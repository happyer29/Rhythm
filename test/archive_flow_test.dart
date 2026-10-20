import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:rhythm/core/models.dart';
import 'package:rhythm/core/repository.dart';
import 'package:rhythm/main.dart';
import 'package:rhythm/store.dart';
import 'package:rhythm/ui/habit_card.dart';

const _id = 'C512C36D-CBB8-4B2E-B53E-4E6760F385E2';
const _otherID = '2DF1A8F2-7FB1-4B77-8BAA-19BC38D2B13C';
const _today = '2026-10-15';

Journal _journal() => Journal(
  habits: [
    Habit(
      id: _id,
      title: 'Learning',
      startDay: '2026-10-01',
      kind: HabitKind.duration,
      options: const ['Sample category A', 'Sample category B'],
      targetMinutes: 60,
    ),
    Habit(id: _otherID, title: 'Take a walk', startDay: '2026-10-01'),
  ],
  entries: [
    HabitEntry(
      habitID: _id,
      day: '2026-10-14',
      minutes: 40,
      sessions: const [HabitSession(topic: 'Sample category A', minutes: 40)],
    ),
    HabitEntry(
      habitID: _id,
      day: _today,
      minutes: 75,
      sessions: const [
        HabitSession(topic: 'Sample category A', minutes: 30),
        HabitSession(topic: 'Sample category B', minutes: 45),
      ],
    ),
    HabitEntry(habitID: _otherID, day: _today, checked: true),
  ],
);

Finder get _learningCard => find.byKey(const ValueKey('$_id/$_today'));

Future<void> _mount(WidgetTester tester, RhythmStore store) async {
  tester.view.physicalSize = const Size(1280, 1100);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await store.load();
  await tester.pumpWidget(RhythmApp(store: store));
  await tester.pumpAndSettle();
  addTearDown(() async {
    await tester.pumpWidget(const SizedBox.shrink());
    store.dispose();
  });
}

Future<void> _archiveFromJournal(WidgetTester tester) async {
  final actions = find.descendant(
    of: _learningCard,
    matching: find.byTooltip('Habit actions'),
  );
  await tester.ensureVisible(actions);
  await tester.tap(actions);
  await tester.pumpAndSettle();
  await tester.tap(find.text('Archive habit'));
  await tester.pumpAndSettle();
}

void main() {
  setUpAll(() async {
    await initializeDateFormatting('en_US');
  });

  testWidgets(
    'archive hides a recorded habit, and My habits restores its saved history',
    (tester) async {
      final original = _journal();
      final originalEntries = original.entries
          .map((entry) => entry.toJson())
          .toList();
      final backend = MemoryBackend()
        ..json = JournalRepository.encode(original);
      final store = RhythmStore(
        JournalRepository(backend),
        clock: () => DateTime(2026, 10, 15),
      );
      await _mount(tester, store);
      expect(_learningCard, findsOneWidget);

      await _archiveFromJournal(tester);
      expect(_learningCard, findsNothing);
      expect(store.dailyHabits.map((habit) => habit.id), [_otherID]);
      expect(
        find.text('“Learning” moved to the archive. History kept.'),
        findsOneWidget,
      );
      final archived = JournalRepository.decode(backend.json);
      expect(archived.habits.first.archivedOn, _today);
      expect(archived.habits.first.options, original.habits.first.options);
      expect(
        archived.entries.map((entry) => entry.toJson()).toList(),
        originalEntries,
      );
      expect(backend.revision, 1);

      await tester.tap(find.byKey(const ValueKey('nav-2')));
      await tester.pumpAndSettle();
      expect(find.text('Take a walk'), findsOneWidget);
      expect(find.text('Learning'), findsNothing);
      expect(find.text('Active (1)'), findsOneWidget);
      expect(find.text('Archive (1)'), findsOneWidget);
      expect(
        tester
            .widget<ChoiceChip>(
              find.byKey(const ValueKey('active-habits-filter')),
            )
            .selected,
        isTrue,
      );

      await tester.tap(find.byKey(const ValueKey('archived-habits-filter')));
      await tester.pumpAndSettle();
      expect(find.text('Learning'), findsOneWidget);
      expect(find.text('Take a walk'), findsNothing);
      expect(find.text('Archived · history kept'), findsOneWidget);
      await tester.tap(find.widgetWithText(TextButton, 'Restore'));
      await tester.pumpAndSettle();
      expect(find.text('Your archive is empty.'), findsOneWidget);
      expect(find.text('Archive (0)'), findsOneWidget);
      expect(find.text('Active (2)'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('active-habits-filter')));
      await tester.pumpAndSettle();
      expect(find.text('Learning'), findsOneWidget);
      expect(find.text('Take a walk'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('nav-0')));
      await tester.pumpAndSettle();
      expect(_learningCard, findsOneWidget);
      expect(
        tester.widget<HabitCard>(_learningCard).entry.toJson(),
        original.entry(_id, _today).toJson(),
      );

      // Reload the persisted snapshot through a new repository, as another
      // app session would, rather than relying only on the in-memory store.
      final reloaded = await JournalRepository(backend).load();
      expect(reloaded.habits.first.archivedOn, isNull);
      expect(
        reloaded.entries.map((entry) => entry.toJson()).toList(),
        originalEntries,
      );
      expect(backend.revision, 2);
      expect(store.hasUnsavedChanges, isFalse);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('Undo restores a habit archived from its daily card', (
    tester,
  ) async {
    final original = _journal();
    final backend = MemoryBackend()..json = JournalRepository.encode(original);
    final store = RhythmStore(
      JournalRepository(backend),
      clock: () => DateTime(2026, 10, 15),
    );
    await _mount(tester, store);
    await _archiveFromJournal(tester);
    expect(_learningCard, findsNothing);

    await tester.tap(find.widgetWithText(TextButton, 'Undo'));
    await tester.pumpAndSettle();
    expect(_learningCard, findsOneWidget);
    expect(store.archivedHabits, isEmpty);
    expect(JournalRepository.decode(backend.json).toJson(), original.toJson());
    expect(backend.revision, 2);
    expect(tester.takeException(), isNull);
  });
}
