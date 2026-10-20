import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.mjs';
import { testDB } from './auth-db.mjs';
import { digest } from '../worker/auth.mjs';
import { EMPTY_JOURNAL, MAX_JOURNAL_BYTES, MAX_REQUEST_BYTES, validateJournal } from '../worker/journal.mjs';

const origin = 'https://rhythm.test';
const owner = 'journal-test-owner';
const token = 'a'.repeat(64);
const cookie = `__Host-rhythm=${token}`;
const id = '12345678-1234-1234-1234-123456789ABC';
const habit = {id, title: 'Read', note: '', kind: 'duration', colorHex: 'F34B3F', symbol: 'book',
  options: [], targetMinutes: 30, targetNumber: 1, unit: '', startDay: '2026-01-01'};
const entry = {habitID: id, day: '2026-02-28', checked: false, selections: [], minutes: 45, text: ''};
const journal = () => ({schemaVersion: 1, habits: [{...habit}], entries: [{...entry}]});
const encoded = () => JSON.stringify(journal());

async function fixture(t) {
  const db = testDB();
  t.after(() => db.sqlite.close());
  db.sqlite.prepare('INSERT INTO admin VALUES (1, ?, ?, ?, ?, ?)').run(owner, 'test-admin', '00'.repeat(16), '00'.repeat(32), Date.now());
  db.sqlite.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(await digest(token), owner, Date.now() + 60_000);
  return db;
}
async function send(db, {path = '/api/journal', method = 'GET', body, identity = owner,
  session = cookie, headers = {}} = {}) {
  const h = new Headers({'oai-authenticated-user-id': identity, cookie: session, ...headers});
  if (identity == null) h.delete('oai-authenticated-user-id');
  if (session == null) h.delete('cookie');
  if (method === 'PUT') {
    if (!h.has('origin')) h.set('origin', origin);
    if (!h.has('x-rhythm-request')) h.set('x-rhythm-request', '1');
    if (!h.has('content-type')) h.set('content-type', 'application/json');
  }
  return worker.fetch(new Request(origin + path, {method, headers: h,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)}), {DB: db});
}
const put = (db, json, expectedRevision = 0, options = {}) => send(db, {
  method: 'PUT', body: {json, expectedRevision}, ...options,
});
const stored = db => db.sqlite.prepare('SELECT * FROM account_journals WHERE owner = ? AND admin_id = 1').get(owner);

test('absent account journal reads empty without initializing or writing backup', async t => {
  const db = await fixture(t);
  const response = await send(db);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {json: EMPTY_JOURNAL, revision: 0, initialized: false});
  assert.equal(await (await send(db, {path: '/api/journal/backup'})).json(), null);
  assert.equal(stored(db), undefined);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('journal and backup require an active owner-bound session before accessing data', async t => {
  const db = await fixture(t);
  for (const path of ['/api/journal', '/api/journal/backup']) {
    for (const options of [{session: null}, {session: '__Host-rhythm=' + 'f'.repeat(64)}, {identity: 'another-owner'}]) {
      assert.equal((await send(db, {path, ...options})).status, 401);
    }
    assert.equal((await send(db, {path, identity: null})).status, 403);
  }
  assert.equal((await put(db, 'invalid', 0, {session: null})).status, 401);
  db.sqlite.exec('UPDATE sessions SET expires_at = 0');
  assert.equal((await send(db)).status, 401);
  assert.equal(stored(db), undefined);
});

test('cross-site PUT requests are rejected before reading or changing snapshots', async t => {
  const db = await fixture(t);
  assert.equal((await put(db, encoded())).status, 200);
  const before = stored(db);
  for (const headers of [{origin: 'https://evil.test'}, {origin: ''}, {'sec-fetch-site': 'cross-site'},
    {'x-rhythm-request': ''}, {'content-type': 'text/plain'}]) {
    assert.equal((await put(db, 'not json', 1, {headers})).status, 403);
  }
  assert.deepEqual(stored(db), before);
  for (const method of ['POST', 'DELETE', 'PATCH', 'HEAD']) {
    assert.equal((await send(db, {method})).status, 405);
  }
  assert.equal((await put(db, encoded(), 1, {path: '/api/journal/backup'})).status, 405);
});

test('creation, updates and previous snapshots preserve exact JSON and extension fields', async t => {
  const db = await fixture(t);
  const first = journal();
  first.schemaVersion = 2;
  first.habits[0].options = ['A synthetic study topic'];
  first.entries[0].sessions = [{topic: 'A synthetic study topic', minutes: 45}];
  first.extension = {source: 'synthetic import'};
  const raw = JSON.stringify(first, null, 2);
  assert.deepEqual(await (await put(db, raw)).json(), {revision: 1});
  assert.equal(await (await send(db, {path: '/api/journal/backup'})).json(), null);
  assert.deepEqual(await (await send(db)).json(), {json: raw, revision: 1, initialized: true});
  const second = encoded();
  assert.deepEqual(await (await put(db, second, 1)).json(), {revision: 2});
  assert.deepEqual(await (await send(db, {path: '/api/journal/backup'})).json(), {json: raw, revision: 1});
  assert.equal((await put(db, EMPTY_JOURNAL, 2)).status, 200);
  assert.deepEqual(await (await send(db)).json(), {json: EMPTY_JOURNAL, revision: 3, initialized: true});
  assert.deepEqual(await (await send(db, {path: '/api/journal/backup'})).json(), {json: second, revision: 2});
  const before = stored(db);
  assert.equal((await put(db, raw)).status, 409);
  assert.deepEqual(stored(db), before);
});

test('concurrent initial migration and same-revision edits each commit exactly once', async t => {
  const db = await fixture(t);
  const first = encoded();
  let results = await Promise.all([put(db, first), put(db, EMPTY_JOURNAL)]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const previous = stored(db).json;
  assert.equal(stored(db).revision, 1);
  results = await Promise.all([put(db, first, 1), put(db, EMPTY_JOURNAL, 1)]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  assert.equal(stored(db).revision, 2);
  assert.equal(stored(db).previous_json, previous);
  assert.equal(stored(db).previous_revision, 1);
});

test('server derives account scope; caller-supplied owners and other sessions cannot select it', async t => {
  const db = await fixture(t);
  const other = 'other-owner';
  db.sqlite.prepare('INSERT INTO account_journals (owner, admin_id, json, revision, updated_at) VALUES (?, 1, ?, 1, ?)')
    .run(other, EMPTY_JOURNAL, Date.now());
  const body = {json: encoded(), expectedRevision: 0, owner: other, adminId: 123};
  assert.equal((await send(db, {method: 'PUT', body})).status, 200);
  assert.equal(stored(db).json, body.json);
  assert.equal(db.sqlite.prepare('SELECT json FROM account_journals WHERE owner = ?').get(other).json, EMPTY_JOURNAL);
  // A valid session owned by somebody other than the configured admin is denied.
  db.sqlite.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(await digest('b'.repeat(64)), other, Date.now() + 60_000);
  assert.equal((await send(db, {identity: other, session: '__Host-rhythm=' + 'b'.repeat(64)})).status, 401);
});

test('invalid schema values cannot damage the current journal or its backup', async t => {
  const db = await fixture(t);
  assert.equal((await put(db, encoded())).status, 200);
  assert.equal((await put(db, EMPTY_JOURNAL, 1)).status, 200);
  const before = stored(db);
  const variants = [null, [], {}, {...journal(), schemaVersion: 3}, {...journal(), habits: {}}, {...journal(), entries: {}}];
  for (const mutate of [
    data => { delete data.habits[0].note; },
    data => { data.habits[0].id = 'not-a-uuid'; },
    data => { data.habits.push({...data.habits[0], id: id.toLowerCase()}); },
    data => { data.habits[0].title = ' '; },
    data => { data.habits[0].kind = 'unknown'; },
    data => { data.habits[0].startDay = '0000-01-01'; },
    data => { data.habits[0].archivedOn = '2025-12-31'; },
    data => { data.habits[0].archivedOn = 123; },
    data => { data.habits[0].targetMinutes = 0; },
    data => { data.habits[0].targetNumber = -1; },
    data => { data.habits[0].kind = 'number'; data.habits[0].targetNumber = 0; },
    data => { data.habits[0].kind = 'single'; },
    data => { data.habits[0].options = ['a', 'a']; },
    data => { data.habits[0].options = [' ']; },
    data => { data.habits[0].options = [1]; },
    data => { data.entries[0].habitID = 'missing'; },
    data => { data.entries[0].day = '2026-02-29'; },
    data => { data.entries[0].day = '2025-12-31'; },
    data => { data.entries.push({...data.entries[0]}); },
    data => { data.entries[0].checked = 1; },
    data => { data.entries[0].minutes = -1; },
    data => { data.entries[0].minutes = Number.MAX_SAFE_INTEGER + 1; },
    data => { data.entries[0].number = -1; },
    data => { data.entries[0].text = null; },
    data => { data.entries[0].selections = ['missing']; },
    data => { data.habits[0].options = ['a']; data.entries[0].selections = ['a', 'a']; },
    data => { data.habits[0].kind = 'single'; data.habits[0].options = ['a', 'b']; data.entries[0].selections = ['a', 'b']; },
    data => { data.entries[0].minutes = Number.MAX_SAFE_INTEGER; data.entries.push({...entry, day: '2026-03-01', minutes: 1}); },
  ]) {
    const value = journal(); mutate(value); variants.push(value);
  }
  for (const value of variants) {
    const response = await put(db, JSON.stringify(value), 2);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {error: 'INVALID_JOURNAL'});
  }
  for (const source of ['not-json', encoded().replace('"minutes":45', '"minutes":45.0000000000000001'),
    encoded().replace('"minutes":45', '"minutes":4.5e1'),
    encoded().replace('"minutes":45', '"minutes":9007199254740992'),
    encoded().replace('"schemaVersion":1', '"schemaVersion":1.0'),
    encoded().replace('"minutes":45', '"\\u006dinutes":45.0'),
    encoded().replace('"targetNumber":1', '"targetNumber":1e999'),
    encoded().replace('"schemaVersion":1', '"schemaVersion":1,"extension":' + '['.repeat(257) + '0' + ']'.repeat(257))]) {
    assert.equal((await put(db, source, 2)).status, 400);
  }
  assert.deepEqual(stored(db), before);
});

test('validation matches Dart optional fields, UUID normalization, finite doubles and leap dates', () => {
  const value = journal();
  value.habits[0].id = id.toLowerCase();
  value.habits[0].targetNumber = 1.5;
  value.habits[0].archivedOn = null;
  value.entries[0].day = '2028-02-29';
  value.entries[0].number = 2.75;
  value.entries[0].text = 'quoted field "minutes":1.1 is only text';
  assert.doesNotThrow(() => validateJournal(JSON.stringify(value)));
  value.entries[0].number = null;
  assert.doesNotThrow(() => validateJournal(JSON.stringify(value)));
  const fractionalGoal = JSON.stringify(value).replace('"targetNumber":1.5', '"targetNumber":1.5e1');
  assert.doesNotThrow(() => validateJournal(fractionalGoal));
});

test('categorized sessions preserve repeated topics, order and uncategorized minutes across account saves', async t => {
  const db = await fixture(t);
  const value = journal();
  value.schemaVersion = 2;
  value.habits[0].options = ['Writing', 'English'];
  value.entries[0].sessions = [
    {topic: 'Writing', minutes: 15},
    {topic: 'English', minutes: 10},
    {topic: 'Writing', minutes: 15},
    {topic: 'English', minutes: 0},
  ];
  // Five unassigned minutes can coexist with detailed imported sessions.
  const raw = JSON.stringify(value);
  assert.equal((await put(db, raw)).status, 200);
  const saved = await (await send(db)).json();
  assert.equal(saved.json, raw);
  assert.deepEqual(JSON.parse(saved.json).entries[0].sessions, value.entries[0].sessions);
  value.entries[0].sessions[1].minutes += 5;
  assert.equal((await put(db, JSON.stringify(value), 1)).status, 200);
  assert.deepEqual(await (await send(db, {path: '/api/journal/backup'})).json(), {json: raw, revision: 1});
});

test('categorized session validation rejects bad versions, topic references, types and overflowing totals without changing data', async t => {
  const db = await fixture(t);
  const value = journal();
  value.schemaVersion = 2;
  value.habits[0].options = ['Writing'];
  value.entries[0].sessions = [{topic: 'Writing', minutes: 45}];
  assert.equal((await put(db, JSON.stringify(value))).status, 200);
  const before = stored(db);
  const invalidVariants = [
    data => { data.schemaVersion = 1; },
    data => { data.schemaVersion = 1; data.entries[0].sessions = []; },
    data => { data.entries[0].sessions = null; },
    data => { data.entries[0].sessions = {}; },
    data => { data.entries[0].sessions = [null]; },
    data => { data.entries[0].sessions = [[]]; },
    data => { data.entries[0].sessions = ['Writing']; },
    data => { delete data.entries[0].sessions[0].topic; },
    data => { data.entries[0].sessions[0].topic = 1; },
    data => { data.entries[0].sessions[0].topic = 'Unknown'; },
    data => { data.entries[0].sessions[0].topic = ' Writing'; },
    data => { delete data.entries[0].sessions[0].minutes; },
    data => { data.entries[0].sessions[0].minutes = '45'; },
    data => { data.entries[0].sessions[0].minutes = null; },
    data => { data.entries[0].sessions[0].minutes = -1; },
    data => { data.entries[0].sessions[0].minutes = 0.5; },
    data => { data.entries[0].sessions[0].minutes = 46; },
    data => { data.entries[0].sessions[0].minutes = Number.MAX_SAFE_INTEGER + 1; },
    data => { data.entries[0].sessions.push({topic: 'Writing', minutes: 1}); },
    data => {
      data.entries[0].minutes = Number.MAX_SAFE_INTEGER;
      data.entries[0].sessions = [{topic: 'Writing', minutes: Number.MAX_SAFE_INTEGER}, {topic: 'Writing', minutes: 1}];
    },
    ...['check', 'single', 'multiple', 'number', 'text'].map(kind => data => { data.habits[0].kind = kind; }),
  ];
  for (const mutate of invalidVariants) {
    const data = structuredClone(value);
    mutate(data);
    const response = await put(db, JSON.stringify(data), 1);
    assert.equal(response.status, 400, JSON.stringify(data));
    assert.deepEqual(await response.json(), {error: 'INVALID_JOURNAL'});
  }
  const raw = JSON.stringify(value);
  for (const token of ['45.0000000000000001', '4.5e1', '9007199254740992']) {
    const source = raw.replace('"topic":"Writing","minutes":45', `"topic":"Writing","minutes":${token}`);
    assert.equal((await put(db, source, 1)).status, 400, token);
  }
  assert.deepEqual(stored(db), before);
});

test('v1 journals remain readable; v2 permits absent or empty session lists for ordinary habits', () => {
  assert.doesNotThrow(() => validateJournal(encoded()));
  const value = journal();
  value.schemaVersion = 2;
  assert.doesNotThrow(() => validateJournal(JSON.stringify(value)));
  value.habits[0].kind = 'check';
  value.entries[0].sessions = [];
  assert.doesNotThrow(() => validateJournal(JSON.stringify(value)));
});

test('invalid request envelopes and oversized UTF-8 input never mutate storage', async t => {
  const db = await fixture(t);
  assert.equal((await put(db, encoded())).status, 200);
  const before = stored(db);
  for (const body of ['{', null, [], {json: encoded()}, {json: {}, expectedRevision: 1},
    {json: encoded(), expectedRevision: -1}, {json: encoded(), expectedRevision: 1.5},
    {json: encoded(), expectedRevision: Number.MAX_SAFE_INTEGER + 1},
    JSON.stringify({json: encoded(), expectedRevision: 1}).replace('"expectedRevision":1', '"expectedRevision":1.0000000000000001')]) {
    assert.equal((await send(db, {method: 'PUT', body})).status, 400);
  }
  const large = journal();
  large.habits[0].note = 'я'.repeat(Math.floor(MAX_JOURNAL_BYTES / 2));
  assert.equal((await put(db, JSON.stringify(large), 1)).status, 413);
  assert.equal((await send(db, {method: 'PUT', body: 'x'.repeat(MAX_REQUEST_BYTES + 1)})).status, 413);
  assert.equal((await put(db, encoded(), 1, {headers: {'content-length': String(MAX_REQUEST_BYTES + 1)}})).status, 413);
  assert.deepEqual(stored(db), before);
});

test('revision limit and unknown revisions fail without replacing snapshots', async t => {
  const db = await fixture(t);
  assert.equal((await put(db, encoded(), 1)).status, 409);
  assert.equal((await put(db, encoded())).status, 200);
  db.sqlite.prepare('UPDATE account_journals SET revision = ?').run(Number.MAX_SAFE_INTEGER);
  const before = stored(db);
  const result = await put(db, EMPTY_JOURNAL, Number.MAX_SAFE_INTEGER);
  assert.equal(result.status, 409);
  assert.deepEqual(await result.json(), {error: 'REVISION_LIMIT'});
  assert.deepEqual(stored(db), before);
});

test('journal database failures are generic and preserve the authenticated boundary', async t => {
  const db = await fixture(t);
  const prepare = db.prepare;
  db.prepare = sql => {
    if (sql.includes('account_journals')) throw new Error('synthetic sensitive database detail');
    return prepare(sql);
  };
  const response = await send(db);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {error: 'JOURNAL_UNAVAILABLE'});
});
