import { validateJournal } from "../worker/journal.mjs";

const entryFields = new Set([
  "habitID",
  "day",
  "checked",
  "selections",
  "sessions",
  "minutes",
  "number",
  "text",
]);
const maximum = Number.MAX_SAFE_INTEGER;

class NumberToken {
  constructor(source, value) {
    this.source = source;
    this.value = value;
  }
}

function readNumberTokens(text, validated) {
  let missingSource = false;
  const result = JSON.parse(text, (_key, value, context) => {
    if (typeof value !== "number") return value;
    if (typeof context?.source !== "string") missingSource = true;
    return new NumberToken(context?.source, value);
  });
  if (!missingSource) return result;

  // Older engines do not supply reviver source text. Tag numeric tokens before
  // parsing, using a property name absent from every decoded source object.
  const keys = new Set();
  const collectKeys = (value) => {
    if (value === null || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      keys.add(key);
      collectKeys(item);
    }
  };
  collectKeys(validated);
  let marker = "__rhythm_number_token__";
  while (keys.has(marker)) marker += "_";
  const chunks = [];
  for (let index = 0; index < text.length;) {
    const start = index;
    if (text[index] === '"') {
      index++;
      while (text[index] !== '"') {
        if (text[index] === "\\") index++;
        index++;
      }
      chunks.push(text.slice(start, ++index));
    } else if (text[index] === "-" || /[0-9]/.test(text[index])) {
      const token = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(
        text.slice(index),
      )[0];
      chunks.push(JSON.stringify({ [marker]: token }));
      index += token.length;
    } else {
      chunks.push(text[index++]);
    }
  }
  return JSON.parse(chunks.join(""), (_key, value) =>
    value !== null && typeof value === "object" && Object.hasOwn(value, marker)
      ? new NumberToken(value[marker], Number(value[marker]))
      : value,
  );
}

function decimalValue(token) {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(token);
  let digits = `${match[2]}${match[3] ?? ""}`.replace(/^0+/, "");
  if (!digits) return "0";
  let power = Number(match[4] ?? 0) - (match[3]?.length ?? 0);
  const zeros = /0+$/.exec(digits)?.[0].length ?? 0;
  power += zeros;
  digits = digits.slice(0, digits.length - zeros);
  return `${match[1]}${digits}e${power}`;
}

function restoreOpaqueNumbers(value) {
  if (value instanceof NumberToken) {
    const encoded = JSON.stringify(value.value);
    if (value.source === encoded) return value.value;
    if (typeof JSON.rawJSON === "function") return JSON.rawJSON(value.source);
    // Preserve normal finite numbers in older browsers, but never silently
    // round an unknown extension number or replace overflow with null.
    if (
      Number.isFinite(value.value) &&
      decimalValue(value.source) === decimalValue(encoded)
    )
      return value.value;
    const error = new Error(
      "This browser cannot preserve an extension number exactly.",
    );
    error.code = "unsupported-number";
    throw error;
  }
  if (Array.isArray(value)) return value.map(restoreOpaqueNumbers);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        restoreOpaqueNumbers(item),
      ]),
    );
  }
  return value;
}

export function validDay(day) {
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const [year, month, date] = day.split("-").map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return (
    year >= 1 &&
    month >= 1 &&
    month <= 12 &&
    date >= 1 &&
    date <=
      [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
  );
}

export function todayKey(date = new Date()) {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function shiftDay(day, count) {
  if (!validDay(day) || !Number.isSafeInteger(count)) return day;
  const [year, month, date] = day.split("-").map(Number);
  // UTC civil arithmetic avoids both DST and the Date constructor's 1900 offset.
  const value = new Date(0);
  value.setUTCFullYear(year, month - 1, date);
  value.setUTCDate(value.getUTCDate() + count);
  if (!Number.isFinite(value.getTime())) return day;
  const result = `${String(value.getUTCFullYear()).padStart(4, "0")}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
  return validDay(result) ? result : day;
}

export function freezeJournal(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) freezeJournal(item);
    Object.freeze(value);
  }
  return value;
}

function assertJSONNumbers(value, seen = new Set()) {
  if (typeof value === "number" && !Number.isFinite(value))
    throw new Error("INVALID_JOURNAL");
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) throw new Error("INVALID_JOURNAL");
  seen.add(value);
  for (const item of Object.values(value)) assertJSONNumbers(item, seen);
  seen.delete(value);
}

export function parseJournal(text) {
  // Validate original number tokens before normalization can round them away.
  const validated = validateJournal(text);
  const journal = readNumberTokens(text, validated);
  return freezeJournal(
    restoreOpaqueNumbers({
      ...journal,
      schemaVersion: 2,
      habits: journal.habits.map((habit, index) => ({
        ...habit,
        id: habit.id.toUpperCase(),
        targetMinutes: validated.habits[index].targetMinutes,
        targetNumber: validated.habits[index].targetNumber,
      })),
      entries: journal.entries.map((entry, index) => ({
        ...entry,
        habitID: entry.habitID.toUpperCase(),
        minutes: validated.entries[index].minutes,
        sessions: (entry.sessions ?? []).map((session, sessionIndex) => ({
          ...session,
          minutes: validated.entries[index].sessions[sessionIndex].minutes,
        })),
        number: validated.entries[index].number ?? null,
      })),
    }),
  );
}

export function serializeJournal(journal) {
  assertJSONNumbers(journal);
  // Whitespace must not push an otherwise valid near-limit account over quota.
  // The previous client omitted these optional fields. Keep that compact wire
  // shape even though the UI gets convenient []/null defaults after loading.
  const wire =
    journal.schemaVersion === 2 && Array.isArray(journal.entries)
      ? {
          ...journal,
          entries: journal.entries.map((entry) => {
            if (
              entry === null ||
              typeof entry !== "object" ||
              Array.isArray(entry)
            )
              return entry;
            const value = { ...entry };
            if (Array.isArray(value.sessions) && value.sessions.length === 0)
              delete value.sessions;
            if (value.number == null) delete value.number;
            return value;
          }),
        }
      : journal;
  const text = JSON.stringify(wire);
  validateJournal(text);
  return text;
}

export function emptyEntry(habitID, day) {
  return {
    habitID: habitID.toUpperCase(),
    day,
    checked: false,
    selections: [],
    sessions: [],
    minutes: 0,
    number: null,
    text: "",
  };
}

export function newHabit(kind = "check", day = todayKey()) {
  return {
    id: crypto.randomUUID().toUpperCase(),
    title: "",
    note: "",
    kind,
    colorHex: "6C5CE7",
    symbol: "waveform.path",
    unit: "",
    startDay: day,
    options: [],
    targetMinutes: 30,
    targetNumber: 1,
  };
}

export function hasValue(entry) {
  return Boolean(
    entry &&
    (entry.checked ||
      entry.selections?.length ||
      entry.sessions?.length ||
      entry.minutes > 0 ||
      entry.number != null ||
      entry.text?.trim()),
  );
}

export function entryFor(journal, habitID, day) {
  const id = habitID.toUpperCase();
  return (
    journal.entries.find(
      (entry) => entry.habitID === id && entry.day === day,
    ) ?? emptyEntry(id, day)
  );
}

export function withEntry(journal, entry) {
  const id =
    typeof entry.habitID === "string"
      ? entry.habitID.toUpperCase()
      : entry.habitID;
  const old = journal.entries.find(
    (value) => value.habitID === id && value.day === entry.day,
  );
  const next = { ...old, ...entry, habitID: id };
  // Even a clear operation must be valid before it can remove an old record.
  serializeJournal({ ...journal, entries: [next] });
  const retain =
    hasValue(next) || Object.keys(next).some((key) => !entryFields.has(key));
  return {
    ...journal,
    schemaVersion: 2,
    entries: [
      ...journal.entries.filter(
        (value) => value.habitID !== id || value.day !== entry.day,
      ),
      ...(retain ? [next] : []),
    ],
  };
}

export function eligible(habit, day) {
  return (
    day >= habit.startDay &&
    (habit.archivedOn == null || day < habit.archivedOn)
  );
}

export function habitProgress(habit, entry) {
  if (!entry || entry.habitID.toUpperCase() !== habit.id.toUpperCase())
    return 0;
  switch (habit.kind) {
    case "check":
      return entry.checked ? 1 : 0;
    case "single":
    case "multiple":
      return entry.selections.some((value) => habit.options.includes(value))
        ? 1
        : 0;
    case "duration":
      return Math.min(
        1,
        Math.max(0, entry.minutes / Math.max(1, habit.targetMinutes)),
      );
    case "number":
      return entry.number == null
        ? 0
        : Math.min(1, Math.max(0, entry.number / habit.targetNumber));
    case "text":
      return entry.text.trim() ? 1 : 0;
    default:
      return 0;
  }
}

export function dailyHabits(journal, day, today = todayKey()) {
  const recorded = new Set(
    journal.entries
      .filter((entry) => entry.day === day && hasValue(entry))
      .map((entry) => entry.habitID),
  );
  return journal.habits.filter(
    (habit) =>
      (day < today || habit.archivedOn == null) &&
      (eligible(habit, day) || recorded.has(habit.id)),
  );
}

function safeSum(values) {
  return values.reduce((sum, value) => Math.min(maximum, sum + value), 0);
}

export function sessionMinutes(entry) {
  return safeSum((entry.sessions ?? []).map((session) => session.minutes));
}

export function unassignedMinutes(entry) {
  return Math.max(0, entry.minutes - sessionMinutes(entry));
}

export function daySummary(journal, day) {
  const values = journal.entries.filter((entry) => entry.day === day);
  const recorded = new Set(
    values.filter(hasValue).map((entry) => entry.habitID),
  );
  // Historical analytics include archived habits and their saved records.
  const habits = journal.habits.filter(
    (habit) => eligible(habit, day) || recorded.has(habit.id),
  );
  const timed = new Set(
    journal.habits
      .filter((habit) => habit.kind === "duration")
      .map((habit) => habit.id),
  );
  const progresses = habits.map((habit) =>
    habitProgress(habit, entryFor(journal, habit.id, day)),
  );
  return {
    habits,
    completed: progresses.filter((value) => value >= 1).length,
    total: habits.length,
    progress: habits.length
      ? progresses.reduce((sum, value) => sum + value, 0) / habits.length
      : 0,
    minutes: safeSum(
      values
        .filter((entry) => timed.has(entry.habitID))
        .map((entry) => entry.minutes),
    ),
    recorded: recorded.size,
  };
}

export function streakFromDays(days, today = todayKey()) {
  if (!validDay(today)) return 0;
  const active = days instanceof Set ? days : new Set(days);
  let day = active.has(today) ? today : shiftDay(today, -1);
  let count = 0;
  while (active.has(day)) {
    count++;
    const previous = shiftDay(day, -1);
    if (previous === day) break;
    day = previous;
  }
  return count;
}

export function habitStats(journal, habit, today = todayKey()) {
  const entries = journal.entries.filter(
    (entry) => entry.habitID === habit.id && entry.day <= today,
  );
  const recorded = entries.filter(hasValue);
  const completed = entries.filter((entry) => habitProgress(habit, entry) >= 1);
  return {
    habit,
    recordedDays: entries.length,
    completedDays: completed.length,
    totalMinutes:
      habit.kind === "duration"
        ? safeSum(entries.map((entry) => entry.minutes))
        : 0,
    streak: streakFromDays(
      recorded.map((entry) => entry.day),
      today,
    ),
    progress: entries.length ? completed.length / entries.length : 0,
  };
}

export function journalStats(journal, today = todayKey()) {
  const entries = journal.entries.filter(
    (entry) => entry.day <= today && hasValue(entry),
  );
  const days = new Set(entries.map((entry) => entry.day));
  const habits = journal.habits.map((habit) =>
    habitStats(journal, habit, today),
  );
  return {
    activeDays: days.size,
    streak: streakFromDays(days, today),
    totalMinutes: safeSum(habits.map((habit) => habit.totalMinutes)),
    habits,
  };
}

export function formatMinutes(minutes) {
  const value = Math.max(0, Math.floor(minutes));
  if (value < 60) return `${value} min`;
  const rest = value % 60;
  return `${Math.floor(value / 60)}h${rest ? ` ${rest}m` : ""}`;
}
