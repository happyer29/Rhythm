import 'package:flutter_test/flutter_test.dart';

import 'package:rhythm/core/models.dart';
import 'package:rhythm/core/analytics.dart';

const checkID = 'A1000000-0000-4000-8000-000000000001';
const timeID = 'A1000000-0000-4000-8000-000000000002';
const textID = 'A1000000-0000-4000-8000-000000000003';
const numberID = 'A1000000-0000-4000-8000-000000000004';
const singleID = 'A1000000-0000-4000-8000-000000000005';
const multipleID = 'A1000000-0000-4000-8000-000000000006';
Habit habit(
  String id, {
  HabitKind kind = HabitKind.check,
  String startDay = '2024-01-01',
  String? archivedOn,
}) => Habit(
  id: id,
  title: kind.name,
  kind: kind,
  startDay: startDay,
  archivedOn: archivedOn,
  options: kind == HabitKind.single || kind == HabitKind.multiple
      ? ['A', 'B']
      : [],
  targetMinutes: 60,
  targetNumber: 2,
);

void main() {
  test(
    'civil days reject malformed dates and preserve leap/year boundaries',
    () {
      for (final day in [
        '0001-01-01',
        '2024-02-29',
        '2026-03-29',
        '2026-10-25',
        '9999-12-31',
      ]) {
        expect(DayKey.fromDate(DayKey.parse(day)!), day);
        expect(DayKey.parse(day)!.hour, 12);
      }
      for (final day in [
        '',
        '2025-02-29',
        '2026-04-31',
        '2026-2-01',
        '2026-13-01',
        '0000-01-01',
        '٢٠٢٦-١٠-٠٥',
        '2026-10-05x',
      ]) {
        expect(DayKey.parse(day), isNull);
        expect(DayKey.year(day), 0);
        expect(DayKey.add(day, 1), day);
      }
      expect(DayKey.add('2024-02-28', 1), '2024-02-29');
      expect(DayKey.add('2026-12-31', 1), '2027-01-01');
      expect(DayKey.add('2027-01-01', -1), '2026-12-31');
      expect(DayKey.add('0001-01-01', -1), '0001-01-01');
      expect(DayKey.add('9999-12-31', 1), '9999-12-31');
    },
  );

  test('civil day increments cross DST by calendar rather than duration', () {
    for (final day in [
      '2026-03-28',
      '2026-03-29',
      '2026-10-24',
      '2026-10-25',
      '2026-03-08',
      '2026-11-01',
    ]) {
      final next = DayKey.add(day, 1);
      expect(DayKey.add(next, -1), day);
      expect(DayKey.parse(next)!.hour, 12);
    }
  });

  test('all six habit types apply goal and completion semantics', () {
    final checked = habit(checkID);
    expect(
      checked.complete(
        HabitEntry(habitID: checkID, day: '2026-10-05', checked: true),
      ),
      isTrue,
    );
    expect(
      checked.progress(
        HabitEntry(habitID: timeID, day: '2026-10-05', checked: true),
      ),
      0,
    );
    final timed = habit(timeID, kind: HabitKind.duration);
    expect(
      timed.progress(
        HabitEntry(habitID: timeID, day: '2026-10-05', minutes: 45),
      ),
      .75,
    );
    expect(
      timed.progress(
        HabitEntry(habitID: timeID, day: '2026-10-05', minutes: 90),
      ),
      1,
    );
    expect(
      timed.progress(
        HabitEntry(habitID: timeID, day: '2026-10-05', minutes: -1),
      ),
      0,
    );
    for (final kind in [HabitKind.single, HabitKind.multiple]) {
      final choice = habit(singleID, kind: kind);
      expect(
        choice.progress(
          HabitEntry(habitID: singleID, day: '2026-10-05', selections: ['A']),
        ),
        1,
      );
      expect(
        choice.progress(
          HabitEntry(
            habitID: singleID,
            day: '2026-10-05',
            selections: ['Unknown'],
          ),
        ),
        0,
      );
    }
    final numeric = habit(numberID, kind: HabitKind.number);
    expect(
      numeric.progress(
        HabitEntry(habitID: numberID, day: '2026-10-05', number: 1),
      ),
      .5,
    );
    expect(
      numeric.progress(
        HabitEntry(habitID: numberID, day: '2026-10-05', number: double.nan),
      ),
      0,
    );
    expect(
      numeric
          .copyWith(targetNumber: .0000001)
          .complete(
            HabitEntry(habitID: numberID, day: '2026-10-05', number: .0000001),
          ),
      isTrue,
    );
    final text = habit(textID, kind: HabitKind.text);
    expect(
      text.complete(
        HabitEntry(habitID: textID, day: '2026-10-05', text: ' \n '),
      ),
      isFalse,
    );
    expect(
      text.complete(HabitEntry(habitID: textID, day: '2026-10-05', text: '中文')),
      isTrue,
    );
  });

  test('entries remain independent by day and clearing removes the record', () {
    final original = Journal(habits: [habit(checkID)]);
    final entered = original.withEntry(
      HabitEntry(
        habitID: checkID.toLowerCase(),
        day: '2026-10-05',
        checked: true,
      ),
    );
    expect(entered.entry(checkID.toLowerCase(), '2026-10-05').checked, isTrue);
    expect(entered.entry(checkID, '2026-10-06').checked, isFalse);
    expect(
      entered
          .withEntry(entered.entries.single.copyWith(checked: false))
          .entries,
      isEmpty,
    );
    expect(original.entries, isEmpty);
    expect(() => entered.entries.clear(), throwsUnsupportedError);
    expect(
      () => entered.habits.single.options.add('x'),
      throwsUnsupportedError,
    );
  });

  test('numeric zero is a record and number clearing is explicit', () {
    final zero = HabitEntry(habitID: numberID, day: '2026-10-05', number: 0);
    expect(zero.hasValue, isTrue);
    expect(zero.copyWith(text: 'note').number, 0);
    expect(zero.copyWith(clearNumber: true).hasValue, isFalse);
    expect(
      HabitEntry(habitID: textID, day: zero.day, text: '\n ').hasValue,
      isFalse,
    );
  });

  test(
    'eligibility excludes future/archive day and preserves recorded archive history',
    () {
      final first = habit(checkID, archivedOn: '2026-10-06');
      final second = habit(timeID, startDay: '2026-10-05');
      final future = habit(textID, startDay: '2026-10-10');
      var journal = Journal(
        habits: [first, second, future],
        entries: [
          HabitEntry(habitID: checkID, day: '2026-10-04', checked: true),
          HabitEntry(habitID: checkID, day: '2026-10-05', checked: true),
        ],
      );
      expect(journal.progress('2026-10-04'), 1);
      expect(journal.progress('2026-10-05'), .5);
      expect(journal.progress('2026-10-05', habitID: checkID.toLowerCase()), 1);
      expect(journal.habitsOn('2026-10-06').map((habit) => habit.id), [timeID]);
      journal = journal.withEntry(
        HabitEntry(habitID: checkID, day: '2026-10-06', checked: true),
      );
      expect(journal.habitsOn('2026-10-06').length, 2);
      expect(journal.progress('2026-10-06'), .5);
      expect(
        first.copyWith(clearArchivedOn: true).eligible('2026-10-06'),
        isTrue,
      );
    },
  );

  test('streak allows empty today, crosses year, and breaks on a gap', () {
    final journal = Journal(
      habits: [habit(textID, kind: HabitKind.text)],
      entries: [
        for (final day in [
          '2025-12-30',
          '2025-12-31',
          '2026-01-01',
          '2026-01-03',
        ])
          HabitEntry(habitID: textID, day: day, text: 'entry'),
      ],
    );
    expect(journal.activeDays(), 4);
    expect(journal.activeDays(year: 2025), 2);
    expect(journal.activeDays(through: '2026-01-01'), 3);
    expect(journal.streak('2026-01-01'), 3);
    expect(journal.streak('2026-01-02'), 3);
    expect(journal.streak('2026-01-03'), 1);
    expect(journal.streak('2026-01-06'), 0);
    expect(journal.streak('bad'), 0);
  });

  test(
    'minutes count only duration habits and saturate signed 64-bit totals',
    () {
      final journal = Journal(
        habits: [
          habit(timeID, kind: HabitKind.duration),
          habit(checkID),
        ],
        entries: [
          HabitEntry(
            habitID: timeID,
            day: '2026-10-04',
            minutes: maxSafeInteger,
          ),
          HabitEntry(habitID: timeID, day: '2026-10-05', minutes: 1),
          HabitEntry(habitID: checkID, day: '2026-10-05', minutes: 800),
        ],
      );
      expect(journal.totalMinutes(), maxSafeInteger);
      expect(journal.totalMinutes(day: '2026-10-05'), 1);
      expect(journal.completedCount('2026-10-04'), 1);
      final stats = JournalAnalytics(journal).statistics('2026-10-05');
      expect(stats.totalMinutes, maxSafeInteger);
      expect(stats.habits.first.totalMinutes, maxSafeInteger);
      expect(stats.habits.last.totalMinutes, 0);
    },
  );

  test('indexed statistics match direct calculations with future cutoff', () {
    final journal = fixture();
    final index = JournalAnalytics(journal);
    for (final today in [
      '2023-12-31',
      '2024-01-01',
      '2024-02-29',
      '2024-08-30',
      '2024-12-31',
      '2025-01-03',
    ]) {
      final filtered = journal.copyWith(
        entries: journal.entries
            .where((entry) => entry.day.compareTo(today) <= 0)
            .toList(),
      );
      final stats = index.statistics(today);
      expect(stats.activeDays, filtered.activeDays());
      expect(stats.streak, filtered.streak(today));
      expect(stats.totalMinutes, filtered.totalMinutes());
      for (final row in stats.habits) {
        final records = filtered.entries.where(
          (entry) => entry.habitID == row.habit.id,
        );
        expect(row.recordedDays, records.length);
        expect(row.completedDays, records.where(row.habit.complete).length);
      }
    }
  });

  test('every heatmap cell matches direct progress and filtered minutes', () {
    final journal = fixture();
    final index = JournalAnalytics(journal);
    for (final filter in <String?>[
      null,
      ...journal.habits.map((habit) => habit.id.toLowerCase()),
      'unknown',
    ]) {
      for (final year in [2024, 2025]) {
        final map = index.heatmap(year, habitID: filter, today: '2024-11-30');
        final cells = map.weeks.expand((week) => week);
        expect(
          cells.where((day) => day.isInYear).length,
          year == 2024 ? 366 : 365,
        );
        expect(map.weeks.every((week) => week.length == 7), isTrue);
        expect(
          map.weeks.every(
            (week) => DayKey.parse(week.first.day)!.weekday == DateTime.monday,
          ),
          isTrue,
        );
        for (final day in cells.where((day) => day.isInYear)) {
          expect(
            day.progress,
            closeTo(journal.progress(day.day, habitID: filter), .00000001),
          );
          final filtered = journal.copyWith(
            entries: journal.entries
                .where(
                  (entry) =>
                      filter == null || entry.habitID == filter.toUpperCase(),
                )
                .toList(),
          );
          expect(day.minutes, filtered.totalMinutes(day: day.day));
          expect(day.isFuture, day.day.compareTo('2024-11-30') > 0);
        }
        final active = journal.entries
            .where(
              (entry) =>
                  entry.hasValue &&
                  DayKey.year(entry.day) == year &&
                  entry.day.compareTo('2024-11-30') <= 0 &&
                  (filter == null || entry.habitID == filter.toUpperCase()),
            )
            .map((entry) => entry.day)
            .toSet()
            .length;
        expect(map.activeDays, active);
      }
    }
  });

  test('heatmap boundaries and invalid years are finite', () {
    final index = JournalAnalytics(Journal());
    for (final year in [0, 10000, -1]) {
      expect(index.heatmap(year, today: '2026-10-05').weeks, isEmpty);
    }
    for (final year in [1, 9999]) {
      final cells = index
          .heatmap(year, today: '2026-10-05')
          .weeks
          .expand((week) => week);
      expect(cells.where((day) => day.isInYear).length, 365);
      expect(cells.length, lessThanOrEqualTo(378));
    }
  });

  test(
    'rebuilt analytics reflect edits and retain immutable previous snapshots',
    () {
      var journal = Journal(habits: [habit(timeID, kind: HabitKind.duration)]);
      final before = JournalAnalytics(journal);
      journal = journal.withEntry(
        HabitEntry(habitID: timeID, day: '2026-10-05', minutes: 30),
      );
      final entered = JournalAnalytics(journal);
      expect(entered.statistics('2026-10-05').totalMinutes, 30);
      expect(before.statistics('2026-10-05').totalMinutes, 0);
      journal = journal.copyWith(
        habits: [journal.habits.single.copyWith(targetMinutes: 30)],
      );
      expect(
        JournalAnalytics(
          journal,
        ).statistics('2026-10-05').habits.single.completedDays,
        1,
      );
      journal = journal.withEntry(journal.entries.single.copyWith(minutes: 0));
      expect(JournalAnalytics(journal).statistics('2026-10-05').activeDays, 0);
      expect(entered.statistics('2026-10-05').activeDays, 1);
    },
  );
}

Journal fixture() {
  final habits = [
    habit(checkID, archivedOn: '2024-09-01'),
    habit(timeID, kind: HabitKind.duration),
    habit(textID, kind: HabitKind.text),
    habit(numberID, kind: HabitKind.number),
    habit(singleID, kind: HabitKind.single, startDay: '2024-02-01'),
    habit(multipleID, kind: HabitKind.multiple),
  ];
  final entries = <HabitEntry>[];
  for (var index = 0; index < 369; index++) {
    final day = DayKey.add('2024-01-01', index);
    if (index % 3 == 0) {
      entries.add(HabitEntry(habitID: checkID, day: day, checked: true));
    }
    if (index % 4 == 0) {
      entries.add(HabitEntry(habitID: timeID, day: day, minutes: index % 120));
    }
    if (index % 5 == 0) {
      entries.add(
        HabitEntry(
          habitID: textID,
          day: day,
          text: index % 10 == 0 ? 'note' : ' ',
        ),
      );
    }
    if (index % 6 == 0) {
      entries.add(
        HabitEntry(habitID: numberID, day: day, number: (index % 4).toDouble()),
      );
    }
    if (index >= 31 && index % 7 == 0) {
      entries.add(HabitEntry(habitID: singleID, day: day, selections: ['A']));
    }
    if (index % 8 == 0) {
      entries.add(
        HabitEntry(habitID: multipleID, day: day, selections: ['A', 'B']),
      );
    }
  }
  return Journal(habits: habits, entries: entries);
}
