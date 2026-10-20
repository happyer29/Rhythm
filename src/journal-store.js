import {
  emptyEntry,
  parseJournal,
  serializeJournal,
  todayKey,
  withEntry,
} from "./journal.js";

const emptyJSON = '{"schemaVersion":2,"habits":[],"entries":[]}';
const validRevision = (value) => Number.isSafeInteger(value) && value >= 0;

export function journalError(code, cause) {
  const error = new Error(code, cause === undefined ? undefined : { cause });
  error.name = "JournalError";
  error.code = code;
  return error;
}

function failure(error, fallback = "unavailable") {
  if (error?.code) return error;
  const code =
    error?.message === "JOURNAL_TOO_LARGE"
      ? "quota"
      : error?.message === "INVALID_JOURNAL"
        ? "invalid"
        : fallback;
  return journalError(code, error);
}

export function createJournalStore(adapter, { today = todayKey } = {}) {
  let state = Object.freeze({
    journal: parseJournal(emptyJSON),
    ready: false,
    loading: false,
    saving: false,
    importing: false,
    unsaved: false,
    error: null,
    revision: 0,
  });
  const subscribers = new Set();
  let loaded = false;
  let observed = false;
  let blockedWrites = false;
  let changeVersion = 0;
  let savedVersion = 0;
  let pendingWrites = 0;
  let queue = Promise.resolve();
  let loadingPromise = null;

  function publish(patch) {
    state = Object.freeze({ ...state, ...patch });
    for (const subscriber of subscribers) subscriber();
  }

  function report(error, fallback) {
    publish({ error: failure(error, fallback) });
    return false;
  }

  function canEdit() {
    if (!state.ready || !loaded) return report(journalError("not-loaded"));
    if (state.loading || state.importing) return report(journalError("busy"));
    return true;
  }

  function verifyEntryDay(entry) {
    if (typeof entry?.day !== "string" || entry.day > today())
      throw journalError("future-day");
  }

  function confirmedRevision(value, expected) {
    if (!validRevision(value) || value !== expected + 1)
      throw journalError("corrupt");
    return value;
  }

  async function writeSnapshot(journal, version) {
    if (blockedWrites) return false;
    if (!loaded) return report(journalError("not-loaded"));
    try {
      if (state.revision === Number.MAX_SAFE_INTEGER)
        throw journalError("revision-limit");
      const expected = state.revision;
      const revision = confirmedRevision(
        await adapter.write(serializeJournal(journal), expected),
        expected,
      );
      savedVersion = version;
      publish({
        revision,
        unsaved: savedVersion < changeVersion,
        ...(savedVersion === changeVersion ? { error: null } : {}),
      });
      return true;
    } catch (error) {
      // The response may have been lost after a committed write. Keep the old
      // CAS revision and stop queued writes until an explicit retry or reload.
      blockedWrites = true;
      publish({ unsaved: true, error: failure(error) });
      return false;
    }
  }

  function enqueue(journal, version) {
    pendingWrites++;
    publish({ saving: true });
    const operation = queue.then(() => writeSnapshot(journal, version));
    const result = operation.finally(() => {
      pendingWrites--;
      publish({
        saving: pendingWrites > 0,
        unsaved: savedVersion < changeVersion,
      });
    });
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  function replace(next) {
    let journal;
    try {
      journal = parseJournal(serializeJournal(next));
    } catch (error) {
      return Promise.resolve(report(error, "invalid"));
    }
    const version = ++changeVersion;
    publish({ journal, unsaved: true });
    return enqueue(journal, version);
  }

  async function readSaved(explicit) {
    if (loadingPromise) return loadingPromise;
    if (state.saving || state.importing || (!explicit && state.unsaved))
      return false;
    loaded = false;
    observed = false;
    publish({ loading: true, error: null });
    loadingPromise = Promise.resolve().then(async () => {
      try {
        const result = await adapter.read();
        if (
          !result ||
          typeof result.json !== "string" ||
          !validRevision(result.revision)
        ) {
          throw journalError("corrupt");
        }
        observed = true;
        publish({ revision: result.revision });
        let journal;
        try {
          journal = parseJournal(result.json);
        } catch (error) {
          throw journalError("corrupt", error);
        }
        loaded = true;
        blockedWrites = false;
        changeVersion = savedVersion = 0;
        publish({ journal, ready: true, unsaved: false, error: null });
        return true;
      } catch (error) {
        if (validRevision(error?.observedRevision)) {
          observed = true;
          publish({ revision: error.observedRevision });
        }
        // Explicit reload discards a draft only after the complete read succeeds.
        publish({
          error: failure(error),
          ...(!explicit ? { ready: false } : {}),
        });
        return false;
      } finally {
        publish({ loading: false });
        loadingPromise = null;
      }
    });
    return loadingPromise;
  }

  function updateEntry(entry) {
    if (!canEdit()) return Promise.resolve(false);
    try {
      verifyEntryDay(entry);
      return replace(withEntry(state.journal, entry));
    } catch (error) {
      return Promise.resolve(report(error, "invalid"));
    }
  }

  function saveHabit(habit) {
    if (!canEdit()) return Promise.resolve(false);
    try {
      const id = habit.id.toUpperCase();
      const previous = state.journal.habits.find((value) => value.id === id);
      const next = { ...previous, ...habit, id };
      if (Object.hasOwn(habit, "archivedOn") && habit.archivedOn == null)
        delete next.archivedOn;
      if (previous?.kind === "duration" && next.kind === "duration") {
        next.options = [...new Set([...previous.options, ...next.options])];
      }
      const habits = previous
        ? state.journal.habits.map((value) => (value.id === id ? next : value))
        : [...state.journal.habits, next];
      return replace({ ...state.journal, habits });
    } catch (error) {
      return Promise.resolve(report(error, "invalid"));
    }
  }

  function saveSessions(entry, categories) {
    if (!canEdit()) return Promise.resolve(false);
    try {
      verifyEntryDay(entry);
      const id = entry.habitID.toUpperCase();
      const previous = state.journal.habits.find((habit) => habit.id === id);
      if (previous?.kind !== "duration" || !Array.isArray(categories))
        throw journalError("invalid");
      const next = {
        ...previous,
        options: [...new Set([...previous.options, ...categories])],
      };
      const journal = {
        ...state.journal,
        habits: state.journal.habits.map((habit) =>
          habit.id === id ? next : habit,
        ),
      };
      return replace(withEntry(journal, entry));
    } catch (error) {
      return Promise.resolve(report(error, "invalid"));
    }
  }

  function changeArchive(id, archive) {
    if (!canEdit()) return Promise.resolve(false);
    const habit = state.journal.habits.find(
      (value) => value.id === String(id).toUpperCase(),
    );
    if (!habit) return Promise.resolve(report(journalError("missing-habit")));
    if ((habit.archivedOn != null) === archive)
      return Promise.resolve(!state.unsaved);
    const next = { ...habit };
    if (archive)
      next.archivedOn = habit.startDay > today() ? habit.startDay : today();
    else delete next.archivedOn;
    // Passing an explicit null also clears the property when saveHabit merges.
    return saveHabit(archive ? next : { ...next, archivedOn: null });
  }

  function recordEntries(entries) {
    if (!canEdit()) return Promise.resolve(false);
    if (state.unsaved) return Promise.resolve(report(journalError("busy")));
    try {
      if (!Array.isArray(entries) || entries.length < 1 || entries.length > 100)
        throw journalError("invalid");
      for (const entry of entries) verifyEntryDay(entry);
      // Batch validation also rejects duplicate day/habit keys.
      serializeJournal({ ...state.journal, entries });
      return replace(entries.reduce(withEntry, state.journal));
    } catch (error) {
      return Promise.resolve(report(error, "invalid"));
    }
  }

  async function importJournal(json) {
    if (state.loading || state.saving || state.importing || state.unsaved)
      return report(journalError("busy"));
    if (!observed) return report(journalError("not-loaded"));
    let journal;
    try {
      journal = parseJournal(json);
    } catch (error) {
      return report(error, "invalid");
    }
    publish({ importing: true, saving: true });
    try {
      const expected = state.revision;
      if (expected === Number.MAX_SAFE_INTEGER)
        throw journalError("revision-limit");
      const revision = confirmedRevision(
        await adapter.write(serializeJournal(journal), expected),
        expected,
      );
      loaded = true;
      blockedWrites = false;
      changeVersion = savedVersion = 0;
      publish({ journal, revision, ready: true, unsaved: false, error: null });
      return true;
    } catch (error) {
      return report(error);
    } finally {
      publish({ importing: false, saving: false });
    }
  }

  return Object.freeze({
    getSnapshot: () => state,
    subscribe(listener) {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
    load: () => readSaved(false),
    reloadSaved: () => readSaved(true),
    updateEntry,
    clearEntry: (id, day) => updateEntry(emptyEntry(id, day)),
    saveHabit,
    saveSessions,
    archiveHabit: (id) => changeArchive(id, true),
    restoreHabit: (id) => changeArchive(id, false),
    recordEntries,
    deleteHabit(id) {
      if (!canEdit()) return Promise.resolve(false);
      const canonical = String(id).toUpperCase();
      return replace({
        ...state.journal,
        habits: state.journal.habits.filter((habit) => habit.id !== canonical),
        entries: state.journal.entries.filter(
          (entry) => entry.habitID !== canonical,
        ),
      });
    },
    retrySave() {
      if (!canEdit()) return Promise.resolve(false);
      if (state.saving) return Promise.resolve(report(journalError("busy")));
      if (!state.unsaved) return Promise.resolve(true);
      blockedWrites = false;
      return enqueue(state.journal, changeVersion);
    },
    importJournal,
    exportJSON: () => serializeJournal(state.journal),
    async exportPreviousJSON() {
      try {
        const previous = await adapter.readBackup();
        if (previous === null) return null;
        if (
          !previous ||
          typeof previous.json !== "string" ||
          !validRevision(previous.revision)
        )
          throw journalError("corrupt");
        return previous.json;
      } catch (error) {
        report(error);
        throw failure(error);
      }
    },
    reportError: (error) => report(error),
    dismissError() {
      if (state.ready && !state.unsaved) publish({ error: null });
    },
  });
}
