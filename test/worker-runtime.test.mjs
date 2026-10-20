import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from './worker-runtime.mjs';
test('deployed bundle runs setup, login, CSRF and revocation in actual workerd/D1',async()=>{
  const {runtime,db}=await createRuntime();
  try {
    const origin='https://rhythm.test';
    const headers={'oai-authenticated-user-id':'runtime-test-owner','Content-Type':'application/json','X-Rhythm-Request':'1',Origin:origin};
    const credentials={username:'runtime-admin',password:'synthetic-runtime-passphrase-only',remember:true};
    const setup=await runtime.dispatchFetch(origin+'/api/auth/setup',{method:'POST',headers,body:JSON.stringify(credentials)});
    assert.equal(setup.status,200,await setup.clone().text());
    const cookie=setup.headers.get('set-cookie'); assert.match(cookie,/HttpOnly/);
    const signedHeaders={...headers,Cookie:cookie};
    assert.equal((await runtime.dispatchFetch(origin+'/app.js',{headers})).status,401);
    assert.equal((await runtime.dispatchFetch(origin+'/app.js',{headers:signedHeaders})).status,200);
    assert.equal((await runtime.dispatchFetch(origin+'/styles.css',{headers})).status,401);
    const stylesheet = await runtime.dispatchFetch(origin+'/styles.css',{headers:signedHeaders});
    assert.equal(stylesheet.status,200);
    assert.match(stylesheet.headers.get('content-type'),/^text\/css/);
    assert.equal((await runtime.dispatchFetch(origin+'/api/auth/logout',{method:'POST',headers:{...signedHeaders,Origin:'https://evil.test'},body:'{}'})).status,403);
    assert.equal((await runtime.dispatchFetch(origin+'/api/auth/logout',{method:'POST',headers:signedHeaders,body:'{}'})).status,200);
    assert.equal((await runtime.dispatchFetch(origin+'/app.js',{headers:signedHeaders})).status,401);
    const login=await runtime.dispatchFetch(origin+'/api/auth/login',{method:'POST',headers,body:JSON.stringify(credentials)});
    assert.equal(login.status,200,await login.clone().text());
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM admin').first()).n,1);
  } finally {await runtime.dispose();}
});
