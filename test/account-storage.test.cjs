'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {IDBFactory} = require('fake-indexeddb');
const browserSource = fs.readFileSync(path.join(__dirname, '../web/browser-storage.js'), 'utf8');
const accountSource = fs.readFileSync(path.join(__dirname, '../web/account-storage.js'), 'utf8');
const EMPTY = '{"schemaVersion":1,"habits":[],"entries":[]}';
const journal = name => JSON.stringify({schemaVersion: 1, habits: [{
  id: 'ABCDEF12-1234-1234-1234-ABCDEF123456', title: name, kind: 'duration',
  startDay: '2026-10-01', targetMinutes: 30,
}], entries: [{habitID: 'ABCDEF12-1234-1234-1234-ABCDEF123456', day: '2026-10-01', minutes: 45}]});
const code = value => error => error && error.code === value;
const response = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: {'Content-Type': 'application/json'},
});

function server(initial = null) {
  const state = {current: initial, previous: null, requests: [], commits: 0};
  state.fetch = async (url, options = {}) => {
    state.requests.push({url, options});
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    if (url === '/api/journal/backup') return response(state.previous);
    assert.equal(url, '/api/journal');
    if (options.method === 'PUT') {
      assert.equal(options.headers['Content-Type'], 'application/json');
      assert.equal(options.headers['X-Rhythm-Request'], '1');
      const body = JSON.parse(options.body);
      const revision = state.current?.revision ?? 0;
      if (body.expectedRevision !== revision) return response({error: 'CONFLICT'}, 409);
      state.previous = state.current && {json: state.current.json, revision};
      state.current = {json: body.json, revision: revision + 1, initialized: true};
      state.commits++;
      return response({revision: state.current.revision});
    }
    return response(state.current ?? {json: EMPTY, revision: 0, initialized: false});
  };
  return state;
}

function client(fetch, factory = new IDBFactory(), auth) {
  const window = {indexedDB: factory, setTimeout, clearTimeout, AbortController, fetch};
  if (auth) window.rhythmAuth = auth;
  vm.runInNewContext(browserSource, {window});
  const local = window.rhythmStorage;
  vm.runInNewContext(accountSource, {window});
  return {window, factory, local, api: window.rhythmAccountStorage,
    call: async (...args) => JSON.parse(await window.rhythmStorageCall(...args))};
}

test('missing account adapter fails closed instead of reading or writing the browser journal', async () => {
  const window = {indexedDB: new IDBFactory(), setTimeout, clearTimeout};
  vm.runInNewContext(browserSource, {window});
  await window.rhythmStorage.write(journal('Legacy data'), 0);
  for (const method of ['read', 'write', 'backup']) {
    assert.deepEqual(JSON.parse(await window.rhythmStorageCall(method, journal('Must not save'), 1)),
      {ok: false, code: 'unavailable'});
  }
  assert.equal((await window.rhythmStorage.read()).json, journal('Legacy data'));
  assert.equal((await window.rhythmStorage.read()).revision, 1);
  await window.rhythmStorage.close();
});

test('installation performs no I/O; empty new browser does not initialize the account', async () => {
  const remote = server();
  const item = client(remote.fetch);
  assert.equal(remote.requests.length, 0);
  assert.equal((await item.factory.databases()).length, 0);
  const loaded = await item.api.read();
  assert.equal(loaded.json, EMPTY);
  assert.equal(loaded.revision, 0);
  assert.equal(remote.commits, 0);
  assert.equal(item.window.rhythmStorage, item.local);
  await item.local.close();
});

test('migrates nonempty browser journal once, preserving exact text and all local snapshots', async () => {
  const remote = server();
  const item = client(remote.fetch);
  const old = journal('Previous');
  const exact = ` \n${journal('Чтение 阅读')}\n`;
  await item.local.write(old, 0);
  await item.local.write(exact, 1);
  const loaded = await item.call('read');
  assert.deepEqual(loaded, {ok: true, value: {json: exact, revision: 1}});
  assert.equal(remote.current.json, exact);
  assert.equal((await item.local.read()).json, exact);
  assert.equal((await item.local.read()).revision, 2);
  assert.equal((await item.local.readBackup()).json, old);
  assert.equal((await item.api.read()).json, exact);
  assert.equal(remote.commits, 1);
  await item.local.close();
});

test('established account loads without opening unavailable IndexedDB', async () => {
  const remote = server({json: journal('Account'), revision: 9, initialized: true});
  const item = client(remote.fetch, null);
  assert.equal((await item.api.read()).json, remote.current.json);
  assert.equal((await item.api.read()).revision, 9);
  assert.equal(remote.commits, 0);
});

test('version 2 categorized sessions keep separate repeated topics through account saves and backups', async () => {
  const snapshot = JSON.parse(journal('Learning'));
  snapshot.schemaVersion = 2;
  snapshot.habits[0].options = ['Sample category'];
  snapshot.entries[0].sessions = [{topic: 'Sample category', minutes: 15}, {topic: 'Sample category', minutes: 30}];
  const exact = JSON.stringify(snapshot);
  const remote = server({json: exact, revision: 1, initialized: true});
  const item = client(remote.fetch, null);
  assert.equal((await item.api.read()).json, exact);
  snapshot.entries[0].minutes = 55;
  snapshot.entries[0].sessions.push({topic: 'Sample category', minutes: 10});
  const next = JSON.stringify(snapshot);
  assert.equal(await item.api.write(next, 1), 2);
  assert.equal((await item.api.read()).json, next);
  assert.equal((await item.api.readBackup()).json, exact);
});

test('an intentionally empty saved account is never overwritten by old local entries', async () => {
  const remote = server({json: EMPTY, revision: 7, initialized: true});
  const item = client(remote.fetch);
  await item.local.write(journal('Old browser'), 0);
  assert.equal((await item.api.read()).json, EMPTY);
  assert.equal(remote.commits, 0);
  assert.equal((await item.local.read()).json, journal('Old browser'));
  await item.local.close();
});

test('two browsers racing to migrate read one CAS winner without merging or overwriting', async () => {
  const remote = server();
  const one = client(remote.fetch), two = client(remote.fetch);
  await one.local.write(journal('First browser'), 0);
  await two.local.write(journal('Second browser'), 0);
  const loaded = await Promise.all([one.api.read(), two.api.read()]);
  assert.equal(remote.commits, 1);
  assert.equal(loaded[0].json, remote.current.json);
  assert.equal(loaded[1].json, remote.current.json);
  assert.equal(loaded[0].revision, 1);
  assert.equal(loaded[1].revision, 1);
  assert.equal((await one.local.read()).json, journal('First browser'));
  assert.equal((await two.local.read()).json, journal('Second browser'));
  await Promise.all([one.local.close(), two.local.close()]);
});

test('simultaneous reads in one page share the migration and later reads refresh the account', async () => {
  const remote = server();
  const item = client(remote.fetch);
  await item.local.write(journal('Local'), 0);
  const loaded = await Promise.all([item.api.read(), item.api.read(), item.api.read()]);
  assert.equal(loaded.length, 3);
  assert.equal(remote.requests.length, 2);
  assert.equal(remote.commits, 1);
  remote.current = {json: journal('Other browser update'), revision: 2, initialized: true};
  assert.equal((await item.api.read()).json, remote.current.json);
  await item.local.close();
});

test('a lost migration response is resolved by reading the saved account without replaying PUT', async () => {
  const remote = server();
  const item = client(async (url, options) => {
    const result = await remote.fetch(url, options);
    if (options.method === 'PUT') throw new TypeError('Response lost');
    return result;
  });
  await item.local.write(journal('Migrated'), 0);
  const loaded = await item.api.read();
  assert.equal(loaded.json, journal('Migrated'));
  assert.equal(loaded.revision, 1);
  assert.equal(remote.commits, 1);
  assert.equal(remote.requests.filter(req => req.options.method === 'PUT').length, 1);
  await item.local.close();
});

test('a failed migration with no committed account fails closed and may be retried explicitly', async () => {
  const remote = server();
  let offline = true;
  const item = client(async (url, options) => {
    if (options.method === 'PUT' && offline) throw new TypeError('Offline');
    return remote.fetch(url, options);
  });
  await item.local.write(journal('Must remain safe'), 0);
  await assert.rejects(item.api.read(), code('unavailable'));
  assert.equal(remote.current, null);
  assert.equal((await item.local.read()).json, journal('Must remain safe'));
  offline = false;
  assert.equal((await item.api.read()).json, journal('Must remain safe'));
  assert.equal(remote.commits, 1);
  await item.local.close();
});

test('network, authentication, and server failures never display the local journal as saved', async () => {
  for (const fail of [
    async () => { throw new TypeError('Offline'); },
    async () => response({error: 'AUTHENTICATION_REQUIRED'}, 401),
    async () => response({error: 'REQUEST_REJECTED'}, 403),
    async () => response({error: 'JOURNAL_UNAVAILABLE'}, 503),
    async () => new Response('<html>Sign in</html>'),
  ]) {
    const item = client(fail);
    await item.local.write(journal('Local only'), 0);
    const loaded = await item.call('read');
    assert.equal(loaded.ok, false);
    assert.ok(['unavailable', 'corrupt'].includes(loaded.code));
    assert.equal('value' in loaded, false);
    assert.equal((await item.local.read()).json, journal('Local only'));
    await item.local.close();
  }
});

test('unavailable local storage blocks migration without creating an empty account', async () => {
  const remote = server();
  const item = client(remote.fetch, null);
  await assert.rejects(item.api.read(), code('unavailable'));
  assert.equal(remote.current, null);
  assert.equal(remote.commits, 0);
});

test('corrupt browser journal is retained and never uploaded or replaced with empty data', async () => {
  const remote = server();
  const item = client(remote.fetch);
  await item.local.read();
  await new Promise((resolve, reject) => {
    const opening = item.factory.open('rhythm-habit-journal', 1);
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result;
      const tx = db.transaction('snapshots', 'readwrite');
      tx.objectStore('snapshots').put({formatVersion: 1, revision: 3,
        json: '{incomplete', updatedAt: new Date().toISOString()}, 'current');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  });
  await assert.rejects(item.api.read(), code('corrupt'));
  assert.equal(remote.commits, 0);
  assert.equal(remote.current, null);
  assert.deepEqual(await item.call('read'), {ok: false, code: 'corrupt', observedRevision: 0});
  // An explicit restore can now CAS against the verified empty account while
  // the damaged local record remains intact for inspection/recovery.
  assert.deepEqual(await item.call('write', journal('User restored backup'), 0), {ok: true, value: 1});
  assert.equal((await item.api.read()).json, journal('User restored backup'));
  assert.equal((await item.local.read()).json, '{incomplete');
  await item.local.close();
});

test('lost migration response and failed recovery read cannot report local data as saved', async () => {
  const remote = server();
  let disconnected = false;
  const item = client(async (url, options) => {
    if (disconnected) throw new TypeError('Offline');
    const result = await remote.fetch(url, options);
    if (options.method === 'PUT') {
      disconnected = true;
      throw new TypeError('Disconnected after commit');
    }
    return result;
  });
  await item.local.write(journal('Preserved'), 0);
  assert.deepEqual(await item.call('read'), {ok: false, code: 'unavailable', observedRevision: 0});
  assert.equal(remote.commits, 1);
  disconnected = false;
  assert.equal((await item.api.read()).json, journal('Preserved'));
  assert.equal(remote.commits, 1);
  await item.local.close();
});

test('writes and backups use the account even in an unrelated fresh browser', async () => {
  const remote = server({json: journal('Original'), revision: 3, initialized: true});
  const one = client(remote.fetch), two = client(remote.fetch, null);
  assert.equal(await two.api.readBackup(), null);
  assert.equal(await one.api.write(journal('Saved in first browser'), 3), 4);
  assert.equal((await two.api.read()).json, journal('Saved in first browser'));
  assert.equal((await two.api.readBackup()).json, journal('Original'));
  assert.equal((await two.api.readBackup()).revision, 3);
  assert.equal((await one.factory.databases()).length, 0);
  const result = await two.call('write', journal('Saved in second browser'), 4);
  assert.deepEqual(result, {ok: true, value: 5});
  assert.equal((await one.api.read()).json, journal('Saved in second browser'));
});

test('stale writes surface conflict, preserving both current and previous snapshots', async () => {
  const remote = server({json: journal('Before'), revision: 3, initialized: true});
  const item = client(remote.fetch);
  await item.api.write(journal('Winner'), 3);
  assert.deepEqual(await item.call('write', journal('Stale'), 3), {ok: false, code: 'conflict'});
  assert.equal(remote.current.json, journal('Winner'));
  assert.equal(remote.previous.json, journal('Before'));
  assert.equal(remote.commits, 1);
});

test('an ordinary write with a lost response is not reported as saved', async () => {
  const remote = server({json: journal('Before'), revision: 3, initialized: true});
  const item = client(async (url, options) => {
    const result = await remote.fetch(url, options);
    if (options.method === 'PUT') throw new TypeError('Lost response');
    return result;
  });
  assert.deepEqual(await item.call('write', journal('After'), 3), {ok: false, code: 'unavailable'});
  assert.equal((await item.api.read()).json, journal('After'));
  assert.equal(remote.commits, 1);
});

test('invalid write input, unsafe revisions and overflow fail before network or local I/O', async () => {
  const remote = server();
  const item = client(remote.fetch);
  for (const invalid of ['invalid', '{}', 'null', '[]', '{"schemaVersion":3,"habits":[],"entries":[]}']) {
    await assert.rejects(item.api.write(invalid, 0), code('invalid'));
  }
  for (const revision of [-1, 0.5, NaN, Infinity, '0', null, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(item.api.write(EMPTY, revision), code('invalid'));
  }
  await assert.rejects(item.api.write(EMPTY, Number.MAX_SAFE_INTEGER), code('revision-limit'));
  assert.equal(remote.requests.length, 0);
  assert.equal((await item.factory.databases()).length, 0);
});

test('malformed account envelopes never trigger migration or return local data', async () => {
  const malformed = [null, [], {}, {json: EMPTY, revision: 0},
    {json: EMPTY, revision: 0, initialized: true},
    {json: EMPTY, revision: 1, initialized: false},
    {json: journal('Unexpected'), revision: 0, initialized: false},
    {json: 17, revision: 1, initialized: true},
    ...[-1, 0.1, '1', Number.MAX_SAFE_INTEGER + 1].map(revision => ({json: EMPTY, revision, initialized: true})),
  ];
  for (const value of malformed) {
    let calls = 0;
    const item = client(async () => { calls++; return response(value); });
    await assert.rejects(item.api.read(), code('corrupt'));
    assert.equal(calls, 1);
    assert.equal((await item.factory.databases()).length, 0);
  }
});

test('malformed save acknowledgements and backups are errors, not success', async () => {
  for (const value of [null, [], {}, {revision: 0}, {revision: '1'}, {revision: 2}, {revision: Number.MAX_SAFE_INTEGER + 1}]) {
    const item = client(async () => response(value));
    await assert.rejects(item.api.write(EMPTY, 0), code('corrupt'));
  }
  for (const value of [[], {}, {json: 5, revision: 1}, {json: EMPTY, revision: -1}]) {
    const item = client(async () => response(value));
    await assert.rejects(item.api.readBackup(), code('corrupt'));
  }
});

test('HTTP status and server revision limit map to repository failures', async () => {
  for (const [status, error, expected] of [
    [400, 'INVALID_JOURNAL', 'invalid'], [413, 'JOURNAL_TOO_LARGE', 'quota'],
    [409, 'CONFLICT', 'conflict'], [409, 'REVISION_LIMIT', 'revision-limit'],
    [401, 'AUTHENTICATION_REQUIRED', 'unavailable'], [403, 'REQUEST_REJECTED', 'unavailable'],
    [503, 'JOURNAL_UNAVAILABLE', 'unavailable'],
  ]) {
    const item = client(async () => response({error}, status));
    assert.deepEqual(await item.call('write', EMPTY, 0), {ok: false, code: expected});
  }
});

test('raw payload bytes including 64-bit spellings survive account reads, writes and backups', async () => {
  const exact = '{"schemaVersion":1,"habits":[],"entries":[],"customInteger":9223372036854775807}\n';
  const remote = server();
  const item = client(remote.fetch);
  assert.equal(await item.api.write(exact, 0), 1);
  assert.equal((await item.api.read()).json, exact);
  await item.api.write(EMPTY, 1);
  assert.equal((await item.api.readBackup()).json, exact);
  // The Dart decoder owns existing payload validation and needs the revision
  // to allow explicit restoration while the server keeps the corrupt backup.
  remote.current = {json: '{corrupt', revision: 3, initialized: true};
  assert.equal((await item.api.read()).json, '{corrupt');
  assert.equal((await item.api.read()).revision, 3);
});

test('auth guard completes before any account request and locked access never reads local data', async () => {
  const remote = server({json: EMPTY, revision: 1, initialized: true});
  let checks = 0;
  const auth = {active: false, async check() { checks++; this.active = true; }};
  const item = client(remote.fetch, new IDBFactory(), auth);
  assert.equal((await item.api.read()).revision, 1);
  assert.equal(checks, 1);
  auth.check = async () => { throw new Error('Session expired'); };
  assert.deepEqual(await item.call('read'), {ok: false, code: 'unavailable'});
  assert.equal(remote.requests.length, 1);
  assert.equal((await item.factory.databases()).length, 0);
});

test('request timeout aborts a hung fetch and releases the read for explicit retry', async () => {
  const remote = server({json: EMPTY, revision: 1, initialized: true});
  const item = client(async (_url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')));
  }));
  let expire;
  item.window.setTimeout = callback => { expire = callback; return 1; };
  item.window.clearTimeout = () => {};
  const waiting = item.api.read();
  expire();
  await assert.rejects(waiting, code('unavailable'));
  assert.equal((await item.factory.databases()).length, 0);
  item.window.fetch = remote.fetch;
  item.window.setTimeout = setTimeout;
  item.window.clearTimeout = clearTimeout;
  assert.equal((await item.api.read()).revision, 1);
});
