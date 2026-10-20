import 'dart:async';
import 'package:flutter/foundation.dart';
import 'platform/preferences.dart';
import 'package:uuid/uuid.dart';
import 'core/models.dart';
import 'core/analytics.dart';
import 'core/repository.dart';
import 'l10n.dart';

class RhythmStore extends ChangeNotifier {
  RhythmStore(this.repository, {DateTime Function()? clock})
    : _clock = clock ?? DateTime.now {
    today = DayKey.fromDate(_clock());
    selectedDay = today;
  }
  final JournalRepository repository;
  final DateTime Function() _clock;
  Journal journal = Journal();
  late JournalAnalytics analytics = JournalAnalytics(journal);
  late String today;
  late String selectedDay;
  AppLanguage language = AppLanguage.english;
  bool ready = false;
  bool loading = true;
  bool _loadInProgress = false;
  bool saveFailed = false;
  bool importing = false;
  int _writes = 0;
  int _revision = 0;
  int _savedRevision = 0;
  Object? error;
  bool get saving => _writes > 0;
  bool get hasConflict =>
      error is RepositoryFailure &&
      (error as RepositoryFailure).code == 'conflict';
  bool get hasUnsavedChanges => saveFailed || _savedRevision < _revision;
  Strings get strings => Strings(language);
  bool get isFuture => selectedDay.compareTo(today) > 0;
  List<Habit> get dailyHabits => journal.habitsOn(
    selectedDay,
    includeArchived: selectedDay.compareTo(today) < 0,
  );
  List<Habit> get activeHabits =>
      journal.habits.where((h) => h.archivedOn == null).toList();
  List<Habit> get archivedHabits =>
      journal.habits.where((h) => h.archivedOn != null).toList();
  Future<void> _preferenceQueue = Future<void>.value();

  Future<void> load() async {
    if (_loadInProgress || saving || importing || hasUnsavedChanges) return;
    _loadInProgress = true;
    loading = true;
    error = null;
    notifyListeners();
    try {
      try {
        language = LanguageDetails.fromCode(Preferences.read());
      } catch (_) {
        language = AppLanguage.english;
      }
      journal = await repository.load();
      analytics = JournalAnalytics(journal);
      ready = true;
      saveFailed = false;
      _revision = 0;
      _savedRevision = 0;
    } catch (failure) {
      error = failure;
      ready = false;
    } finally {
      loading = false;
      _loadInProgress = false;
      notifyListeners();
    }
  }

  void selectDay(String day) {
    if (!DayKey.valid(day) || selectedDay == day) return;
    selectedDay = day;
    notifyListeners();
  }

  void refreshCalendar() {
    final next = DayKey.fromDate(_clock());
    if (next == today) return;
    if (selectedDay == today) selectedDay = next;
    today = next;
    notifyListeners();
  }

  Future<void> setLanguage(AppLanguage value) {
    final task = _preferenceQueue.then((_) async {
      if (value == language) return;
      try {
        Preferences.write(value.code);
        language = value;
      } catch (failure) {
        error = failure;
      }
      notifyListeners();
    });
    _preferenceQueue = task.catchError((Object _) {});
    return task;
  }

  Future<void> updateEntry(HabitEntry entry) async {
    if (!ready || importing || loading || entry.day.compareTo(today) > 0) {
      return;
    }
    try {
      // Validate before empty-entry cleanup so invalid input cannot erase a value.
      JournalRepository.validate(
        Journal(habits: journal.habits, entries: [entry]),
      );
    } catch (failure) {
      error = failure;
      notifyListeners();
      return;
    }
    await _replace(journal.withEntry(entry));
  }

  Future<void> clearEntry(Habit habit) =>
      updateEntry(HabitEntry(habitID: habit.id, day: selectedDay));

  /// Adds categories and records their sessions in the same account snapshot.
  /// Existing categories remain available for earlier entries and other days.
  Future<bool> updateDurationSessions(
    HabitEntry entry,
    List<String> categories,
  ) async {
    if (!ready || importing || loading || entry.day.compareTo(today) > 0) {
      return false;
    }
    try {
      final habit = journal.habits
          .where((habit) => habit.id == entry.habitID)
          .firstOrNull;
      if (habit == null || habit.kind != HabitKind.duration) {
        throw const FormatException(
          'Sessions require an existing duration habit.',
        );
      }
      final updated = habit.copyWith(
        options: {...habit.options, ...categories}.toList(),
      );
      // Validate even a zero-valued entry before withEntry can remove it.
      final habits = journal.habits
          .map((habit) => habit.id == updated.id ? updated : habit)
          .toList();
      JournalRepository.validate(Journal(habits: habits, entries: [entry]));
      final next = journal.copyWith(habits: habits).withEntry(entry);
      JournalRepository.validate(next);
      await _replace(next);
      return !saveFailed;
    } catch (failure) {
      error = failure;
      notifyListeners();
      return false;
    }
  }

  Future<void> recordEntries(List<HabitEntry> entries) async {
    if (!ready || importing || loading || hasUnsavedChanges) {
      throw StateError('The journal is not ready for another update.');
    }
    if (entries.isEmpty ||
        entries.length > 100 ||
        entries.any((entry) => entry.day.compareTo(today) > 0)) {
      throw const FormatException('Invalid entries or future day.');
    }
    JournalRepository.validate(
      Journal(habits: journal.habits, entries: entries),
    );
    var next = journal;
    for (final entry in entries) {
      next = next.withEntry(entry);
    }
    JournalRepository.validate(next);
    await _replace(next);
    if (saveFailed) throw error ?? StateError('Saving failed.');
  }

  Future<void> saveHabit(Habit habit) async {
    if (!ready || importing || loading) return;
    final habits = journal.habits.toList();
    final index = habits.indexWhere((h) => h.id == habit.id);
    if (index < 0) {
      habits.add(habit);
    } else {
      habits[index] = habit;
    }
    await _replace(journal.copyWith(habits: habits));
  }

  Future<bool> archiveHabit(Habit habit) async {
    if (!ready || importing || loading) return false;
    final current = journal.habits
        .where((current) => current.id == habit.id)
        .firstOrNull;
    if (current == null) return false;
    if (current.archivedOn != null) return !hasUnsavedChanges;
    final archiveDay = current.startDay.compareTo(today) > 0
        ? current.startDay
        : today;
    await saveHabit(current.copyWith(archivedOn: archiveDay));
    return !hasUnsavedChanges;
  }

  Future<bool> unarchiveHabit(Habit habit) async {
    if (!ready || importing || loading) return false;
    final current = journal.habits
        .where((current) => current.id == habit.id)
        .firstOrNull;
    if (current == null) return false;
    if (current.archivedOn == null) return !hasUnsavedChanges;
    await saveHabit(current.copyWith(clearArchivedOn: true));
    return !hasUnsavedChanges;
  }

  Future<void> deleteHabit(Habit habit) async {
    if (!ready || importing || loading) return;
    await _replace(
      journal.copyWith(
        habits: journal.habits.where((h) => h.id != habit.id).toList(),
        entries: journal.entries.where((e) => e.habitID != habit.id).toList(),
      ),
    );
  }

  Future<void> addExamples() async {
    if (!ready || importing || loading) return;
    final s = strings;
    final date = isFuture ? today : selectedDay;
    final habits = [
      Habit(
        id: const Uuid().v4(),
        title: s.t('Read every day', '每天阅读'),
        note: s.t('A few pages are a step forward', '读几页，也是进步'),
        kind: HabitKind.duration,
        symbol: 'book.closed',
        colorHex: 'D8E1E5',
        targetMinutes: 30,
        startDay: date,
      ),
      Habit(
        id: const Uuid().v4(),
        title: s.t('Morning movement', '晨间运动'),
        kind: HabitKind.check,
        symbol: 'figure.mind.and.body',
        startDay: date,
      ),
      Habit(
        id: const Uuid().v4(),
        title: s.t('How I feel', '身心状态'),
        kind: HabitKind.single,
        symbol: 'sun.max',
        colorHex: 'A796C2',
        options: [
          s.t('Great', '很好'),
          s.t('Good', '不错'),
          s.t('Neutral', '一般'),
          s.t('Tired', '疲惫'),
        ],
        startDay: date,
      ),
      Habit(
        id: const Uuid().v4(),
        title: s.t('Self-care', '关爱自己'),
        kind: HabitKind.multiple,
        symbol: 'waveform.path',
        colorHex: '6DADB5',
        options: [
          s.t('Walk', '散步'),
          s.t('Meditation', '冥想'),
          s.t('Social media break', '远离社交媒体'),
          s.t('Early bedtime', '早点睡觉'),
        ],
        startDay: date,
      ),
    ];
    await _replace(journal.copyWith(habits: [...journal.habits, ...habits]));
  }

  Future<void> _replace(Journal next) async {
    try {
      JournalRepository.validate(next);
    } catch (failure) {
      error = failure;
      notifyListeners();
      return;
    }
    journal = next;
    analytics = JournalAnalytics(next);
    final revision = ++_revision;
    _writes++;
    notifyListeners();
    try {
      await repository.save(next);
      _savedRevision = revision;
      if (revision == _revision) {
        saveFailed = false;
        error = null;
      }
    } catch (failure) {
      saveFailed = true;
      error = failure;
    } finally {
      _writes--;
      notifyListeners();
    }
  }

  Future<void> retrySave() async {
    if (!ready || importing || loading) return;
    await _replace(journal);
  }

  /// Called only after the user agrees to discard the unsaved draft.
  Future<bool> reloadSaved() async {
    if (_loadInProgress || saving || importing) return false;
    _loadInProgress = true;
    loading = true;
    notifyListeners();
    try {
      final next = await repository.load();
      journal = next;
      analytics = JournalAnalytics(next);
      _revision = _savedRevision = 0;
      saveFailed = false;
      ready = true;
      error = null;
      return true;
    } catch (failure) {
      error = failure;
      return false;
    } finally {
      loading = false;
      _loadInProgress = false;
      notifyListeners();
    }
  }

  Future<bool> importJournal(Journal replacement) async {
    if (saving || importing || loading || hasUnsavedChanges) return false;
    importing = true;
    notifyListeners();
    try {
      await repository.restore(replacement);
      journal = replacement;
      analytics = JournalAnalytics(journal);
      ready = true;
      saveFailed = false;
      error = null;
      _revision++;
      _savedRevision = _revision;
      return true;
    } catch (failure) {
      error = failure;
      return false;
    } finally {
      importing = false;
      notifyListeners();
    }
  }

  void reportError(Object failure) {
    error = failure;
    notifyListeners();
  }

  void dismissError() {
    if (ready && !saveFailed) {
      error = null;
      notifyListeners();
    }
  }
}
