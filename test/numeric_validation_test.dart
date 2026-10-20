import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm/core/models.dart';
import 'package:rhythm/core/repository.dart';

const _id = 'ABCDEF00-0000-4000-8000-000000000001';

Habit _duration() => Habit(
  id: _id,
  title: 'Read 读书',
  startDay: '2026-01-01',
  kind: HabitKind.duration,
  targetMinutes: 60,
);

Journal _recorded(int minutes) => Journal(
  habits: [_duration()],
  entries: [HabitEntry(habitID: _id, day: '2026-10-05', minutes: minutes)],
);

String _rawJournal({
  String minutes = '15',
  String minuteKey = '"minutes"',
  String targetMinutes = '60',
  String schemaVersion = '1',
  String number = 'null',
  String targetNumber = '1',
  String note = '""',
}) =>
    '''{
  "schemaVersion":$schemaVersion,
  "habits":[{
    "id":"$_id","title":"Read 读书","note":$note,
    "kind":"duration","colorHex":"F34B3F","symbol":"book.closed",
    "options":[],"targetMinutes":$targetMinutes,"targetNumber":$targetNumber,
    "unit":"","startDay":"2026-01-01"
  }],
  "entries":[{
    "habitID":"$_id","day":"2026-10-05","checked":false,
    "selections":[],$minuteKey:$minutes,"number":$number,"text":""
  }]
}''';

void main() {
  test(
    'the maximum safe integer imports and exports without changing digits',
    () {
      final journal = JournalRepository.decode(
        _rawJournal(
          minutes: '9007199254740991',
          targetMinutes: '9007199254740991',
        ),
      );
      expect(journal.entries.single.minutes, maxSafeInteger);
      expect(journal.habits.single.targetMinutes, maxSafeInteger);
      final exported = JournalRepository.encode(journal);
      expect(exported, contains('"minutes": 9007199254740991'));
      expect(JournalRepository.decode(exported).toJson(), journal.toJson());
    },
  );

  test('unsafe source integer tokens are rejected before JSON rounding', () {
    for (final token in [
      '9007199254740992',
      '9007199254740993',
      '9223372036854775807',
      '9223372036854775808',
    ]) {
      expect(
        () => JournalRepository.decode(_rawJournal(minutes: token)),
        throwsFormatException,
        reason: 'entry minutes: $token',
      );
      expect(
        () => JournalRepository.decode(_rawJournal(targetMinutes: token)),
        throwsFormatException,
        reason: 'goal minutes: $token',
      );
    }
  });

  test(
    'integer fields reject fractions and exponent spellings even if they round to integers',
    () {
      for (final token in [
        '1.5',
        '1.0',
        '1.00000000000000001',
        '9007199254740991.1',
        '1e0',
        '9.007199254740991e15',
        '-1',
        '"15"',
        'true',
        'null',
      ]) {
        expect(
          () => JournalRepository.decode(_rawJournal(minutes: token)),
          throwsFormatException,
          reason: 'entry minutes: $token',
        );
        expect(
          () => JournalRepository.decode(_rawJournal(targetMinutes: token)),
          throwsFormatException,
          reason: 'goal minutes: $token',
        );
      }
      // Without lexical validation, the fractional version could become schema 1
      // in JavaScript and incorrectly pass the normal version check.
      expect(
        () => JournalRepository.decode(
          _rawJournal(schemaVersion: '1.00000000000000001'),
        ),
        throwsFormatException,
      );
    },
  );

  test('escaped integer keys cannot bypass source-token validation', () {
    expect(
      JournalRepository.decode(
        _rawJournal(minuteKey: r'"\u006dinutes"'),
      ).entries.single.minutes,
      15,
    );
    expect(
      () => JournalRepository.decode(
        _rawJournal(minuteKey: r'"\u006dinutes"', minutes: '9007199254740993'),
      ),
      throwsFormatException,
    );
  });

  test('integer-looking text inside a note is preserved', () {
    const text = 'A quote: "minutes":9223372036854775807, a backslash: \\, 中文';
    final journal = JournalRepository.decode(
      _rawJournal(note: jsonEncode(text)),
    );
    expect(journal.habits.single.note, text);
    expect(
      JournalRepository.decode(
        JournalRepository.encode(journal),
      ).habits.single.note,
      text,
    );
  });

  test('number and targetNumber preserve native Double semantics', () {
    final journal = JournalRepository.decode(
      _rawJournal(number: '9007199254740993', targetNumber: '1e100'),
    );
    // Both native Double and JS Number represent this source value as 2^53.
    expect(journal.entries.single.number, double.parse('9007199254740993'));
    expect(journal.habits.single.targetNumber, 1e100);
    final roundTrip = JournalRepository.decode(
      JournalRepository.encode(journal),
    );
    expect(roundTrip.entries.single.number, journal.entries.single.number);
    expect(
      roundTrip.habits.single.targetNumber,
      journal.habits.single.targetNumber,
    );
    expect(
      JournalRepository.decode(
        _rawJournal(number: '0'),
      ).entries.single.hasValue,
      isTrue,
    );
  });

  test(
    'numeric helpers reject nonfinite, negative and unsafe integer values',
    () {
      for (final value in <Object?>[
        double.infinity,
        double.negativeInfinity,
        double.nan,
        -1,
        maxSafeInteger + 1,
        1.5,
        '15',
        null,
      ]) {
        expect(
          () => jsonInt({'minutes': value}, 'minutes'),
          throwsFormatException,
        );
      }
      for (final value in [
        double.infinity,
        double.negativeInfinity,
        double.nan,
      ]) {
        expect(
          () => jsonNumber({'number': value}, 'number'),
          throwsFormatException,
        );
      }
      expect(jsonInt({'minutes': maxSafeInteger}, 'minutes'), maxSafeInteger);
    },
  );

  test('programmatic unsafe integer values cannot be exported', () {
    final invalid = _recorded(maxSafeInteger + 1);
    expect(() => JournalRepository.validate(invalid), throwsFormatException);
    expect(() => JournalRepository.encode(invalid), throwsFormatException);
    expect(
      () => JournalRepository.encode(
        Journal(
          habits: [_duration().copyWith(targetMinutes: maxSafeInteger + 1)],
        ),
      ),
      throwsFormatException,
    );
  });

  test(
    'duration totals at the exact limit pass and overflowing totals fail',
    () {
      final atLimit = Journal(
        habits: [_duration()],
        entries: [
          HabitEntry(
            habitID: _id,
            day: '2026-10-04',
            minutes: maxSafeInteger - 1,
          ),
          HabitEntry(habitID: _id, day: '2026-10-05', minutes: 1),
        ],
      );
      expect(() => JournalRepository.validate(atLimit), returnsNormally);
      expect(atLimit.totalMinutes(), maxSafeInteger);
      final overflow = atLimit.withEntry(
        HabitEntry(habitID: _id, day: '2026-10-05', minutes: 2),
      );
      expect(() => JournalRepository.validate(overflow), throwsFormatException);
      expect(() => JournalRepository.encode(overflow), throwsFormatException);
      // Bypass encode to exercise the raw import route as well.
      expect(
        () => JournalRepository.decode(jsonEncode(overflow.toJson())),
        throwsFormatException,
      );
    },
  );

  test('aggregate validation only totals duration habits', () {
    final checked = _duration().copyWith(
      id: 'ABCDEF00-0000-4000-8000-000000000002',
      kind: HabitKind.check,
    );
    final journal = Journal(
      habits: [_duration(), checked],
      entries: [
        HabitEntry(habitID: _id, day: '2026-10-05', minutes: maxSafeInteger),
        HabitEntry(
          habitID: checked.id,
          day: '2026-10-05',
          minutes: maxSafeInteger,
          checked: true,
        ),
      ],
    );
    expect(() => JournalRepository.validate(journal), returnsNormally);
    expect(journal.totalMinutes(), maxSafeInteger);
  });

  test(
    'invalid numeric saves and restores do not write to the backend',
    () async {
      final backend = _CountingMemoryBackend();
      final repository = JournalRepository(backend);
      await repository.load();
      final original = backend.json;
      final invalid = Journal(
        habits: [_duration()],
        entries: [
          HabitEntry(habitID: _id, day: '2026-10-04', minutes: maxSafeInteger),
          HabitEntry(habitID: _id, day: '2026-10-05', minutes: 1),
        ],
      );
      await expectLater(repository.save(invalid), throwsFormatException);
      await expectLater(repository.restore(invalid), throwsFormatException);
      expect(backend.writes, 0);
      expect(backend.json, original);
      expect(backend.revision, 0);
      expect(repository.revision, 0);
    },
  );
}

class _CountingMemoryBackend extends MemoryBackend {
  int writes = 0;
  @override
  Future<int> write(String json, int revision) {
    writes++;
    return super.write(json, revision);
  }
}
