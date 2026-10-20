import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm/core/models.dart';
import 'package:rhythm/core/repository.dart';
import 'package:rhythm/platform/journal_actions.dart';
import 'package:rhythm/store.dart';

const _id = 'ABCDEF00-0000-4000-8000-000000000001';
const _day = '2026-10-05';
const _topics = ['English', 'Код', 'History'];

Habit _habit() => Habit(
  id: _id,
  title: 'Synthetic duration habit',
  startDay: '2026-01-01',
  kind: HabitKind.duration,
  options: _topics,
  targetMinutes: 60,
);

HabitEntry _entry({
  int minutes = 60,
  List<HabitSession> sessions = const [
    HabitSession(topic: 'English', minutes: 15),
    HabitSession(topic: 'Код', minutes: 30),
    HabitSession(topic: 'English', minutes: 10),
  ],
}) => HabitEntry(
  habitID: _id,
  day: _day,
  minutes: minutes,
  sessions: sessions,
  text: 'Original import notes',
);

Journal _journal({HabitEntry? entry, Habit? habit}) =>
    Journal(habits: [habit ?? _habit()], entries: [entry ?? _entry()]);

RhythmStore _store(MemoryBackend backend) {
  final store = RhythmStore(
    JournalRepository(backend),
    clock: () => DateTime(2026, 10, 5, 12),
  );
  addTearDown(store.dispose);
  return store;
}

void main() {
  test(
    'version 1 imports upgrade without changing entries or duration totals',
    () {
      final legacy = _journal(entry: _entry(sessions: const [])).toJson();
      legacy['schemaVersion'] = 1;
      final loaded = JournalRepository.decode(jsonEncode(legacy));
      expect(loaded.schemaVersion, 2);
      expect(loaded.entries.single.sessions, isEmpty);
      expect(loaded.entries.single.unassignedMinutes, 60);
      expect(
        loaded.entries.single.toJson(),
        (legacy['entries'] as List).single,
      );
      expect(jsonDecode(JournalRepository.encode(loaded))['schemaVersion'], 2);
      for (final sessions in [
        null,
        <Object?>[],
        <Object?>[{}],
      ]) {
        final withSessions =
            jsonDecode(jsonEncode(legacy)) as Map<String, dynamic>;
        withSessions['entries'][0]['sessions'] = sessions;
        expect(
          () => JournalRepository.decode(jsonEncode(withSessions)),
          throwsFormatException,
        );
      }
      legacy['schemaVersion'] = 3;
      expect(
        () => JournalRepository.decode(jsonEncode(legacy)),
        throwsFormatException,
      );
    },
  );

  test(
    'sessions round trip in order with repeated topics and uncategorized time',
    () {
      final journal = JournalRepository.decode(
        JournalRepository.encode(_journal()),
      );
      final entry = journal.entries.single;
      expect(entry.sessions.map((session) => session.topic), [
        'English',
        'Код',
        'English',
      ]);
      expect(entry.sessions.map((session) => session.minutes), [15, 30, 10]);
      expect(entry.sessionMinutes, 55);
      expect(entry.unassignedMinutes, 5);
      expect(entry.minutes, 60);
      expect(journal.totalMinutes(), 60);
      expect(entry.copyWith(text: 'Edited note').sessions, entry.sessions);
      expect(entry.copyWith(sessions: []).unassignedMinutes, 60);
      expect(() => entry.sessions.clear(), throwsUnsupportedError);
    },
  );

  test('a zero-minute session remains a recorded entry', () {
    final entry = HabitEntry(
      habitID: _id,
      day: _day,
      sessions: const [HabitSession(topic: 'English', minutes: 0)],
    );
    final journal = Journal(habits: [_habit()]).withEntry(entry);
    expect(journal.entries.single.hasValue, isTrue);
    expect(journal.activeDays(), 1);
    expect(
      JournalRepository.decode(
        JournalRepository.encode(journal),
      ).entries.single.sessions.single.minutes,
      0,
    );
  });

  test(
    'session validation rejects wrong kinds, unknown categories and invalid totals',
    () {
      final invalid = [
        _journal(habit: _habit().copyWith(kind: HabitKind.check)),
        _journal(
          entry: _entry(
            sessions: const [HabitSession(topic: 'Unknown', minutes: 1)],
          ),
        ),
        _journal(
          entry: _entry(sessions: const [HabitSession(topic: '', minutes: 1)]),
        ),
        _journal(
          entry: _entry(
            sessions: const [HabitSession(topic: 'English', minutes: -1)],
          ),
        ),
        _journal(
          entry: _entry(
            sessions: [
              HabitSession(topic: 'English', minutes: maxSafeInteger + 1),
            ],
          ),
        ),
        _journal(entry: _entry(minutes: 54)),
        _journal(
          entry: _entry(
            minutes: maxSafeInteger,
            sessions: const [
              HabitSession(topic: 'English', minutes: maxSafeInteger),
              HabitSession(topic: 'Код', minutes: 1),
            ],
          ),
        ),
      ];
      for (final journal in invalid) {
        expect(() => JournalRepository.encode(journal), throwsFormatException);
        expect(
          () => JournalRepository.decode(jsonEncode(journal.toJson())),
          throwsFormatException,
        );
      }
      final max = _journal(
        entry: _entry(
          minutes: maxSafeInteger,
          sessions: const [
            HabitSession(topic: 'English', minutes: maxSafeInteger),
          ],
        ),
      );
      expect(
        JournalRepository.decode(
          JournalRepository.encode(max),
        ).entries.single.sessionMinutes,
        maxSafeInteger,
      );
    },
  );

  test(
    'session integer tokens cannot be rounded or coerced while importing',
    () {
      final source = jsonEncode(_journal().toJson());
      for (final token in [
        '1.0',
        '1e0',
        '9007199254740993',
        '"15"',
        'null',
        'true',
      ]) {
        expect(
          () => JournalRepository.decode(
            source.replaceFirst(
              '"topic":"English","minutes":15',
              '"topic":"English","minutes":$token',
            ),
          ),
          throwsFormatException,
          reason: token,
        );
      }
      final raw = jsonDecode(source) as Map<String, dynamic>;
      for (final malformed in [
        null,
        {},
        'English',
        [null],
        [
          {'topic': 'English'},
        ],
      ]) {
        raw['entries'][0]['sessions'] = malformed;
        expect(
          () => JournalRepository.decode(jsonEncode(raw)),
          throwsFormatException,
        );
      }
    },
  );

  test('adding a category and session saves one atomic snapshot', () async {
    final backend = _TrackingBackend()
      ..json = JournalRepository.encode(_journal());
    final store = _store(backend);
    await store.load();
    final entry = store.journal.entries.single.copyWith(
      minutes: 90,
      sessions: [
        ...store.journal.entries.single.sessions,
        const HabitSession(topic: 'Music', minutes: 30),
      ],
    );
    expect(await store.updateDurationSessions(entry, ['Music']), isTrue);
    expect(backend.snapshots, hasLength(1));
    final saved = JournalRepository.decode(backend.json);
    expect(saved.habits.single.options, [..._topics, 'Music']);
    expect(saved.entries.single.sessions.last.topic, 'Music');
    expect(saved.entries.single.unassignedMinutes, 5);
    expect(saved.entries.single.text, 'Original import notes');
  });

  test(
    'queued updates preserve categories added by the earlier update',
    () async {
      final backend = _TrackingBackend()
        ..json = JournalRepository.encode(_journal());
      final store = _store(backend);
      await store.load();
      backend.gate = Completer<void>();
      final first = store.updateDurationSessions(
        _entry(
          minutes: 60,
          sessions: const [HabitSession(topic: 'Music', minutes: 60)],
        ),
        ['Music'],
      );
      await backend.started.future;
      final second = store.updateDurationSessions(
        HabitEntry(
          habitID: _id,
          day: '2026-10-04',
          minutes: 10,
          sessions: const [HabitSession(topic: 'Art', minutes: 10)],
        ),
        ['Art'],
      );
      backend.gate!.complete();
      expect(await first, isTrue);
      expect(await second, isTrue);
      final saved = JournalRepository.decode(backend.json);
      expect(saved.habits.single.options, [..._topics, 'Music', 'Art']);
      expect(saved.entry(_id, _day).sessions.single.topic, 'Music');
      expect(saved.entry(_id, '2026-10-04').sessions.single.topic, 'Art');
    },
  );

  test(
    'failed session saves retain the draft and retry both categories and sessions',
    () async {
      final backend = _TrackingBackend()
        ..json = JournalRepository.encode(_journal());
      final store = _store(backend);
      await store.load();
      final original = backend.json;
      backend.fail = true;
      expect(
        await store.updateDurationSessions(
          _entry(
            minutes: 20,
            sessions: const [HabitSession(topic: 'Music', minutes: 20)],
          ),
          ['Music'],
        ),
        isFalse,
      );
      expect(backend.json, original);
      expect(store.hasUnsavedChanges, isTrue);
      expect(store.journal.habits.single.options, contains('Music'));
      expect(store.journal.entries.single.sessions.single.topic, 'Music');
      backend.fail = false;
      await store.retrySave();
      expect(store.hasUnsavedChanges, isFalse);
      expect(
        JournalRepository.decode(
          backend.json,
        ).entries.single.sessions.single.topic,
        'Music',
      );
    },
  );

  test(
    'invalid session updates cannot change categories or existing records',
    () async {
      final backend = _TrackingBackend()
        ..json = JournalRepository.encode(_journal());
      final store = _store(backend);
      await store.load();
      final original = store.journal;
      expect(
        await store.updateDurationSessions(_entry(minutes: 1), ['Music']),
        isFalse,
      );
      expect(store.journal, same(original));
      expect(backend.snapshots, isEmpty);
      // Removing an option referenced by history is also rejected.
      await store.saveHabit(_habit().copyWith(options: ['History']));
      expect(store.journal, same(original));
      expect(backend.snapshots, isEmpty);
    },
  );

  test(
    'journal action preserves sessions and requires explicit sessions with changed totals',
    () async {
      final backend = _TrackingBackend()
        ..json = JournalRepository.encode(_journal());
      final store = _store(backend);
      await store.load();
      Future<Map<String, dynamic>> record(Map<String, dynamic> entry) async =>
          jsonDecode(
                await runJournalAction(
                  store,
                  'record_habit_entries',
                  jsonEncode({
                    'entries': [
                      {'habitID': _id, 'day': _day, ...entry},
                    ],
                  }),
                  openDay: (_) {},
                  startCreation: () {},
                ),
              )
              as Map<String, dynamic>;
      expect((await record({'text': 'New note'}))['saved'], isTrue);
      expect(store.journal.entries.single.sessions, hasLength(3));
      expect((await record({'minutes': 90}))['isError'], isTrue);
      expect(store.journal.entries.single.minutes, 60);
      expect((await record({'sessions': []}))['isError'], isTrue);
      expect(store.journal.entries.single.sessions, hasLength(3));
      expect(store.journal.entries.single.unassignedMinutes, 5);
      expect(
        (await record({
          'minutes': 90,
          'sessions': [
            {'topic': 'English', 'minutes': 90},
          ],
        }))['saved'],
        isTrue,
      );
      expect(store.journal.entries.single.sessions.single.minutes, 90);
      expect(store.journal.entries.single.text, 'New note');
    },
  );
}

class _TrackingBackend extends MemoryBackend {
  final snapshots = <String>[];
  final started = Completer<void>();
  Completer<void>? gate;
  bool fail = false;

  @override
  Future<int> write(String json, int revision) async {
    if (!started.isCompleted) started.complete();
    await gate?.future;
    if (fail) throw const RepositoryFailure('storage-unavailable');
    final result = await super.write(json, revision);
    snapshots.add(json);
    return result;
  }
}
