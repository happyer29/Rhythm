import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:rhythm/core/analytics.dart';
import 'package:rhythm/core/models.dart';
import 'package:rhythm/l10n.dart';
import 'package:rhythm/ui/dashboard.dart';
import 'package:rhythm/ui/theme.dart';

const _today = '2026-10-05';
const _english = Strings(AppLanguage.english);
const _chinese = Strings(AppLanguage.simplifiedChinese);

Journal _journal() => Journal(
  habits: [
    Habit(id: 'reading', title: 'Read a chapter', startDay: '2026-01-01'),
    Habit(
      id: 'focus',
      title: '专注工作 · A longer habit title',
      kind: HabitKind.duration,
      startDay: '2026-01-01',
      targetMinutes: 60,
    ),
  ],
  entries: [
    HabitEntry(habitID: 'reading', day: _today, checked: true),
    HabitEntry(habitID: 'focus', day: _today, minutes: 90),
  ],
);

Widget _host(Widget child, {double textScale = 1}) => MaterialApp(
  theme: RhythmTheme.data,
  home: Scaffold(
    body: MediaQuery(
      data: MediaQueryData(textScaler: TextScaler.linear(textScale)),
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: child,
      ),
    ),
  ),
);

class _CountingAnalytics extends JournalAnalytics {
  _CountingAnalytics(super.journal);
  int heatmapCalls = 0;
  @override
  HeatmapSnapshot heatmap(int year, {String? habitID, required String today}) {
    heatmapCalls++;
    return super.heatmap(year, habitID: habitID, today: today);
  }
}

void main() {
  setUpAll(() async {
    await initializeDateFormatting('en_US');
    await initializeDateFormatting('zh_CN');
  });

  testWidgets('dashboard fits phone, desktop, Chinese, and large text', (
    tester,
  ) async {
    final journal = _journal();
    final analytics = JournalAnalytics(journal);
    addTearDown(() => tester.view.resetPhysicalSize());
    addTearDown(() => tester.view.resetDevicePixelRatio());
    tester.view.devicePixelRatio = 1;
    for (final width in [320.0, 360.0, 1280.0]) {
      tester.view.physicalSize = Size(width, 900);
      for (final strings in [_english, _chinese]) {
        for (final scale in [1.0, 2.0]) {
          await tester.pumpWidget(
            _host(
              Column(
                children: [
                  DailyProgressPanel(
                    journal: journal,
                    day: _today,
                    strings: strings,
                  ),
                  const SizedBox(height: 20),
                  StatisticsPage(
                    journal: journal,
                    analytics: analytics,
                    today: _today,
                    selectedDay: _today,
                    strings: strings,
                    onSelectDay: (_) {},
                  ),
                ],
              ),
              textScale: scale,
            ),
          );
          await tester.pump();
          expect(
            tester.takeException(),
            isNull,
            reason: 'width=$width language=${strings.language} scale=$scale',
          );
        }
      }
    }
  });

  testWidgets('map reuses data across day changes and refreshes after edits', (
    tester,
  ) async {
    final journal = _journal();
    final analytics = _CountingAnalytics(journal);
    Widget build(JournalAnalytics source, String day) => _host(
      ActivityMap(
        analytics: source,
        habits: journal.habits,
        selectedDay: day,
        today: _today,
        strings: _english,
        onSelectDay: (_) {},
      ),
    );
    await tester.pumpWidget(build(analytics, _today));
    expect(analytics.heatmapCalls, 1);
    await tester.pumpWidget(build(analytics, '2026-10-04'));
    expect(analytics.heatmapCalls, 1);
    final edited = _CountingAnalytics(journal.copyWith(entries: []));
    await tester.pumpWidget(build(edited, '2026-10-04'));
    expect(edited.heatmapCalls, 1);
    expect(find.text('Active days: 0'), findsOneWidget);
    await tester.pumpWidget(build(edited, '2025-10-04'));
    expect(edited.heatmapCalls, 2);
    expect(find.text('2025'), findsOneWidget);
  });

  testWidgets('daily summary refreshes after edits and changing the day', (
    tester,
  ) async {
    Widget build(Journal journal, String day) => _host(
      DailyProgressPanel(journal: journal, day: day, strings: _english),
    );
    final journal = _journal();
    await tester.pumpWidget(build(journal, _today));
    expect(find.text('100'), findsOneWidget);
    expect(find.text('1 hr 30 min'), findsOneWidget);
    final edited = journal.copyWith(
      entries: [HabitEntry(habitID: 'focus', day: _today, minutes: 30)],
    );
    await tester.pumpWidget(build(edited, _today));
    expect(find.text('25'), findsOneWidget);
    expect(find.text('30 min'), findsOneWidget);
    expect(find.text('0 / 2'), findsOneWidget);
    await tester.pumpWidget(build(edited, '2026-10-04'));
    expect(find.text('00'), findsOneWidget);
    expect(find.text('0 min'), findsOneWidget);
  });

  testWidgets(
    'daily goals can hide archived habits while retaining logged time',
    (tester) async {
      final original = _journal();
      final journal = original.copyWith(
        habits: [
          original.habits.first,
          original.habits.last.copyWith(archivedOn: _today),
        ],
      );
      Widget build(bool includeArchived) => _host(
        DailyProgressPanel(
          journal: journal,
          day: _today,
          strings: _english,
          includeArchived: includeArchived,
        ),
      );

      await tester.pumpWidget(build(true));
      expect(find.text('2 / 2'), findsOneWidget);
      expect(find.text('1 hr 30 min'), findsOneWidget);
      await tester.pumpWidget(build(false));
      expect(find.text('1 / 1'), findsOneWidget);
      expect(find.text('1 hr 30 min'), findsOneWidget);
      await tester.pumpWidget(build(true));
      expect(find.text('2 / 2'), findsOneWidget);
    },
  );

  testWidgets('keyboard navigates days and cannot open the future', (
    tester,
  ) async {
    final journal = _journal();
    final selected = <String>[];
    await tester.pumpWidget(
      _host(
        ActivityMap(
          analytics: JournalAnalytics(journal),
          habits: journal.habits,
          selectedDay: _today,
          today: _today,
          strings: _english,
          onSelectDay: selected.add,
        ),
      ),
    );
    final focus = tester.widget<Focus>(
      find.byWidgetPredicate(
        (widget) =>
            widget is Focus && widget.focusNode?.debugLabel == 'Activity map',
      ),
    );
    focus.focusNode!.requestFocus();
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    expect(selected, [_today]);
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowUp);
    await tester.sendKeyEvent(LogicalKeyboardKey.space);
    expect(selected, [_today, '2026-10-04']);
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    expect(selected.last, '2026-09-27');
    expect(tester.takeException(), isNull);
  });

  testWidgets('painted days expose localized accessibility actions', (
    tester,
  ) async {
    final handle = tester.ensureSemantics();
    final journal = _journal();
    final selected = <String>[];
    await tester.pumpWidget(
      _host(
        ActivityMap(
          analytics: JournalAnalytics(journal),
          habits: journal.habits,
          selectedDay: _today,
          today: _today,
          strings: _chinese,
          onSelectDay: selected.add,
        ),
      ),
    );
    SemanticsOwner? semanticsOwner;
    tester.binding.rootPipelineOwner.visitChildren((owner) {
      semanticsOwner ??= owner.semanticsOwner;
    });
    final root = semanticsOwner!.rootSemanticsNode!;
    final days = <SemanticsNode>[];
    void collect(SemanticsNode node) {
      if (node.label.startsWith('2026年')) days.add(node);
      node.visitChildren((child) {
        collect(child);
        return true;
      });
    }

    collect(root);
    expect(days.length, 365);
    final today = days.singleWhere(
      (node) => node.label.startsWith('2026年10月5日'),
    );
    final future = days.singleWhere(
      (node) => node.label.startsWith('2026年10月6日'),
    );
    expect(today.getSemanticsData().hasAction(SemanticsAction.tap), isTrue);
    expect(future.getSemanticsData().hasAction(SemanticsAction.tap), isFalse);
    expect(future.label, contains('未来日期'));
    semanticsOwner!.performAction(today.id, SemanticsAction.tap);
    await tester.pump();
    expect(selected, [_today]);
    handle.dispose();
  });

  testWidgets('deleted filter falls back to all habits', (tester) async {
    final journal = _journal();
    Widget build(Journal value) => _host(
      ActivityMap(
        analytics: JournalAnalytics(value),
        habits: value.habits,
        selectedDay: _today,
        today: _today,
        strings: _english,
        onSelectDay: (_) {},
      ),
    );
    await tester.pumpWidget(build(journal));
    await tester.tap(find.byTooltip('Filter activity by habit'));
    await tester.pumpAndSettle();
    await tester.tap(
      find.byWidgetPredicate(
        (widget) =>
            widget is CheckedPopupMenuItem<String> && widget.value == 'READING',
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Read a chapter'), findsOneWidget);
    await tester.pumpWidget(build(Journal()));
    expect(find.text('All habits'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
