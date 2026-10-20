'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// These tests exercise the actual browser scripts without an HTTP server or a
// real journal. Keep this file in test/ so the source paths stay project-local.
const guardSource = fs.readFileSync(path.join(__dirname, '../web/auth-guard.js'), 'utf8');
const hooksSource = fs.readFileSync(path.join(__dirname, '../web/browser-hooks.js'), 'utf8');
const AUTH_ERROR = /AUTHENTICATION_REQUIRED/;

function deferred() {
  let resolve;
  const promise = new Promise(fulfill => { resolve = fulfill; });
  return {promise, resolve};
}

async function settle() {
  // Drain promise continuations from fetch/json/check/tool callbacks.
  for (let index = 0; index < 12; index++) await Promise.resolve();
}

function browser({initial = 'authenticated', sessionLifetime = 300000} = {}) {
  let now = 1_800_000_000_000;
  let nextTimerID = 1;
  let detachCount = 0;
  const requests = [];
  const sessionReplies = [];
  const logoutReplies = [];
  const timers = new Map();
  const windowListeners = new Map();
  const documentListeners = new Map();
  const channels = [];
  const registeredTools = [];
  const storageWrites = [];
  const cookieWrites = [];
  const alerts = [];
  const redirects = [];
  const elements = [];
  const objectURLs = [];
  const initialExpiresAt = now + sessionLifetime;
  if (initial === 'unauthenticated') sessionReplies.push({authenticated:false});
  if (initial === 'offline') sessionReplies.push(new Error('Network unavailable'));
  function addListener(collection, name, callback) {
    const listeners = collection.get(name) || [];
    listeners.push(callback);
    collection.set(name, listeners);
  }
  function dispatch(collection, name, event = {}) {
    for (const callback of collection.get(name) || []) callback(event);
  }
  const document = {
    documentElement:{style:{visibility:'visible'}, lang:'en'},
    hidden:false,
    addEventListener(name, callback) { addListener(documentListeners, name, callback); },
    modelContext:{
      registerTool(definition, options) {
        // Deliberately retain callback references even after their signal aborts:
        // a revoked tool must defend itself, not rely on framework removal.
        registeredTools.push({definition, signal:options.signal});
      },
    },
    body:{appendChild() {}},
    createElement(tag) {
      const element = {tag, style:{}, clicks:0, removed:false, children:[], attributes:{},
        click() { this.clicks++; }, remove() { this.removed = true; },
        setAttribute(key, value) { this.attributes[key] = value; },
        append(...children) { this.children.push(...children); }, focus() { this.focused = true; }};
      elements.push(element);
      return element;
    },
  };
  Object.defineProperty(document, 'cookie', {
    get() { return ''; },
    set(value) { cookieWrites.push(value); },
  });
  function storage(name) {
    return {
      getItem() { return null; },
      setItem(key, value) { storageWrites.push({storage:name, key, value}); },
      removeItem(key) { storageWrites.push({storage:name, key, removed:true}); },
    };
  }
  const sandbox = {
    document,
    location:{replace(value) { redirects.push(value); }},
    localStorage:storage('localStorage'),
    sessionStorage:storage('sessionStorage'),
    alert(value) { alerts.push(value); },
    addEventListener(name, callback) { addListener(windowListeners, name, callback); },
    BroadcastChannel:class {
      constructor(name) { this.name = name; this.messages = []; this.listeners = []; channels.push(this); }
      addEventListener(name, callback) { if (name === 'message') this.listeners.push(callback); }
      postMessage(message) { this.messages.push(message); }
      receive(message) { for (const callback of this.listeners) callback({data:message}); }
    },
    Date:class extends Date { static now() { return now; } },
    AbortController,
    AbortSignal,
    TextDecoder,
    Blob,
    URL:{
      createObjectURL(blob) { objectURLs.push(blob); return 'blob:test-backup'; },
      revokeObjectURL() {},
    },
    setTimeout(callback, delay) { const id = nextTimerID++; timers.set(id, {callback, delay, due:now + delay}); return id; },
    clearTimeout(id) { timers.delete(id); },
    async fetch(url, options) {
      requests.push({url, options});
      const queue = url === '/api/auth/session' ? sessionReplies : logoutReplies;
      let reply = queue.length ? queue.shift() :
        (url === '/api/auth/session' ? {authenticated:true, expiresAt:initialExpiresAt} : {ok:true});
      if (typeof reply === 'function') {
        const pending = reply();
        const aborted = new Promise((resolve, reject) => {
          if (options.signal?.aborted) reject(new Error('AbortError'));
          else options.signal?.addEventListener('abort', () => reject(new Error('AbortError')), {once:true});
        });
        reply = await Promise.race([pending, aborted]);
      }
      if (reply instanceof Error) throw reply;
      if (reply.httpStatus) return {ok:false, status:reply.httpStatus, async json() { return reply; }};
      return {ok:true, status:200, async json() { return reply; }};
    },
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(hooksSource, context, {filename:'browser-hooks.js'});
  const detach = sandbox.rhythmBrowser.detach;
  sandbox.rhythmBrowser.detach = () => { detachCount++; detach(); };
  vm.runInContext(guardSource, context, {filename:'auth-guard.js'});
  return {
    window:sandbox, document, requests, sessionReplies, logoutReplies, registeredTools,
    channels, storageWrites, cookieWrites, alerts, redirects, elements, objectURLs, timers,
    get detachCount() { return detachCount; },
    get now() { return now; },
    get expiresAt() { return initialExpiresAt; },
    get overlay() { return elements.find(element => element.tag === 'section' && !element.removed); },
    advance(milliseconds) { now += milliseconds; },
    dispatchWindow(name, event) { dispatch(windowListeners, name, event); },
    dispatchDocument(name, event) { dispatch(documentListeners, name, event); },
    async runNextTimer() {
      const next = [...timers.entries()].sort((left, right) => left[1].due - right[1].due)[0];
      assert.ok(next, 'an authentication revalidation timer is armed');
      timers.delete(next[0]);
      now = next[1].due;
      next[1].callback();
      await settle();
    },
    tool(name = 'read_journal') {
      const registered = registeredTools.find(item => item.definition.name === name);
      assert.ok(registered, `expected ${name} to be registered`);
      return registered;
    },
  };
}

for (const initial of ['unauthenticated', 'offline']) {
  test(`startup fails closed when the session is ${initial}`, async () => {
    const page = browser({initial});
    assert.equal(page.document.documentElement.style.visibility, 'hidden', 'conceal before the first response');
    await assert.rejects(page.window.rhythmAuth.ready, AUTH_ERROR);
    assert.equal(page.window.rhythmAuth.active, false);
    assert.equal(page.document.documentElement.style.visibility, 'hidden');
    assert.equal(page.detachCount, 1);
    assert.deepEqual(page.redirects, ['/auth']);
    assert.equal(page.requests.length, 1);
  });
}

test('the app is revealed only after a valid server session, using cookie credentials without cache', async () => {
  const page = browser();
  assert.equal(page.document.documentElement.style.visibility, 'hidden');
  await page.window.rhythmAuth.ready;
  assert.equal(page.window.rhythmAuth.active, true);
  assert.equal(page.document.documentElement.style.visibility, 'visible');
  assert.deepEqual(page.redirects, []);
  const {url, options} = page.requests[0];
  assert.equal(url, '/api/auth/session');
  assert.equal(options.credentials, 'same-origin');
  assert.equal(options.cache, 'no-store');
  assert.equal(options.redirect, 'error');
});

test('an expired or malformed server session never unlocks the page', async () => {
  for (const state of [{authenticated:true}, {authenticated:true, expiresAt:'9999999999999'},
    {authenticated:true, expiresAt:1}, {authenticated:false, expiresAt:9_999_999_999_999}]) {
    const page = browser();
    await page.window.rhythmAuth.ready;
    page.sessionReplies.push(state);
    await assert.rejects(page.window.rhythmAuth.check(), AUTH_ERROR);
    assert.equal(page.window.rhythmAuth.active, false);
    assert.equal(page.document.documentElement.style.visibility, 'hidden');
    assert.deepEqual(page.redirects, []);
    assert.ok(page.overlay, 'loaded pages lock in place');
  }
});

for (const mechanism of ['BroadcastChannel', 'storage']) {
  test(`${mechanism} logout closes the page and captured WebMCP callbacks`, async () => {
    const page = browser();
    await page.window.rhythmAuth.ready;
    let calls = 0;
    page.window.rhythmBrowser.attach(async () => { calls++; return '{"private":"journal"}'; });
    const captured = page.tool();
    const previousRequests = page.requests.length;
    if (mechanism === 'BroadcastChannel') page.channels[0].receive('logout');
    else page.dispatchWindow('storage', {key:'rhythm.auth.logout', newValue:String(page.now)});
    assert.equal(page.window.rhythmAuth.active, false);
    assert.equal(page.document.documentElement.style.visibility, 'hidden');
    assert.equal(captured.signal.aborted, true);
    assert.deepEqual(page.redirects, ['/auth']);
    await assert.rejects(captured.definition.execute({}), AUTH_ERROR);
    assert.equal(calls, 0);
    assert.equal(page.requests.length, previousRequests, 'captured callbacks fail before any further network or journal access');
  });
}

test('an unrelated storage event does not revoke a valid session', async () => {
  const page = browser();
  await page.window.rhythmAuth.ready;
  page.dispatchWindow('storage', {key:'rhythm.language', newValue:'zh'});
  assert.equal(page.window.rhythmAuth.active, true);
  assert.deepEqual(page.redirects, []);
});

test('periodic session rejection conceals the journal, preserves drafts, and closes every registered tool', async () => {
  const page = browser();
  await page.window.rhythmAuth.ready;
  let calls = 0;
  page.window.rhythmBrowser.attach(async () => { calls++; return '{}'; });
  page.window.rhythmBrowser.setUnsaved(true);
  page.sessionReplies.push({httpStatus:401});
  await page.runNextTimer();
  assert.equal(page.window.rhythmAuth.active, false);
  assert.equal(page.document.documentElement.style.visibility, 'hidden');
  assert.deepEqual(page.redirects, []);
  assert.equal(page.window.rhythmBrowser.hasUnsaved(), true);
  assert.ok(page.overlay);
  for (const {definition, signal} of page.registeredTools) {
    assert.equal(signal.aborted, true);
    await assert.rejects(definition.execute({}), AUTH_ERROR);
  }
  assert.equal(calls, 0);
});

test('the absolute expiration immediately disables export and import before the next timer', async () => {
  const page = browser({sessionLifetime:1000});
  await page.window.rhythmAuth.ready;
  page.advance(1001);
  assert.equal(page.window.rhythmAuth.active, false);
  assert.throws(() => page.window.rhythmBrowser.download('backup.json', '{"private":true}'), AUTH_ERROR);
  assert.deepEqual(JSON.parse(await page.window.rhythmBrowser.pickBackup()), {error:true});
  assert.equal(page.objectURLs.length, 0);
  assert.equal(page.elements.length, 0);
});

test('callbacks retained by an agent cannot run after explicit detach', async () => {
  const page = browser();
  await page.window.rhythmAuth.ready;
  let calls = 0;
  page.window.rhythmBrowser.attach(async () => { calls++; return '{}'; });
  const captured = page.tool();
  page.window.rhythmBrowser.detach();
  await assert.rejects(captured.definition.execute({}), AUTH_ERROR);
  assert.equal(calls, 0);
});

test('replacing the tool lifecycle invalidates callbacks from the previous registration', async () => {
  const page = browser();
  await page.window.rhythmAuth.ready;
  let oldCalls = 0;
  let newCalls = 0;
  page.window.rhythmBrowser.attach(async () => { oldCalls++; return '{}'; });
  const oldTool = page.tool();
  page.window.rhythmBrowser.attach(async () => { newCalls++; return '{"saved":true}'; });
  await assert.rejects(oldTool.definition.execute({}), AUTH_ERROR);
  const newTool = page.registeredTools.filter(item => item.definition.name === 'read_journal').at(-1);
  assert.deepEqual(JSON.parse(JSON.stringify(await newTool.definition.execute({}))), {saved:true});
  assert.equal(oldCalls, 0);
  assert.equal(newCalls, 1);
});

test('WebMCP checks the server before giving the tool access to journal data', async () => {
  const page = browser();
  await page.window.rhythmAuth.ready;
  let calls = 0;
  page.window.rhythmBrowser.attach(async () => { calls++; return '{"private":"journal"}'; });
  page.sessionReplies.push({httpStatus:401});
  await assert.rejects(page.tool().definition.execute({}), AUTH_ERROR);
  assert.equal(calls, 0);
  assert.equal(page.window.rhythmAuth.active, false);
});

test('WebMCP withholds a computed journal result if the session is revoked during execution', async () => {
  const page = browser();
  await page.window.rhythmAuth.ready;
  let calls = 0;
  page.window.rhythmBrowser.attach(async () => {
    calls++;
    page.sessionReplies.push({httpStatus:401});
    return '{"private":"journal"}';
  });
  await assert.rejects(page.tool().definition.execute({}), AUTH_ERROR);
  assert.equal(calls, 1);
  assert.equal(page.document.documentElement.style.visibility, 'hidden');
});

test('an in-flight tool cannot return private data after a cross-tab logout', async () => {
  const page = browser();
  await page.window.rhythmAuth.ready;
  const result = deferred();
  let actionStarted = false;
  page.window.rhythmBrowser.attach(async () => { actionStarted = true; return result.promise; });
  const execution = page.tool().definition.execute({});
  await settle();
  assert.equal(actionStarted, true);
  page.channels[0].receive('logout');
  result.resolve('{"private":"journal"}');
  await assert.rejects(execution, AUTH_ERROR);
});

test('a delayed successful session response cannot reveal a page already locked by another tab', async () => {
  const page = browser();
  await page.window.rhythmAuth.ready;
  const response = deferred();
  page.sessionReplies.push(() => response.promise);
  const check = page.window.rhythmAuth.check();
  page.channels[0].receive('logout');
  response.resolve({authenticated:true, expiresAt:page.expiresAt});
  await assert.rejects(check, AUTH_ERROR);
  assert.equal(page.document.documentElement.style.visibility, 'hidden');
  assert.equal(page.window.rhythmAuth.active, false);
  assert.deepEqual(page.redirects, ['/auth']);
});

test('unsaved changes prevent logout before any HTTP request or tool invalidation', async () => {
  const page = browser();
  await page.window.rhythmAuth.ready;
  page.window.rhythmBrowser.attach(async () => '{}');
  page.window.rhythmBrowser.setUnsaved(true);
  const before = page.requests.length;
  await page.window.rhythmAuth.logout();
  assert.equal(page.requests.length, before);
  assert.equal(page.alerts.length, 1);
  assert.match(page.alerts[0], /Save your changes/);
  assert.equal(page.window.rhythmBrowser.hasUnsaved(), true);
  assert.equal(page.window.rhythmAuth.active, true);
  assert.equal(page.tool().signal.aborted, false);
  assert.deepEqual(page.redirects, []);
  assert.deepEqual(page.storageWrites, []);
});

test('successful logout revokes server state before notifying other tabs and locking the app', async () => {
  const page = browser();
  await page.window.rhythmAuth.ready;
  const response = deferred();
  page.logoutReplies.push(() => response.promise);
  const logout = page.window.rhythmAuth.logout();
  await settle();
  assert.equal(page.window.rhythmAuth.active, true);
  assert.deepEqual(page.channels[0].messages, []);
  response.resolve({ok:true});
  await logout;
  const request = page.requests.find(item => item.url === '/api/auth/logout');
  assert.ok(request);
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.credentials, 'same-origin');
  assert.equal(request.options.headers['Content-Type'], 'application/json');
  assert.equal(request.options.headers['X-Rhythm-Request'], '1');
  assert.deepEqual(page.channels[0].messages, ['logout']);
  assert.equal(page.window.rhythmAuth.active, false);
  assert.deepEqual(page.redirects, ['/auth']);
});

test('failed logout does not falsely report that the server session was revoked', async () => {
  const page = browser();
  await page.window.rhythmAuth.ready;
  page.logoutReplies.push({httpStatus:503});
  await page.window.rhythmAuth.logout();
  assert.equal(page.window.rhythmAuth.active, true);
  assert.equal(page.alerts.length, 1);
  assert.match(page.alerts[0], /Could not sign out/);
  assert.deepEqual(page.channels[0].messages, []);
  assert.deepEqual(page.redirects, []);
});

test('authentication persists no password or session token in JavaScript-managed browser storage', async () => {
  const page = browser();
  await page.window.rhythmAuth.ready;
  // Even unexpected sensitive properties in a response must not be persisted.
  page.sessionReplies.push({authenticated:true, expiresAt:page.expiresAt,
    token:'synthetic-session-token-must-not-be-persisted', password:'synthetic-password'});
  await page.window.rhythmAuth.check();
  assert.deepEqual(page.storageWrites, []);
  await page.window.rhythmAuth.logout();
  assert.deepEqual(page.storageWrites, [{storage:'localStorage', key:'rhythm.auth.logout', value:String(page.now)}]);
  assert.deepEqual(page.cookieWrites, [], 'only the HTTP server manages the auth cookie');
});

test('page restoration conceals the previous journal until session revalidation completes', async () => {
  const page = browser();
  await page.window.rhythmAuth.ready;
  const response = deferred();
  page.sessionReplies.push(() => response.promise);
  page.dispatchWindow('pagehide');
  assert.equal(page.document.documentElement.style.visibility, 'hidden');
  page.dispatchWindow('pageshow');
  assert.equal(page.document.documentElement.style.visibility, 'hidden');
  response.resolve({httpStatus:401});
  await settle();
  assert.equal(page.document.documentElement.style.visibility, 'hidden');
  assert.equal(page.window.rhythmAuth.active, false);
});


for (const mechanism of ['BroadcastChannel', 'storage']) {
  test(`${mechanism} logout preserves an unsaved draft behind a locked overlay`, async () => {
    const page = browser();
    await page.window.rhythmAuth.ready;
    page.window.rhythmBrowser.attach(async () => '{"private":"draft"}');
    const captured = page.tool();
    page.window.rhythmBrowser.setUnsaved(true);
    if (mechanism === 'BroadcastChannel') page.channels[0].receive('logout');
    else page.dispatchWindow('storage', {key:'rhythm.auth.logout', newValue:String(page.now)});
    assert.equal(page.window.rhythmAuth.active, false);
    assert.equal(page.document.documentElement.style.visibility, 'hidden');
    assert.equal(page.window.rhythmBrowser.hasUnsaved(), true);
    assert.ok(page.overlay);
    assert.equal(page.overlay.attributes.role, 'alertdialog');
    assert.deepEqual(page.redirects, []);
    await assert.rejects(captured.definition.execute({}), AUTH_ERROR);
    let prevented = false;
    page.dispatchWindow('beforeunload', {preventDefault() { prevented = true; }});
    assert.equal(prevented, true, 'leaving the locked page still warns about the retained draft');
  });
}

test('the known absolute expiration locks the journal while a session request is still hanging', async () => {
  const page = browser({sessionLifetime:1000});
  await page.window.rhythmAuth.ready;
  let actions = 0;
  page.window.rhythmBrowser.attach(async () => { actions++; return '{}'; });
  const captured = page.tool();
  page.window.rhythmBrowser.setUnsaved(true);
  const response = deferred();
  page.sessionReplies.push(() => response.promise);
  const revalidation = page.window.rhythmAuth.check();
  // The network has not resolved, and its timeout has not elapsed either.
  await page.runNextTimer();
  assert.equal(page.now, page.expiresAt);
  assert.equal(page.window.rhythmAuth.active, false);
  assert.equal(page.document.documentElement.style.visibility, 'hidden');
  assert.ok(page.overlay);
  assert.equal(page.window.rhythmBrowser.hasUnsaved(), true);
  await assert.rejects(captured.definition.execute({}), AUTH_ERROR);
  assert.equal(actions, 0);
  response.resolve({authenticated:true, expiresAt:page.expiresAt});
  await assert.rejects(revalidation, AUTH_ERROR);
});

test('a hanging session request has a bounded timeout and leaves an unsaved draft intact', async () => {
  const page = browser();
  await page.window.rhythmAuth.ready;
  page.window.rhythmBrowser.attach(async () => '{}');
  page.window.rhythmBrowser.setUnsaved(true);
  const response = deferred();
  page.sessionReplies.push(() => response.promise);
  const revalidation = page.window.rhythmAuth.check();
  const rejection = assert.rejects(revalidation, AUTH_ERROR);
  await page.runNextTimer();
  await rejection;
  assert.equal(page.window.rhythmAuth.active, false);
  assert.equal(page.document.documentElement.style.visibility, 'hidden');
  assert.equal(page.window.rhythmBrowser.hasUnsaved(), true);
  assert.deepEqual(page.redirects, []);
  assert.ok(page.overlay);
});

test('successful reauthentication restores the same draft but never revives revoked tool callbacks', async () => {
  const page = browser();
  await page.window.rhythmAuth.ready;
  const draft = {text:'locally retained draft'};
  page.window.rhythmBrowser.attach(async () => JSON.stringify(draft));
  const oldTool = page.tool();
  page.window.rhythmBrowser.setUnsaved(true);
  page.sessionReplies.push({httpStatus:401});
  await assert.rejects(page.window.rhythmAuth.check(), AUTH_ERROR);
  assert.ok(page.overlay);
  await page.window.rhythmAuth.check();
  assert.equal(page.window.rhythmAuth.active, true);
  assert.equal(page.window.rhythmBrowser.hasUnsaved(), true);
  assert.equal(page.document.documentElement.style.visibility, 'visible');
  assert.equal(page.overlay, undefined);
  await assert.rejects(oldTool.definition.execute({}), AUTH_ERROR);
  const newTool = page.registeredTools.filter(item => item.definition.name === 'read_journal').at(-1);
  assert.deepEqual(JSON.parse(JSON.stringify(await newTool.definition.execute({}))), draft);
});

test('an import already reading a file cannot hand its JSON to the app after session expiry', async () => {
  const page = browser({sessionLifetime:1000});
  await page.window.rhythmAuth.ready;
  const read = deferred();
  const importResult = page.window.rhythmBrowser.pickBackup();
  const input = page.elements.find(element => element.tag === 'input');
  input.files = [{size:16, arrayBuffer:() => read.promise}];
  const change = input.onchange();
  page.advance(1001);
  read.resolve(new TextEncoder().encode('{"private":true}'));
  await change;
  assert.deepEqual(JSON.parse(await importResult), {error:true});
});
