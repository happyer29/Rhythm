import 'models.dart';

class HabitStatistics {
  const HabitStatistics({
    required this.habit,
    required this.recordedDays,
    required this.completedDays,
    required this.totalMinutes,
  });
  final Habit habit;
  final int recordedDays, completedDays, totalMinutes;
}

class StatisticsSnapshot {
  StatisticsSnapshot({
    required this.activeDays,
    required this.streak,
    required this.totalMinutes,
    required List<HabitStatistics> habits,
  }) : habits = List.unmodifiable(habits);
  final int activeDays, streak, totalMinutes;
  final List<HabitStatistics> habits;
}

class HeatmapDay {
  const HeatmapDay({
    required this.day,
    required this.progress,
    required this.minutes,
    required this.isInYear,
    required this.isFuture,
  });
  final String day;
  final double progress;
  final int minutes;
  final bool isInYear, isFuture;
}

class HeatmapSnapshot {
  HeatmapSnapshot({
    required this.year,
    required List<List<HeatmapDay>> weeks,
    required this.activeDays,
  }) : weeks = List.unmodifiable(
         weeks.map((week) => List<HeatmapDay>.unmodifiable(week)),
       );
  final int year, activeDays;
  final List<List<HeatmapDay>> weeks;
}

/// Index once per immutable journal, then reuse across the retained tab views.
class JournalAnalytics {
  JournalAnalytics(Journal journal) : _habits = journal.habits {
    for (final habit in _habits) {
      _habitsByID.putIfAbsent(habit.id, () => habit);
    }
    for (final entry in journal.entries) {
      (_entriesByHabit[entry.habitID] ??= []).add(entry);
      final values = _days.putIfAbsent(entry.day, _DayValues.new);
      if (entry.hasValue) {
        _activeDays.add(entry.day);
        values.recorded.add(entry.habitID);
      }
      final habit = _habitsByID[entry.habitID];
      if (habit != null) {
        values.progress.putIfAbsent(entry.habitID, () => habit.progress(entry));
      }
      if (habit?.kind == HabitKind.duration) {
        values.minutes[entry.habitID] = addMinutes(
          values.minutes[entry.habitID] ?? 0,
          entry.minutes,
        );
        values.totalMinutes = addMinutes(values.totalMinutes, entry.minutes);
      }
    }
  }

  final List<Habit> _habits;
  final Map<String, Habit> _habitsByID = {};
  final Map<String, List<HabitEntry>> _entriesByHabit = {};
  final Map<String, _DayValues> _days = {};
  final Set<String> _activeDays = {};

  StatisticsSnapshot statistics(String today) {
    final rows = _habits
        .map((habit) {
          var recorded = 0, completed = 0, minutes = 0;
          for (final entry in _entriesByHabit[habit.id] ?? <HabitEntry>[]) {
            if (entry.day.compareTo(today) > 0) continue;
            recorded++;
            if (habit.complete(entry)) completed++;
            if (habit.kind == HabitKind.duration) {
              minutes = addMinutes(minutes, entry.minutes);
            }
          }
          return HabitStatistics(
            habit: habit,
            recordedDays: recorded,
            completedDays: completed,
            totalMinutes: minutes,
          );
        })
        .toList(growable: false);
    var minutes = 0;
    for (final item in _days.entries) {
      if (item.key.compareTo(today) <= 0) {
        minutes = addMinutes(minutes, item.value.totalMinutes);
      }
    }
    return StatisticsSnapshot(
      activeDays: _activeDays.where((day) => day.compareTo(today) <= 0).length,
      streak: streakFromDays(_activeDays, today),
      totalMinutes: minutes,
      habits: rows,
    );
  }

  HeatmapSnapshot heatmap(int year, {String? habitID, required String today}) {
    if (year < 1 || year > 9999) {
      return HeatmapSnapshot(year: year, weeks: [], activeDays: 0);
    }
    final filter = habitID?.toUpperCase();
    final selected = filter == null
        ? _habits
        : [if (_habitsByID[filter] != null) _habitsByID[filter]!];
    final first = DateTime(year, 1, 1, 12);
    final last = DateTime(year, 12, 31, 12);
    var monday = DateTime(year, 1, 1 - (first.weekday - 1), 12);
    final weeks = <List<HeatmapDay>>[];
    while (!monday.isAfter(last)) {
      final cells = <HeatmapDay>[];
      for (var weekday = 0; weekday < 7; weekday++) {
        final date = DateTime(
          monday.year,
          monday.month,
          monday.day + weekday,
          12,
        );
        final day = DayKey.fromDate(date);
        final inYear = date.year == year;
        final values = _days[day];
        var sum = 0.0, count = 0;
        if (inYear) {
          for (final habit in selected) {
            if (habit.eligible(day) ||
                values?.recorded.contains(habit.id) == true) {
              count++;
              sum += values?.progress[habit.id] ?? 0;
            }
          }
        }
        cells.add(
          HeatmapDay(
            day: day,
            progress: count == 0 ? 0 : sum / count,
            minutes: !inYear
                ? 0
                : filter == null
                ? values?.totalMinutes ?? 0
                : values?.minutes[filter] ?? 0,
            isInYear: inYear,
            isFuture: day.compareTo(today) > 0,
          ),
        );
      }
      weeks.add(cells);
      monday = DateTime(monday.year, monday.month, monday.day + 7, 12);
    }
    final prefix = '${year.toString().padLeft(4, '0')}-';
    final active = _days.entries
        .where(
          (item) =>
              item.key.startsWith(prefix) &&
              item.key.compareTo(today) <= 0 &&
              (filter == null
                  ? item.value.recorded.isNotEmpty
                  : item.value.recorded.contains(filter)),
        )
        .length;
    return HeatmapSnapshot(year: year, weeks: weeks, activeDays: active);
  }
}

class _DayValues {
  final Map<String, double> progress = {};
  final Map<String, int> minutes = {};
  final Set<String> recorded = {};
  int totalMinutes = 0;
}
