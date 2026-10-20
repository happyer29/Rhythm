import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from './worker-runtime.mjs';
import { EMPTY_JOURNAL, MAX_JOURNAL_BYTES } from '../worker/journal.mjs';

test('real workerd/D1 shares one account journal across independent login sessions and protects CAS backup', async () => {
  const {runtime, db} = await createRuntime();
  try {
    const origin = 'https://rhythm.test';
    const headers = {'oai-authenticated-user-id': 'journal-runtime-owner', Origin: origin,
      'Content-Type': 'application/json', 'X-Rhythm-Request': '1'};
    const credentials = {username: 'journal-runtime-admin', password: 'synthetic-journal-runtime-only', remember: true};
    const send = (path, options = {}) => runtime.dispatchFetch(origin + path, {headers, ...options});
    const setup = await send('/api/auth/setup', {method: 'POST', body: JSON.stringify(credentials)});
    assert.equal(setup.status, 200);
    const first = {...headers, Cookie: setup.headers.get('set-cookie')};
    const login = await send('/api/auth/login', {method: 'POST', body: JSON.stringify(credentials)});
    assert.equal(login.status, 200);
    const second = {...headers, Cookie: login.headers.get('set-cookie')};
    assert.notEqual(first.Cookie, second.Cookie);
    const read = (session, path = '/api/journal') => send(path, {headers: session});
    const put = (session, json, expectedRevision) => send('/api/journal', {
      method: 'PUT', headers: session, body: JSON.stringify({json, expectedRevision}),
    });
    assert.equal((await read(headers)).status, 401);
    assert.deepEqual(await (await read(first)).json(), {json: EMPTY_JOURNAL, revision: 0, initialized: false});
    assert.equal((await db.prepare('SELECT count(*) AS n FROM account_journals').first()).n, 0);
    const habitId = '12345678-1234-1234-1234-123456789ABC';
    const rich = JSON.stringify({schemaVersion: 2, habits: [{id: habitId, title: 'Synthetic learning', note: '',
      kind: 'duration', colorHex: 'F34B3F', symbol: 'book', options: ['Writing', 'English'],
      targetMinutes: 30, targetNumber: 1, unit: '', startDay: '2026-01-01'}], entries: [{
      habitID: habitId, day: '2026-01-02', checked: false, selections: [], minutes: 45, text: '',
      sessions: [{topic: 'Writing', minutes: 15}, {topic: 'English', minutes: 20}, {topic: 'Writing', minutes: 10}],
    }]});
    assert.equal((await put(first, rich, 0)).status, 200);
    assert.deepEqual(await (await read(second)).json(), {json: rich, revision: 1, initialized: true});
    assert.equal((await put({...second, Origin: 'https://evil.test'}, EMPTY_JOURNAL, 1)).status, 403);
    assert.equal((await read({...second, 'oai-authenticated-user-id': 'another-owner'})).status, 401);
    const races = await Promise.all([put(first, rich, 1), put(second, EMPTY_JOURNAL, 1)]);
    assert.deepEqual(races.map(result => result.status).sort(), [200, 409]);
    assert.deepEqual(await (await read(second, '/api/journal/backup')).json(), {json: rich, revision: 1});
    // Both near-limit snapshots coexist in one actual D1 row without exceeding
    // D1's row-size ceiling; the loser of a race has not replaced the backup.
    const nearLimit = EMPTY_JOURNAL.slice(0, -1) + ',"extension":"' + 'x'.repeat(MAX_JOURNAL_BYTES - 100) + '"}';
    assert.equal((await put(first, nearLimit, 2)).status, 200);
    assert.equal((await put(second, nearLimit, 3)).status, 200);
    const last = await (await read(second)).json();
    assert.equal(last.revision, 4);
    assert.equal(last.json, nearLimit);
    assert.deepEqual(await (await read(first, '/api/journal/backup')).json(), {json: nearLimit, revision: 3});
    assert.equal((await put(first, 'not-json', 4)).status, 400);
    assert.equal((await read(second)).status, 200);
  } finally {
    await runtime.dispose();
  }
});
