import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter/services.dart';

import '../core/analytics.dart';
import '../core/models.dart';
import '../l10n.dart';
import 'theme.dart';

class DailyProgressPanel extends StatefulWidget {
  const DailyProgressPanel({
    super.key,
    required this.journal,
    required this.day,
    required this.strings,
    this.includeArchived = true,
  });

  final Journal journal;
  final String day;
  final Strings strings;
  final bool includeArchived;

  @override
  State<DailyProgressPanel> createState() => _DailyProgressPanelState();
}

class _DailyProgressPanelState extends State<DailyProgressPanel> {
  Journal? _cachedJournal;
  String? _cachedDay;
  bool? _cachedIncludeArchived;
  double _progress = 0;
  int _total = 0, _completed = 0, _minutes = 0;

  void _prepare() {
    if (identical(_cachedJournal, widget.journal) &&
        _cachedDay == widget.day &&
        _cachedIncludeArchived == widget.includeArchived) {
      return;
    }
    _cachedJournal = widget.journal;
    _cachedDay = widget.day;
    _cachedIncludeArchived = widget.includeArchived;
    final entries = <String, HabitEntry>{};
    for (final entry in widget.journal.entries) {
      if (entry.day == widget.day) {
        entries.putIfAbsent(entry.habitID, () => entry);
      }
    }
    final habits = widget.journal.habitsOn(
      widget.day,
      includeArchived: widget.includeArchived,
    );
    _total = habits.length;
    _completed = 0;
    var sum = 0.0;
    for (final habit in habits) {
      final entry = entries[habit.id];
      final progress = entry == null ? 0.0 : habit.progress(entry);
      sum += progress;
      if (progress >= 1) _completed++;
    }
    _progress = _total == 0 ? 0 : (sum / _total).clamp(0.0, 1.0);
    _minutes = widget.journal.totalMinutes(day: widget.day);
  }

  @override
  Widget build(BuildContext context) {
    _prepare();
    final strings = widget.strings;
    final progress = _progress;
    final total = _total;
    final completed = _completed;
    final summary = total == 0
        ? strings.t('Create a habit to start tracking.', '创建习惯，开始记录。')
        : progress == 0
        ? strings.t('No entries for this day yet.', '这一天还没有记录。')
        : progress >= 1
        ? strings.t('All daily goals reached.', '已达成全部每日目标。')
        : strings.t('Progress toward this day’s goals.', '所选日期的目标进度。');

    final progressWidget = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Eyebrow(strings.t('01 / DAILY PROGRESS', '01 / 每日进度')),
        const SizedBox(height: 9),
        Semantics(
          label: strings.t('Daily progress', '每日进度'),
          value: '${(progress * 100).round()}%',
          child: ExcludeSemantics(
            child: FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerLeft,
              child: Row(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.baseline,
                textBaseline: TextBaseline.alphabetic,
                children: [
                  Text(
                    (progress * 100).round().toString().padLeft(2, '0'),
                    style: RhythmTheme.mono(
                      60,
                      weight: FontWeight.w300,
                    ).copyWith(letterSpacing: -4, height: 1.1),
                  ),
                  const SizedBox(width: 7),
                  Text(
                    '%',
                    style: RhythmTheme.mono(24, color: RhythmTheme.secondary),
                  ),
                ],
              ),
            ),
          ),
        ),
        const SizedBox(height: 14),
        ClipRect(
          child: LinearProgressIndicator(
            value: progress,
            minHeight: 3,
            backgroundColor: RhythmTheme.line,
            color: RhythmTheme.accent,
            semanticsLabel: strings.t('Goals reached', '目标完成比例'),
          ),
        ),
        const SizedBox(height: 12),
        Text(
          summary,
          style: const TextStyle(
            color: RhythmTheme.secondary,
            fontSize: 12,
            height: 1.5,
          ),
        ),
      ],
    );
    final detailWidget = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: _DailyMetric(
                value: '$completed / $total',
                label: strings.t('COMPLETED', '已完成'),
                icon: Icons.check,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _DailyMetric(
                value: strings.minutes(_minutes),
                label: strings.t('TIME LOGGED', '累计时长'),
                icon: Icons.schedule,
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        SizedBox(
          height: 110,
          width: double.infinity,
          child: RepaintBoundary(
            child: ExcludeSemantics(
              child: CustomPaint(painter: _TerrainPainter(progress)),
            ),
          ),
        ),
      ],
    );

    return Panel(
      padding: const EdgeInsets.all(23),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final narrow =
              constraints.maxWidth < 520 ||
              MediaQuery.textScalerOf(context).scale(14) > 20;
          if (narrow) {
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                progressWidget,
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 22),
                  child: Divider(),
                ),
                detailWidget,
              ],
            );
          }
          return Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(width: 218, child: progressWidget),
              Container(
                margin: const EdgeInsets.symmetric(horizontal: 26),
                color: RhythmTheme.line,
                width: 1,
                height: 158,
              ),
              Expanded(child: detailWidget),
            ],
          );
        },
      ),
    );
  }
}

class _DailyMetric extends StatelessWidget {
  const _DailyMetric({
    required this.value,
    required this.label,
    required this.icon,
  });
  final String value;
  final String label;
  final IconData icon;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 1),
            child: Icon(icon, size: 13, color: RhythmTheme.accent),
          ),
          const SizedBox(width: 7),
          Expanded(
            child: Text(
              label,
              style: RhythmTheme.mono(
                9,
                color: RhythmTheme.secondary,
              ).copyWith(letterSpacing: 0.7),
            ),
          ),
        ],
      ),
      const SizedBox(height: 9),
      Text(value, style: RhythmTheme.mono(23, weight: FontWeight.w300)),
    ],
  );
}

class _TerrainPainter extends CustomPainter {
  const _TerrainPainter(this.progress);
  final double progress;

  @override
  void paint(Canvas canvas, Size size) {
    Offset point(double u, double v) {
      final rise = math.exp(
        -math.pow(u - 0.2, 2) * 2.6 - math.pow(v + 0.15, 2) * 2.1,
      );
      final wave = math.sin(u * 4.1 + v * 1.8) * math.cos(v * 3 - u) * 0.12;
      final height = rise * (0.35 + progress * 0.45) + wave;
      return Offset(
        size.width * (0.5 + (u - v) * 0.235),
        size.height * (0.49 + (u + v) * 0.19 - height * 0.55),
      );
    }

    final paint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 0.55;
    const divisions = 18;
    for (var axis = 0; axis < 2; axis++) {
      for (var row = 0; row <= divisions; row++) {
        final fixed = row / divisions * 2 - 1;
        final path = Path();
        for (var step = 0; step <= 40; step++) {
          final moving = step / 40 * 2 - 1;
          final p = axis == 0 ? point(fixed, moving) : point(moving, fixed);
          if (step == 0) {
            path.moveTo(p.dx, p.dy);
          } else {
            path.lineTo(p.dx, p.dy);
          }
        }
        paint.color = RhythmTheme.ink.withValues(
          alpha: row % 3 == 0 ? 0.36 : 0.16,
        );
        canvas.drawPath(path, paint);
      }
    }
    paint
      ..style = PaintingStyle.fill
      ..color = RhythmTheme.ink.withValues(alpha: 0.6);
    for (var row = 0; row <= divisions; row += 3) {
      for (var column = 0; column <= divisions; column += 3) {
        canvas.drawRect(
          Rect.fromCenter(
            center: point(row / divisions * 2 - 1, column / divisions * 2 - 1),
            width: 1.4,
            height: 1.4,
          ),
          paint,
        );
      }
    }
    paint.color = RhythmTheme.accent;
    canvas.drawRect(
      Rect.fromCenter(center: point(0.2, -0.15), width: 4, height: 4),
      paint,
    );
    paint
      ..color = RhythmTheme.line
      ..strokeWidth = 0.5;
    for (var x = size.width * 0.07; x < size.width * 0.93; x += 6) {
      canvas.drawLine(
        Offset(x, size.height * 0.95),
        Offset(x + 2, size.height * 0.95),
        paint,
      );
    }
  }

  @override
  bool shouldRepaint(covariant _TerrainPainter oldDelegate) =>
      oldDelegate.progress != progress;
}

class ActivityMap extends StatefulWidget {
  const ActivityMap({
    super.key,
    required this.analytics,
    required this.habits,
    required this.selectedDay,
    required this.today,
    required this.strings,
    required this.onSelectDay,
  });

  final JournalAnalytics analytics;
  final List<Habit> habits;
  final String selectedDay;
  final String today;
  final Strings strings;
  final ValueChanged<String> onSelectDay;

  @override
  State<ActivityMap> createState() => _ActivityMapState();
}

class _ActivityMapState extends State<ActivityMap> {
  late int _year;
  String? _filter;
  HeatmapSnapshot? _snapshot;
  JournalAnalytics? _cachedAnalytics;
  int? _cachedYear;
  String? _cachedFilter;
  String? _cachedToday;

  @override
  void initState() {
    super.initState();
    _year = DayKey.year(widget.selectedDay);
  }

  @override
  void didUpdateWidget(covariant ActivityMap oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (DayKey.year(widget.selectedDay) != DayKey.year(oldWidget.selectedDay)) {
      _year = DayKey.year(widget.selectedDay);
    }
    if (_filter != null && !widget.habits.any((h) => h.id == _filter)) {
      _filter = null;
    }
  }

  HeatmapSnapshot get snapshot {
    if (_snapshot == null ||
        !identical(_cachedAnalytics, widget.analytics) ||
        _cachedYear != _year ||
        _cachedFilter != _filter ||
        _cachedToday != widget.today) {
      _snapshot = widget.analytics.heatmap(
        _year,
        habitID: _filter,
        today: widget.today,
      );
      _cachedAnalytics = widget.analytics;
      _cachedYear = _year;
      _cachedFilter = _filter;
      _cachedToday = widget.today;
    }
    return _snapshot!;
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.strings;
    final map = snapshot;
    var filterLabel = s.t('All habits', '全部习惯');
    for (final habit in widget.habits) {
      if (habit.id == _filter) {
        filterLabel = habit.title;
        break;
      }
    }
    final filterButton = PopupMenuButton<String>(
      tooltip: s.t('Filter activity by habit', '按习惯筛选活动'),
      initialValue: _filter ?? '',
      onSelected: (value) =>
          setState(() => _filter = value.isEmpty ? null : value),
      itemBuilder: (context) => [
        CheckedPopupMenuItem(
          value: '',
          checked: _filter == null,
          child: Text(s.t('All habits', '全部习惯')),
        ),
        for (final habit in widget.habits)
          CheckedPopupMenuItem(
            value: habit.id,
            checked: _filter == habit.id,
            child: Text(habit.title),
          ),
      ],
      child: Container(
        constraints: const BoxConstraints(maxWidth: 190, minHeight: 44),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Flexible(
              child: Text(
                filterLabel,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: RhythmTheme.mono(11, color: RhythmTheme.secondary),
              ),
            ),
            const SizedBox(width: 8),
            const Icon(
              Icons.keyboard_arrow_down,
              size: 16,
              color: RhythmTheme.secondary,
            ),
          ],
        ),
      ),
    );
    final yearControl = DecoratedBox(
      decoration: BoxDecoration(
        border: Border.all(color: RhythmTheme.line),
        borderRadius: BorderRadius.circular(3),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          IconButton(
            tooltip: s.t('Previous year', '上一年'),
            icon: const Icon(Icons.chevron_left, size: 17),
            onPressed: _year > 1970 ? () => setState(() => _year--) : null,
          ),
          Text('$_year', style: RhythmTheme.mono(12, weight: FontWeight.w500)),
          IconButton(
            tooltip: s.t('Next year', '下一年'),
            icon: const Icon(Icons.chevron_right, size: 17),
            onPressed: _year < DayKey.year(widget.today)
                ? () => setState(() => _year++)
                : null,
          ),
        ],
      ),
    );

    return Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          LayoutBuilder(
            builder: (context, constraints) {
              final title = Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    s.t('Activity map', '活动图'),
                    style: const TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Eyebrow(s.t('DAY BY DAY / ALL YEAR', '日积月累 / 全年概览')),
                ],
              );
              if (constraints.maxWidth < 610 ||
                  MediaQuery.textScalerOf(context).scale(14) > 20) {
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    title,
                    const SizedBox(height: 12),
                    Wrap(
                      spacing: 10,
                      runSpacing: 8,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [filterButton, yearControl],
                    ),
                  ],
                );
              }
              return Row(
                children: [
                  Expanded(child: title),
                  filterButton,
                  const SizedBox(width: 10),
                  yearControl,
                ],
              );
            },
          ),
          const SizedBox(height: 17),
          const Divider(),
          const SizedBox(height: 18),
          _HeatmapGrid(
            snapshot: map,
            selectedDay: widget.selectedDay,
            today: widget.today,
            strings: s,
            onSelectDay: widget.onSelectDay,
          ),
          const SizedBox(height: 14),
          Wrap(
            spacing: 24,
            runSpacing: 12,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(width: 4, height: 4, color: RhythmTheme.accent),
                  const SizedBox(width: 8),
                  Flexible(
                    child: Text(
                      s.t(
                        'Active days: ${map.activeDays}',
                        '活跃天数：${map.activeDays}',
                      ),
                      style: RhythmTheme.mono(11),
                    ),
                  ),
                  Text(
                    ' / $_year',
                    style: RhythmTheme.mono(11, color: RhythmTheme.secondary),
                  ),
                ],
              ),
              Semantics(
                label: s.t(
                  'Darker cells mean less progress; brighter cells mean more progress.',
                  '颜色越暗进度越低，颜色越亮进度越高。',
                ),
                child: ExcludeSemantics(
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        s.t('LESS', '较少'),
                        style: RhythmTheme.mono(
                          9,
                          color: RhythmTheme.secondary,
                        ),
                      ),
                      const SizedBox(width: 7),
                      for (final score in [0.0, 0.1, 0.35, 0.65, 1.0])
                        Container(
                          margin: const EdgeInsets.only(right: 3),
                          width: 10,
                          height: 10,
                          color: RhythmTheme.heat(score),
                        ),
                      const SizedBox(width: 4),
                      Text(
                        s.t('MORE', '较多'),
                        style: RhythmTheme.mono(
                          9,
                          color: RhythmTheme.secondary,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          Text(
            s.t(
              'Select a day to open its entries. Brightness shows average progress toward that day’s goals.',
              '选择日期查看记录。颜色亮度代表当天习惯的平均目标完成进度。',
            ),
            style: const TextStyle(
              color: RhythmTheme.secondary,
              fontSize: 12,
              height: 1.5,
            ),
          ),
        ],
      ),
    );
  }
}

/// One painted surface instead of hundreds of independently built day buttons.
/// CustomPainter semantics retain an accessible button for every valid day.
class _HeatmapGrid extends StatefulWidget {
  const _HeatmapGrid({
    required this.snapshot,
    required this.selectedDay,
    required this.today,
    required this.strings,
    required this.onSelectDay,
  });
  final HeatmapSnapshot snapshot;
  final String selectedDay;
  final String today;
  final Strings strings;
  final ValueChanged<String> onSelectDay;

  @override
  State<_HeatmapGrid> createState() => _HeatmapGridState();
}

class _HeatmapGridState extends State<_HeatmapGrid> {
  final _focus = FocusNode(debugLabel: 'Activity map');
  final _scroll = ScrollController();
  String? _hoveredDay;
  String? _keyboardDay;
  bool _focused = false;
  late Map<String, String> _labels;
  late Map<String, HeatmapDay> _days;

  @override
  void initState() {
    super.initState();
    _prepare();
  }

  @override
  void didUpdateWidget(covariant _HeatmapGrid oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.snapshot, widget.snapshot) ||
        oldWidget.strings.language != widget.strings.language) {
      _prepare();
      _hoveredDay = null;
      _keyboardDay = null;
    }
    if (oldWidget.selectedDay != widget.selectedDay) {
      _keyboardDay = widget.selectedDay;
    }
  }

  void _prepare() {
    _days = {
      for (final week in widget.snapshot.weeks)
        for (final day in week)
          if (day.isInYear) day.day: day,
    };
    _labels = {
      for (final day in _days.values)
        day.day:
            '${widget.strings.dayLabel(day.day)} · '
            '${day.isFuture ? widget.strings.t('Future day', '未来日期') : '${(day.progress * 100).round()}% · ${widget.strings.minutes(day.minutes)}'}',
    };
  }

  @override
  void dispose() {
    _focus.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _select(String day) {
    if (_days[day]?.isFuture != false) return;
    _focus.requestFocus();
    setState(() => _keyboardDay = day);
    widget.onSelectDay(day);
  }

  KeyEventResult _onKey(
    FocusNode node,
    KeyEvent event,
    _HeatmapGeometry geometry,
  ) {
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) {
      return KeyEventResult.ignored;
    }
    final key = event.logicalKey;
    var current = _keyboardDay ?? widget.selectedDay;
    if (_days[current]?.isFuture != false) {
      current = _days.values.where((d) => !d.isFuture).lastOrNull?.day ?? '';
    }
    if (current.isEmpty) return KeyEventResult.ignored;
    if (key == LogicalKeyboardKey.enter || key == LogicalKeyboardKey.space) {
      _select(current);
      return KeyEventResult.handled;
    }
    final delta = key == LogicalKeyboardKey.arrowLeft
        ? -7
        : key == LogicalKeyboardKey.arrowRight
        ? 7
        : key == LogicalKeyboardKey.arrowUp
        ? -1
        : key == LogicalKeyboardKey.arrowDown
        ? 1
        : 0;
    String next;
    if (delta != 0) {
      next = DayKey.add(current, delta);
    } else if (key == LogicalKeyboardKey.home) {
      next = _days.values.where((d) => !d.isFuture).first.day;
    } else if (key == LogicalKeyboardKey.end) {
      next = _days.values.where((d) => !d.isFuture).last.day;
    } else {
      return KeyEventResult.ignored;
    }
    if (_days[next]?.isFuture == false) {
      setState(() => _keyboardDay = next);
      _revealDay(next, geometry);
    }
    return KeyEventResult.handled;
  }

  void _revealDay(String day, _HeatmapGeometry geometry) {
    if (!_scroll.hasClients) return;
    final rect = geometry.rectForDay(day);
    if (rect == null) return;
    final viewport = _scroll.position.viewportDimension;
    final start = _scroll.offset;
    final target = rect.left < start
        ? rect.left - 8
        : rect.right > start + viewport
        ? rect.right - viewport + 8
        : start;
    _scroll.jumpTo(target.clamp(0.0, _scroll.position.maxScrollExtent));
  }

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final geometry = _HeatmapGeometry(widget.snapshot, constraints.maxWidth);
      final highlighted =
          _hoveredDay ?? (_focused ? _keyboardDay ?? widget.selectedDay : null);
      final hoverLabel = _labels[highlighted];
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Scrollbar(
            controller: _scroll,
            thumbVisibility: geometry.width > constraints.maxWidth,
            child: SingleChildScrollView(
              controller: _scroll,
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.only(bottom: 12),
              child: Focus(
                focusNode: _focus,
                onFocusChange: (value) => setState(() => _focused = value),
                onKeyEvent: (node, event) => _onKey(node, event, geometry),
                child: MouseRegion(
                  cursor: _days[_hoveredDay]?.isFuture == false
                      ? SystemMouseCursors.click
                      : SystemMouseCursors.basic,
                  onExit: (_) => setState(() => _hoveredDay = null),
                  onHover: (event) {
                    final day = geometry.dayAt(event.localPosition)?.day;
                    if (_hoveredDay != day) setState(() => _hoveredDay = day);
                  },
                  child: Tooltip(
                    message:
                        hoverLabel ?? widget.strings.t('Activity map', '活动图'),
                    excludeFromSemantics: true,
                    waitDuration: const Duration(milliseconds: 350),
                    child: GestureDetector(
                      behavior: HitTestBehavior.opaque,
                      onTapUp: (details) {
                        final day = geometry.dayAt(details.localPosition);
                        if (day != null) _select(day.day);
                      },
                      child: RepaintBoundary(
                        child: CustomPaint(
                          size: Size(geometry.width, geometry.height),
                          painter: _HeatmapPainter(
                            geometry: geometry,
                            strings: widget.strings,
                            labels: _labels,
                            selectedDay: widget.selectedDay,
                            today: widget.today,
                            highlightedDay: highlighted,
                            focused: _focused,
                            onSelectDay: _select,
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
          if (_focused && hoverLabel != null)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                hoverLabel,
                style: RhythmTheme.mono(10, color: RhythmTheme.secondary),
              ),
            ),
        ],
      );
    },
  );
}

class _HeatmapGeometry {
  _HeatmapGeometry(this.snapshot, double availableWidth) {
    final count = snapshot.weeks.length;
    side = ((availableWidth - gutter - (count - 1) * gap) / count).clamp(
      9.0,
      13.0,
    );
    width = math.max(availableWidth, gutter + count * (side + gap) - gap);
  }
  final HeatmapSnapshot snapshot;
  static const gutter = 36.0;
  static const top = 24.0;
  static const gap = 3.0;
  late final double side;
  late final double width;
  double get height => top + 7 * (side + gap) - gap + 3;

  Rect rect(int week, int row) => Rect.fromLTWH(
    gutter + week * (side + gap),
    top + row * (side + gap),
    side,
    side,
  );

  Rect? rectForDay(String day) {
    for (var week = 0; week < snapshot.weeks.length; week++) {
      for (var row = 0; row < snapshot.weeks[week].length; row++) {
        if (snapshot.weeks[week][row].day == day) return rect(week, row);
      }
    }
    return null;
  }

  HeatmapDay? dayAt(Offset position) {
    if (position.dx < gutter || position.dy < top) return null;
    final week = ((position.dx - gutter) / (side + gap)).floor();
    final row = ((position.dy - top) / (side + gap)).floor();
    if (week < 0 ||
        week >= snapshot.weeks.length ||
        row < 0 ||
        row >= snapshot.weeks[week].length) {
      return null;
    }
    if (!rect(week, row).inflate(gap / 2).contains(position)) return null;
    final day = snapshot.weeks[week][row];
    return day.isInYear ? day : null;
  }
}

class _HeatmapPainter extends CustomPainter {
  _HeatmapPainter({
    required this.geometry,
    required this.strings,
    required this.labels,
    required this.selectedDay,
    required this.today,
    required this.highlightedDay,
    required this.focused,
    required this.onSelectDay,
  });
  final _HeatmapGeometry geometry;
  final Strings strings;
  final Map<String, String> labels;
  final String selectedDay;
  final String today;
  final String? highlightedDay;
  final bool focused;
  final ValueChanged<String> onSelectDay;

  void _label(Canvas canvas, String text, Offset position) {
    final textPainter = TextPainter(
      text: TextSpan(
        text: text,
        style: RhythmTheme.mono(9, color: RhythmTheme.secondary),
      ),
      textDirection: TextDirection.ltr,
      maxLines: 1,
    )..layout();
    textPainter.paint(canvas, position);
  }

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint();
    final monthPositions = <int, int>{};
    for (var week = 0; week < geometry.snapshot.weeks.length; week++) {
      final days = geometry.snapshot.weeks[week];
      for (var row = 0; row < days.length; row++) {
        final day = days[row];
        if (!day.isInYear) continue;
        final month = int.parse(day.day.substring(5, 7));
        monthPositions.putIfAbsent(month, () => week);
        final rect = geometry.rect(week, row);
        paint
          ..style = PaintingStyle.fill
          ..color = RhythmTheme.heat(
            day.progress,
          ).withValues(alpha: day.isFuture ? 0.35 : 1);
        canvas.drawRRect(
          RRect.fromRectAndRadius(rect, const Radius.circular(1)),
          paint,
        );
        if (day.day == selectedDay ||
            day.day == highlightedDay ||
            day.day == today) {
          paint
            ..style = PaintingStyle.stroke
            ..strokeWidth = 1
            ..color = day.day == selectedDay
                ? RhythmTheme.ink
                : day.day == highlightedDay
                ? RhythmTheme.ink.withValues(alpha: 0.65)
                : RhythmTheme.accent;
          canvas.drawRRect(
            RRect.fromRectAndRadius(
              rect.inflate(0.5),
              const Radius.circular(1),
            ),
            paint,
          );
        }
      }
    }
    for (final month in monthPositions.entries) {
      _label(
        canvas,
        strings.month(month.key),
        Offset(
          _HeatmapGeometry.gutter +
              month.value * (geometry.side + _HeatmapGeometry.gap),
          0,
        ),
      );
    }
    for (final row in [0, 2, 4]) {
      _label(
        canvas,
        strings.weekday(row + 1),
        Offset(
          0,
          _HeatmapGeometry.top +
              row * (geometry.side + _HeatmapGeometry.gap) -
              1,
        ),
      );
    }
  }

  @override
  SemanticsBuilderCallback get semanticsBuilder =>
      (size) => [
        for (var week = 0; week < geometry.snapshot.weeks.length; week++)
          for (var row = 0; row < geometry.snapshot.weeks[week].length; row++)
            if (geometry.snapshot.weeks[week][row].isInYear)
              _semantics(
                geometry.snapshot.weeks[week][row],
                geometry.rect(week, row),
              ),
      ];

  CustomPainterSemantics _semantics(HeatmapDay day, Rect rect) =>
      CustomPainterSemantics(
        key: ValueKey(day.day),
        rect: rect,
        properties: SemanticsProperties(
          label: labels[day.day],
          textDirection: TextDirection.ltr,
          button: true,
          enabled: !day.isFuture,
          selected: day.day == selectedDay,
          focused: focused && day.day == highlightedDay,
          onTap: day.isFuture ? null : () => onSelectDay(day.day),
        ),
      );

  @override
  bool shouldRepaint(covariant _HeatmapPainter oldDelegate) =>
      !identical(oldDelegate.geometry.snapshot, geometry.snapshot) ||
      oldDelegate.geometry.width != geometry.width ||
      oldDelegate.strings.language != strings.language ||
      oldDelegate.selectedDay != selectedDay ||
      oldDelegate.today != today ||
      oldDelegate.highlightedDay != highlightedDay ||
      oldDelegate.focused != focused;

  @override
  bool shouldRebuildSemantics(covariant _HeatmapPainter oldDelegate) =>
      !identical(oldDelegate.geometry.snapshot, geometry.snapshot) ||
      oldDelegate.geometry.width != geometry.width ||
      oldDelegate.strings.language != strings.language ||
      oldDelegate.selectedDay != selectedDay ||
      oldDelegate.focused != focused ||
      (focused && oldDelegate.highlightedDay != highlightedDay);
}

class StatisticsPage extends StatefulWidget {
  const StatisticsPage({
    super.key,
    required this.journal,
    required this.analytics,
    required this.today,
    required this.selectedDay,
    required this.strings,
    required this.onSelectDay,
  });
  final Journal journal;
  final JournalAnalytics analytics;
  final String today;
  final String selectedDay;
  final Strings strings;
  final ValueChanged<String> onSelectDay;

  @override
  State<StatisticsPage> createState() => _StatisticsPageState();
}

class _StatisticsPageState extends State<StatisticsPage> {
  StatisticsSnapshot? _snapshot;
  JournalAnalytics? _cachedAnalytics;
  String? _cachedToday;

  StatisticsSnapshot get snapshot {
    if (_snapshot == null ||
        !identical(_cachedAnalytics, widget.analytics) ||
        _cachedToday != widget.today) {
      _snapshot = widget.analytics.statistics(widget.today);
      _cachedAnalytics = widget.analytics;
      _cachedToday = widget.today;
    }
    return _snapshot!;
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.strings;
    final stats = snapshot;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Eyebrow(s.t('ANALYTICS / OVERVIEW', '统计 / 总览')),
        const SizedBox(height: 12),
        Text(
          s.t('A record of progress.', '每一步，都有记录。'),
          style: const TextStyle(
            fontSize: 32,
            fontWeight: FontWeight.w300,
            letterSpacing: -1.1,
          ),
        ),
        const SizedBox(height: 9),
        Text(
          s.t(
            'Days, time and consistency, all in one place.',
            '天数、时长与坚持，一目了然。',
          ),
          style: const TextStyle(
            color: RhythmTheme.secondary,
            fontSize: 13,
            height: 1.5,
          ),
        ),
        const SizedBox(height: 25),
        LayoutBuilder(
          builder: (context, constraints) {
            final largeText = MediaQuery.textScalerOf(context).scale(14) > 20;
            final columns = constraints.maxWidth >= 680 && !largeText
                ? 3
                : constraints.maxWidth >= 440 && !largeText
                ? 2
                : 1;
            final width = (constraints.maxWidth - (columns - 1) * 12) / columns;
            return Wrap(
              spacing: 12,
              runSpacing: 12,
              children: [
                SizedBox(
                  width: width,
                  child: _StatCard(
                    value: '${stats.activeDays}',
                    label: s.t('ACTIVE DAYS', '活跃天数'),
                    detail: s.t('All time', '全部时间'),
                    icon: Icons.calendar_today_outlined,
                  ),
                ),
                SizedBox(
                  width: width,
                  child: _StatCard(
                    value: '${stats.streak}',
                    label: s.t('DAY STREAK', '连续天数'),
                    detail: s.t('At least one entry per day', '每天至少一条记录'),
                    icon: Icons.loop,
                  ),
                ),
                SizedBox(
                  width: width,
                  child: _StatCard(
                    value: s.minutes(stats.totalMinutes),
                    label: s.t('TIME LOGGED', '累计时长'),
                    detail: s.t('Across all habits', '所有习惯合计'),
                    icon: Icons.schedule,
                  ),
                ),
              ],
            );
          },
        ),
        const SizedBox(height: 24),
        ActivityMap(
          analytics: widget.analytics,
          habits: widget.journal.habits,
          selectedDay: widget.selectedDay,
          today: widget.today,
          strings: s,
          onSelectDay: widget.onSelectDay,
        ),
        const SizedBox(height: 28),
        Wrap(
          spacing: 20,
          runSpacing: 8,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            Text(
              s.t('By habit', '按习惯查看'),
              style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w500),
            ),
            Eyebrow(
              s.t(
                'HABITS: ${stats.habits.length}',
                '习惯：${stats.habits.length}',
              ),
            ),
          ],
        ),
        const SizedBox(height: 15),
        if (stats.habits.isEmpty)
          Panel(
            child: SizedBox(
              width: double.infinity,
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 24),
                child: Column(
                  children: [
                    const Icon(
                      Icons.insights_outlined,
                      color: RhythmTheme.secondary,
                      size: 26,
                    ),
                    const SizedBox(height: 13),
                    Text(
                      s.t(
                        'Results appear after your first entries.',
                        '添加记录后，即可查看统计结果。',
                      ),
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        color: RhythmTheme.secondary,
                        height: 1.5,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          )
        else
          Panel(
            padding: EdgeInsets.zero,
            child: Column(
              children: [
                for (var i = 0; i < stats.habits.length; i++) ...[
                  if (i > 0) const Divider(),
                  _HabitResult(result: stats.habits[i], strings: s),
                ],
              ],
            ),
          ),
      ],
    );
  }
}

class _StatCard extends StatelessWidget {
  const _StatCard({
    required this.value,
    required this.label,
    required this.detail,
    required this.icon,
  });
  final String value;
  final String label;
  final String detail;
  final IconData icon;

  @override
  Widget build(BuildContext context) => Panel(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(child: Eyebrow(label)),
            const SizedBox(width: 8),
            Icon(icon, size: 15, color: RhythmTheme.secondary),
          ],
        ),
        const SizedBox(height: 18),
        Text(
          value,
          style: RhythmTheme.mono(
            32,
            weight: FontWeight.w300,
          ).copyWith(letterSpacing: -1),
        ),
        const SizedBox(height: 14),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              margin: const EdgeInsets.only(top: 5),
              width: 3,
              height: 3,
              color: RhythmTheme.accent,
            ),
            const SizedBox(width: 7),
            Expanded(
              child: Text(
                detail,
                style: const TextStyle(
                  color: RhythmTheme.secondary,
                  fontSize: 11,
                  height: 1.4,
                ),
              ),
            ),
          ],
        ),
      ],
    ),
  );
}

class _HabitResult extends StatelessWidget {
  const _HabitResult({required this.result, required this.strings});
  final HabitStatistics result;
  final Strings strings;

  @override
  Widget build(BuildContext context) {
    final habit = result.habit;
    final title = Row(
      children: [
        Container(
          width: 36,
          height: 36,
          decoration: BoxDecoration(
            color: RhythmTheme.canvas,
            borderRadius: BorderRadius.circular(3),
            border: Border.all(color: RhythmTheme.line),
          ),
          child: Icon(
            RhythmTheme.iconFor(habit.symbol),
            size: 17,
            color: RhythmTheme.ink,
          ),
        ),
        const SizedBox(width: 13),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                habit.title,
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w500,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                '${strings.kind(habit.kind)}${habit.archivedOn == null ? '' : strings.t(' · archived', ' · 已归档')}',
                style: RhythmTheme.mono(10, color: RhythmTheme.secondary),
              ),
            ],
          ),
        ),
      ],
    );
    final metrics = [
      _HabitMetric('${result.recordedDays}', strings.t('DAYS LOGGED', '记录天数')),
      _HabitMetric(
        '${result.completedDays}',
        strings.t('COMPLETED', '已完成'),
        accent: true,
      ),
      if (habit.kind == HabitKind.duration)
        _HabitMetric(
          strings.minutes(result.totalMinutes),
          strings.t('TIME', '时长'),
        ),
    ];
    return Padding(
      padding: const EdgeInsets.all(18),
      child: LayoutBuilder(
        builder: (context, constraints) {
          if (constraints.maxWidth < 620 ||
              MediaQuery.textScalerOf(context).scale(14) > 20) {
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                title,
                const SizedBox(height: 18),
                Wrap(spacing: 25, runSpacing: 14, children: metrics),
              ],
            );
          }
          return Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Expanded(child: title),
              const SizedBox(width: 24),
              for (final metric in metrics)
                Padding(
                  padding: const EdgeInsets.only(left: 22),
                  child: metric,
                ),
            ],
          );
        },
      ),
    );
  }
}

class _HabitMetric extends StatelessWidget {
  const _HabitMetric(this.value, this.label, {this.accent = false});
  final String value;
  final String label;
  final bool accent;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        value,
        style: RhythmTheme.mono(
          18,
          weight: FontWeight.w300,
          color: accent ? RhythmTheme.accent : RhythmTheme.ink,
        ),
      ),
      const SizedBox(height: 6),
      Text(label, style: RhythmTheme.mono(9, color: RhythmTheme.secondary)),
    ],
  );
}
