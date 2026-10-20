import test from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import worker from '../worker/index.mjs';
import { testDB } from './auth-db.mjs';
import { passwordHash, digest, allowAttempt, SESSION_SECONDS, REMEMBER_SECONDS } from '../worker/auth.mjs';
const origin = 'https://rhythm.test';
const password = 'synthetic-auth-fixture-passphrase';
function request(path, {method='GET',body,owner='test-site-owner',cookie,headers={}} = {}) {
  const h = new Headers(headers);
  if (owner) h.set('oai-authenticated-user-id',owner);
  if (cookie) h.set('cookie',cookie);
  if (method === 'POST') {
    if (!h.has('origin')) h.set('origin',origin);
    if (!h.has('content-type')) h.set('content-type','application/json');
    if (!h.has('x-rhythm-request')) h.set('x-rhythm-request','1');
  }
  return new Request(origin+path,{method,headers:h,body:body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)});
}
const credentials = {username:'admin',password,remember:true};
async function setup(db,options={}) {
  const result = await worker.fetch(request('/api/auth/setup',{method:'POST',body:credentials,...options}),{DB:db});
  assert.equal(result.status,200);
  return result.headers.get('set-cookie');
}
const send = (db,path,opts) => worker.fetch(request(path,opts),{DB:db});

test('password KDF agrees with native scrypt vector at production parameters',() => {
  const salt = '0102030405060708090a0b0c0d0e0f10';
  assert.equal(passwordHash(password,salt),scryptSync(password,Buffer.from(salt,'hex'),32,{N:16384,r:8,p:5,maxmem:32*1024*1024}).toString('hex'));
});
test('anonymous identity, forged cookies and direct app routes cannot read app code',async () => {
  const db = testDB();
  for (const path of ['/','/auth','/api/auth/session','/main.dart.js','/index.html']) assert.equal((await send(db,path,{owner:null})).status,403);
  for (const path of ['/main.dart.js','/browser-storage.js','/browser-hooks.js','/flutter_bootstrap.js','/auth-guard.js','/%69ndex.html','/app/index.html']) {
    const result = await send(db,path,{cookie:'__Host-rhythm='+'a'.repeat(64)});
    assert.equal(result.status,401,path);
    assert.equal(result.headers.get('cache-control'),'private, no-store');
  }
  assert.equal((await send(db,'/')).headers.get('location'),'/auth');
});
test('one-time setup, safe storage and remembered session, identity-bound',async () => {
  const db = testDB(); const cookie = await setup(db);
  assert.match(cookie,/^__Host-rhythm=[a-f0-9]{64}; Path=\/; Secure; HttpOnly; SameSite=Strict; Max-Age=2592000$/);
  const admin = db.sqlite.prepare('SELECT * FROM admin').get();
  assert.notEqual(admin.password_hash,password); assert.equal(admin.password_hash.length,64);
  const session = db.sqlite.prepare('SELECT * FROM sessions').get();
  assert.equal(session.token_hash,await digest(cookie.split(';')[0].split('=')[1]));
  assert.ok(session.expires_at > Date.now() + (REMEMBER_SECONDS-10)*1000);
  assert.equal((await send(db,'/',{cookie})).status,200);
  assert.equal((await send(db,'/main.dart.js',{cookie,owner:'other-user'})).status,401);
  const sessionJSON = await (await send(db,'/api/auth/session',{cookie})).json();
  assert.deepEqual(Object.keys(sessionJSON).sort(),['authenticated','expiresAt']);
  assert.equal((await send(db,'/api/auth/setup',{method:'POST',body:credentials})).status,409);
});
test('simultaneous setup yields exactly one admin and one session',async () => {
  const db = testDB();
  const results = await Promise.all([send(db,'/api/auth/setup',{method:'POST',body:credentials}),send(db,'/api/auth/setup',{method:'POST',body:{...credentials,username:'second'}})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM admin').get().n,1);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM sessions').get().n,1);
});
test('CSRF, form submissions and missing custom header are rejected before writes',async () => {
  const db = testDB();
  for (const path of ['/api/auth/setup','/api/auth/login','/api/auth/logout']) {
    for (const headers of [{origin:'https://evil.test'},{origin:'null'},{'sec-fetch-site':'cross-site'},{'content-type':'text/plain'},{'x-rhythm-request':'0'}]) {
      const response = await send(db,path,{method:'POST',body:credentials,headers});
      assert.equal(response.status,403);
      assert.equal(response.headers.get('access-control-allow-origin'),null);
    }
    assert.equal((await send(db,path)).status,405);
  }
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM admin').get().n,0);
});
test('body size, invalid JSON and credential types fail closed',async () => {
  const db = testDB();
  for (const body of ['x'.repeat(5000),'not json',{...credentials,password:123},{...credentials,password:'short'},{...credentials,username:"admin' OR 1=1"},{...credentials,password:'x'.repeat(129)},null]) {
    assert.equal((await send(db,'/api/auth/setup',{method:'POST',body})).status,400);
  }
});
test('login failures are generic, rotated sessions revoke previous token',async () => {
  const db = testDB(); const oldCookie = await setup(db);
  for (const body of [{...credentials,password:'incorrect'},{...credentials,username:'unknown'}]) {
    const result = await send(db,'/api/auth/login',{method:'POST',body});
    assert.equal(result.status,401); assert.deepEqual(await result.json(),{error:'INVALID_LOGIN'});
  }
  const login = await send(db,'/api/auth/login',{method:'POST',body:{...credentials,remember:false},cookie:oldCookie});
  const cookie = login.headers.get('set-cookie');
  assert.equal(login.status,200); assert.doesNotMatch(cookie,/Max-Age|Expires/);
  assert.notEqual(cookie.split(';')[0],oldCookie.split(';')[0]);
  assert.equal((await send(db,'/main.dart.js',{cookie:oldCookie})).status,401);
  assert.ok(db.sqlite.prepare('SELECT expires_at FROM sessions').get().expires_at <= Date.now()+SESSION_SECONDS*1000);
});
test('logout revokes server session, expiration and duplicate cookies rejected',async () => {
  const db = testDB(); const cookie = await setup(db);
  assert.equal((await send(db,'/main.dart.js',{cookie:cookie.split(';')[0]+'; '+cookie.split(';')[0]})).status,401);
  const logout = await send(db,'/api/auth/logout',{method:'POST',body:{},cookie});
  assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);
  assert.equal((await send(db,'/main.dart.js',{cookie})).status,401);
  const login = await send(db,'/api/auth/login',{method:'POST',body:credentials});
  db.sqlite.exec('UPDATE sessions SET expires_at = 0');
  assert.equal((await send(db,'/main.dart.js',{cookie:login.headers.get('set-cookie')})).status,401);
});
test('rate limiter is atomic across concurrent attempts and resets after 15 minutes',async () => {
  const db = testDB(); const now=Date.now();
  const results = await Promise.all(Array.from({length:20},()=>allowAttempt(db,'owner',now)));
  assert.equal(results.filter(r=>r.allowed).length,10);
  assert.equal((await allowAttempt(db,'owner',now+900000)).allowed,true);
  for (let i=0;i<10;i++) await allowAttempt(db,'test-site-owner',now);
  const response = await send(db,'/api/auth/login',{method:'POST',body:credentials});
  assert.equal(response.status,429); assert.ok(Number(response.headers.get('retry-after'))>0);
});
test('DB outages deny access without leaking exception details',async () => {
  const result=await worker.fetch(request('/main.dart.js'),{});
  assert.equal(result.status,503); assert.deepEqual(await result.json(),{error:'AUTH_UNAVAILABLE'});
});
test('CSP and safe response headers on login, errors and protected page',async () => {
  const db=testDB(); const cookie=await setup(db);
  for (const path of ['/auth','/','/missing']) {
    const result=await send(db,path,{cookie});
    assert.match(result.headers.get('content-security-policy'),/frame-ancestors 'none'/);
    assert.match(result.headers.get('content-security-policy'),/script-src 'self' 'wasm-unsafe-eval';/);
    assert.equal(result.headers.get('x-content-type-options'),'nosniff');
    assert.equal(result.headers.get('cache-control'),'private, no-store');
  }
});
test('built public assets contain no HTML/app scripts or source maps',() => {
  for (const name of ['index.html','main.dart.js','flutter_bootstrap.js','browser-hooks.js','browser-storage.js','auth-guard.js']) {
    assert.equal(existsSync(new URL(`../dist/client/${name}`,import.meta.url)),false,name);
  }
  assert.ok(existsSync(new URL('../dist/server/index.js',import.meta.url)));
  const walk = dir => readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(new URL(e.name+'/',dir)):[e.name]);
  assert.ok(walk(new URL('../dist/client/',import.meta.url)).every(name=>!name.endsWith('.map')&&!name.endsWith('.html')));
  const hosting = new URL('../.openai/hosting.json',import.meta.url);
  if (existsSync(hosting)) {
    assert.equal(readFileSync(hosting,'utf8').includes('"static"'),false);
  }
});
