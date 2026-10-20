/*
 * The account journal is authoritative. IndexedDB is read only to migrate an
 * existing journal into an account that has never had a saved snapshot. Local
 * records are retained; they are never used as an offline fallback.
 * Loading this script performs no I/O. The journal store serializes writes.
 */
(function installAccountStorage(root) {
  'use strict';

  const legacy = root.rhythmStorage;
  const REQUEST_TIMEOUT_MS = 15000;
  let pendingRead = null;

  class StorageFailure extends Error {
    constructor(code, message, cause) {
      super(message);
      this.name = 'RhythmAccountStorageError';
      this.code = code;
      if (cause !== undefined) this.cause = cause;
    }
  }

  function normalize(error) {
    if (error instanceof StorageFailure) return error;
    return new StorageFailure('unavailable', 'The account journal is unavailable.', error);
  }

  function parseJournal(json, code) {
    let value;
    try {
      if (typeof json !== 'string') throw new TypeError('Expected JSON text.');
      value = JSON.parse(json);
    } catch (cause) {
      throw new StorageFailure(code, 'The journal is not valid JSON.', cause);
    }
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        ![1, 2].includes(value.schemaVersion) || !Array.isArray(value.habits) ||
        !Array.isArray(value.entries)) {
      throw new StorageFailure(code, 'The journal schema is unsupported or malformed.');
    }
    return value;
  }

  function checkSnapshot(value, current) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        typeof value.json !== 'string' || !Number.isSafeInteger(value.revision) ||
        value.revision < 0 || (current && typeof value.initialized !== 'boolean')) {
      throw new StorageFailure('corrupt', 'The account journal response is invalid.');
    }
    if (current) {
      if (value.initialized) {
        if (value.revision === 0) {
          throw new StorageFailure('corrupt', 'A saved account journal has no revision.');
        }
      } else {
        const empty = parseJournal(value.json, 'corrupt');
        if (value.revision !== 0 || empty.habits.length || empty.entries.length) {
          throw new StorageFailure('corrupt', 'The empty account journal response is inconsistent.');
        }
      }
    }
    // Retain the exact bytes, including JSON number spellings. The journal validator checks
    // existing payloads after retaining their revision for explicit recovery.
    return value;
  }

  async function request(path, options = {}) {
    let timeout;
    try {
      // The auth guard also conceals and locks the page if the session expires.
      // Re-checking permits recovery after signing in again in another tab.
      if (root.rhythmAuth) {
        await root.rhythmAuth.check();
        if (!root.rhythmAuth.active) throw new Error('Authentication required.');
      }
      const controller = new root.AbortController();
      timeout = root.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const response = await root.fetch(path, {
        ...options, credentials: 'same-origin', cache: 'no-store',
        redirect: 'error', signal: controller.signal,
      });
      if (!response.ok) {
        let errorCode;
        try { errorCode = (await response.json()).error; } catch (_) { /* Status still fails closed. */ }
        const code = response.status === 409
          ? (errorCode === 'REVISION_LIMIT' ? 'revision-limit' : 'conflict')
          : response.status === 400 ? 'invalid'
          : response.status === 413 ? 'quota' : 'unavailable';
        throw new StorageFailure(code, 'The account journal request failed.');
      }
      try { return await response.json(); }
      catch (cause) { throw new StorageFailure('corrupt', 'The account journal response is not JSON.', cause); }
    } catch (error) {
      throw normalize(error);
    } finally {
      if (timeout !== undefined) root.clearTimeout(timeout);
    }
  }

  async function readServer() {
    return checkSnapshot(await request('/api/journal'), true);
  }

  async function write(json, expectedRevision) {
    parseJournal(json, 'invalid');
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new StorageFailure('invalid', 'The expected revision must be a non-negative safe integer.');
    }
    if (expectedRevision === Number.MAX_SAFE_INTEGER) {
      throw new StorageFailure('revision-limit', 'The journal revision limit has been reached.');
    }
    const result = await request('/api/journal', {
      method: 'PUT', headers: {'Content-Type': 'application/json', 'X-Rhythm-Request': '1'},
      body: JSON.stringify({json, expectedRevision}),
    });
    if (!result || typeof result !== 'object' || Array.isArray(result) ||
        !Number.isSafeInteger(result.revision) || result.revision !== expectedRevision + 1) {
      throw new StorageFailure('corrupt', 'The account journal save confirmation is invalid.');
    }
    return result.revision;
  }

  async function load() {
    const account = await readServer();
    if (account.initialized) return {json: account.json, revision: account.revision};
    try {
      // An unavailable legacy database must not affect an established account.
      // For a new account, fail instead of hiding data we could not inspect.
      if (!legacy || typeof legacy.read !== 'function') {
        throw new StorageFailure('unavailable', 'The previous browser journal cannot be checked.');
      }
      const local = await legacy.read();
      const journal = parseJournal(local.json, 'corrupt');
      if (!journal.habits.length && !journal.entries.length) {
        return {json: account.json, revision: account.revision};
      }
      try {
        const revision = await write(local.json, 0);
        return {json: local.json, revision};
      } catch (error) {
        if (!['conflict', 'unavailable', 'corrupt'].includes(error.code)) throw error;
        // Another browser may have initialized this account, or our successful
        // PUT response may have been lost. Read the winner; never replay/merge
        // the local snapshot over an existing account journal.
        const observed = await readServer();
        if (observed.initialized) return {json: observed.json, revision: observed.revision};
        throw error;
      }
    } catch (error) {
      // The account's revision was authenticated and observed even though the
      // browser migration failed. Permit an explicit JSON restore with CAS0,
      // while keeping normal editing blocked. If another client (or our lost
      // PUT) has since committed, the restore conflicts instead of overwriting.
      const failure = new StorageFailure(error.code || 'unavailable',
        'The previous browser journal could not be migrated.', error);
      failure.observedRevision = account.revision;
      throw failure;
    }
  }

  function read() {
    if (pendingRead) return pendingRead;
    const result = load();
    pendingRead = result;
    const release = () => { if (pendingRead === result) pendingRead = null; };
    result.then(release, release);
    return result;
  }

  async function readBackup() {
    const result = await request('/api/journal/backup');
    if (result === null) return null;
    const previous = checkSnapshot(result, false);
    return {json: previous.json, revision: previous.revision};
  }

  root.rhythmAccountStorage = Object.freeze({read, write, readBackup});
  root.rhythmStorageCall = async function(method, json, revision) {
    try {
      let value;
      if (method === 'read') value = await read();
      else if (method === 'backup') value = await readBackup();
      else if (method === 'write') value = await write(json, revision);
      else throw new StorageFailure('invalid', 'Unknown storage action.');
      return JSON.stringify({ok: true, value});
    } catch (error) {
      return JSON.stringify({ok: false, code: error.code || 'unavailable',
        ...(Number.isSafeInteger(error.observedRevision) && error.observedRevision >= 0
          ? {observedRevision: error.observedRevision} : {}),
      });
    }
  };
})(window);
