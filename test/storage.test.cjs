'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {IDBFactory, IDBObjectStore} = require('fake-indexeddb');
const sourcePath = process.env.RHYTHM_STORAGE_SOURCE || require('node:path').join(__dirname, '../web/browser-storage.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const DB = 'rhythm-habit-journal';
const EMPTY = '{"schemaVersion":1,"habits":[],"entries":[]}';
const journal = note => JSON.stringify({schemaVersion: 1, habits: [], entries: [], testNote: note});
const envelope = (json, revision) => ({formatVersion: 1, json, revision, updatedAt: new Date().toISOString()});

function client(factory = new IDBFactory()) {
  const window = {indexedDB: factory, setTimeout, clearTimeout};
  vm.runInNewContext(source, {window}, {filename: 'rhythm-web-browser-storage.js'});
  return {api: window.rhythmStorage, window, factory};
}
function nativeOpen(factory, version = 1, upgrade) {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB, version);
    req.onupgradeneeded = () => { if (upgrade) upgrade(req.result, req.transaction); };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
  });
}
async function rawOperation(factory, callback) {
  const db = await nativeOpen(factory);
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction('snapshots', 'readwrite');
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
      callback(tx.objectStore('snapshots'));
    });
  } finally { db.close(); }
}
async function rawRead(factory, key) {
  const db = await nativeOpen(factory);
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('snapshots');
      const req = tx.objectStore('snapshots').get(key);
      let result;
      req.onsuccess = () => { result = req.result; };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
const code = value => error => error && error.code === value;

// VM-created values have a different Object prototype. Compare public scalar
// fields instead of making prototype identity part of the integration contract.
test('lazy installation; first read yields revision zero and no backup', async () => {
  const item = client();
  assert.equal((await item.factory.databases()).length, 0);
  const loaded = await item.api.read();
  assert.equal(loaded.json, EMPTY);
  assert.equal(loaded.revision, 0);
  assert.equal(await item.api.readBackup(), null);
  assert.equal((await item.factory.databases()).length, 1);
  await item.api.close();
});

test('successful writes preserve exact previous bytes and increment revisions', async () => {
  const item = client();
  await item.api.read();
  const first = journal('first 阅读');
  const second = ` ${journal('second')}\n`;
  assert.equal(await item.api.write(first, 0), 1);
  assert.equal((await item.api.readBackup()).json, EMPTY);
  assert.equal(await item.api.write(second, 1), 2);
  assert.equal((await item.api.read()).json, second);
  assert.equal((await item.api.read()).revision, 2);
  assert.equal((await item.api.readBackup()).json, first);
  assert.equal((await item.api.readBackup()).revision, 1);
  await item.api.close();
});

test('simultaneous writers in separate clients use atomic compare-and-swap', async () => {
  const factory = new IDBFactory();
  const one = client(factory), two = client(factory);
  await Promise.all([one.api.read(), two.api.read()]);
  const candidates = [journal('one'), journal('two')];
  const outcomes = await Promise.allSettled([
    one.api.write(candidates[0], 0), two.api.write(candidates[1], 0),
  ]);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  const failure = outcomes.find(result => result.status === 'rejected').reason;
  assert.equal(failure.code, 'conflict');
  assert.equal(failure.expectedRevision, 0);
  assert.equal(failure.actualRevision, 1);
  const winning = outcomes.findIndex(result => result.status === 'fulfilled');
  assert.equal((await one.api.read()).json, candidates[winning]);
  assert.equal((await one.api.readBackup()).json, EMPTY);
  assert.equal(await two.api.write(journal('explicit retry after refresh'), 1), 2);
  assert.equal((await one.api.readBackup()).json, candidates[winning]);
  await Promise.all([one.api.close(), two.api.close()]);
});

test('stale revision leaves current and previous snapshots unchanged', async () => {
  const item = client();
  await item.api.write(journal('one'), 0);
  await item.api.write(journal('two'), 1);
  const beforeCurrent = await rawRead(item.factory, 'current');
  const beforePrevious = await rawRead(item.factory, 'previous');
  await assert.rejects(item.api.write(journal('bad stale'), 0), code('conflict'));
  assert.deepEqual(await rawRead(item.factory, 'current'), beforeCurrent);
  assert.deepEqual(await rawRead(item.factory, 'previous'), beforePrevious);
  await item.api.close();
});

test('quota failure after backup put rolls back both snapshots', async () => {
  const item = client();
  await item.api.write(journal('one'), 0);
  await item.api.write(journal('two'), 1);
  const beforeCurrent = await rawRead(item.factory, 'current');
  const beforePrevious = await rawRead(item.factory, 'previous');
  const original = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function(value, key) {
    if (key === 'current') throw new DOMException('Injected quota failure', 'QuotaExceededError');
    return original.call(this, value, key);
  };
  try {
    await assert.rejects(item.api.write(journal('three'), 2), code('quota'));
  } finally { IDBObjectStore.prototype.put = original; }
  assert.deepEqual(await rawRead(item.factory, 'current'), beforeCurrent);
  assert.deepEqual(await rawRead(item.factory, 'previous'), beforePrevious);
  assert.equal(await item.api.write(journal('retry'), 2), 3);
  await item.api.close();
});

test('request success followed by transaction abort is never reported as saved', async () => {
  const item = client();
  await item.api.write(journal('one'), 0);
  const beforeCurrent = await rawRead(item.factory, 'current');
  const beforePrevious = await rawRead(item.factory, 'previous');
  const original = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function(value, key) {
    const req = original.call(this, value, key);
    if (key === 'current') req.addEventListener('success', () => this.transaction.abort());
    return req;
  };
  try {
    await assert.rejects(item.api.write(journal('two'), 1), code('unavailable'));
  } finally { IDBObjectStore.prototype.put = original; }
  assert.deepEqual(await rawRead(item.factory, 'current'), beforeCurrent);
  assert.deepEqual(await rawRead(item.factory, 'previous'), beforePrevious);
  await item.api.close();
});

test('corrupt JSON retains its observed revision and exact bytes on explicit restore', async () => {
  const item = client();
  await item.api.read();
  const corrupt = '{"interrupted journal":';
  await rawOperation(item.factory, store => store.put(envelope(corrupt, 4), 'current'));
  const loaded = await item.api.read();
  assert.equal(loaded.json, corrupt);
  assert.equal(loaded.revision, 4);
  assert.throws(() => JSON.parse(loaded.json)); // The Dart decoder owns this error.
  assert.equal(await item.api.write(journal('user restored valid JSON'), 4), 5);
  assert.equal((await item.api.readBackup()).json, corrupt);
  assert.equal((await item.api.readBackup()).revision, 4);
  await item.api.close();
});

test('bad envelope and missing current record are errors, never automatic resets', async () => {
  const item = client();
  await item.api.write(journal('valid backup'), 0);
  await item.api.write(journal('valid current'), 1);
  const previous = await rawRead(item.factory, 'previous');
  const corrupt = {json: journal('damaged envelope'), revision: 2};
  await rawOperation(item.factory, store => store.put(corrupt, 'current'));
  await assert.rejects(item.api.read(), code('corrupt'));
  await assert.rejects(item.api.write(journal('must not overwrite'), 2), code('corrupt'));
  assert.deepEqual(await rawRead(item.factory, 'current'), corrupt);
  assert.deepEqual(await rawRead(item.factory, 'previous'), previous);
  await rawOperation(item.factory, store => store.delete('current'));
  await assert.rejects(item.api.read(), code('corrupt'));
  await item.api.close();
  const reopened = client(item.factory);
  await assert.rejects(reopened.api.read(), code('corrupt'));
  assert.equal(await rawRead(item.factory, 'current'), undefined);
  assert.equal((await reopened.api.readBackup()).json, journal('valid backup'));
  await reopened.api.close();
});

test('invalid new JSON and revision arguments fail before opening a database', async () => {
  const item = client();
  for (const json of ['invalid', 'null', '[]', '{}', '{"schemaVersion":2,"habits":[],"entries":[]}']) {
    await assert.rejects(item.api.write(json, 0), code('invalid'));
  }
  for (const revision of [-1, 0.5, NaN, Infinity, '0', null, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(item.api.write(EMPTY, revision), code('invalid'));
  }
  assert.equal((await item.factory.databases()).length, 0);
});

test('unavailable or blocked storage rejects, and later explicit retry may recover', async () => {
  const item = client(null);
  await assert.rejects(item.api.read(), code('unavailable'));
  Object.defineProperty(item.window, 'indexedDB', {configurable: true,
    get() { throw new DOMException('Restricted browser context', 'SecurityError'); }});
  await assert.rejects(item.api.read(), code('unavailable'));
  Object.defineProperty(item.window, 'indexedDB', {configurable: true,
    value: {open() { const req = {}; queueMicrotask(() => req.onblocked()); return req; }}});
  await assert.rejects(item.api.read(), code('unavailable'));
  Object.defineProperty(item.window, 'indexedDB', {value: new IDBFactory()});
  assert.equal((await item.api.read()).revision, 0);
  await item.api.close();
});

test('unexpected existing database format is preserved', async () => {
  const factory = new IDBFactory();
  const db = await nativeOpen(factory, 1, db => {
    db.createObjectStore('unexpected').put('preserve me', 'value');
  });
  db.close();
  const item = client(factory);
  await assert.rejects(item.api.read(), code('corrupt'));
  const reopened = await nativeOpen(factory);
  assert.equal(reopened.objectStoreNames.contains('unexpected'), true);
  assert.equal(reopened.objectStoreNames.contains('snapshots'), false);
  reopened.close();
});

test('revision overflow is rejected without touching the previous snapshot', async () => {
  const item = client();
  await item.api.read();
  await rawOperation(item.factory, store => store.put(envelope(EMPTY, Number.MAX_SAFE_INTEGER), 'current'));
  await assert.rejects(item.api.write(journal('overflow'), Number.MAX_SAFE_INTEGER), code('corrupt'));
  assert.equal((await item.api.read()).revision, Number.MAX_SAFE_INTEGER);
  assert.equal(await item.api.readBackup(), null);
  await item.api.close();
});

test('a 64-bit JSON number spelling is never normalized by JavaScript parsing', async () => {
  const item = client();
  const json = '{"schemaVersion":1,"habits":[],"entries":[],"testInteger":9223372036854775807}';
  assert.equal(await item.api.write(json, 0), 1);
  assert.equal((await item.api.read()).json, json);
  await item.api.write(journal('next'), 1);
  assert.equal((await item.api.readBackup()).json, json);
  await item.api.close();
});

test('versionchange releases the connection instead of blocking future upgrades', async () => {
  const item = client();
  await item.api.write(journal('keep'), 0);
  const upgraded = await nativeOpen(item.factory, 2);
  upgraded.close();
  await assert.rejects(item.api.read(), code('unavailable'));
  const inspect = await nativeOpen(item.factory, 2);
  assert.equal(inspect.objectStoreNames.contains('snapshots'), true);
  inspect.close();
});


test('opening timeout rejects and late success closes only the abandoned connection', async () => {
  const item = client(null);
  const request = {};
  let fireTimeout;
  let abandonedClosed = 0;
  item.window.indexedDB = {open() { return request; }};
  item.window.setTimeout = callback => { fireTimeout = callback; return 1; };
  item.window.clearTimeout = () => {};
  const pending = item.api.read();
  fireTimeout();
  await assert.rejects(pending, code('unavailable'));

  // Explicit retry starts a fresh connection; late success of the old request
  // must neither activate the stale connection nor disturb the new one.
  item.window.indexedDB = new IDBFactory();
  item.window.setTimeout = setTimeout;
  item.window.clearTimeout = clearTimeout;
  assert.equal((await item.api.read()).revision, 0);
  request.result = {close() { abandonedClosed++; }};
  request.onsuccess();
  assert.equal(abandonedClosed, 1);
  assert.equal(await item.api.write(journal('retry remained live'), 0), 1);
  assert.equal((await item.api.read()).json, journal('retry remained live'));
  await item.api.close();
});

test('late upgrade after an opening timeout aborts without initializing data', async () => {
  const item = client(null);
  const request = {};
  let fireTimeout;
  let aborted = 0;
  let initialized = 0;
  item.window.indexedDB = {open() { return request; }};
  item.window.setTimeout = callback => { fireTimeout = callback; return 1; };
  item.window.clearTimeout = () => {};
  const pending = item.api.read();
  fireTimeout();
  await assert.rejects(pending, code('unavailable'));
  request.transaction = {abort() { aborted++; }};
  request.result = {createObjectStore() { initialized++; }};
  request.onupgradeneeded({oldVersion: 0});
  assert.equal(aborted, 1);
  assert.equal(initialized, 0);
});
