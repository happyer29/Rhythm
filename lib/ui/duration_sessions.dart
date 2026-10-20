import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/models.dart';
import '../l10n.dart';
import 'theme.dart';

/// Categorized durations retain individual sessions, even for repeated topics.
class DurationSessions extends StatelessWidget {
  const DurationSessions({
    super.key,
    required this.habit,
    required this.entry,
    required this.strings,
    required this.enabled,
    required this.allowNewCategories,
    required this.onChanged,
  });

  final Habit habit;
  final HabitEntry entry;
  final Strings strings;
  final bool enabled;
  final bool allowNewCategories;
  final void Function(HabitEntry entry, List<String> categories) onChanged;

  Future<void> _edit(BuildContext context, [int? index]) async {
    final original = index == null ? null : entry.sessions[index];
    final result = await showDialog<HabitSession>(
      context: context,
      builder: (_) => _SessionEditor(
        strings: strings,
        categories: habit.options,
        session: original,
        allowNewCategories: allowNewCategories,
        maximumMinutes: 59999 - entry.minutes + (original?.minutes ?? 0),
      ),
    );
    if (result == null || !context.mounted) return;
    final sessions = [...entry.sessions];
    if (index == null) {
      sessions.add(result);
    } else {
      sessions[index] = result;
    }
    onChanged(
      entry.copyWith(
        sessions: sessions,
        minutes:
            entry.unassignedMinutes +
            sessions.fold<int>(0, (sum, session) => sum + session.minutes),
      ),
      [
        ...habit.options,
        if (!habit.options.contains(result.topic)) result.topic,
      ],
    );
  }

  void _remove(int index) {
    final sessions = [...entry.sessions]..removeAt(index);
    onChanged(
      entry.copyWith(
        sessions: sessions,
        minutes: entry.minutes - entry.sessions[index].minutes,
      ),
      habit.options,
    );
  }

  Future<void> _editUnassigned(BuildContext context) async {
    final result = await showDialog<HabitSession>(
      context: context,
      builder: (_) => _SessionEditor(
        strings: strings,
        categories: const [],
        session: HabitSession(topic: '', minutes: entry.unassignedMinutes),
        allowNewCategories: false,
        unassigned: true,
        maximumMinutes: 59999 - entry.sessionMinutes,
      ),
    );
    if (result == null || !context.mounted) return;
    onChanged(
      entry.copyWith(minutes: entry.sessionMinutes + result.minutes),
      habit.options,
    );
  }

  @override
  Widget build(BuildContext context) {
    final s = strings;
    final categories = {
      for (final category in habit.options)
        if (entry.sessions.any((session) => session.topic == category))
          category,
      for (final session in entry.sessions)
        if (!habit.options.contains(session.topic)) session.topic,
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Wrap(
          alignment: WrapAlignment.spaceBetween,
          crossAxisAlignment: WrapCrossAlignment.center,
          spacing: 12,
          runSpacing: 8,
          children: [
            Text(
              s.t('SESSIONS', '分次记录'),
              style: RhythmTheme.mono(10, color: RhythmTheme.secondary),
            ),
            OutlinedButton.icon(
              onPressed: enabled ? () => _edit(context) : null,
              icon: const Icon(Icons.add, size: 16),
              label: Text(s.t('Add session', '添加记录')),
            ),
          ],
        ),
        if (entry.sessions.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 10),
            child: Text(
              s.t(
                'Choose a category and record each session separately.',
                '选择类别，分别记录每次时长。',
              ),
              style: const TextStyle(
                fontSize: 12,
                color: RhythmTheme.secondary,
              ),
            ),
          ),
        for (final category in categories) ...[
          const SizedBox(height: 12),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(
                  category,
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Text(
                s.minutes(
                  entry.sessions
                      .where((session) => session.topic == category)
                      .fold<int>(0, (sum, session) => sum + session.minutes),
                ),
                style: RhythmTheme.mono(11, color: RhythmTheme.secondary),
              ),
            ],
          ),
          for (var index = 0; index < entry.sessions.length; index++)
            if (entry.sessions[index].topic == category)
              Row(
                key: ValueKey('session:$index'),
                children: [
                  const Icon(
                    Icons.schedule,
                    size: 13,
                    color: RhythmTheme.secondary,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      s.minutes(entry.sessions[index].minutes),
                      style: RhythmTheme.mono(12),
                    ),
                  ),
                  IconButton(
                    tooltip: s.t(
                      'Edit session ${index + 1}',
                      '编辑第 ${index + 1} 次记录',
                    ),
                    onPressed: enabled ? () => _edit(context, index) : null,
                    icon: const Icon(Icons.edit_outlined, size: 16),
                  ),
                  IconButton(
                    tooltip: s.t(
                      'Delete session ${index + 1}',
                      '删除第 ${index + 1} 次记录',
                    ),
                    onPressed: enabled ? () => _remove(index) : null,
                    icon: const Icon(Icons.close, size: 17),
                  ),
                ],
              ),
        ],
        if (entry.unassignedMinutes > 0) ...[
          const Divider(height: 24),
          Row(
            children: [
              Expanded(
                child: Text(
                  s.t('Unassigned time', '未分类时长'),
                  style: const TextStyle(
                    fontSize: 12,
                    color: RhythmTheme.secondary,
                  ),
                ),
              ),
              Text(
                s.minutes(entry.unassignedMinutes),
                style: RhythmTheme.mono(12),
              ),
              IconButton(
                tooltip: s.t('Edit unassigned time', '编辑未分类时长'),
                onPressed: enabled ? () => _editUnassigned(context) : null,
                icon: const Icon(Icons.edit_outlined, size: 16),
              ),
            ],
          ),
          Text(
            s.t(
              'Earlier time without a category stays included in your total.',
              '之前未分类的时长仍计入总时长。',
            ),
            style: const TextStyle(fontSize: 11, color: RhythmTheme.secondary),
          ),
        ],
        if (entry.sessions.isNotEmpty || entry.unassignedMinutes > 0) ...[
          const SizedBox(height: 12),
          Text(
            s.t(
              'Total: ${s.minutes(entry.minutes)}',
              '总计：${s.minutes(entry.minutes)}',
            ),
            textAlign: TextAlign.right,
            style: RhythmTheme.mono(12),
          ),
        ],
      ],
    );
  }
}

class _SessionEditor extends StatefulWidget {
  const _SessionEditor({
    required this.strings,
    required this.categories,
    required this.session,
    required this.allowNewCategories,
    required this.maximumMinutes,
    this.unassigned = false,
  });

  final Strings strings;
  final List<String> categories;
  final HabitSession? session;
  final bool allowNewCategories;
  final int maximumMinutes;
  final bool unassigned;

  @override
  State<_SessionEditor> createState() => _SessionEditorState();
}

class _SessionEditorState extends State<_SessionEditor> {
  final _topic = TextEditingController();
  final _hours = TextEditingController();
  final _minutes = TextEditingController();
  late int _category;
  Strings get s => widget.strings;
  bool get _newCategory => _category == widget.categories.length;
  int? get _duration {
    final hours = int.tryParse(_hours.text.isEmpty ? '0' : _hours.text);
    final minutes = int.tryParse(_minutes.text.isEmpty ? '0' : _minutes.text);
    if (hours == null || minutes == null || hours > 999 || minutes > 59) {
      return null;
    }
    return hours * 60 + minutes;
  }

  String get _selectedTopic =>
      _newCategory ? _topic.text.trim() : widget.categories[_category];

  String? get _error {
    if (!widget.unassigned) {
      if (_selectedTopic.isEmpty) return s.t('Enter a category.', '请输入类别。');
      if (_selectedTopic.runes.length > 200) {
        return s.t(
          'Use no more than 200 characters per category.',
          '每个类别不能超过 200 个字符。',
        );
      }
      if (_newCategory &&
          !widget.categories.contains(_selectedTopic) &&
          widget.categories.length >= 30) {
        return s.t('You can add up to 30 categories.', '最多可添加 30 个类别。');
      }
    }
    final duration = _duration;
    if (duration == null) {
      return s.t('Use 0–999 hours and 0–59 minutes.', '请输入 0–999 小时和 0–59 分钟。');
    }
    if (duration > widget.maximumMinutes) {
      return s.t(
        'The daily total cannot exceed 59,999 minutes.',
        '每日总时长不能超过 59,999 分钟。',
      );
    }
    return null;
  }

  @override
  void initState() {
    super.initState();
    final existing = widget.session;
    final existingIndex = widget.categories.indexOf(existing?.topic ?? '');
    _category = existingIndex >= 0
        ? existingIndex
        : existing == null && widget.categories.isNotEmpty
        ? 0
        : widget.categories.length;
    _topic.text = existing?.topic ?? '';
    final minutes = existing?.minutes ?? 0;
    _hours.text = '${minutes ~/ 60}';
    _minutes.text = '${minutes % 60}';
    for (final controller in [_topic, _hours, _minutes]) {
      controller.addListener(_refresh);
    }
  }

  void _refresh() => setState(() {});

  @override
  void dispose() {
    _topic.dispose();
    _hours.dispose();
    _minutes.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final error = _error;
    return AlertDialog(
      insetPadding: const EdgeInsets.all(16),
      title: Text(
        widget.unassigned
            ? s.t('Unassigned time', '未分类时长')
            : widget.session == null
            ? s.t('Add session', '添加记录')
            : s.t('Edit session', '编辑记录'),
      ),
      content: SizedBox(
        width: 380,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (!widget.unassigned) ...[
                DropdownButtonFormField<int>(
                  initialValue: _category,
                  isExpanded: true,
                  decoration: InputDecoration(labelText: s.t('Category', '类别')),
                  items: [
                    for (var i = 0; i < widget.categories.length; i++)
                      DropdownMenuItem(
                        value: i,
                        child: Text(
                          widget.categories[i],
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    if (widget.allowNewCategories || _newCategory)
                      DropdownMenuItem(
                        value: widget.categories.length,
                        child: Text(s.t('+ New category', '+ 新类别')),
                      ),
                  ],
                  onChanged: (value) => setState(() => _category = value!),
                ),
                if (_newCategory) ...[
                  const SizedBox(height: 16),
                  TextField(
                    controller: _topic,
                    autofocus: true,
                    maxLength: 200,
                    decoration: InputDecoration(
                      labelText: s.t('New category', '新类别'),
                    ),
                  ),
                ],
                const SizedBox(height: 20),
              ],
              Row(
                children: [
                  Expanded(child: _timeField(_hours, s.t('Hours', '小时'))),
                  const SizedBox(width: 12),
                  Expanded(child: _timeField(_minutes, s.t('Minutes', '分钟'))),
                ],
              ),
              if (error != null) ...[
                const SizedBox(height: 14),
                Text(
                  error,
                  style: const TextStyle(
                    fontSize: 12,
                    color: RhythmTheme.secondary,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: Text(s.t('Cancel', '取消')),
        ),
        FilledButton(
          onPressed: error == null
              ? () => Navigator.pop(
                  context,
                  HabitSession(
                    topic: widget.unassigned ? '' : _selectedTopic,
                    minutes: _duration!,
                  ),
                )
              : null,
          child: Text(s.t('Save session', '保存记录')),
        ),
      ],
    );
  }

  Widget _timeField(TextEditingController controller, String label) =>
      TextField(
        controller: controller,
        keyboardType: TextInputType.number,
        inputFormatters: [FilteringTextInputFormatter.digitsOnly],
        textAlign: TextAlign.center,
        decoration: InputDecoration(labelText: label),
      );
}
