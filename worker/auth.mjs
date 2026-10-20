import { scrypt } from '@noble/hashes/scrypt.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

export const COOKIE = '__Host-rhythm';
export const REMEMBER_SECONDS = 30 * 86400;
export const SESSION_SECONDS = 12 * 3600;
const WINDOW_MS = 15 * 60 * 1000;
const encoder = new TextEncoder();
export const randomHex = (bytes = 32) => bytesToHex(crypto.getRandomValues(new Uint8Array(bytes)));
export async function digest(value) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}
export function passwordHash(password, salt) {
  // OWASP scrypt equivalent: 16 MiB, p=5. Synchronous execution bounds
  // simultaneous KDF allocations within an isolate; rate limiting precedes it.
  return bytesToHex(scrypt(encoder.encode(password), hexToBytes(salt), {
    N:16384, r:8, p:5, dkLen:32, maxmem:32 * 1024 * 1024,
  }));
}
export async function verifyPassword(password, admin) {
  const actual = passwordHash(password, admin?.salt ?? '00'.repeat(16));
  // Delegate equality to native HMAC verification instead of a JS string/byte
  // comparison that can short-circuit. The per-comparison key is ephemeral.
  const key = await crypto.subtle.importKey('raw',crypto.getRandomValues(new Uint8Array(32)),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
  const expected = await crypto.subtle.sign('HMAC',key,hexToBytes(admin?.password_hash ?? '00'.repeat(32)));
  return crypto.subtle.verify('HMAC',key,expected,hexToBytes(actual));
}
export function sessionToken(request) {
  const matches = (request.headers.get('cookie') ?? '').split(';')
    .map(v => v.trim()).filter(v => v.startsWith(`${COOKIE}=`));
  if (matches.length !== 1) return null;
  const token = matches[0].slice(COOKIE.length + 1);
  return /^[a-f0-9]{64}$/.test(token) ? token : null;
}
export function sessionCookie(token, remember = false) {
  return `${COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict${remember ? `; Max-Age=${REMEMBER_SECONDS}` : ''}`;
}
export const clearCookie = `${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`;
export function authDB(env) {
  if (!env.DB) throw new Error('AUTH_DATABASE_UNAVAILABLE');
  return env.DB;
}
export async function findAdmin(db) { return db.prepare('SELECT * FROM admin WHERE id = 1').first(); }
export async function getSession(request, db, owner, now = Date.now()) {
  const token = sessionToken(request);
  if (!token) return null;
  return db.prepare('SELECT expires_at FROM sessions WHERE token_hash = ? AND owner = ? AND expires_at > ?')
    .bind(await digest(token), owner, now).first();
}
export async function issueSession(request, db, owner, remember, now = Date.now()) {
  const token = randomHex();
  const lifetime = remember ? REMEMBER_SECONDS : SESSION_SECONDS;
  const previous = sessionToken(request);
  const commands = [db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now)];
  if (previous) commands.push(db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await digest(previous)));
  commands.push(db.prepare('INSERT INTO sessions (token_hash, owner, expires_at) VALUES (?, ?, ?)')
    .bind(await digest(token), owner, now + lifetime * 1000));
  await db.batch(commands);
  return sessionCookie(token, remember);
}
export async function allowAttempt(db, owner, now = Date.now()) {
  // One atomic statement, including the count check: parallel requests cannot
  // all read an old counter and evade the limit. Username/IP changes don't help.
  const row = await db.prepare(`INSERT INTO auth_attempts (identity, window_start, count) VALUES (?, ?, 1)
    ON CONFLICT(identity) DO UPDATE SET
    count = CASE WHEN window_start <= ? THEN 1 ELSE count + 1 END,
    window_start = CASE WHEN window_start <= ? THEN excluded.window_start ELSE window_start END
    RETURNING count, window_start`).bind(await digest(owner), now, now - WINDOW_MS, now - WINDOW_MS).first();
  return {allowed:row.count <= 10, retryAfter:Math.max(1, Math.ceil((row.window_start + WINDOW_MS - now) / 1000))};
}
export function validCredentials(body, setup = false) {
  return body && typeof body === 'object' && !Array.isArray(body)
    && typeof body.username === 'string' && /^[a-zA-Z0-9_.-]{3,64}$/.test(body.username)
    && typeof body.password === 'string' && [...body.password].length >= (setup ? 15 : 1)
    && [...body.password].length <= 128 && encoder.encode(body.password).length <= 512
    && typeof body.remember === 'boolean';
}
export async function readBody(request) {
  if (!request.body) throw new Error('INVALID_BODY');
  const reader = request.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const {done,value} = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 4096) { await reader.cancel(); throw new Error('BODY_TOO_LARGE'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes));
  } finally { reader.releaseLock(); }
}
