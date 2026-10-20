import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dailyHabits, daySummary, eligible, emptyEntry, entryFor, formatMinutes, habitProgress,
  habitStats, journalStats, parseJournal, serializeJournal, sessionMinutes, shiftDay,
  streakFromDays, todayKey, unassignedMinutes, validDay, withEntry,
} from '../src/journal.js';

const id = 'ABCDEF00-0000-4000-8000-000000000001';
const day = '2026-10-15';
function habit(kind = 'duration', overrides = {}) {
  return {
    id, title: 'Example habit', note: '', kind, colorHex: '6C5CE7', symbol: 'book',
    unit: '', startDay: '2026-10-01', options: ['Reading', 'Practice'],
    targetMinutes: 60, targetNumber: 10, ...overrides,
  };
}
const entry = (overrides = {}) => ({...emptyEntry(id, day), ...overrides});
const journal = (habits = [habit()], entries = []) => ({schemaVersion: 2, habits, entries});

test('civil days handle leap years, years below 100, boundaries, and DST dates', () => {
  for (const valid of ['0001-01-01', '0099-12-31', '2000-02-29', '2024-02-29', '9999-12-31']) assert.equal(validDay(valid), true);
  for (const invalid of ['0000-01-01', '1900-02-29', '2025-02-29', '2026-04-31', '2026-1-01', '2026-01-01T00:00:00']) assert.equal(validDay(invalid), false);
  assert.equal(shiftDay('2024-03-01', -1), '2024-02-29');
  assert.equal(shiftDay('2026-03-08', 1), '2026-03-09');
  assert.equal(shiftDay('0099-12-31', 1), '0100-01-01');
  assert.equal(shiftDay('0001-01-01', -1), '0001-01-01');
  assert.equal(shiftDay('9999-12-31', 1), '9999-12-31');
  assert.equal(shiftDay('invalid', 1), 'invalid');
  assert.equal(todayKey(new Date(2026, 9, 15, 12)), day);
});

test('version 1 imports upgrade IDs and schema without dropping extension fields', () => {
  const original = journal([habit('duration', {id: id.toLowerCase(), settings: {display: 'small'}})], [
    {habitID: id.toLowerCase(), day, checked: false, selections: [], minutes: 15, text: '', metadata: {source: 'sample'}},
  ]);
  original.schemaVersion = 1;
  original.extension = {version: 'example'};
  const parsed = parseJournal(JSON.stringify(original));
  assert.equal(parsed.schemaVersion, 2);
  assert.equal(parsed.habits[0].id, id);
  assert.equal(parsed.entries[0].habitID, id);
  assert.deepEqual(parsed.entries[0].sessions, []);
  assert.equal(parsed.entries[0].number, null);
  assert.deepEqual(parsed.habits[0].settings, original.habits[0].settings);
  assert.deepEqual(parseJournal(serializeJournal(parsed)), parsed);
  assert.equal(Object.isFrozen(parsed.entries[0].metadata), true);
  assert.throws(() => { parsed.habits[0].title = 'Mutation'; }, TypeError);
});

test('integer token validation happens before JSON rounding, including escaped keys', () => {
  const source = JSON.stringify(journal([habit()], [entry({minutes: 10})]));
  for (const token of ['9007199254740992', '9007199254740991.1', '1e1', '1.0', '-1']) {
    assert.throws(() => parseJournal(source.replace('"minutes":10', `"minutes":${token}`)), /INVALID_JOURNAL/);
  }
  assert.throws(() => parseJournal(source.replace('"minutes":10', '"\\u006dinutes":1e1')), /INVALID_JOURNAL/);
  assert.throws(() => serializeJournal(journal([habit('number')], [entry({number: Number.NaN})])), /INVALID_JOURNAL/);
  assert.throws(() => serializeJournal(journal([habit('number')], [entry({number: Infinity})])), /INVALID_JOURNAL/);
  assert.throws(() => parseJournal(JSON.stringify({...journal(), schemaVersion: 1, entries: [entry()]})), /INVALID_JOURNAL/);
});

test('opaque extension numbers retain their exact tokens through normal journal edits', () => {
  const data = journal(
    [habit('duration', {extension: {identifier: 'large'}})],
    [entry({minutes: 30, extension: {decimal: 'precise'}, sessions: [{topic: 'Reading', minutes: 20, extension: {overflow: 'overflow-token'}}]})],
  );
  data.extension = {integers: ['large'], exponent: 'exponent-token'};
  const source = JSON.stringify(data)
    .replaceAll('"large"', '9007199254740993')
    .replace('"precise"', '0.10000000000000000000001')
    .replace('"overflow-token"', '1e309')
    .replace('"exponent-token"', '1e20');
  const parsed = parseJournal(source);
  assert.equal(typeof parsed.habits[0].targetMinutes, 'number');
  assert.equal(typeof parsed.habits[0].targetNumber, 'number');
  assert.equal(typeof parsed.entries[0].minutes, 'number');
  assert.equal(typeof parsed.entries[0].sessions[0].minutes, 'number');
  const edited = withEntry(parsed, {...parsed.entries[0], minutes: 40});
  const encoded = serializeJournal(edited);
  assert.match(encoded, /"identifier":9007199254740993/);
  assert.match(encoded, /"integers":\[9007199254740993\]/);
  assert.match(encoded, /"decimal":0\.10000000000000000000001/);
  assert.match(encoded, /"overflow":1e309/);
  assert.match(encoded, /"exponent":1e20/);
  assert.equal(serializeJournal(parseJournal(encoded)), encoded);
});

test('older browsers preserve ordinary extension numbers and fail closed only on precision loss', () => {
  const nativeParse = JSON.parse;
  const nativeRaw = JSON.rawJSON;
  const source = JSON.stringify({
    ...journal([habit('number', {targetNumber: 1e20})]),
    extension: {'__rhythm_number_token__': 'existing key', normal: 0.5, count: 10, safeLarge: 1e20},
  });
  try {
    JSON.rawJSON = undefined;
    JSON.parse = (text, reviver) => nativeParse(text, reviver ? function(key, value) {
      return reviver.call(this, key, value);
    } : undefined);
    const parsed = parseJournal(source.replace('"count":10', '"count":1e1'));
    assert.equal(parsed.extension.count, 10);
    assert.equal(parsed.extension.normal, 0.5);
    assert.equal(parsed.extension.safeLarge, 1e20);
    assert.equal(parsed.extension.__rhythm_number_token__, 'existing key');
    assert.equal(parsed.habits[0].targetNumber, 1e20);
    assert.doesNotThrow(() => serializeJournal(parsed));
    for (const token of ['9007199254740993', '9007199254740991.1', '0.10000000000000000000001', '1e309', '1e-999']) {
      assert.throws(() => parseJournal(source.replace('"count":10', `"count":${token}`)), error => error.code === 'unsupported-number');
    }
  } finally {
    JSON.parse = nativeParse;
    JSON.rawJSON = nativeRaw;
  }
});

test('serializing a valid compact journal does not add whitespace that exceeds the account quota', () => {
  const data = {...journal([habit()], [entry({minutes: 15})]), extension: {padding: ''}};
  data.extension.padding = 'x'.repeat(899_990 - new TextEncoder().encode(JSON.stringify(data)).length);
  const source = JSON.stringify(data);
  assert.equal(new TextEncoder().encode(source).length, 899_990);
  const encoded = serializeJournal(parseJournal(source));
  assert.ok(encoded.length <= source.length);
});

test('near-limit legacy records do not gain optional empty fields on their first save', () => {
  const legacyEntry = entry({minutes: 15});
  delete legacyEntry.sessions;
  delete legacyEntry.number;
  const data = {...journal([habit()], [legacyEntry]), schemaVersion: 1, padding: ''};
  data.padding = 'x'.repeat(900_000 - new TextEncoder().encode(JSON.stringify(data)).length);
  const source = JSON.stringify(data);
  assert.equal(new TextEncoder().encode(source).length, 900_000);
  const parsed = parseJournal(source);
  assert.deepEqual(parsed.entries[0].sessions, []);
  assert.equal(parsed.entries[0].number, null);
  const encoded = serializeJournal(parsed);
  assert.equal(new TextEncoder().encode(encoded).length, 900_000);
  assert.equal(JSON.parse(encoded).schemaVersion, 2);
  assert.equal(Object.hasOwn(JSON.parse(encoded).entries[0], 'sessions'), false);
  assert.equal(Object.hasOwn(JSON.parse(encoded).entries[0], 'number'), false);
});

test('all six habit types preserve their completion semantics', () => {
  const cases = [
    ['check', {checked: true}, 1], ['check', {}, 0],
    ['single', {selections: ['Reading']}, 1], ['multiple', {selections: ['Practice']}, 1],
    ['duration', {minutes: 30}, 0.5], ['duration', {minutes: 120}, 1],
    ['number', {number: 2.5}, 0.25], ['number', {number: null}, 0],
    ['text', {text: ' A note '}, 1], ['text', {text: ' \n '}, 0],
  ];
  for (const [kind, values, expected] of cases) assert.equal(habitProgress(habit(kind), entry(values)), expected);
  assert.equal(habitProgress(habit(), {...entry(), habitID: 'ABCDEF00-0000-4000-8000-000000000002'}), 0);
});

test('timed sessions retain duplicates, zero minutes, order and uncategorized remainder', () => {
  const sessions = [
    {topic: 'Reading', minutes: 30, custom: true},
    {topic: 'Practice', minutes: 0},
    {topic: 'Reading', minutes: 45},
  ];
  const parsed = parseJournal(JSON.stringify(journal([habit()], [entry({minutes: 100, sessions})])));
  assert.deepEqual(parsed.entries[0].sessions, sessions);
  assert.equal(sessionMinutes(parsed.entries[0]), 75);
  assert.equal(unassignedMinutes(parsed.entries[0]), 25);
  assert.throws(() => parseJournal(JSON.stringify(journal([habit()], [entry({minutes: 74, sessions})]))), /INVALID_JOURNAL/);
  assert.throws(() => parseJournal(JSON.stringify(journal([habit()], [entry({minutes: 10, sessions: [{topic: 'Missing', minutes: 10}]})]))), /INVALID_JOURNAL/);
});

test('entry replacement canonicalizes IDs and validates before deleting an empty entry', () => {
  const original = parseJournal(JSON.stringify(journal([habit()], [entry({minutes: 15})])));
  const next = withEntry(original, entry({habitID: id.toLowerCase(), minutes: 25}));
  assert.equal(next.entries.length, 1);
  assert.equal(entryFor(next, id.toLowerCase(), day).minutes, 25);
  assert.equal(original.entries[0].minutes, 15);
  assert.equal(withEntry(original, entry()).entries.length, 0);
  assert.throws(() => withEntry(original, entry({minutes: -1})), /INVALID_JOURNAL/);
  assert.throws(() => withEntry(original, entry({habitID: 'invalid'})), /INVALID_JOURNAL/);
  assert.equal(entryFor(original, id, '2026-10-14').minutes, 0);
});

test('editing and clearing a record retains unknown extension data', () => {
  const original = parseJournal(JSON.stringify(journal([habit()], [entry({minutes: 15, extension: {sample: true}})])));
  const cleared = withEntry(original, entry());
  assert.equal(cleared.entries[0].minutes, 0);
  assert.deepEqual(cleared.entries[0].extension, {sample: true});
  assert.deepEqual(parseJournal(serializeJournal(cleared)).entries[0].extension, {sample: true});
});

test('archive hides current cards while retaining historical records and analytics', () => {
  const archived = habit('duration', {archivedOn: day});
  const data = journal([archived], [
    entry({day: '2026-10-14', minutes: 60}),
    entry({minutes: 30}),
    entry({day: '2026-10-16', minutes: 90}),
  ]);
  assert.equal(eligible(archived, day), false);
  assert.equal(dailyHabits(data, day, day).length, 0);
  assert.equal(dailyHabits(data, '2026-10-16', day).length, 0);
  assert.equal(dailyHabits(data, '2026-10-14', day).length, 1);
  assert.equal(daySummary(data, day).minutes, 30);
  assert.equal(daySummary(data, day).progress, 0.5);
  assert.deepEqual(habitStats(data, archived, day), {
    habit: archived, recordedDays: 2, completedDays: 1, totalMinutes: 90, streak: 2, progress: 0.5,
  });
  assert.equal(journalStats(data, day).activeDays, 2);
  assert.equal(journalStats(data, day).totalMinutes, 90);
  assert.equal(journalStats(data, day).streak, 2);
});

test('streak tolerates an unfinished today and ignores future records', () => {
  assert.equal(streakFromDays(['2026-10-13', '2026-10-14', '2026-10-16'], day), 2);
  assert.equal(streakFromDays(['2026-10-12', '2026-10-14'], day), 1);
  assert.equal(streakFromDays(['0001-01-01'], '0001-01-01'), 1);
  assert.equal(streakFromDays([], day), 0);
});

test('minute formatting is compact without losing the remainder', () => {
  assert.equal(formatMinutes(0), '0 min');
  assert.equal(formatMinutes(59), '59 min');
  assert.equal(formatMinutes(60), '1h');
  assert.equal(formatMinutes(125), '2h 5m');
});
