import 'dart:async';
import 'dart:convert';
import 'models.dart';
import 'integer_preflight.dart';

class RepositoryFailure implements Exception {
  const RepositoryFailure(this.code, {this.observedRevision});
  final String code;
  // A failed browser migration may still have observed the account revision.
  // Only an explicit restore may use it; ordinary edits require a full load.
  final int? observedRevision;
  @override
  String toString() => 'Journal storage: $code';
}

abstract class JournalBackend {
  Future<Map<String, dynamic>> read();
  // Atomically preserves the previous snapshot and compares its revision.
  Future<int> write(String json, int revision);
}

abstract interface class JournalBackupBackend {
  Future<String?> readBackup();
}

// Used only by non-browser unit tests.
class MemoryBackend implements JournalBackend {
  String json = '{"schemaVersion":1,"habits":[],"entries":[]}';
  int revision = 0;
  String? previousJson;
  @override
  Future<Map<String, dynamic>> read() async => {
    'json': json,
    'revision': revision,
  };
  @override
  Future<int> write(String next, int expected) async {
    if (revision >= maxSafeInteger) {
      throw const RepositoryFailure('revision-limit');
    }
    if (expected != revision) throw const RepositoryFailure('conflict');
    previousJson = json;
    json = next;
    return ++revision;
  }
}

class JournalRepository {
  JournalRepository(this.backend);
  final JournalBackend backend;
  int revision = 0;
  bool _loaded = false;
  bool _observed = false;
  Future<void> _pending = Future<void>.value();
  Future<T> _serialized<T>(Future<T> Function() operation) {
    final result = _pending.then((_) => operation());
    _pending = result.then<void>((_) {}, onError: (Object _, StackTrace _) {});
    return result;
  }

  Future<Journal> load() => _serialized(() async {
    _loaded = false;
    _observed = false;
    late final Map<String, dynamic> result;
    try {
      result = await backend.read();
    } on RepositoryFailure catch (failure) {
      final observed = failure.observedRevision;
      if (observed != null && observed >= 0 && observed <= maxSafeInteger) {
        revision = observed;
        _observed = true;
      }
      rethrow;
    }
    final observed = result['revision'];
    if (result['json'] is! String ||
        observed is! int ||
        !observed.isFinite ||
        observed < 0 ||
        observed > maxSafeInteger) {
      throw const RepositoryFailure('invalid-storage');
    }
    revision = observed;
    _observed = true;
    final journal = decode(result['json'] as String);
    _loaded = true;
    return journal;
  });
  Future<void> save(Journal journal) => _serialized(() async {
    if (!_loaded) throw const RepositoryFailure('not-loaded');
    final json = encode(journal);
    revision = await backend.write(json, revision);
  });
  Future<void> restore(Journal journal) => _serialized(() async {
    if (!_observed) throw const RepositoryFailure('not-loaded');
    final json = encode(journal);
    revision = await backend.write(json, revision);
    _loaded = true;
  });

  Future<String?> previousSnapshot() async {
    final storage = backend;
    return storage is JournalBackupBackend
        ? (storage as JournalBackupBackend).readBackup()
        : null;
  }

  static Journal decode(String contents) {
    validateWebIntegerFields(contents);
    final value = jsonDecode(contents);
    if (value is! Map<String, dynamic>) {
      throw const FormatException('Invalid habit data: expected an object.');
    }
    final journal = Journal.fromJson(value);
    validate(journal);
    return journal;
  }

  static String encode(Journal journal) {
    validate(journal);
    return const JsonEncoder.withIndent('  ').convert(journal.toJson());
  }

  static final _uuid = RegExp(
    r'^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$',
  );
  static void validate(Journal journal) {
    Never invalid(String detail) =>
        throw FormatException('Invalid habit data: $detail.');
    if (journal.schemaVersion != 2) {
      throw FormatException(
        'Data format version ${journal.schemaVersion} is not supported.',
      );
    }
    final habits = <String, Habit>{};
    for (final habit in journal.habits) {
      if (!_uuid.hasMatch(habit.id)) invalid('invalid habit ID');
      if (habits.containsKey(habit.id)) invalid('duplicate habit ID');
      if (habit.title.trim().isEmpty) invalid('empty habit title');
      if (!DayKey.valid(habit.startDay)) invalid('invalid start date');
      if (habit.archivedOn != null &&
          (!DayKey.valid(habit.archivedOn!) ||
              habit.archivedOn!.compareTo(habit.startDay) < 0)) {
        invalid('invalid archive date');
      }
      if (!habit.targetMinutes.isFinite ||
          habit.targetMinutes < 0 ||
          habit.targetMinutes > maxSafeInteger ||
          !habit.targetNumber.isFinite ||
          habit.targetNumber < 0 ||
          habit.kind == HabitKind.duration && habit.targetMinutes <= 0 ||
          habit.kind == HabitKind.number && habit.targetNumber <= 0) {
        invalid('invalid habit goal');
      }
      if (habit.options.toSet().length != habit.options.length ||
          habit.options.any((option) => option.trim().isEmpty)) {
        invalid('invalid list options');
      }
      if ((habit.kind == HabitKind.single ||
              habit.kind == HabitKind.multiple) &&
          habit.options.isEmpty) {
        invalid('no list options');
      }
      habits[habit.id] = habit;
    }
    final keys = <String>{};
    var totalMinutes = 0;
    for (final entry in journal.entries) {
      final habit = habits[entry.habitID];
      if (habit == null) invalid('entry refers to a missing habit');
      if (!DayKey.valid(entry.day) || entry.day.compareTo(habit.startDay) < 0) {
        invalid('invalid entry date');
      }
      if (!keys.add('${entry.habitID}/${entry.day}')) {
        invalid('duplicate daily entry');
      }
      if (!entry.minutes.isFinite ||
          entry.minutes < 0 ||
          entry.minutes > maxSafeInteger ||
          entry.number != null &&
              (!entry.number!.isFinite || entry.number! < 0)) {
        invalid('negative or invalid value');
      }
      if (habit.kind == HabitKind.duration) {
        if (entry.minutes > maxSafeInteger - totalMinutes) {
          invalid('total minutes exceed browser precision');
        }
        totalMinutes += entry.minutes;
      }
      if (entry.sessions.isNotEmpty && habit.kind != HabitKind.duration) {
        invalid('sessions require a duration habit');
      }
      var sessionMinutes = 0;
      for (final session in entry.sessions) {
        if (session.topic.trim().isEmpty ||
            !habit.options.contains(session.topic) ||
            !session.minutes.isFinite ||
            session.minutes < 0 ||
            session.minutes > maxSafeInteger ||
            session.minutes > entry.minutes - sessionMinutes) {
          invalid('invalid timed session');
        }
        sessionMinutes += session.minutes;
      }
      if (entry.selections.toSet().length != entry.selections.length ||
          entry.selections.any(
            (selection) => !habit.options.contains(selection),
          ) ||
          habit.kind == HabitKind.single && entry.selections.length > 1) {
        invalid('invalid list selection');
      }
    }
  }
}
