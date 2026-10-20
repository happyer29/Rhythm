import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:rhythm/core/models.dart';
import 'package:rhythm/l10n.dart';
import 'package:rhythm/ui/habit_card.dart';
import 'package:rhythm/ui/habit_editor.dart';

const _strings = Strings(AppLanguage.english);
const _id = 'C512C36D-CBB8-4B2E-B53E-4E6760F385E2';
const _day = '2026-01-05';

Habit _habit(HabitKind kind) => Habit(
  id: _id,
  title: 'Read and reflect',
  startDay: _day,
  kind: kind,
  options: kind == HabitKind.single || kind == HabitKind.multiple
      ? ['First', 'Second']
      : const [],
  targetMinutes: 60,
  targetNumber: 8,
);

Widget _app(Widget child) => MaterialApp(
  theme: ThemeData.dark(),
  localizationsDelegates: GlobalMaterialLocalizations.delegates,
  supportedLocales: const [Locale('en'), Locale('zh')],
  home: Scaffold(body: child),
);

Finder _field(String label) => find.byWidgetPredicate(
  (widget) => widget is TextField && widget.decoration?.labelText == label,
);

class _Harness extends StatefulWidget {
  const _Harness(this.habit, {this.enabled = true});
  final Habit habit;
  final bool enabled;
  @override
  State<_Harness> createState() => _HarnessState();
}

class _HarnessState extends State<_Harness> {
  late HabitEntry entry = HabitEntry(habitID: _id, day: _day);
  void replace(HabitEntry value) => setState(() => entry = value);
  @override
  Widget build(BuildContext context) => SingleChildScrollView(
    padding: const EdgeInsets.all(20),
    child: HabitCard(
      habit: widget.habit,
      entry: entry,
      strings: _strings,
      enabled: widget.enabled,
      onChanged: replace,
      onClear: () => replace(HabitEntry(habitID: _id, day: entry.day)),
      onEdit: () {},
    ),
  );
}

void main() {
  setUpAll(() async {
    await initializeDateFormatting();
  });

  testWidgets(
    'duration preserves drafts, clamps overflow, and follows external day changes',
    (tester) async {
      await tester.pumpWidget(_app(_Harness(_habit(HabitKind.duration))));
      final state = tester.state<_HarnessState>(find.byType(_Harness));
      await tester.enterText(_field('Hours'), '2');
      await tester.pump();
      await tester.enterText(_field('Minutes'), '05');
      await tester.pump();
      expect(state.entry.minutes, 125);
      expect(
        tester.widget<TextField>(_field('Minutes')).controller!.text,
        '05',
      );
      await tester.enterText(
        _field('Hours'),
        '99999999999999999999999999999999999',
      );
      await tester.pump();
      expect(state.entry.minutes, 999 * 60 + 5);
      expect(tester.widget<TextField>(_field('Hours')).controller!.text, '999');
      await tester.enterText(_field('Minutes'), '90');
      await tester.pump();
      expect(state.entry.minutes, 59999);
      state.replace(HabitEntry(habitID: _id, day: '2026-01-06'));
      await tester.pump();
      expect(tester.widget<TextField>(_field('Hours')).controller!.text, '');
      expect(tester.widget<TextField>(_field('Minutes')).controller!.text, '');
    },
  );

  testWidgets('number accepts decimal comma and never saves invalid drafts', (
    tester,
  ) async {
    await tester.pumpWidget(_app(_Harness(_habit(HabitKind.number))));
    final state = tester.state<_HarnessState>(find.byType(_Harness));
    await tester.enterText(_field('Value'), '2,50');
    await tester.pump();
    expect(state.entry.number, 2.5);
    expect(tester.widget<TextField>(_field('Value')).controller!.text, '2,50');
    await tester.enterText(_field('Value'), 'Infinity');
    await tester.pump();
    expect(state.entry.number, 2.5);
    expect(find.text('Enter a number from 0 to 1 billion.'), findsOneWidget);
    await tester.enterText(_field('Value'), '');
    await tester.pump();
    expect(state.entry.number, isNull);
  });

  testWidgets('text controller and selection survive journal rebuilds', (
    tester,
  ) async {
    await tester.pumpWidget(_app(_Harness(_habit(HabitKind.text))));
    final finder = _field('A note for this day');
    final controller = tester.widget<TextField>(finder).controller!;
    await tester.enterText(finder, 'Morning notes');
    await tester.pump();
    expect(tester.widget<TextField>(finder).controller, same(controller));
    expect(controller.selection.baseOffset, 'Morning notes'.length);
    expect(
      tester.state<_HarnessState>(find.byType(_Harness)).entry.text,
      'Morning notes',
    );
  });

  testWidgets('multiple choices can be toggled without closing the selector', (
    tester,
  ) async {
    await tester.pumpWidget(_app(_Harness(_habit(HabitKind.multiple))));
    final state = tester.state<_HarnessState>(find.byType(_Harness));
    await tester.tap(find.text('Choose options'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('First'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Second'));
    await tester.pumpAndSettle();
    expect(state.entry.selections, ['First', 'Second']);
    await tester.tap(find.text('First'));
    await tester.pumpAndSettle();
    expect(state.entry.selections, ['Second']);
    await tester.tap(find.text('Done'));
    await tester.pumpAndSettle();
    expect(find.text('Selected: 1'), findsOneWidget);
  });

  testWidgets(
    'every habit card fits a 360px phone and future input is disabled',
    (tester) async {
      tester.view.physicalSize = const Size(360, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      for (final kind in HabitKind.values) {
        await tester.pumpWidget(_app(_Harness(_habit(kind), enabled: false)));
        await tester.pump();
        expect(tester.takeException(), isNull, reason: kind.name);
        expect(find.text('Future days are read-only.'), findsOneWidget);
        for (final field in tester.widgetList<TextField>(
          find.byType(TextField),
        )) {
          expect(field.enabled, isFalse);
        }
      }
    },
  );

  testWidgets(
    'editing preserves type and earlier options while allowing additions',
    (tester) async {
      Habit? result;
      final original = _habit(HabitKind.multiple);
      await tester.pumpWidget(
        _app(
          Builder(
            builder: (context) => TextButton(
              onPressed: () async {
                result = await showHabitEditor(
                  context,
                  habit: original,
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
      expect(
        find.text('The entry type is fixed to preserve your history.'),
        findsOneWidget,
      );
      final numberButton = tester.widget<OutlinedButton>(
        find.ancestor(
          of: find.text('Number'),
          matching: find.byType(OutlinedButton),
        ),
      );
      expect(numberButton.onPressed, isNull);
      await tester.ensureVisible(_field('Additional options'));
      await tester.enterText(_field('Additional options'), 'Third');
      await tester.pump();
      await tester.tap(find.text('Save'));
      await tester.pumpAndSettle();
      expect(result!.id, original.id);
      expect(result!.kind, HabitKind.multiple);
      expect(result!.options, ['First', 'Second', 'Third']);
      expect(result!.startDay, original.startDay);
    },
  );

  testWidgets(
    'new phone editor rejects duplicate options and saves a valid new habit',
    (tester) async {
      tester.view.physicalSize = const Size(360, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      Habit? result;
      await tester.pumpWidget(
        _app(
          Builder(
            builder: (context) => TextButton(
              onPressed: () async {
                result = await showHabitEditor(
                  context,
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
      await tester.enterText(_field('Habit name'), 'Mood');
      await tester.tap(find.text('Single choice'));
      await tester.pump();
      await tester.ensureVisible(_field('Options'));
      await tester.enterText(_field('Options'), 'Calm\nCalm');
      await tester.pump();
      expect(find.text('Each option must be unique.'), findsOneWidget);
      expect(
        tester
            .widget<FilledButton>(
              find.widgetWithText(FilledButton, 'Create habit'),
            )
            .onPressed,
        isNull,
      );
      await tester.enterText(_field('Options'), 'Calm\nFocused');
      await tester.pump();
      await tester.tap(find.text('Create habit'));
      await tester.pumpAndSettle();
      expect(result!.title, 'Mood');
      expect(result!.options, ['Calm', 'Focused']);
      expect(result!.kind, HabitKind.single);
      expect(result!.id, matches(RegExp(r'^[A-F0-9-]{36}$')));
      expect(tester.takeException(), isNull);
    },
  );
}
