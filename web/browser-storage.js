/*
 * Legacy browser journal, retained for migration into account storage.
 * Loading this file performs no storage I/O. The first read/write opens IndexedDB.
 *
 * window.rhythmStorage.read() -> Promise<{json: string, revision: number}>
 * window.rhythmStorage.write(json, expectedRevision) -> Promise<number>
 * window.rhythmStorage.readBackup() -> Promise<{json, revision} | null>
 * window.rhythmStorage.close() -> Promise<void> (testing / page teardown)
 *
 * Rejections are Error objects with .code:
 *   unavailable | corrupt | quota | conflict | invalid
 * A conflict also contains .expectedRevision and .actualRevision.
 *
 * The journal store remains responsible for full habit/entry validation.
 * This adapter validates new JSON/schema shape and its storage envelope, and
 * preserves the exact supplied JSON text (including 64-bit number spellings).
 *
 * Transaction design follows https://www.w3.org/TR/IndexedDB-3/:
 * overlapping readwrite transactions are serialized by IndexedDB; both writes
 * use one transaction; success is reported only by transaction.oncomplete.
 * No fetch, server, cloud, localStorage fallback, automatic reset or migration.
 * Browser eviction / clearing site data still removes the local database.
 */
(function installRhythmStorage(root) {
  'use strict';

  const DATABASE = 'rhythm-habit-journal';
  const VERSION = 1;
  const STORE = 'snapshots';
  const CURRENT = 'current';
  const PREVIOUS = 'previous';
  const EMPTY = '{"schemaVersion":1,"habits":[],"entries":[]}';
  const OPEN_TIMEOUT_MS = 15000;
  let opening = null;
  let live = null;

  class StorageFailure extends Error {
    constructor(code, message, cause) {
      super(message);
      this.name = 'RhythmStorageError';
      this.code = code;
      if (cause !== undefined) this.cause = cause;
    }
  }

  function normalize(error) {
    if (error instanceof StorageFailure) return error;
    if (error && error.name === 'QuotaExceededError') {
      return new StorageFailure('quota', 'Browser storage quota was exceeded.', error);
    }
    if (error && ['DataError', 'DataCloneError', 'NotFoundError'].includes(error.name)) {
      return new StorageFailure('corrupt', 'The local journal storage is inconsistent.', error);
    }
    return new StorageFailure('unavailable', 'Browser journal storage is unavailable.', error);
  }

  function checkJson(json, code) {
    let parsed;
    try {
      if (typeof json !== 'string') throw new TypeError('Expected JSON text.');
      parsed = JSON.parse(json);
    } catch (cause) {
      throw new StorageFailure(code, 'The journal is not valid JSON.', cause);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
        parsed.schemaVersion !== 1 || !Array.isArray(parsed.habits) ||
        !Array.isArray(parsed.entries)) {
      throw new StorageFailure(code, 'The journal schema is unsupported or malformed.');
    }
  }

  function checkSnapshot(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        value.formatVersion !== 1 || !Number.isSafeInteger(value.revision) ||
        value.revision < 0 || typeof value.updatedAt !== 'string' ||
        !Number.isFinite(Date.parse(value.updatedAt))) {
      throw new StorageFailure('corrupt', 'The stored journal revision is invalid.');
    }
    // Payload corruption is reported by the journal decoder after it retains the
    // observed revision. An explicit user import may then CAS-replace the raw
    // corrupt payload and preserve those exact bytes in PREVIOUS.
    if (typeof value.json !== 'string') {
      throw new StorageFailure('corrupt', 'The stored journal payload is not text.');
    }
    return value;
  }

  function snapshot(json, revision) {
    return {formatVersion: 1, json, revision, updatedAt: new Date().toISOString()};
  }

  function forget(db) {
    if (live === db) {
      live = null;
      opening = null;
    }
  }

  function openDatabase() {
    if (live) return Promise.resolve(live);
    if (opening) return opening;
    const pending = new Promise((resolve, reject) => {
      let request;
      let settled = false;
      let timer;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        root.clearTimeout(timer);
        reject(normalize(error));
      };
      try {
        // Accessing the property itself can throw in restricted/sandboxed pages.
        const factory = root.indexedDB;
        if (!factory || typeof factory.open !== 'function') {
          throw new StorageFailure('unavailable', 'IndexedDB is not available in this browser context.');
        }
        request = factory.open(DATABASE, VERSION);
        timer = root.setTimeout(() => fail(new StorageFailure(
          'unavailable', 'Opening browser storage timed out. Close other Rhythm tabs and retry.'
        )), OPEN_TIMEOUT_MS);
      } catch (error) {
        fail(error);
        return;
      }
      request.onblocked = () => fail(new StorageFailure(
        'unavailable', 'Another page is blocking access to the journal database.'
      ));
      request.onerror = () => fail(request.error);
      request.onupgradeneeded = (event) => {
        if (settled) {
          request.transaction.abort();
          return;
        }
        try {
          // Only a newly created database gets an empty current record. A
          // missing record/store in an existing database is corruption, never
          // interpreted as permission to discard or initialize user data.
          if (event.oldVersion !== 0) {
            throw new StorageFailure('corrupt', 'An unsupported database migration was requested.');
          }
          const store = request.result.createObjectStore(STORE);
          store.put(snapshot(EMPTY, 0), CURRENT);
        } catch (error) {
          fail(error);
          request.transaction.abort();
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        if (settled) {
          db.close();
          return;
        }
        try {
          if (!db.objectStoreNames.contains(STORE)) {
            throw new StorageFailure('corrupt', 'The journal object store is missing.');
          }
          const inspected = db.transaction(STORE, 'readonly').objectStore(STORE);
          if (inspected.keyPath !== null || inspected.autoIncrement) {
            throw new StorageFailure('corrupt', 'The journal object store format is invalid.');
          }
          db.onversionchange = () => {
            forget(db);
            db.close();
          };
          db.onclose = () => forget(db);
          settled = true;
          root.clearTimeout(timer);
          live = db;
          resolve(db);
        } catch (error) {
          db.close();
          fail(error);
        }
      };
    });
    opening = pending;
    // Clearing only our own failed open lets a later user-triggered retry work.
    pending.catch(() => { if (opening === pending) opening = null; });
    return pending;
  }

  function beginTransaction(db, mode) {
    if (mode === 'readwrite') {
      try {
        return db.transaction(STORE, mode, {durability: 'strict'});
      } catch (error) {
        // Older browsers may reject the options argument. Atomicity still
        // holds without it; no claim of guaranteed power-loss durability.
        if (!(error instanceof TypeError)) throw error;
      }
    }
    return db.transaction(STORE, mode);
  }

  function transact(db, mode, operation) {
    return new Promise((resolve, reject) => {
      let transaction;
      let value;
      let failure;
      try {
        transaction = beginTransaction(db, mode);
      } catch (error) {
        reject(normalize(error));
        return;
      }
      const abort = (error) => {
        failure = failure || normalize(error);
        try { transaction.abort(); }
        catch (_) { reject(failure); }
      };
      transaction.onerror = (event) => {
        // Do not preventDefault: failed requests must abort the whole write.
        failure = failure || normalize(event.target.error || transaction.error);
      };
      transaction.onabort = () => reject(failure || normalize(transaction.error));
      transaction.oncomplete = () => {
        if (failure) reject(failure);
        else resolve(value);
      };
      try {
        operation(transaction.objectStore(STORE), (result) => { value = result; }, abort);
      } catch (error) {
        abort(error);
      }
    });
  }

  async function read() {
    const db = await openDatabase();
    return transact(db, 'readonly', (store, result, abort) => {
      const request = store.get(CURRENT);
      request.onsuccess = () => {
        try {
          const current = checkSnapshot(request.result);
          result({json: current.json, revision: current.revision});
        } catch (error) { abort(error); }
      };
    });
  }

  async function write(json, expectedRevision) {
    checkJson(json, 'invalid');
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new StorageFailure('invalid', 'The expected revision must be a non-negative safe integer.');
    }
    const db = await openDatabase();
    return transact(db, 'readwrite', (store, result, abort) => {
      const request = store.get(CURRENT);
      request.onsuccess = () => {
        try {
          const current = checkSnapshot(request.result);
          if (current.revision !== expectedRevision) {
            const conflict = new StorageFailure('conflict', 'The journal was changed in another tab.');
            conflict.expectedRevision = expectedRevision;
            conflict.actualRevision = current.revision;
            throw conflict;
          }
          if (current.revision === Number.MAX_SAFE_INTEGER) {
            throw new StorageFailure('corrupt', 'The journal revision limit has been reached.');
          }
          const nextRevision = current.revision + 1;
          // Both requests are issued synchronously in this active transaction.
          // Any failed request rolls back current AND previous together.
          store.put(current, PREVIOUS);
          store.put(snapshot(json, nextRevision), CURRENT);
          result(nextRevision);
        } catch (error) { abort(error); }
      };
    });
  }

  async function readBackup() {
    const db = await openDatabase();
    return transact(db, 'readonly', (store, result, abort) => {
      const request = store.get(PREVIOUS);
      request.onsuccess = () => {
        try {
          if (request.result === undefined) { result(null); return; }
          const previous = checkSnapshot(request.result);
          result({json: previous.json, revision: previous.revision});
        } catch (error) { abort(error); }
      };
    });
  }

  async function close() {
    if (!opening && !live) return;
    try {
      const db = live || await opening;
      forget(db);
      db.close();
    } catch (_) { /* Cleanup must not hide an earlier storage failure. */ }
  }

  root.rhythmStorage = Object.freeze({read, write, readBackup, close});
})(window);

// account-storage.js replaces this bridge. If that script fails to load, the
// app must not silently save to this browser while claiming an account save.
window.rhythmStorageCall = async function() {
  return JSON.stringify({ok:false, code:'unavailable'});
};
