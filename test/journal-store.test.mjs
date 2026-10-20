import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createJournalStore, journalError} from '../src/journal-store.js';
import {dailyHabits, emptyEntry, parseJournal, serializeJournal} from '../src/journal.js';
import {validateJournal} from '../worker/journal.mjs';

const id = 'ABCDEF00-0000-4000-8000-000000000001';
const checkId = 'ABCDEF00-0000-4000-8000-000000000002';
const day = '2026-10-15';
const timed = {
  id, title: 'Example learning', note: '', kind: 'duration', colorHex: '6C5CE7',
  symbol: 'book', unit: '', startDay: '2026-10-01', options: ['Reading', 'Practice'],
  targetMinutes: 60, targetNumber: 1,
};
const entry = (minutes, overrides = {}) => ({...emptyEntry(id, day), minutes, ...overrides});
const initial = {
  schemaVersion: 2,
  habits: [timed, {...timed, id: checkId, kind: 'check', title: 'Example walk', options: []}],
  entries: [entry(15)],
};
const accountAdapterSource = await readFile(new URL('../web/account-storage.js', import.meta.url), 'utf8');

function accountClient(remote, legacyRead) {
  const window = {
    AbortController, setTimeout, clearTimeout,
    rhythmStorage: {read: legacyRead},
    rhythmAuth: {active: true, check: async () => {}},
    fetch: async (url, options) => {
      const response = (body, status = 200) => new Response(JSON.stringify(body), {status});
      if (url === '/api/journal/backup') return response(remote.previous ?? null);
      if (options.method === 'PUT') {
        const body = JSON.parse(options.body);
        validateJournal(body.json);
        if (body.expectedRevision !== (remote.current?.revision ?? 0)) return response({error: 'CONFLICT'}, 409);
        remote.previous = remote.current;
        remote.current = {json: body.json, revision: body.expectedRevision + 1, initialized: true};
        remote.writes++;
        return response({revision: remote.current.revision});
      }
      return response(remote.current ?? {
        json: '{"schemaVersion":2,"habits":[],"entries":[]}', revision: 0, initialized: false,
      });
    },
  };
  vm.runInNewContext(accountAdapterSource, {window});
  return window.rhythmAccountStorage;
}

function gate() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}

class MemoryAdapter {
  json = JSON.stringify(initial);
  revision = 4;
  previous = null;
  reads = 0;
  writes = [];
  readFailure = null;
  writeFailure = null;
  writeGate = null;
  readGate = null;
  lostReply = false;
  badReply = false;
  concurrent = 0;
  maximumConcurrent = 0;

  async read() {
    this.reads++;
    if (this.readGate) await this.readGate.promise;
    if (this.readFailure) throw this.readFailure;
    return {json: this.json, revision: this.revision};
  }

  async write(json, expected) {
    this.writes.push({json, expected});
    this.maximumConcurrent = Math.max(this.maximumConcurrent, ++this.concurrent);
    try {
      if (this.writeGate) await this.writeGate.promise;
      if (this.writeFailure) throw this.writeFailure;
      if (expected !== this.revision) throw journalError('conflict');
      this.previous = {json: this.json, revision: this.revision};
      this.json = json;
      this.revision++;
      if (this.lostReply) throw journalError('unavailable');
      return this.badReply ? {revision: this.revision} : this.revision;
    } finally { this.concurrent--; }
  }

  async readBackup() { return this.previous; }
}

function makeStore(adapter = new MemoryAdapter()) {
  return createJournalStore(adapter, {today: () => day});
}

test('external-store snapshots remain stable and immutable between notifications', async () => {
  const store = makeStore();
  assert.equal(store.getSnapshot(), store.getSnapshot());
  const initialState = store.getSnapshot();
  let notifications = 0;
  const unsubscribe = store.subscribe(() => { notifications++; });
  assert.equal(await store.load(), true);
  assert.notEqual(initialState, store.getSnapshot());
  assert.equal(Object.isFrozen(store.getSnapshot()), true);
  assert.equal(Object.isFrozen(store.getSnapshot().journal.habits[0]), true);
  assert.equal(store.getSnapshot(), store.getSnapshot());
  assert.ok(notifications > 0);
  unsubscribe();
  const before = notifications;
  await store.updateEntry(entry(30));
  assert.equal(notifications, before);
});

test('concurrent edits publish the latest draft immediately and serialize CAS writes', async () => {
  const adapter = new MemoryAdapter();
  const store = makeStore(adapter);
  await store.load();
  adapter.writeGate = gate();
  const first = store.updateEntry(entry(30));
  const second = store.updateEntry({...emptyEntry(checkId, day), checked: true});
  await Promise.resolve();
  assert.equal(store.getSnapshot().saving, true);
  assert.equal(store.getSnapshot().unsaved, true);
  assert.equal(store.getSnapshot().journal.entries.length, 2);
  assert.equal(adapter.writes.length, 1);
  assert.equal(await store.reloadSaved(), false);
  adapter.writeGate.resolve();
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.deepEqual(adapter.writes.map(write => write.expected), [4, 5]);
  assert.equal(adapter.maximumConcurrent, 1);
  assert.equal(parseJournal(adapter.json).entries.length, 2);
  assert.equal(store.getSnapshot().revision, 6);
  assert.equal(store.getSnapshot().unsaved, false);
  assert.equal(store.getSnapshot().saving, false);
});

test('a failed write stops queued saves and retry preserves every latest draft edit', async () => {
  const adapter = new MemoryAdapter();
  const store = makeStore(adapter);
  await store.load();
  const original = adapter.json;
  adapter.writeFailure = journalError('unavailable');
  const first = store.updateEntry(entry(30));
  const second = store.updateEntry({...emptyEntry(checkId, day), checked: true});
  assert.deepEqual(await Promise.all([first, second]), [false, false]);
  assert.equal(adapter.writes.length, 1);
  assert.equal(adapter.json, original);
  assert.equal(store.getSnapshot().journal.entries.length, 2);
  assert.equal(store.getSnapshot().unsaved, true);
  const reads = adapter.reads;
  assert.equal(await store.load(), false);
  assert.equal(adapter.reads, reads);
  store.dismissError();
  assert.equal(store.getSnapshot().error.code, 'unavailable');
  adapter.writeFailure = null;
  assert.equal(await store.retrySave(), true);
  assert.equal(parseJournal(adapter.json).entries.length, 2);
  assert.equal(store.getSnapshot().unsaved, false);
  assert.equal(store.getSnapshot().error, null);
});

test('conflicts and retries cannot overwrite another client; explicit reload recovers', async () => {
  const adapter = new MemoryAdapter();
  const first = makeStore(adapter);
  const second = makeStore(adapter);
  await Promise.all([first.load(), second.load()]);
  await first.updateEntry(entry(30));
  const committed = adapter.json;
  assert.equal(await second.updateEntry(entry(45)), false);
  assert.equal(second.getSnapshot().error.code, 'conflict');
  assert.equal(second.getSnapshot().journal.entries[0].minutes, 45);
  assert.equal(await second.retrySave(), false);
  assert.equal(adapter.json, committed);
  assert.equal(await second.reloadSaved(), true);
  assert.equal(second.getSnapshot().journal.entries[0].minutes, 30);
  assert.equal(second.getSnapshot().unsaved, false);
  assert.equal(await second.updateEntry(entry(60)), true);
});

test('lost and malformed save confirmations retain the old CAS revision and draft', async () => {
  for (const mode of ['lostReply', 'badReply']) {
    const adapter = new MemoryAdapter();
    const store = makeStore(adapter);
    await store.load();
    adapter[mode] = true;
    assert.equal(await store.updateEntry(entry(45)), false);
    const committed = adapter.json;
    assert.equal(store.getSnapshot().revision, 4);
    assert.equal(store.getSnapshot().unsaved, true);
    assert.equal(adapter.revision, 5);
    adapter[mode] = false;
    assert.equal(await store.retrySave(), false);
    assert.equal(store.getSnapshot().error.code, 'conflict');
    assert.equal(adapter.json, committed);
    assert.equal(await store.reloadSaved(), true);
    assert.equal(store.getSnapshot().journal.entries[0].minutes, 45);
    assert.equal(store.getSnapshot().revision, 5);
  }
});

test('failed reload preserves draft and blocks retry from using an unread revision', async () => {
  for (const corrupt of [false, true]) {
    const adapter = new MemoryAdapter();
    const store = makeStore(adapter);
    await store.load();
    adapter.writeFailure = journalError('unavailable');
    await store.updateEntry(entry(45));
    const draft = store.getSnapshot().journal;
    adapter.writeFailure = null;
    if (corrupt) {
      adapter.json = 'not JSON';
      adapter.revision = 20;
    } else adapter.readFailure = journalError('unavailable');
    assert.equal(await store.reloadSaved(), false);
    assert.equal(store.getSnapshot().journal, draft);
    assert.equal(store.getSnapshot().unsaved, true);
    const writes = adapter.writes.length;
    assert.equal(await store.retrySave(), false);
    assert.equal(store.getSnapshot().error.code, 'not-loaded');
    assert.equal(adapter.writes.length, writes);
    assert.equal(parseJournal(store.exportJSON()).entries[0].minutes, 45);
  }
});

test('load deduplicates pending reads and can recover from synchronous read failure', async () => {
  const adapter = new MemoryAdapter();
  const store = makeStore(adapter);
  adapter.readGate = gate();
  const first = store.load();
  const second = store.load();
  await Promise.resolve();
  assert.equal(adapter.reads, 1);
  adapter.readGate.resolve();
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  let throws = true;
  const failing = makeStore({
    read() { if (throws) throw Error('offline'); return adapter.read(); },
    write: (...args) => adapter.write(...args),
  });
  assert.equal(await failing.load(), false);
  throws = false;
  assert.equal(await failing.load(), true);
});

test('unobserved load failures block edits and import, while corrupt observed data permits explicit restore', async () => {
  const adapter = new MemoryAdapter();
  const store = makeStore(adapter);
  adapter.readFailure = journalError('unavailable');
  assert.equal(await store.load(), false);
  assert.equal(await store.updateEntry(entry(30)), false);
  assert.equal(await store.importJournal(JSON.stringify(initial)), false);
  assert.equal(adapter.writes.length, 0);
  adapter.readFailure = null;
  adapter.json = '{"schemaVersion":2,"habits":[],"entries":[1]}';
  assert.equal(await store.load(), false);
  assert.equal(store.getSnapshot().revision, 4);
  assert.equal(store.getSnapshot().error.code, 'corrupt');
  assert.equal(await store.importJournal(JSON.stringify(initial)), true);
  assert.equal(store.getSnapshot().ready, true);
  assert.equal(adapter.writes[0].expected, 4);
});

test('legacy migration observedRevision enables only an explicit CAS restore', async () => {
  const adapter = new MemoryAdapter();
  adapter.revision = 0;
  const migration = journalError('unavailable');
  migration.observedRevision = 0;
  adapter.readFailure = migration;
  const store = makeStore(adapter);
  assert.equal(await store.load(), false);
  assert.equal(await store.saveHabit(timed), false);
  assert.equal(adapter.writes.length, 0);
  assert.equal(await store.importJournal(JSON.stringify(initial)), true);
  assert.equal(adapter.writes[0].expected, 0);

  const staleAdapter = new MemoryAdapter();
  staleAdapter.readFailure = migration;
  const stale = makeStore(staleAdapter);
  await stale.load();
  const original = staleAdapter.json;
  assert.equal(await stale.importJournal(JSON.stringify(initial)), false);
  assert.equal(stale.getSnapshot().error.code, 'conflict');
  assert.equal(staleAdapter.json, original);
});

test('import is exclusive, validates exact tokens and only replaces current data after confirmation', async () => {
  const adapter = new MemoryAdapter();
  const store = makeStore(adapter);
  await store.load();
  const before = store.getSnapshot().journal;
  assert.equal(await store.importJournal(JSON.stringify(initial).replace('"minutes":15', '"minutes":15.0')), false);
  assert.equal(store.getSnapshot().journal, before);
  assert.equal(adapter.writes.length, 0);
  adapter.writeGate = gate();
  const imported = {...initial, extension: {source: 'sample backup'}, entries: [entry(90)]};
  const importing = store.importJournal(JSON.stringify(imported));
  assert.equal(store.getSnapshot().importing, true);
  assert.equal(store.getSnapshot().journal, before);
  assert.equal(await store.updateEntry(entry(30)), false);
  assert.equal(await store.reloadSaved(), false);
  adapter.writeGate.resolve();
  assert.equal(await importing, true);
  assert.equal(store.getSnapshot().journal.entries[0].minutes, 90);
  assert.deepEqual(store.getSnapshot().journal.extension, imported.extension);
  assert.equal(parseJournal(await store.exportPreviousJSON()).entries[0].minutes, 15);
});

test('unsaved changes prevent importing over a recoverable draft', async () => {
  const adapter = new MemoryAdapter();
  const store = makeStore(adapter);
  await store.load();
  adapter.writeFailure = journalError('unavailable');
  await store.updateEntry(entry(30));
  const draft = store.getSnapshot().journal;
  const writes = adapter.writes.length;
  assert.equal(await store.importJournal(JSON.stringify(initial)), false);
  assert.equal(store.getSnapshot().journal, draft);
  assert.equal(adapter.writes.length, writes);
});

test('archive and restore retain sessions, category order, notes, and historical activity', async () => {
  const adapter = new MemoryAdapter();
  adapter.json = JSON.stringify({
    ...initial,
    entries: [entry(100, {
      sessions: [{topic: 'Reading', minutes: 30}, {topic: 'Practice', minutes: 0}, {topic: 'Reading', minutes: 45}],
      text: 'Sample note',
    }), entry(15, {day: '2026-10-14'})],
  });
  const store = makeStore(adapter);
  await store.load();
  const original = store.getSnapshot().journal;
  assert.equal(await store.archiveHabit(id.toLowerCase()), true);
  assert.equal(dailyHabits(store.getSnapshot().journal, day, day).some(habit => habit.id === id), false);
  assert.equal(dailyHabits(store.getSnapshot().journal, '2026-10-14', day).some(habit => habit.id === id), true);
  assert.deepEqual(store.getSnapshot().journal.entries, original.entries);
  assert.deepEqual(store.getSnapshot().journal.habits[0].options, timed.options);
  assert.equal(await store.archiveHabit(id), true);
  assert.equal(adapter.revision, 5);
  const reopened = makeStore(adapter);
  await reopened.load();
  assert.equal(await reopened.restoreHabit(id), true);
  assert.deepEqual(reopened.getSnapshot().journal, original);
  assert.equal(await reopened.restoreHabit(id), true);
  assert.equal(adapter.revision, 6);
});

test('new category and ordered sessions persist atomically with historical categories intact', async () => {
  const adapter = new MemoryAdapter();
  const store = makeStore(adapter);
  await store.load();
  const sessions = [
    {topic: 'Reading', minutes: 30},
    {topic: 'New sample', minutes: 20},
    {topic: 'Reading', minutes: 0},
  ];
  assert.equal(await store.saveSessions(entry(65, {sessions}), ['New sample']), true);
  assert.equal(adapter.writes.length, 1);
  const saved = parseJournal(adapter.json);
  assert.deepEqual(saved.habits[0].options, ['Reading', 'Practice', 'New sample']);
  assert.deepEqual(saved.entries[0].sessions, sessions);
  assert.equal(saved.entries[0].minutes, 65);
  assert.equal(await store.saveHabit({...saved.habits[0], options: ['Another sample']}), true);
  assert.deepEqual(store.getSnapshot().journal.habits[0].options, ['Reading', 'Practice', 'New sample', 'Another sample']);
});

test('future and invalid updates cannot clear saved entries or add invalid categories', async () => {
  const adapter = new MemoryAdapter();
  const store = makeStore(adapter);
  await store.load();
  const original = store.getSnapshot().journal;
  for (const value of [entry(-1), entry(0, {day: '2026-10-16'}), entry(0, {minutes: NaN})]) {
    assert.equal(await store.updateEntry(value), false);
  }
  assert.equal(await store.saveSessions(entry(0), ['']), false);
  assert.equal(await store.saveSessions(entry(0, {sessions: [{topic: 'New', minutes: 1}]}), ['New']), false);
  assert.equal(store.getSnapshot().journal, original);
  assert.equal(adapter.writes.length, 0);
  assert.equal(await store.clearEntry(id, day), true);
  assert.equal(store.getSnapshot().journal.entries.length, 0);
});

test('batch recording validates every row atomically and preserves unknown fields', async () => {
  const adapter = new MemoryAdapter();
  adapter.json = serializeJournal({...initial, entries: [entry(15, {extension: {sample: true}})]});
  const store = makeStore(adapter);
  await store.load();
  assert.equal(await store.recordEntries([entry(30), entry(45)]), false);
  assert.equal(adapter.writes.length, 0);
  assert.equal(await store.recordEntries([entry(30), entry(45, {day: '2026-10-16'})]), false);
  assert.equal(adapter.writes.length, 0);
  assert.equal(await store.recordEntries([entry(30), {...emptyEntry(checkId, day), checked: true}]), true);
  assert.equal(adapter.writes.length, 1);
  assert.deepEqual(parseJournal(adapter.json).entries[0].extension, {sample: true});
});

test('an ordinary account edit never reformats opaque extension integers', async () => {
  const adapter = new MemoryAdapter();
  adapter.json = JSON.stringify({...initial, extension: {identifier: 'large'}})
    .replace('"large"', '9007199254740993');
  const store = makeStore(adapter);
  assert.equal(await store.load(), true);
  assert.equal(await store.updateEntry(entry(30)), true);
  assert.match(adapter.json, /"identifier":9007199254740993/);
  assert.match(store.exportJSON(), /"identifier":9007199254740993/);
});

test('maximum revision is never sent as an unsafe increment', async () => {
  const adapter = new MemoryAdapter();
  adapter.revision = Number.MAX_SAFE_INTEGER;
  const store = makeStore(adapter);
  await store.load();
  assert.equal(await store.updateEntry(entry(30)), false);
  assert.equal(store.getSnapshot().error.code, 'revision-limit');
  assert.equal(adapter.writes.length, 0);
  assert.equal(store.getSnapshot().unsaved, true);
});

test('future-start habits archive safely and deleted habits cannot be resurrected by stale archive actions', async () => {
  const adapter = new MemoryAdapter();
  const store = makeStore(adapter);
  await store.load();
  const future = {...timed, id: 'ABCDEF00-0000-4000-8000-000000000003', startDay: '2027-01-01'};
  assert.equal(await store.saveHabit(future), true);
  assert.equal(await store.archiveHabit(future.id), true);
  assert.equal(store.getSnapshot().journal.habits[2].archivedOn, future.startDay);
  assert.equal(await store.restoreHabit(future.id), true);
  assert.equal(await store.deleteHabit(id), true);
  assert.equal(await store.archiveHabit(id), false);
  assert.equal(store.getSnapshot().journal.entries.length, 0);
  assert.equal(store.getSnapshot().journal.habits.some(habit => habit.id === id), false);
});

test('real account adapter and React store retain both prior journal versions across browser changes', async () => {
  const kinds = ['check', 'single', 'multiple', 'duration', 'number', 'text'];
  for (const schemaVersion of [1, 2]) {
    const habits = kinds.map((kind, index) => ({
      ...timed,
      id: `ABCDEF00-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      kind,
      title: `Synthetic ${kind}`,
      options: ['single', 'multiple', 'duration'].includes(kind) ? ['Sample category A', 'Sample category B', '示例类别'] : [],
      ...(kind === 'duration' ? {archivedOn: day} : {}),
    }));
    const values = [
      {checked: true}, {selections: ['Sample category B']},
      {selections: ['示例类别', 'Sample category A']},
      {minutes: 100, text: 'Synthetic session note'},
      {number: 0}, {text: 'Synthetic reflection.\n示例文字'},
    ];
    const entries = habits.map((habit, index) => {
      const value = {...emptyEntry(habit.id, day), ...values[index]};
      delete value.sessions;
      if (value.number === null) delete value.number;
      return value;
    });
    if (schemaVersion === 2) entries[3].sessions = [
      {topic: 'Sample category A', minutes: 30},
      {topic: '示例类别', minutes: 0},
      {topic: 'Sample category A', minutes: 45},
    ];
    const source = ` \n${JSON.stringify({schemaVersion, habits, entries}, null, 2)}\n`;
    const remote = {current: {json: source, revision: 7, initialized: true}, writes: 0};
    const noLocalFallback = async () => { throw Error('An established account must never read browser records.'); };
    const store = makeStore(accountClient(remote, noLocalFallback));
    assert.equal(await store.load(), true);
    const loaded = store.getSnapshot().journal;
    assert.equal(loaded.schemaVersion, 2);
    assert.equal(loaded.habits.length, 6);
    assert.equal(loaded.entries.length, 6);
    assert.equal(loaded.entries[4].number, 0);
    assert.deepEqual(loaded.habits[3].options, habits[3].options);
    assert.deepEqual(loaded.entries[3].sessions, entries[3].sessions ?? []);
    assert.equal(dailyHabits(loaded, day, day).some(habit => habit.id === habits[3].id), false);
    assert.equal(remote.current.json, source);
    assert.equal(remote.writes, 0);

    assert.equal(await store.archiveHabit(habits[0].id), true);
    assert.equal(remote.previous.json, source);
    assert.deepEqual(parseJournal(remote.current.json).entries, loaded.entries);
    const otherBrowser = makeStore(accountClient(remote, noLocalFallback));
    assert.equal(await otherBrowser.load(), true);
    assert.deepEqual(otherBrowser.getSnapshot().journal, store.getSnapshot().journal);
    assert.equal(await otherBrowser.restoreHabit(habits[3].id), true);
    assert.deepEqual(otherBrowser.getSnapshot().journal.entries, loaded.entries);
    assert.equal(dailyHabits(otherBrowser.getSnapshot().journal, day, day).some(habit => habit.id === habits[3].id), true);
  }
});

test('the React store migrates a genuine v1 browser snapshot only into a new account', async () => {
  const legacy = {...initial, schemaVersion: 1, entries: [{habitID: id, day, checked: false, selections: [], minutes: 15, text: ''}]};
  const exact = `\n${JSON.stringify(legacy, null, 2)}\n`;
  const remote = {current: null, writes: 0};
  let browserReads = 0;
  const api = accountClient(remote, async () => {
    browserReads++;
    return {json: exact, revision: 12};
  });
  const store = makeStore(api);
  assert.equal(await store.load(), true);
  assert.equal(remote.current.json, exact);
  assert.equal(remote.writes, 1);
  assert.equal(browserReads, 1);
  assert.equal(store.getSnapshot().revision, 1);
  assert.equal(store.getSnapshot().journal.schemaVersion, 2);
  assert.equal(await store.load(), true);
  assert.equal(remote.writes, 1);
  assert.equal(browserReads, 1);
  assert.equal(await store.updateEntry(entry(30)), true);
  assert.equal(remote.previous.json, exact);
  assert.equal(JSON.parse(remote.current.json).schemaVersion, 2);
});
