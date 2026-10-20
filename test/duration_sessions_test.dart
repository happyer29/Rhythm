import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm/core/models.dart';
import 'package:rhythm/l10n.dart';
import 'package:rhythm/ui/habit_card.dart';
import 'package:rhythm/ui/habit_editor.dart';

const _strings = Strings(AppLanguage.english);
const _id = 'C512C36D-CBB8-4B2E-B53E-4E6760F385E2';
const _day = '2026-01-05';

Habit _habit() => Habit(
  id: _id,
  title: 'Learning',
  startDay: _day,
  kind: HabitKind.duration,
  options: ['Reading', 'Agents'],
  targetMinutes: 60,
);

HabitEntry _entry() => HabitEntry(
  habitID: _id,
  day: _day,
  minutes: 100,
  sessions: const [
    HabitSession(topic: 'Reading', minutes: 30),
    HabitSession(topic: 'Reading', minutes: 45),
    HabitSession(topic: 'Agents', minutes: 0),
  ],
);

Widget _app(Widget child) => MaterialApp(
  theme: ThemeData.dark(),
  home: Scaffold(body: child),
);

Finder _field(String label) => find.byWidgetPredicate(
  (widget) => widget is TextField && widget.decoration?.labelText == label,
);

class _Harness extends StatefulWidget {
  const _Harness({this.enabled = true});
  final bool enabled;
  @override
  State<_Harness> createState() => _HarnessState();
}

class _HarnessState extends State<_Harness> {
  Habit habit = _habit();
  HabitEntry entry = _entry();
  int saves = 0;
  @override
  Widget build(BuildContext context) => SingleChildScrollView(
    padding: const EdgeInsets.all(20),
    child: HabitCard(
      habit: habit,
      entry: entry,
      strings: _strings,
      enabled: widget.enabled,
      onChanged: (value) => setState(() => entry = value),
      onDurationSessionsChanged: (value, categories) => setState(() {
        entry = value;
        habit = habit.copyWith(options: categories);
        saves++;
      }),
      onClear: () {},
      onEdit: () {},
    ),
  );
}

void main() {
  testWidgets('repeated topics retain separate editable sessions on a phone', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(360, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(_app(const _Harness()));
    final state = tester.state<_HarnessState>(find.byType(_Harness));
    expect(find.text('Reading'), findsOneWidget);
    expect(find.text('30 min'), findsOneWidget);
    expect(find.text('45 min'), findsOneWidget);
    expect(find.text('Unassigned time'), findsOneWidget);
    expect(tester.takeException(), isNull);

    await tester.tap(find.byTooltip('Edit session 2'));
    await tester.pumpAndSettle();
    await tester.enterText(_field('Hours'), '1');
    await tester.enterText(_field('Minutes'), '10');
    await tester.tap(find.text('Save session'));
    await tester.pumpAndSettle();
    expect(state.entry.minutes, 125);
    expect(state.entry.unassignedMinutes, 25);
    expect(state.entry.sessions.map((session) => session.minutes), [30, 70, 0]);
    expect(tester.takeException(), isNull);

    await tester.tap(find.byTooltip('Delete session 1'));
    await tester.pumpAndSettle();
    expect(state.entry.minutes, 95);
    expect(state.entry.sessions.map((session) => session.topic), [
      'Reading',
      'Agents',
    ]);
    expect(state.entry.sessions.map((session) => session.minutes), [70, 0]);
    expect(state.entry.unassignedMinutes, 25);

    await tester.tap(find.text('Add session'));
    await tester.pumpAndSettle();
    await tester.enterText(_field('Minutes'), '15');
    await tester.tap(find.text('Save session'));
    await tester.pumpAndSettle();
    expect(state.entry.minutes, 110);
    expect(state.entry.sessions.map((session) => session.topic), [
      'Reading',
      'Agents',
      'Reading',
    ]);
    expect(state.entry.sessions.map((session) => session.minutes), [70, 0, 15]);
    expect(tester.takeException(), isNull);
  });

  testWidgets('new category and its session are saved together', (
    tester,
  ) async {
    await tester.pumpWidget(_app(const _Harness()));
    final state = tester.state<_HarnessState>(find.byType(_Harness));
    await tester.tap(find.text('Add session'));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(DropdownButtonFormField<int>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('+ New category').last);
    await tester.pumpAndSettle();
    await tester.enterText(_field('New category'), 'Café practice');
    await tester.enterText(_field('Hours'), '2');
    await tester.enterText(_field('Minutes'), '5');
    await tester.tap(find.text('Save session'));
    await tester.pumpAndSettle();
    expect(state.saves, 1);
    expect(state.habit.options, ['Reading', 'Agents', 'Café practice']);
    expect(state.entry.sessions.last.topic, 'Café practice');
    expect(state.entry.sessions.last.minutes, 125);
    expect(state.entry.minutes, 225);
    expect(state.entry.unassignedMinutes, 25);
  });

  testWidgets('unassigned time stays independent from categorized sessions', (
    tester,
  ) async {
    await tester.pumpWidget(_app(const _Harness()));
    final state = tester.state<_HarnessState>(find.byType(_Harness));
    await tester.ensureVisible(find.byTooltip('Edit unassigned time'));
    await tester.tap(find.byTooltip('Edit unassigned time'));
    await tester.pumpAndSettle();
    await tester.enterText(_field('Hours'), '1');
    await tester.enterText(_field('Minutes'), '0');
    await tester.tap(find.text('Save session'));
    await tester.pumpAndSettle();
    expect(state.entry.minutes, 135);
    expect(state.entry.unassignedMinutes, 60);
    expect(state.entry.sessions.map((session) => session.minutes), [30, 45, 0]);
    expect(state.habit.options, ['Reading', 'Agents']);
  });

  testWidgets('session duration validation and cancel do not save drafts', (
    tester,
  ) async {
    await tester.pumpWidget(_app(const _Harness()));
    final state = tester.state<_HarnessState>(find.byType(_Harness));
    await tester.tap(find.text('Add session'));
    await tester.pumpAndSettle();
    await tester.enterText(_field('Hours'), '999');
    await tester.enterText(_field('Minutes'), '59');
    await tester.pump();
    expect(
      find.text('The daily total cannot exceed 59,999 minutes.'),
      findsOneWidget,
    );
    expect(
      tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
      isNull,
    );
    await tester.enterText(_field('Minutes'), '99');
    await tester.pump();
    expect(find.text('Use 0–999 hours and 0–59 minutes.'), findsOneWidget);
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(state.saves, 0);
    expect(state.entry.minutes, 100);
  });

  testWidgets('future session editing and deletion are disabled', (
    tester,
  ) async {
    await tester.pumpWidget(_app(const _Harness(enabled: false)));
    expect(
      tester
          .widget<OutlinedButton>(
            find.widgetWithText(OutlinedButton, 'Add session'),
          )
          .onPressed,
      isNull,
    );
    for (final tooltip in [
      'Edit session 1',
      'Delete session 1',
      'Edit unassigned time',
    ]) {
      expect(
        tester
            .widget<IconButton>(
              find.byWidgetPredicate(
                (widget) => widget is IconButton && widget.tooltip == tooltip,
              ),
            )
            .onPressed,
        isNull,
      );
    }
  });

  testWidgets('duration settings preserve categories and permit additions', (
    tester,
  ) async {
    Habit? result;
    await tester.pumpWidget(
      _app(
        Builder(
          builder: (context) => TextButton(
            onPressed: () async {
              result = await showHabitEditor(
                context,
                habit: _habit(),
                initialDay: _day,
                strings: _strings,
              );
            },
            child: const Text('Open editor'),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Open editor'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(_field('Additional categories'));
    await tester.enterText(_field('Additional categories'), 'Reading');
    await tester.pump();
    expect(find.text('Each category must be unique.'), findsOneWidget);
    await tester.enterText(_field('Additional categories'), 'Programming');
    await tester.pump();
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();
    expect(result!.options, ['Reading', 'Agents', 'Programming']);
    expect(result!.kind, HabitKind.duration);
  });
}
