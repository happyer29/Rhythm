import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm/core/models.dart';
import 'package:rhythm/core/repository.dart';
import 'package:rhythm/store.dart';

const _learningId = 'ABCDEF00-0000-4000-8000-000000000001';
const _checkId = 'ABCDEF00-0000-4000-8000-000000000002';
const _today = '2026-10-15';

Journal _journal() => Journal(
  habits: [
    Habit(
      id: _learningId,
      title: 'Learning',
      note: 'Keep the original categories',
      kind: HabitKind.duration,
      startDay: '2026-10-01',
      options: ['Sample category A', 'Sample category B'],
      targetMinutes: 30,
    ),
    Habit(id: _checkId, title: 'Walk', startDay: '2026-10-01'),
  ],
  entries: [
    HabitEntry(
      habitID: _learningId,
      day: '2026-10-14',
      minutes: 30,
      sessions: [const HabitSession(topic: 'Sample category A', minutes: 30)],
    ),
    HabitEntry(
      habitID: _learningId,
      day: _today,
      minutes: 60,
      sessions: [
        const HabitSession(topic: 'Sample category B', minutes: 20),
        const HabitSession(topic: 'Sample category A', minutes: 25),
        const HabitSession(topic: 'Sample category A', minutes: 15),
      ],
      text: 'Session notes',
    ),
  ],
);

RhythmStore _store(JournalBackend backend) {
  final store = RhythmStore(
    JournalRepository(backend),
    clock: () => DateTime(2026, 10, 15, 12),
  );
  addTearDown(store.dispose);
  return store;
}

class _FailingBackend extends MemoryBackend {
  bool fail = true;

  @override
  Future<int> write(String next, int expected) async {
    if (fail) throw const RepositoryFailure('storage-unavailable');
    return super.write(next, expected);
  }
}

void main() {
  test(
    'archive hides a recorded habit today and preserves account history on reload and restore',
    () async {
      final original = _journal();
      final backend = MemoryBackend()
        ..json = JournalRepository.encode(original);
      final store = _store(backend);
      await store.load();
      final habit = store.journal.habits.first;

      expect(await store.archiveHabit(habit), isTrue);

      expect(store.activeHabits.map((habit) => habit.id), [_checkId]);
      expect(store.archivedHabits.single.archivedOn, _today);
      expect(store.dailyHabits.map((habit) => habit.id), [_checkId]);
      expect(
        store.journal.entries.map((entry) => entry.toJson()),
        original.entries.map((entry) => entry.toJson()),
      );
      expect(store.journal.habits.first.options, original.habits.first.options);
      expect(store.analytics.statistics(_today).totalMinutes, 90);
      expect(store.analytics.statistics(_today).activeDays, 2);
      store.selectDay('2026-10-14');
      expect(store.dailyHabits.map((habit) => habit.id), [
        _learningId,
        _checkId,
      ]);
      store.selectDay('2026-10-16');
      expect(store.dailyHabits.map((habit) => habit.id), [_checkId]);

      final reopened = _store(backend);
      await reopened.load();
      expect(reopened.archivedHabits.single.id, _learningId);
      expect(reopened.dailyHabits.map((habit) => habit.id), [_checkId]);
      expect(
        await reopened.unarchiveHabit(reopened.archivedHabits.single),
        isTrue,
      );
      final restored = _store(backend);
      await restored.load();
      expect(restored.archivedHabits, isEmpty);
      expect(restored.dailyHabits.map((habit) => habit.id), [
        _learningId,
        _checkId,
      ]);
      expect(restored.journal.toJson(), original.toJson());
      expect(backend.revision, 2);
    },
  );

  test(
    'archive and restore use current data when invoked with a stale habit',
    () async {
      final backend = MemoryBackend()
        ..json = JournalRepository.encode(_journal());
      final store = _store(backend);
      await store.load();
      final stale = store.journal.habits.first;
      final edited = stale.copyWith(
        title: 'Updated learning',
        options: [...stale.options, 'New category'],
      );
      await store.saveHabit(edited);

      expect(await store.archiveHabit(stale), isTrue);
      expect(store.archivedHabits.single.title, edited.title);
      expect(store.archivedHabits.single.options, edited.options);
      final staleArchived = store.archivedHabits.single;
      await store.saveHabit(
        staleArchived.copyWith(note: 'Updated while archived'),
      );
      expect(await store.unarchiveHabit(staleArchived), isTrue);
      expect(store.journal.habits.first.note, 'Updated while archived');
      expect(store.journal.habits.first.options, edited.options);
      expect(store.journal.habits.first.title, edited.title);
    },
  );

  test(
    'repeated archive or restore does not create another account revision',
    () async {
      final backend = MemoryBackend()
        ..json = JournalRepository.encode(_journal());
      final store = _store(backend);
      await store.load();
      final habit = store.journal.habits.first;

      expect(await store.archiveHabit(habit), isTrue);
      expect(await store.archiveHabit(habit), isTrue);
      expect(backend.revision, 1);
      expect(await store.unarchiveHabit(habit), isTrue);
      expect(await store.unarchiveHabit(habit), isTrue);
      expect(backend.revision, 2);
    },
  );

  test(
    'stale actions cannot recreate a deleted habit or its entries',
    () async {
      final backend = MemoryBackend()
        ..json = JournalRepository.encode(_journal());
      final store = _store(backend);
      await store.load();
      final stale = store.journal.habits.first;
      await store.deleteHabit(stale);
      final saved = backend.json;

      expect(await store.archiveHabit(stale), isFalse);
      expect(await store.unarchiveHabit(stale), isFalse);
      expect(store.journal.habits.map((habit) => habit.id), [_checkId]);
      expect(store.journal.entries, isEmpty);
      expect(backend.json, saved);
      expect(backend.revision, 1);
    },
  );

  test(
    'a future-start habit can be archived and restored without changing its start date',
    () async {
      final future = _journal().habits.first.copyWith(startDay: '2026-11-01');
      final backend = MemoryBackend()
        ..json = JournalRepository.encode(Journal(habits: [future]));
      final store = _store(backend);
      await store.load();

      expect(await store.archiveHabit(future), isTrue);
      expect(store.archivedHabits.single.archivedOn, future.startDay);
      expect(store.activeHabits, isEmpty);
      expect(store.dailyHabits, isEmpty);
      expect(await store.unarchiveHabit(future), isTrue);
      expect(store.journal.habits.single.startDay, future.startDay);
      expect(store.dailyHabits, isEmpty);
      store.selectDay(future.startDay);
      expect(store.dailyHabits.single.id, future.id);
    },
  );

  test(
    'failed archive remains a recoverable draft and never reports saved success',
    () async {
      final backend = _FailingBackend()
        ..json = JournalRepository.encode(_journal());
      final before = backend.json;
      final store = _store(backend);
      await store.load();
      final habit = store.journal.habits.first;

      expect(await store.archiveHabit(habit), isFalse);
      expect(store.saveFailed, isTrue);
      expect(store.hasUnsavedChanges, isTrue);
      expect(store.archivedHabits.single.id, habit.id);
      expect(backend.json, before);
      expect(await store.archiveHabit(habit), isFalse);
      backend.fail = false;
      await store.retrySave();
      expect(store.hasUnsavedChanges, isFalse);
      expect(
        JournalRepository.decode(backend.json).habits.first.archivedOn,
        _today,
      );
      expect(
        JournalRepository.decode(
          backend.json,
        ).entries.map((entry) => entry.toJson()),
        _journal().entries.map((entry) => entry.toJson()),
      );
    },
  );

  test(
    'archive conflicts cannot overwrite entries saved by another account client',
    () async {
      final backend = MemoryBackend()
        ..json = JournalRepository.encode(_journal());
      final first = _store(backend);
      final second = _store(backend);
      await first.load();
      await second.load();
      await first.updateEntry(
        HabitEntry(habitID: _checkId, day: _today, checked: true),
      );
      final committed = backend.json;

      expect(await second.archiveHabit(second.journal.habits.first), isFalse);
      expect(second.hasConflict, isTrue);
      expect(backend.json, committed);
      expect(await second.reloadSaved(), isTrue);
      expect(second.archivedHabits, isEmpty);
      expect(second.journal.entry(_checkId, _today).checked, isTrue);
    },
  );
}
