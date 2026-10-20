import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startLocalServer } from '../scripts/serve-local.mjs';

test('local restart preserves the existing account, journal and backup without reseeding', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rhythm-local-persistence-'));
  const d1Persist = join(directory, 'd1');
  let preview;
  const credentials = {
    username:'restart-owner', password:'synthetic-restart-test-passphrase-only', remember:true,
  };
  const habitID = '22222222-2222-4222-8222-222222222222';
  const journal = minutes => JSON.stringify({
    schemaVersion:1,
    habits:[{
      id:habitID, title:'Synthetic restart habit', note:'x'.repeat(5000),
      kind:'duration', colorHex:'6DADB5', symbol:'book.closed', options:[],
      targetMinutes:30, targetNumber:1, unit:'min', startDay:'2026-01-01',
    }],
    entries:[{habitID, day:'2026-01-01', checked:false, selections:[], minutes, text:''}],
  });
  const first = journal(30);
  const second = journal(45);
  const headers = cookie => ({
    Origin:preview.origin, 'Content-Type':'application/json', 'X-Rhythm-Request':'1',
    ...(cookie ? {Cookie:cookie} : {}),
  });
  try {
    preview = await startLocalServer({port:0, d1Persist});
    const setup = await fetch(preview.origin + '/api/auth/setup', {
      method:'POST', headers:headers(), body:JSON.stringify(credentials),
    });
    assert.equal(setup.status, 200, await setup.clone().text());
    let cookie = setup.headers.get('set-cookie');
    assert.ok(cookie);

    // The proxy accepts a real journal larger than the auth request limit.
    for (const [json, expectedRevision] of [[first,0], [second,1]]) {
      const saved = await fetch(preview.origin + '/api/journal', {
        method:'PUT', headers:headers(cookie), body:JSON.stringify({json, expectedRevision}),
      });
      assert.equal(saved.status, 200, await saved.clone().text());
      assert.deepEqual(await saved.json(), {revision:expectedRevision + 1});
    }

    // Port conflicts are detected before creating or opening any data directory.
    const unusedData = join(directory, 'must-not-be-created');
    await assert.rejects(startLocalServer({
      port:Number(new URL(preview.origin).port), d1Persist:unusedData,
    }), {code:'EADDRINUSE'});
    await assert.rejects(access(unusedData), {code:'ENOENT'});

    await preview.close();
    preview = await startLocalServer({port:0, d1Persist, testAccount:true});
    const login = await fetch(preview.origin + '/api/auth/login', {
      method:'POST', headers:headers(), body:JSON.stringify(credentials),
    });
    assert.equal(login.status, 200, await login.clone().text());
    cookie = login.headers.get('set-cookie');
    const restored = await fetch(preview.origin + '/api/journal', {headers:headers(cookie)});
    assert.equal(restored.status, 200, await restored.clone().text());
    assert.deepEqual(await restored.json(), {json:second, revision:2, initialized:true});
    const backup = await fetch(preview.origin + '/api/journal/backup', {headers:headers(cookie)});
    assert.equal(backup.status, 200, await backup.clone().text());
    assert.deepEqual(await backup.json(), {json:first, revision:1});

    const authTooLarge = await fetch(preview.origin + '/api/auth/login', {
      method:'POST', headers:headers(cookie), body:'x'.repeat(4097),
    });
    assert.equal(authTooLarge.status, 413);
    await authTooLarge.text();
    const journalTooLarge = await fetch(preview.origin + '/api/journal', {
      method:'PUT', headers:headers(cookie), body:'x'.repeat(2 * 1024 * 1024 + 1),
    });
    assert.equal(journalTooLarge.status, 413);
    await journalTooLarge.text();
  } finally {
    await preview?.close();
    await rm(directory, {recursive:true, force:true});
  }
});
