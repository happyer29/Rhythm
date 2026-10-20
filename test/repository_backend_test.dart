import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm/core/models.dart';
import 'package:rhythm/core/repository.dart';

const _id = 'ABCDEF00-0000-4000-8000-000000000001';

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
  entries: [HabitEntry(habitID: _id, day: '2026-10-05', minutes: minutes)],
);

Matcher get _controlledFailure =>
    throwsA(anyOf(isA<RepositoryFailure>(), isA<FormatException>()));

void main() {
  test(
    'load returns the decoded journal and adopts the backend revision',
    () async {
      final backend = _FakeBackend(
        json: JournalRepository.encode(_journal(15)),
        revision: 7,
      );
      final repository = JournalRepository(backend);
      expect((await repository.load()).toJson(), _journal(15).toJson());
      expect(repository.revision, 7);
      expect(backend.expectedRevisions, isEmpty);
      await repository.save(_journal(30));
      expect(backend.expectedRevisions, [7]);
      expect(repository.revision, 8);
      expect(JournalRepository.decode(backend.json).entries.single.minutes, 30);
    },
  );

  test('ordinary save is gated until a successful load', () async {
    final backend = _FakeBackend(
      json: JournalRepository.encode(_journal(15)),
      revision: 0,
    );
    final repository = JournalRepository(backend);
    final original = backend.json;
    await expectLater(repository.save(_journal(30)), _controlledFailure);
    expect(backend.expectedRevisions, isEmpty);
    expect(backend.json, original);
    await repository.load();
    await repository.save(_journal(30));
    expect(backend.expectedRevisions, [0]);
  });

  test(
    'concurrent saves wait for the first write and use the resulting revision',
    () async {
      final backend = _FakeBackend(
        json: JournalRepository.encode(_journal(15)),
        revision: 7,
      );
      final repository = JournalRepository(backend);
      await repository.load();
      final gate = Completer<void>();
      backend.firstWriteGate = gate;
      final first = repository.save(_journal(30));
      final second = repository.save(_journal(45));
      await backend.firstWriteStarted.future;
      await Future<void>.delayed(Duration.zero);
      expect(backend.expectedRevisions, [7]);
      gate.complete();
      await Future.wait([first, second]);
      expect(backend.expectedRevisions, [7, 8]);
      expect(repository.revision, 9);
      expect(JournalRepository.decode(backend.json).entries.single.minutes, 45);
    },
  );

  test(
    'a failed write preserves revision and does not poison the queue',
    () async {
      final original = JournalRepository.encode(_journal(15));
      final backend = _FakeBackend(json: original, revision: 4);
      final repository = JournalRepository(backend);
      await repository.load();
      backend.nextWriteFailure = const RepositoryFailure('offline');
      await expectLater(repository.save(_journal(30)), _controlledFailure);
      expect(repository.revision, 4);
      expect(backend.revision, 4);
      expect(backend.json, original);
      expect(backend.history, isEmpty);
      await repository.save(_journal(45));
      expect(backend.expectedRevisions, [4, 4]);
      expect(repository.revision, 5);
      expect(JournalRepository.decode(backend.json).entries.single.minutes, 45);
    },
  );

  test('a second stale repository cannot overwrite another client', () async {
    final backend = _FakeBackend(
      json: JournalRepository.encode(_journal(15)),
      revision: 3,
    );
    final first = JournalRepository(backend);
    final second = JournalRepository(backend);
    await first.load();
    await second.load();
    await first.save(_journal(30));
    final committed = backend.json;
    await expectLater(
      second.save(_journal(45)),
      throwsA(
        isA<RepositoryFailure>().having(
          (failure) => failure.code,
          'code',
          'conflict',
        ),
      ),
    );
    expect(backend.json, committed);
    expect(backend.revision, 4);
    expect(second.revision, 3);
    // An explicit reload synchronizes the client before another user edit.
    expect((await second.load()).entries.single.minutes, 30);
    await second.save(_journal(60));
    expect(backend.revision, 5);
    expect(JournalRepository.decode(backend.json).entries.single.minutes, 60);
  });

  test(
    'corrupt JSON retains observed revision but gates ordinary save',
    () async {
      const corrupt = '{broken current journal}';
      final backend = _FakeBackend(json: corrupt, revision: 12);
      final repository = JournalRepository(backend);
      await expectLater(repository.load(), throwsFormatException);
      expect(repository.revision, 12);
      await expectLater(repository.save(_journal(30)), _controlledFailure);
      expect(backend.expectedRevisions, isEmpty);
      expect(backend.json, corrupt);
      expect(backend.revision, 12);
    },
  );

  test(
    'explicit restore after corrupt load uses observed revision and retains old snapshot',
    () async {
      const corrupt = '{broken current journal}';
      final backend = _FakeBackend(json: corrupt, revision: 12);
      final repository = JournalRepository(backend);
      await expectLater(repository.load(), throwsFormatException);
      await repository.restore(_journal(30));
      expect(backend.expectedRevisions, [12]);
      expect(backend.history, [corrupt]);
      expect(repository.revision, 13);
      expect((await repository.load()).entries.single.minutes, 30);
      // Restore has also returned the repository to a valid loaded state.
      await repository.save(_journal(45));
      expect(backend.expectedRevisions, [12, 13]);
    },
  );

  test(
    'successful restore enables saving without requiring an extra load',
    () async {
      final backend = _FakeBackend(json: 'corrupt', revision: 6);
      final repository = JournalRepository(backend);
      await expectLater(repository.load(), throwsFormatException);
      await repository.restore(_journal(30));
      await repository.save(_journal(45));
      expect(backend.expectedRevisions, [6, 7]);
      expect(repository.revision, 8);
    },
  );

  test(
    'failed browser migration allows explicit restore only at the observed account revision',
    () async {
      final backend = _FakeBackend(
        json: JournalRepository.encode(Journal()),
        revision: 0,
      )..readFailure = const RepositoryFailure('corrupt', observedRevision: 0);
      final repository = JournalRepository(backend);
      await expectLater(repository.load(), _controlledFailure);
      await expectLater(repository.save(_journal(30)), _controlledFailure);
      expect(backend.expectedRevisions, isEmpty);
      await repository.restore(_journal(30));
      expect(backend.expectedRevisions, [0]);
      expect(repository.revision, 1);
      await repository.save(_journal(45));
      expect(backend.expectedRevisions, [0, 1]);
    },
  );

  test(
    'migration recovery cannot overwrite an account initialized by another client',
    () async {
      final winner = JournalRepository.encode(_journal(60));
      final backend = _FakeBackend(json: winner, revision: 1)
        ..readFailure = const RepositoryFailure(
          'unavailable',
          observedRevision: 0,
        );
      final repository = JournalRepository(backend);
      await expectLater(repository.load(), _controlledFailure);
      await expectLater(
        repository.restore(_journal(30)),
        throwsA(
          isA<RepositoryFailure>().having(
            (failure) => failure.code,
            'code',
            'conflict',
          ),
        ),
      );
      expect(backend.expectedRevisions, [0]);
      expect(backend.json, winner);
      expect(backend.history, isEmpty);
    },
  );

  test(
    'unobserved or unsafe migration failures cannot authorize explicit restore',
    () async {
      for (final observed in [null, -1, maxSafeInteger + 1]) {
        final original = JournalRepository.encode(_journal(15));
        final backend = _FakeBackend(json: original, revision: 4)
          ..readFailure = RepositoryFailure(
            'unavailable',
            observedRevision: observed,
          );
        final repository = JournalRepository(backend);
        await expectLater(repository.load(), _controlledFailure);
        await expectLater(repository.restore(_journal(30)), _controlledFailure);
        expect(backend.expectedRevisions, isEmpty);
        expect(backend.json, original);
      }
    },
  );

  test(
    'invalid restoration never sends a write or erases corrupt data',
    () async {
      const corrupt = 'corrupt bytes represented as a string';
      final backend = _FakeBackend(json: corrupt, revision: 9);
      final repository = JournalRepository(backend);
      await expectLater(repository.load(), throwsFormatException);
      await expectLater(
        repository.restore(Journal(schemaVersion: 99)),
        throwsFormatException,
      );
      expect(repository.revision, 9);
      expect(backend.expectedRevisions, isEmpty);
      expect(backend.json, corrupt);
      expect(backend.history, isEmpty);
    },
  );

  test(
    'restore still respects a revision conflict after a corrupt read',
    () async {
      final backend = _FakeBackend(json: 'corrupt', revision: 9);
      final repository = JournalRepository(backend);
      await expectLater(repository.load(), throwsFormatException);
      final otherClientData = JournalRepository.encode(_journal(60));
      backend.json = otherClientData;
      backend.revision = 10;
      await expectLater(
        repository.restore(_journal(30)),
        throwsA(
          isA<RepositoryFailure>().having(
            (failure) => failure.code,
            'code',
            'conflict',
          ),
        ),
      );
      expect(backend.json, otherClientData);
      expect(backend.revision, 10);
      expect(repository.revision, 9);
      expect(backend.history, isEmpty);
      await expectLater(repository.save(_journal(45)), _controlledFailure);
      expect(backend.expectedRevisions, [9]);
    },
  );

  test('a failed reload invalidates a previously loaded repository', () async {
    final backend = _FakeBackend(
      json: JournalRepository.encode(_journal(15)),
      revision: 4,
    );
    final repository = JournalRepository(backend);
    await repository.load();
    backend.json = 'corrupt newer data';
    backend.revision = 5;
    await expectLater(repository.load(), throwsFormatException);
    expect(repository.revision, 5);
    await expectLater(repository.save(_journal(30)), _controlledFailure);
    expect(backend.expectedRevisions, isEmpty);
    expect(backend.json, 'corrupt newer data');
  });

  test(
    'transport read failure also gates saves until loading succeeds',
    () async {
      final original = JournalRepository.encode(_journal(15));
      final backend = _FakeBackend(json: original, revision: 4);
      final repository = JournalRepository(backend);
      await repository.load();
      backend.readFailure = const RepositoryFailure('offline');
      await expectLater(repository.load(), _controlledFailure);
      await expectLater(repository.save(_journal(30)), _controlledFailure);
      expect(repository.revision, 4);
      expect(backend.expectedRevisions, isEmpty);
      backend.readFailure = null;
      await repository.load();
      await repository.save(_journal(45));
      expect(backend.expectedRevisions, [4]);
    },
  );

  test(
    'malformed envelopes and unsafe revisions fail without adopting invalid metadata',
    () async {
      final validJSON = JournalRepository.encode(_journal(15));
      final invalid = <Map<String, dynamic>>[
        {},
        {'json': validJSON},
        {'revision': 8},
        {'json': 42, 'revision': 8},
        {'json': null, 'revision': 8},
        for (final value in <Object?>[
          null,
          '8',
          true,
          -1,
          1.5,
          double.infinity,
          double.nan,
          maxSafeInteger + 1,
        ])
          {'json': validJSON, 'revision': value},
      ];
      for (final envelope in invalid) {
        final backend = _FakeBackend(json: validJSON, revision: 7);
        final repository = JournalRepository(backend);
        await repository.load();
        backend.readOverride = envelope;
        await expectLater(repository.load(), _controlledFailure);
        expect(repository.revision, 7);
        await expectLater(repository.save(_journal(30)), _controlledFailure);
        expect(backend.expectedRevisions, isEmpty);
        expect(backend.json, validJSON);
      }
    },
  );

  test('zero and maximum safe read revisions are accepted', () async {
    for (final revision in [0, maxSafeInteger]) {
      final backend = _FakeBackend(
        json: JournalRepository.encode(_journal(15)),
        revision: revision,
      );
      final repository = JournalRepository(backend);
      expect((await repository.load()).entries.single.minutes, 15);
      expect(repository.revision, revision);
      expect(backend.expectedRevisions, isEmpty);
    }
  });
}

/// In-memory contract double. A production backend needs its own integration
/// test proving that snapshot retention and CAS happen in one transaction.
class _FakeBackend implements JournalBackend {
  _FakeBackend({required this.json, required this.revision});
  String json;
  int revision;
  Map<String, dynamic>? readOverride;
  RepositoryFailure? readFailure;
  RepositoryFailure? nextWriteFailure;
  Completer<void>? firstWriteGate;
  final firstWriteStarted = Completer<void>();
  final expectedRevisions = <int>[];
  final history = <String>[];

  @override
  Future<Map<String, dynamic>> read() async {
    final failure = readFailure;
    if (failure != null) throw failure;
    return readOverride ?? {'json': json, 'revision': revision};
  }

  @override
  Future<int> write(String next, int expected) async {
    expectedRevisions.add(expected);
    if (!firstWriteStarted.isCompleted) firstWriteStarted.complete();
    if (expectedRevisions.length == 1 && firstWriteGate != null) {
      await firstWriteGate!.future;
    }
    final failure = nextWriteFailure;
    nextWriteFailure = null;
    if (failure != null) throw failure;
    if (expected != revision) throw const RepositoryFailure('conflict');
    // The backend commits a retained snapshot and new version atomically.
    history.add(json);
    json = next;
    return ++revision;
  }
}
