import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:uuid/uuid.dart';

import '../core/models.dart';
import '../l10n.dart';
import 'theme.dart';

Future<Habit?> showHabitEditor(
  BuildContext context, {
  Habit? habit,
  required String initialDay,
  required Strings strings,
}) => showDialog<Habit>(
  context: context,
  builder: (_) =>
      _HabitEditor(habit: habit, initialDay: initialDay, strings: strings),
);

class _HabitEditor extends StatefulWidget {
  const _HabitEditor({
    this.habit,
    required this.initialDay,
    required this.strings,
  });
  final Habit? habit;
  final String initialDay;
  final Strings strings;

  @override
  State<_HabitEditor> createState() => _HabitEditorState();
}

class _HabitEditorState extends State<_HabitEditor> {
  final _title = TextEditingController();
  final _note = TextEditingController();
  final _options = TextEditingController();
  final _goalMinutes = TextEditingController(text: '30');
  final _goalNumber = TextEditingController(text: '8');
  final _unit = TextEditingController();
  HabitKind _kind = HabitKind.check;
  String _color = 'F34B3F';
  String _symbol = 'waveform.path';
  late String _startDay;
  static const _palette = [
    'F34B3F',
    'D8E1E5',
    '6DADB5',
    'C7A778',
    'A796C2',
    '87A493',
  ];
  static const _symbols = [
    'waveform.path',
    'book.closed',
    'figure.mind.and.body',
    'sun.max',
    'drop',
    'moon',
    'heart',
    'pencil',
    'figure.walk',
    'cup.and.saucer',
    'brain.head.profile',
    'music.note',
  ];

  Strings get s => widget.strings;
  bool get editing => widget.habit != null;
  bool get isChoice => _kind == HabitKind.single || _kind == HabitKind.multiple;
  bool get isDuration => _kind == HabitKind.duration;
  List<TextEditingController> get _controllers => [
    _title,
    _note,
    _options,
    _goalMinutes,
    _goalNumber,
    _unit,
  ];

  @override
  void initState() {
    super.initState();
    final today = DayKey.today();
    _startDay =
        DayKey.valid(widget.initialDay) &&
            widget.initialDay.compareTo(today) <= 0
        ? widget.initialDay
        : today;
    final h = widget.habit;
    if (h != null) {
      _title.text = h.title;
      _note.text = h.note;
      _kind = h.kind;
      _color = h.colorHex;
      _symbol = h.symbol;
      _goalMinutes.text = '${h.targetMinutes}';
      _goalNumber.text = h.targetNumber == h.targetNumber.truncateToDouble()
          ? h.targetNumber.toStringAsFixed(0)
          : '${h.targetNumber}';
      _unit.text = h.unit;
      _startDay = h.startDay;
    }
    for (final controller in _controllers) {
      controller.addListener(_refresh);
    }
  }

  void _refresh() => setState(() {});

  @override
  void dispose() {
    for (final controller in _controllers) {
      controller.dispose();
    }
    super.dispose();
  }

  List<String> get _allOptions => [
    if (editing) ...widget.habit!.options,
    ..._options.text
        .split('\n')
        .map((value) => value.trim())
        .where((value) => value.isNotEmpty),
  ];

  String? get _validation {
    if (_title.text.trim().isEmpty) {
      return s.t('Enter a habit name.', '请输入习惯名称。');
    }
    if (_title.text.runes.length > 100) {
      return s.t('Use no more than 100 characters.', '名称不能超过 100 个字符。');
    }
    if (isChoice || isDuration) {
      final options = _allOptions;
      if (isChoice && options.isEmpty) {
        return s.t('Add at least one option.', '请至少添加一个选项。');
      }
      if (options.toSet().length != options.length) {
        return isDuration
            ? s.t('Each category must be unique.', '类别不能重复。')
            : s.t('Each option must be unique.', '选项不能重复。');
      }
      if (options.length > 30) {
        return isDuration
            ? s.t('You can add up to 30 categories.', '最多可添加 30 个类别。')
            : s.t('You can add up to 30 options.', '最多可添加 30 个选项。');
      }
      if (options.any((value) => value.runes.length > 200)) {
        return isDuration
            ? s.t(
                'Use no more than 200 characters per category.',
                '每个类别不能超过 200 个字符。',
              )
            : s.t(
                'Use no more than 200 characters per option.',
                '每个选项不能超过 200 个字符。',
              );
      }
    }
    if (_kind == HabitKind.duration) {
      final value = int.tryParse(_goalMinutes.text);
      if (value == null || value < 1 || value > 59999) {
        return s.t(
          'Use a whole number from 1 to 59,999 minutes.',
          '目标须为 1 至 59,999 分钟的整数。',
        );
      }
    }
    if (_kind == HabitKind.number) {
      final value = double.tryParse(_goalNumber.text.replaceAll(',', '.'));
      if (value == null ||
          !value.isFinite ||
          value <= 0 ||
          value > 1000000000) {
        return s.t(
          'The daily goal must be above 0 and at most 1 billion.',
          '每日目标须大于 0，且不超过 10 亿。',
        );
      }
    }
    if (!DayKey.valid(_startDay) || _startDay.compareTo(DayKey.today()) > 0) {
      return s.t('Choose today or an earlier start date.', '请选择今天或更早的开始日期。');
    }
    if (editing && _startDay.compareTo(widget.habit!.startDay) > 0) {
      return s.t(
        'The start date cannot move later because it would hide history.',
        '开始日期不可推迟，以免隐藏历史记录。',
      );
    }
    return null;
  }

  void _save() {
    if (_validation != null) return;
    Navigator.of(context).pop(
      Habit(
        id: widget.habit?.id ?? const Uuid().v4(),
        title: _title.text.trim(),
        note: _note.text.trim(),
        kind: _kind,
        colorHex: _color,
        symbol: _symbol,
        options: isChoice || isDuration ? _allOptions : const [],
        targetMinutes: _kind == HabitKind.duration
            ? int.parse(_goalMinutes.text)
            : 30,
        targetNumber: _kind == HabitKind.number
            ? double.parse(_goalNumber.text.replaceAll(',', '.'))
            : 1,
        unit: _unit.text.trim(),
        startDay: _startDay,
        archivedOn: widget.habit?.archivedOn,
      ),
    );
  }

  Future<void> _pickDate() async {
    final today = DayKey.parse(DayKey.today())!;
    final original = widget.habit == null
        ? today
        : DayKey.parse(widget.habit!.startDay)!;
    final last = original.isBefore(today) ? original : today;
    final initial = DayKey.parse(_startDay) ?? last;
    final selected = await showDatePicker(
      context: context,
      initialDate: initial.isAfter(last) ? last : initial,
      firstDate: DateTime(1),
      lastDate: last,
      locale: Locale(s.localeName.split(RegExp('[-_]')).first),
      helpText: s.t('FIRST DAY', '第一天'),
    );
    if (selected != null && mounted) {
      setState(() => _startDay = DayKey.fromDate(selected));
    }
  }

  @override
  Widget build(BuildContext context) {
    final media = MediaQuery.of(context);
    final availableHeight = media.size.height - media.viewInsets.bottom - 32;
    final narrow = media.size.width < 520;
    final padding = narrow ? 18.0 : 26.0;
    final validation = _validation;
    return Dialog(
      backgroundColor: RhythmTheme.canvas,
      insetPadding: const EdgeInsets.all(16),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(5),
        side: const BorderSide(color: RhythmTheme.line),
      ),
      child: SizedBox(
        width: 590,
        height: math.max(220, math.min(820, availableHeight)),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(
              padding: EdgeInsets.all(padding),
              decoration: const BoxDecoration(
                color: RhythmTheme.paper,
                border: Border(bottom: BorderSide(color: RhythmTheme.line)),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Eyebrow(
                          editing
                              ? s.t('HABIT SETTINGS', '习惯设置')
                              : s.t('NEW HABIT / 01', '新习惯 / 01'),
                        ),
                        const SizedBox(height: 9),
                        Text(
                          editing
                              ? s.t('Habit settings', '习惯设置')
                              : s.t('New habit', '新建习惯'),
                          style: TextStyle(
                            fontSize: narrow ? 23 : 27,
                            fontWeight: FontWeight.w500,
                            letterSpacing: -.8,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          s.t(
                            'Define your action, entry type and daily goal.',
                            '设定行动、记录方式和每日目标。',
                          ),
                          style: const TextStyle(
                            fontSize: 11,
                            color: RhythmTheme.secondary,
                          ),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    tooltip: s.t('Close settings', '关闭设置'),
                    onPressed: () => Navigator.pop(context),
                    icon: const Icon(Icons.close, size: 18),
                  ),
                ],
              ),
            ),
            Expanded(
              child: SingleChildScrollView(
                padding: EdgeInsets.all(padding),
                keyboardDismissBehavior:
                    ScrollViewKeyboardDismissBehavior.onDrag,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    _section(s.t('01 / Name', '01 / 名称'), [
                      _field(
                        _title,
                        s.t('Habit name', '习惯名称'),
                        hint: s.t('For example, read every day', '例如，每天阅读'),
                        maxLength: 100,
                      ),
                    ]),
                    _section(s.t('02 / Entry type', '02 / 记录方式'), [
                      LayoutBuilder(
                        builder: (context, constraints) {
                          final columns = constraints.maxWidth < 400 ? 2 : 3;
                          return Wrap(
                            spacing: 7,
                            runSpacing: 7,
                            children: [
                              for (final kind in HabitKind.values)
                                SizedBox(
                                  width:
                                      (constraints.maxWidth -
                                          7 * (columns - 1)) /
                                      columns,
                                  child: OutlinedButton(
                                    onPressed: editing
                                        ? null
                                        : () => setState(() => _kind = kind),
                                    style: OutlinedButton.styleFrom(
                                      foregroundColor: _kind == kind
                                          ? RhythmTheme.ink
                                          : RhythmTheme.secondary,
                                      disabledForegroundColor: _kind == kind
                                          ? RhythmTheme.ink
                                          : RhythmTheme.muted,
                                      backgroundColor: _kind == kind
                                          ? RhythmTheme.accent.withValues(
                                              alpha: .075,
                                            )
                                          : RhythmTheme.paper,
                                      side: BorderSide(
                                        color: _kind == kind
                                            ? RhythmTheme.accent
                                            : RhythmTheme.line,
                                      ),
                                      padding: const EdgeInsets.symmetric(
                                        horizontal: 10,
                                        vertical: 15,
                                      ),
                                    ),
                                    child: Row(
                                      children: [
                                        Icon(_kindIcon(kind), size: 16),
                                        const SizedBox(width: 8),
                                        Expanded(
                                          child: Text(
                                            s.kind(kind),
                                            maxLines: 2,
                                            style: const TextStyle(
                                              fontSize: 11,
                                            ),
                                          ),
                                        ),
                                        if (_kind == kind)
                                          const Icon(
                                            Icons.check,
                                            size: 12,
                                            color: RhythmTheme.accent,
                                          ),
                                      ],
                                    ),
                                  ),
                                ),
                            ],
                          );
                        },
                      ),
                      _explanation(
                        editing
                            ? s.t(
                                'The entry type is fixed to preserve your history.',
                                '为保留历史记录，记录方式不可更改。',
                              )
                            : _kindExplanation,
                      ),
                    ]),
                    if (isChoice || isDuration)
                      _section(
                        isDuration
                            ? s.t('Categories · optional', '类别 · 可选')
                            : editing
                            ? s.t('Options / add new choices', '选项 / 添加新选项')
                            : s.t('Options / one per line', '选项 / 每行一个'),
                        [
                          if (editing && widget.habit!.options.isNotEmpty) ...[
                            Wrap(
                              spacing: 6,
                              runSpacing: 6,
                              children: [
                                for (final option in widget.habit!.options)
                                  Chip(
                                    label: Text(
                                      option,
                                      style: const TextStyle(fontSize: 11),
                                    ),
                                    avatar: const Icon(
                                      Icons.lock_outline,
                                      size: 13,
                                    ),
                                    visualDensity: VisualDensity.compact,
                                  ),
                              ],
                            ),
                            _explanation(
                              isDuration
                                  ? s.t(
                                      'Saved categories stay unchanged to preserve earlier sessions. Add new categories below.',
                                      '已保存的类别保持不变，以保留历史记录。您可以在下方添加新类别。',
                                    )
                                  : s.t(
                                      'Saved options stay unchanged so earlier selections remain intact. You can add new options below.',
                                      '已保存的选项保持不变，以保留历史选择。您可以在下方添加新选项。',
                                    ),
                            ),
                          ],
                          _field(
                            _options,
                            isDuration
                                ? editing
                                      ? s.t('Additional categories', '新增类别')
                                      : s.t('Categories', '类别')
                                : editing
                                ? s.t('Additional options', '新增选项')
                                : s.t('Options', '选项'),
                            hint: isDuration
                                ? s.t('One category per line', '每行一个类别')
                                : s.t('One option per line', '每行一个选项'),
                            minLines: 3,
                            maxLines: 6,
                          ),
                          if (isDuration)
                            _explanation(
                              s.t(
                                'Categories let you log separate sessions, each with its own duration. Leave empty to record only a daily total. Existing time is kept when you add categories.',
                                '添加类别后，可分别记录每次时长。留空则仅记录每日总时长。添加类别时，已有时长将予以保留。',
                              ),
                            ),
                        ],
                      ),
                    if (_kind == HabitKind.duration)
                      _section(s.t('Daily goal', '每日目标'), [
                        _field(
                          _goalMinutes,
                          s.t('Minutes per day', '每日分钟数'),
                          keyboard: TextInputType.number,
                          formatters: [FilteringTextInputFormatter.digitsOnly],
                        ),
                        if (int.tryParse(_goalMinutes.text) case final int value
                            when value > 0)
                          Text(
                            s.minutes(value),
                            style: RhythmTheme.mono(
                              12,
                              color: RhythmTheme.secondary,
                            ),
                          ),
                        if (editing)
                          _explanation(
                            s.t(
                              'The new goal applies to progress for all days.',
                              '新目标将用于计算所有日期的进度。',
                            ),
                          ),
                      ]),
                    if (_kind == HabitKind.number)
                      _section(s.t('Daily goal and unit', '每日目标和单位'), [
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(
                              child: _field(
                                _goalNumber,
                                s.t('Daily goal', '每日目标'),
                                keyboard: const TextInputType.numberWithOptions(
                                  decimal: true,
                                ),
                              ),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: _field(
                                _unit,
                                s.t('Unit', '单位'),
                                hint: s.t('e.g. glasses', '例如，杯'),
                                maxLength: 40,
                              ),
                            ),
                          ],
                        ),
                        if (editing)
                          _explanation(
                            s.t(
                              'The new goal applies to progress for all days.',
                              '新目标将用于计算所有日期的进度。',
                            ),
                          ),
                      ]),
                    _section(s.t('03 / Icon and color', '03 / 图标和颜色'), [
                      Wrap(
                        spacing: 6,
                        runSpacing: 6,
                        children: [
                          for (final hex in _palette)
                            Semantics(
                              selected: _color == hex,
                              child: IconButton(
                                tooltip: s.t('Color $hex', '颜色 $hex'),
                                style: IconButton.styleFrom(
                                  side: BorderSide(
                                    color: _color == hex
                                        ? RhythmTheme.ink
                                        : Colors.transparent,
                                  ),
                                ),
                                onPressed: () => setState(() => _color = hex),
                                icon: Container(
                                  width: 24,
                                  height: 24,
                                  decoration: BoxDecoration(
                                    color: Color(
                                      0xff000000 | int.parse(hex, radix: 16),
                                    ),
                                    borderRadius: BorderRadius.circular(2),
                                  ),
                                  child: _color == hex
                                      ? const Icon(
                                          Icons.check,
                                          color: RhythmTheme.canvas,
                                          size: 16,
                                        )
                                      : null,
                                ),
                              ),
                            ),
                        ],
                      ),
                      Wrap(
                        spacing: 5,
                        runSpacing: 5,
                        children: [
                          for (final symbol in _symbols)
                            Semantics(
                              selected: _symbol == symbol,
                              child: IconButton(
                                tooltip: _symbolLabel(symbol),
                                onPressed: () =>
                                    setState(() => _symbol = symbol),
                                style: IconButton.styleFrom(
                                  foregroundColor: _symbol == symbol
                                      ? Color(
                                          0xff000000 |
                                              (int.tryParse(
                                                    _color.replaceAll('#', ''),
                                                    radix: 16,
                                                  ) ??
                                                  0xf34b3f),
                                        )
                                      : RhythmTheme.secondary,
                                  backgroundColor: _symbol == symbol
                                      ? RhythmTheme.paper
                                      : Colors.transparent,
                                  side: BorderSide(
                                    color: _symbol == symbol
                                        ? RhythmTheme.line
                                        : Colors.transparent,
                                  ),
                                ),
                                icon: Icon(
                                  RhythmTheme.iconFor(symbol),
                                  size: 20,
                                ),
                              ),
                            ),
                        ],
                      ),
                    ]),
                    _section(s.t('04 / Start date', '04 / 开始日期'), [
                      Align(
                        alignment: Alignment.centerLeft,
                        child: OutlinedButton.icon(
                          onPressed: _pickDate,
                          icon: const Icon(
                            Icons.calendar_today_outlined,
                            size: 16,
                          ),
                          label: Text(s.dayLabel(_startDay)),
                        ),
                      ),
                      _explanation(
                        editing
                            ? s.t(
                                'You can move the start date earlier. Moving it later would hide existing history.',
                                '您可以提前开始日期。推迟日期会隐藏现有历史记录。',
                              )
                            : s.t(
                                'This habit starts on this date. Earlier days stay unchanged.',
                                '此习惯从该日期开始显示，之前的日期不受影响。',
                              ),
                      ),
                    ]),
                    _section(
                      s.t('05 / Description · optional', '05 / 描述 · 可选'),
                      [
                        _field(
                          _note,
                          s.t('Description', '描述'),
                          hint: s.t(
                            'What will help you keep going?',
                            '什么能帮助你坚持下去？',
                          ),
                          minLines: 2,
                          maxLines: 4,
                          maxLength: 1000,
                        ),
                      ],
                      bottomSpace: false,
                    ),
                  ],
                ),
              ),
            ),
            Container(
              padding: EdgeInsets.symmetric(horizontal: padding, vertical: 16),
              decoration: const BoxDecoration(
                color: RhythmTheme.paper,
                border: Border(top: BorderSide(color: RhythmTheme.line)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (validation != null) ...[
                    Text(
                      validation,
                      style: const TextStyle(
                        fontSize: 11,
                        color: RhythmTheme.secondary,
                      ),
                    ),
                    const SizedBox(height: 10),
                  ],
                  Wrap(
                    alignment: WrapAlignment.end,
                    spacing: 10,
                    runSpacing: 8,
                    children: [
                      TextButton(
                        onPressed: () => Navigator.pop(context),
                        child: Text(s.t('Cancel', '取消')),
                      ),
                      FilledButton(
                        onPressed: validation == null ? _save : null,
                        child: Text(
                          editing
                              ? s.t('Save', '保存')
                              : s.t('Create habit', '创建习惯'),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _section(
    String label,
    List<Widget> children, {
    bool bottomSpace = true,
  }) => Padding(
    padding: EdgeInsets.only(bottom: bottomSpace ? 24 : 0),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          label.toUpperCase(),
          style: RhythmTheme.mono(
            10,
            color: RhythmTheme.secondary,
          ).copyWith(letterSpacing: 1),
        ),
        const SizedBox(height: 11),
        for (var index = 0; index < children.length; index++) ...[
          if (index > 0) const SizedBox(height: 10),
          children[index],
        ],
      ],
    ),
  );

  Widget _field(
    TextEditingController controller,
    String label, {
    String? hint,
    int? maxLength,
    int minLines = 1,
    int maxLines = 1,
    TextInputType? keyboard,
    List<TextInputFormatter>? formatters,
  }) => TextField(
    controller: controller,
    minLines: minLines,
    maxLines: maxLines,
    maxLength: maxLength,
    keyboardType:
        keyboard ??
        (maxLines > 1 ? TextInputType.multiline : TextInputType.text),
    inputFormatters: formatters,
    decoration: InputDecoration(
      labelText: label,
      hintText: hint,
      counterText: '',
      filled: true,
      fillColor: RhythmTheme.paper,
      isDense: true,
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
    ),
    style: const TextStyle(fontSize: 13),
  );

  Widget _explanation(String text) => Text(
    text,
    style: const TextStyle(
      fontSize: 11,
      color: RhythmTheme.secondary,
      height: 1.5,
    ),
  );

  IconData _kindIcon(HabitKind kind) => switch (kind) {
    HabitKind.check => Icons.check_circle_outline,
    HabitKind.single => Icons.list_alt,
    HabitKind.multiple => Icons.checklist,
    HabitKind.duration => Icons.schedule,
    HabitKind.number => Icons.numbers,
    HabitKind.text => Icons.notes,
  };

  String get _kindExplanation => switch (_kind) {
    HabitKind.check => s.t(
      'Mark the action complete with one tap.',
      '轻点一下，标记行动已完成。',
    ),
    HabitKind.single => s.t(
      'Select one value from your own list.',
      '从自定义列表中选择一个值。',
    ),
    HabitKind.multiple => s.t(
      'Select several values from your own list.',
      '从自定义列表中选择多个值。',
    ),
    HabitKind.duration => s.t(
      'Log hours and minutes toward a daily goal.',
      '记录小时和分钟，向每日目标迈进。',
    ),
    HabitKind.number => s.t(
      'Track an amount, a count or a distance.',
      '跟踪数量、次数或距离。',
    ),
    HabitKind.text => s.t('Write a short entry for each day.', '每天写下一条简短记录。'),
  };

  String _symbolLabel(String symbol) => switch (symbol) {
    'waveform.path' => s.t('Rhythm', '节奏'),
    'book.closed' => s.t('Reading', '阅读'),
    'figure.mind.and.body' => s.t('Meditation', '冥想'),
    'sun.max' => s.t('Sun', '太阳'),
    'drop' => s.t('Water', '饮水'),
    'moon' => s.t('Sleep', '睡眠'),
    'heart' => s.t('Health', '健康'),
    'pencil' => s.t('Writing', '写作'),
    'figure.walk' => s.t('Walking', '步行'),
    'cup.and.saucer' => s.t('Coffee', '咖啡'),
    'brain.head.profile' => s.t('Learning', '学习'),
    'music.note' => s.t('Music', '音乐'),
    _ => symbol,
  };
}
