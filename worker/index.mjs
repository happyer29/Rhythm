import {
  authDB, findAdmin, getSession, issueSession, allowAttempt, validCredentials,
  readBody, randomHex, passwordHash, verifyPassword, sessionToken, digest, clearCookie,
} from './auth.mjs';
import { protectedAssets, loginHTML, loginJS } from './generated-assets.mjs';
import { handleJournal } from './journal.mjs';

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {status, headers:{'content-type':'application/json; charset=utf-8',...headers}});
}
function secure(response) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control','private, no-store');
  headers.set('X-Content-Type-Options','nosniff');
  headers.set('Referrer-Policy','no-referrer');
  headers.set('X-Frame-Options','DENY');
  headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  return new Response(response.body,{status:response.status,headers});
}
function sameOriginWrite(request) {
  return request.headers.get('origin') === new URL(request.url).origin
    && ['same-origin',null].includes(request.headers.get('sec-fetch-site'))
    && request.headers.get('x-rhythm-request') === '1'
    && request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() === 'application/json';
}
async function handle(request, env) {
  const url = new URL(request.url);
  // These headers are supplied by Sites dispatch. The owner-only Site audience
  // is the first authorization boundary, including first-time setup.
  const owner = request.headers.get('oai-authenticated-user-id');
  if (!owner || owner.length > 256) return json({error:'SITE_SIGN_IN_REQUIRED'},403);
  const path = url.pathname;
  if (['GET','HEAD'].includes(request.method) && path === '/auth') {
    return new Response(request.method === 'HEAD' ? null : loginHTML,{headers:{'content-type':'text/html; charset=utf-8'}});
  }
  if (request.method === 'GET' && path === '/auth.js') {
    return new Response(loginJS,{headers:{'content-type':'text/javascript; charset=utf-8'}});
  }
  const db = authDB(env);
  if (request.method === 'GET' && path === '/api/auth/session') {
    const session = await getSession(request,db,owner);
    if (session) return json({authenticated:true,expiresAt:session.expires_at});
    return json({authenticated:false,setupRequired:!(await findAdmin(db))});
  }
  if (path.startsWith('/api/auth/')) {
    if (request.method !== 'POST') return json({error:'METHOD_NOT_ALLOWED'},405,{'Allow':'POST'});
    if (!sameOriginWrite(request)) return json({error:'REQUEST_REJECTED'},403);
    let body;
    try { body = await readBody(request); } catch { return json({error:'INVALID_REQUEST'},400); }
    if (path === '/api/auth/logout') {
      const token = sessionToken(request);
      if (token) await db.prepare('DELETE FROM sessions WHERE token_hash = ? AND owner = ?').bind(await digest(token),owner).run();
      return json({ok:true},200,{'Set-Cookie':clearCookie});
    }
    if (!['/api/auth/setup','/api/auth/login'].includes(path)) return json({error:'NOT_FOUND'},404);
    const attempt = await allowAttempt(db,owner);
    if (!attempt.allowed) return json({error:'TOO_MANY_ATTEMPTS'},429,{'Retry-After':String(attempt.retryAfter)});
    const setup = path === '/api/auth/setup';
    if (!validCredentials(body,setup)) return json({error:setup?'INVALID_CREDENTIALS':'INVALID_LOGIN'},400);
    const username = body.username.toLowerCase();
    const admin = await findAdmin(db);
    if (setup) {
      if (admin) return json({error:'SETUP_CLOSED'},409);
      const salt = randomHex(16);
      const hash = passwordHash(body.password,salt);
      // A fixed primary key makes concurrent setup safe. No public registration.
      const result = await db.prepare('INSERT OR IGNORE INTO admin (id, owner, username, salt, password_hash, created_at) VALUES (1, ?, ?, ?, ?, ?)')
        .bind(owner,username,salt,hash,Date.now()).run();
      if (result.meta.changes !== 1) return json({error:'SETUP_CLOSED'},409);
    } else {
      const passwordOK = await verifyPassword(body.password,admin);
      if (!admin || !passwordOK || admin.username !== username || admin.owner !== owner) {
        return json({error:'INVALID_LOGIN'},401);
      }
    }
    const cookie = await issueSession(request,db,owner,body.remember);
    return json({ok:true},200,{'Set-Cookie':cookie});
  }
  if (path === '/api/journal' || path === '/api/journal/backup') {
    const session = await getSession(request,db,owner);
    if (!session) return json({error:'AUTHENTICATION_REQUIRED'},401);
    const admin = await findAdmin(db);
    if (!admin || admin.owner !== owner) return json({error:'AUTHENTICATION_REQUIRED'},401);
    if (request.method === 'PUT' && !sameOriginWrite(request)) return json({error:'REQUEST_REJECTED'},403);
    try { return await handleJournal(request,db,owner,admin.id,json); }
    catch { return json({error:'JOURNAL_UNAVAILABLE'},503); }
  }
  if (!['GET','HEAD'].includes(request.method)) return json({error:'METHOD_NOT_ALLOWED'},405,{'Allow':'GET, HEAD'});
  const session = await getSession(request,db,owner);
  if (!session) {
    if (path === '/' || path === '/index.html') return new Response(null,{status:303,headers:{Location:'/auth'}});
    return json({error:'AUTHENTICATION_REQUIRED'},401);
  }
  const asset = protectedAssets[path === '/' ? '/index.html' : path];
  if (!asset) return json({error:'NOT_FOUND'},404);
  return new Response(request.method === 'HEAD' ? null : asset.body,{headers:{'content-type':asset.type}});
}
export default {
  async fetch(request,env) {
    try { return secure(await handle(request,env)); }
    catch { return secure(json({error:'AUTH_UNAVAILABLE'},503)); }
  },
};
