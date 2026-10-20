// Keep a current and previous snapshot below D1's 2,000,000-byte row limit.
export const MAX_JOURNAL_BYTES = 900_000;
export const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
export const EMPTY_JOURNAL = '{"schemaVersion":2,"habits":[],"entries":[]}';
const encoder = new TextEncoder();
const maximum = Number.MAX_SAFE_INTEGER;
const integerFields = new Set(['schemaVersion', 'targetMinutes', 'minutes']);
const kinds = new Set(['check', 'single', 'multiple', 'duration', 'number', 'text']);
const uuid = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const strings = value => Array.isArray(value) && value.every(item => typeof item === 'string');
const integer = value => Number.isSafeInteger(value) && value >= 0;
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const invalid = () => { throw new Error('INVALID_JOURNAL'); };

function validDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return year >= 1 && month >= 1 && month <= 12 && day >= 1
    && day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

// JSON.parse rounds numbers before schema validation. Check the original tokens
// for the same integer fields/depth bound as Dart's integer_preflight.dart,
// including escaped property names and integer fields inside extension objects.
function validateIntegerTokens(source, fields = integerFields) {
  let depth = 0;
  for (let i = 0; i < source.length; i++) {
    const character = source[i];
    if (character === '{' || character === '[') {
      // Dart counts value depth: a container at depth 256 can be empty.
      if (depth > 256) invalid();
      depth++;
    } else if (character === '}' || character === ']') {
      depth--;
    } else if (character === '"') {
      if (depth > 256) invalid();
      const start = i++;
      while (i < source.length && source[i] !== '"') {
        if (source[i] === '\\') i++;
        i++;
      }
      let next = i + 1;
      while (/\s/.test(source[next] ?? '') && next < source.length) next++;
      if (source[next] !== ':' || !fields.has(JSON.parse(source.slice(start, i + 1)))) continue;
      next++;
      while (/\s/.test(source[next] ?? '') && next < source.length) next++;
      const token = /^-?(?:0|[1-9][0-9]*)/.exec(source.slice(next))?.[0];
      if (!token || token.length > 17 || !/^[\s,}\]]$/.test(source[next + token.length] ?? '')
          || !integer(Number(token))) invalid();
    } else if (!/\s|,|:/.test(character) && depth > 256) {
      invalid();
    }
  }
}

export function validateJournal(source) {
  if (typeof source !== 'string') invalid();
  if (encoder.encode(source).byteLength > MAX_JOURNAL_BYTES) throw new Error('JOURNAL_TOO_LARGE');
  let journal;
  try { journal = JSON.parse(source); } catch { invalid(); }
  validateIntegerTokens(source);
  if (!object(journal) || ![1, 2].includes(journal.schemaVersion) || !Array.isArray(journal.habits)
      || !Array.isArray(journal.entries)) invalid();
  const habits = new Map();
  for (const habit of journal.habits) {
    if (!object(habit) || !['id', 'title', 'note', 'kind', 'colorHex', 'symbol', 'unit', 'startDay']
      .every(key => typeof habit[key] === 'string')) invalid();
    const id = habit.id.toUpperCase();
    if (!uuid.test(id) || habits.has(id) || !habit.title.trim() || !kinds.has(habit.kind)
        || !validDay(habit.startDay) || !integer(habit.targetMinutes) || !number(habit.targetNumber)
        || (habit.kind === 'duration' && habit.targetMinutes <= 0)
        || (habit.kind === 'number' && habit.targetNumber <= 0)
        || (habit.archivedOn != null && (!validDay(habit.archivedOn) || habit.archivedOn < habit.startDay))
        || !strings(habit.options) || new Set(habit.options).size !== habit.options.length
        || habit.options.some(option => !option.trim())
        || (['single', 'multiple'].includes(habit.kind) && habit.options.length === 0)) invalid();
    habits.set(id, habit);
  }
  const keys = new Set();
  let totalMinutes = 0;
  for (const entry of journal.entries) {
    if (!object(entry) || typeof entry.habitID !== 'string' || typeof entry.text !== 'string'
        || typeof entry.checked !== 'boolean' || !integer(entry.minutes)
        || (entry.number != null && !number(entry.number)) || !strings(entry.selections)) invalid();
    const id = entry.habitID.toUpperCase();
    const habit = habits.get(id);
    const key = `${id}/${entry.day}`;
    if (!habit || !validDay(entry.day) || entry.day < habit.startDay || keys.has(key)
        || new Set(entry.selections).size !== entry.selections.length
        || entry.selections.some(selection => !habit.options.includes(selection))
        || (habit.kind === 'single' && entry.selections.length > 1)) invalid();
    if (Object.hasOwn(entry, 'sessions')) {
      // Version 1 clients do not retain this field when saving. Requiring the
      // new version keeps an older client from silently discarding categories.
      if (journal.schemaVersion === 1 || !Array.isArray(entry.sessions)
          || (entry.sessions.length > 0 && habit.kind !== 'duration')) invalid();
      let sessionMinutes = 0;
      for (const session of entry.sessions) {
        if (!object(session) || typeof session.topic !== 'string'
            || !habit.options.includes(session.topic) || !integer(session.minutes)
            || session.minutes > maximum - sessionMinutes) invalid();
        sessionMinutes += session.minutes;
      }
      // Legacy duration entries may also include uncategorized minutes. Keep
      // that remainder while preventing detailed sessions exceeding the total.
      if (sessionMinutes > entry.minutes) invalid();
    }
    keys.add(key);
    if (habit.kind === 'duration') {
      if (entry.minutes > maximum - totalMinutes) invalid();
      totalMinutes += entry.minutes;
    }
  }
  return journal;
}

async function readRequest(request) {
  if (!request.body) invalid();
  const declared = request.headers.get('content-length');
  if (declared && Number(declared) > MAX_REQUEST_BYTES) throw new Error('JOURNAL_TOO_LARGE');
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new Error('JOURNAL_TOO_LARGE');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let body;
    try {
      const source = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
      body = JSON.parse(source);
      validateIntegerTokens(source, new Set(['expectedRevision']));
    } catch { invalid(); }
    if (!object(body) || !integer(body.expectedRevision) || typeof body.json !== 'string') invalid();
    validateJournal(body.json);
    return body;
  } finally {
    reader.releaseLock();
  }
}

// Caller must authenticate the session, verify its admin owner and protect PUT
// against CSRF before invoking this function. Account keys never come from JSON.
export async function handleJournal(request, db, owner, adminId, respond) {
  const backup = new URL(request.url).pathname === '/api/journal/backup';
  if (request.method === 'GET') {
    if (backup) {
      const row = await db.prepare('SELECT previous_json AS json, previous_revision AS revision FROM account_journals WHERE owner = ? AND admin_id = ?')
        .bind(owner, adminId).first();
      return respond(row?.json == null ? null : row);
    }
    const row = await db.prepare('SELECT json, revision FROM account_journals WHERE owner = ? AND admin_id = ?')
      .bind(owner, adminId).first();
    return respond(row ? {...row, initialized: true} : {json: EMPTY_JOURNAL, revision: 0, initialized: false});
  }
  if (request.method !== 'PUT' || backup) return respond({error: 'METHOD_NOT_ALLOWED'}, 405, {Allow: backup ? 'GET' : 'GET, PUT'});
  let body;
  try { body = await readRequest(request); }
  catch (error) {
    return respond({error: error.message === 'JOURNAL_TOO_LARGE' ? 'JOURNAL_TOO_LARGE' : 'INVALID_JOURNAL'}, error.message === 'JOURNAL_TOO_LARGE' ? 413 : 400);
  }
  if (body.expectedRevision === maximum) return respond({error: 'REVISION_LIMIT'}, 409);
  // Each path is a single atomic statement. In particular, a stale expected=0
  // request cannot replace an initialized journal, even if its contents are empty.
  const statement = body.expectedRevision === 0
    ? db.prepare(`INSERT OR IGNORE INTO account_journals (owner, admin_id, json, revision, updated_at)
        VALUES (?, ?, ?, 1, ?) RETURNING revision`).bind(owner, adminId, body.json, Date.now())
    : db.prepare(`UPDATE account_journals SET previous_json = json, previous_revision = revision,
        json = ?, revision = revision + 1, updated_at = ?
        WHERE owner = ? AND admin_id = ? AND revision = ? RETURNING revision`)
      .bind(body.json, Date.now(), owner, adminId, body.expectedRevision);
  const row = await statement.first();
  return row ? respond(row) : respond({error: 'CONFLICT'}, 409);
}
