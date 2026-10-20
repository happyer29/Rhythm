import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm/core/models.dart';
import 'package:rhythm/core/repository.dart';
import 'package:rhythm/store.dart';

const _id = 'ABCDEF00-0000-4000-8000-000000000001';
const _day = '2026-10-05';

Journal _journal(int minutes) => Journal(
  habits: [
    Habit(
      id: _id,
      title: 'Read 读书',
      startDay: '2026-01-01',
      kind: HabitKind.duration,
      targetMinutes: 60,
    ),
  ],
  entries: [HabitEntry(habitID: _id, day: _day, minutes: minutes)],
);

HabitEntry _entry(int minutes) =>
    HabitEntry(habitID: _id, day: _day, minutes: minutes);

RhythmStore _store(JournalBackend backend) {
  final store = RhythmStore(
    JournalRepository(backend),
    clock: () => DateTime(2026, 10, 5, 12),
  );
  addTearDown(store.dispose);
  return store;
}

int _savedMinutes(MemoryBackend backend) =>
    JournalRepository.decode(backend.json).entries.single.minutes;

void main() {
  test('failed saving preserves the draft and retry clears the error only after saving', () async {
    final backend = _ControlledBackend()
      ..json = JournalRepository.encode(_journal(15));
    final store = _store(backend);
    await store.load();
    final saved = backend.json;
    backend.nextWriteFailure = const RepositoryFailure('storage-unavailable');

    await store.updateEntry(_entry(30));

    expect(store.journal.entries.single.minutes, 30);
    expect(store.analytics.statistics(_day).totalMinutes, 30);
    expect(backend.json, saved);
    expect(backend.revision, 0);
    expect(store.ready, isTrue);
    expect(store.saving, isFalse);
    expect(store.saveFailed, isTrue);
    expect(store.hasUnsavedChanges, isTrue);
    expect(store.hasConflict, isFalse);
    final failure = store.error;
    expect(failure, isA<RepositoryFailure>());
    store.dismissError();
    expect(store.error, same(failure));

    // A normal load cannot implicitly discard an unsaved draft.
    final reads = backend.reads;
    await store.load();
    expect(backend.reads, reads);
    expect(store.journal.entries.single.minutes, 30);

    await store.retrySave();

    expect(_savedMinutes(backend), 30);
    expect(backend.revision, 1);
    expect(backend.writes, 2);
    expect(store.hasUnsavedChanges, isFalse);
    expect(store.saveFailed, isFalse);
    expect(store.saving, isFalse);
    expect(store.error, isNull);
  });

  test('a stale store and its retry cannot overwrite the first writer; explicit reload discards its draft', () async {
    // Two real repositories share the same CAS backend, as two tabs would.
    final backend = MemoryBackend()
      ..json = JournalRepository.encode(_journal(15));
    final first = _store(backend);
    final second = _store(backend);
    await first.load();
    await second.load();

    await first.updateEntry(_entry(30));
    final committed = backend.json;
    await second.updateEntry(_entry(45));

    expect(second.hasConflict, isTrue);
    expect(second.hasUnsavedChanges, isTrue);
    expect(second.saveFailed, isTrue);
    expect(second.journal.entries.single.minutes, 45);
    expect(backend.json, committed);
    expect(backend.revision, 1);
    await second.retrySave();
    expect(second.hasConflict, isTrue);
    expect(backend.json, committed);
    expect(backend.revision, 1);

    expect(await second.reloadSaved(), isTrue);

    expect(second.journal.entries.single.minutes, 30);
    expect(second.analytics.statistics(_day).totalMinutes, 30);
    expect(second.hasUnsavedChanges, isFalse);
    expect(second.hasConflict, isFalse);
    expect(second.saveFailed, isFalse);
    expect(second.error, isNull);
    expect(second.ready, isTrue);
    expect(second.loading, isFalse);
    // Explicit reload also adopts the saved revision for subsequent edits.
    await second.updateEntry(_entry(60));
    expect(_savedMinutes(backend), 60);
    expect(backend.revision, 2);
  });

  test('failed explicit reload preserves the draft and blocks a retry from overwriting unread data', () async {
    for (final corruptJson in [false, true]) {
      final backend = _ControlledBackend()
        ..json = JournalRepository.encode(_journal(15));
      final store = _store(backend);
      await store.load();
      backend.nextWriteFailure = const RepositoryFailure('storage-unavailable');
      await store.updateEntry(_entry(45));
      final draft = store.journal;
      final draftAnalytics = store.analytics;
      final original = backend.json;
      if (corruptJson) {
        backend.json = 'corrupt saved journal';
      } else {
        backend.readFailure = const RepositoryFailure('storage-unavailable');
      }

      expect(await store.reloadSaved(), isFalse);

      expect(store.journal, same(draft));
      expect(store.analytics, same(draftAnalytics));
      expect(store.journal.entries.single.minutes, 45);
      expect(store.hasUnsavedChanges, isTrue);
      expect(store.saveFailed, isTrue);
      expect(store.ready, isTrue);
      expect(store.loading, isFalse);
      expect(
        store.error,
        corruptJson ? isA<FormatException>() : isA<RepositoryFailure>(),
      );
      final writes = backend.writes;
      await store.retrySave();
      expect(backend.writes, writes);
      expect(
        store.error,
        isA<RepositoryFailure>().having(
          (failure) => failure.code,
          'code',
          'not-loaded',
        ),
      );
      expect(store.journal.entries.single.minutes, 45);
      expect(store.hasUnsavedChanges, isTrue);
      expect(backend.json, corruptJson ? 'corrupt saved journal' : original);

      backend.json = original;
      backend.readFailure = null;
      expect(await store.reloadSaved(), isTrue);
      expect(store.journal.entries.single.minutes, 15);
      expect(store.hasUnsavedChanges, isFalse);
      expect(store.saveFailed, isFalse);
      expect(store.error, isNull);
    }
  });

  test(
    'initial load failure disables edits and a successful load recovers',
    () async {
      final backend = _ControlledBackend()
        ..json = JournalRepository.encode(_journal(15))
        ..readFailure = const RepositoryFailure('storage-unavailable');
      final store = _store(backend);

      await store.load();

      expect(store.ready, isFalse);
      expect(store.loading, isFalse);
      expect(store.error, isA<RepositoryFailure>());
      await store.saveHabit(_journal(15).habits.single);
      await store.updateEntry(_entry(30));
      await store.retrySave();
      expect(backend.writes, 0);
      expect(_savedMinutes(backend), 15);
      expect(store.journal.habits, isEmpty);

      backend.readFailure = null;
      await store.load();
      expect(store.ready, isTrue);
      expect(store.loading, isFalse);
      expect(store.error, isNull);
      expect(store.hasUnsavedChanges, isFalse);
      expect(store.journal.entries.single.minutes, 15);
    },
  );

  test('explicit reload refuses to race an in-flight save', () async {
    final backend = _ControlledBackend()
      ..json = JournalRepository.encode(_journal(15));
    final store = _store(backend);
    await store.load();
    final gate = Completer<void>();
    backend.writeGate = gate;
    final saving = store.updateEntry(_entry(30));
    await backend.writeStarted.future;
    final reads = backend.reads;

    expect(store.saving, isTrue);
    expect(store.hasUnsavedChanges, isTrue);
    expect(await store.reloadSaved(), isFalse);
    expect(backend.reads, reads);
    expect(store.journal.entries.single.minutes, 30);
    expect(_savedMinutes(backend), 15);

    gate.complete();
    await saving;
    expect(store.saving, isFalse);
    expect(store.hasUnsavedChanges, isFalse);
    expect(store.error, isNull);
    expect(_savedMinutes(backend), 30);
  });

  test(
    'explicit reload refreshes a clean store after another store saves',
    () async {
      final backend = MemoryBackend()
        ..json = JournalRepository.encode(_journal(15));
      final first = _store(backend);
      final second = _store(backend);
      await first.load();
      await second.load();
      second.selectDay('2026-10-04');
      await first.updateEntry(_entry(45));
      expect(second.journal.entries.single.minutes, 15);
      expect(second.hasUnsavedChanges, isFalse);

      expect(await second.reloadSaved(), isTrue);

      expect(second.journal.entries.single.minutes, 45);
      expect(second.analytics.statistics(_day).totalMinutes, 45);
      expect(second.selectedDay, '2026-10-04');
      expect(second.repository.revision, 1);
      expect(second.hasUnsavedChanges, isFalse);
      expect(second.error, isNull);
    },
  );
}

/// Fault injection around the real in-memory revision/CAS implementation.
class _ControlledBackend extends MemoryBackend {
  int reads = 0;
  int writes = 0;
  RepositoryFailure? readFailure;
  RepositoryFailure? nextWriteFailure;
  Completer<void>? writeGate;
  final writeStarted = Completer<void>();

  @override
  Future<Map<String, dynamic>> read() async {
    reads++;
    final failure = readFailure;
    if (failure != null) throw failure;
    return super.read();
  }

  @override
  Future<int> write(String json, int revision) async {
    writes++;
    if (!writeStarted.isCompleted) writeStarted.complete();
    final gate = writeGate;
    if (gate != null) await gate.future;
    final failure = nextWriteFailure;
    nextWriteFailure = null;
    if (failure != null) throw failure;
    return super.write(json, revision);
  }
}
