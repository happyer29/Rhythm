import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/models.dart';
import '../l10n.dart';
import 'duration_sessions.dart';
import 'theme.dart';

/// A keyed card keeps drafts and focus while the journal saves each change.
class HabitCard extends StatefulWidget {
  const HabitCard({
    super.key,
    required this.habit,
    required this.entry,
    required this.strings,
    required this.enabled,
    required this.onChanged,
    required this.onClear,
    required this.onEdit,
    this.onArchive,
    this.onRestore,
    this.onDurationSessionsChanged,
  });

  final Habit habit;
  final HabitEntry entry;
  final Strings strings;
  final bool enabled;
  final ValueChanged<HabitEntry> onChanged;
  final VoidCallback onClear;
  final VoidCallback onEdit;
  final VoidCallback? onArchive, onRestore;
  final void Function(HabitEntry entry, List<String> categories)?
  onDurationSessionsChanged;

  @override
  State<HabitCard> createState() => _HabitCardState();
}

class _HabitCardState extends State<HabitCard> {
  final _hours = TextEditingController();
  final _minutes = TextEditingController();
  final _number = TextEditingController();
  final _text = TextEditingController();
  String? _numberError;

  Strings get s => widget.strings;

  @override
  void initState() {
    super.initState();
    _syncAll();
  }

  @override
  void didUpdateWidget(covariant HabitCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.entry.day != widget.entry.day ||
        oldWidget.habit.id != widget.habit.id) {
      _syncAll();
      return;
    }
    // Do not replace the user's draft with its normalized stored value. In
    // particular, decimal separators and a trailing decimal stay editable.
    if (oldWidget.entry.minutes != widget.entry.minutes &&
        _durationDraft != widget.entry.minutes) {
      _syncDuration();
    }
    if (oldWidget.entry.number != widget.entry.number &&
        _parseNumber(_number.text) != widget.entry.number) {
      _replace(_number, _numberLabel(widget.entry.number));
      _numberError = null;
    }
    if (oldWidget.entry.text != widget.entry.text &&
        _text.text != widget.entry.text) {
      _replace(_text, widget.entry.text);
    }
  }

  void _syncAll() {
    _syncDuration();
    _replace(_number, _numberLabel(widget.entry.number));
    _replace(_text, widget.entry.text);
    _numberError = null;
  }

  void _syncDuration() {
    final value = widget.entry.minutes;
    _replace(_hours, value == 0 ? '' : '${value ~/ 60}');
    _replace(_minutes, value == 0 ? '' : '${value % 60}');
  }

  void _replace(TextEditingController controller, String value) {
    if (controller.text == value) return;
    controller.value = TextEditingValue(
      text: value,
      selection: TextSelection.collapsed(offset: value.length),
    );
  }

  int get _durationDraft =>
      (int.tryParse(_hours.text) ?? 0) * 60 +
      (int.tryParse(_minutes.text) ?? 0);

  static String _numberLabel(double? value) {
    if (value == null) return '';
    return value == value.truncateToDouble()
        ? value.toStringAsFixed(0)
        : value.toString();
  }

  static double? _parseNumber(String text) =>
      double.tryParse(text.trim().replaceAll(',', '.'));

  void _updateDuration(TextEditingController changed, int maximum) {
    // Clamp before multiplication, including a pasted value larger than int64.
    final raw = changed.text;
    final parsed = int.tryParse(raw);
    final bounded = raw.isEmpty ? 0 : (parsed ?? maximum).clamp(0, maximum);
    if (raw.isNotEmpty && (parsed == null || parsed != bounded)) {
      _replace(changed, '$bounded');
    }
    final hours = (int.tryParse(_hours.text) ?? 0).clamp(0, 999).toInt();
    final minutes = (int.tryParse(_minutes.text) ?? 0).clamp(0, 59).toInt();
    widget.onChanged(widget.entry.copyWith(minutes: hours * 60 + minutes));
  }

  void _updateNumber(String value) {
    if (value.trim().isEmpty) {
      setState(() => _numberError = null);
      widget.onChanged(widget.entry.copyWith(clearNumber: true));
      return;
    }
    final number = _parseNumber(value);
    final valid =
        number != null &&
        number.isFinite &&
        number >= 0 &&
        number <= 1000000000;
    setState(() {
      _numberError = valid
          ? null
          : s.t('Enter a number from 0 to 1 billion.', '请输入 0 至 10 亿之间的数字。');
    });
    if (valid) widget.onChanged(widget.entry.copyWith(number: number));
  }

  @override
  void dispose() {
    _hours.dispose();
    _minutes.dispose();
    _number.dispose();
    _text.dispose();
    super.dispose();
  }

  String get _subtitle {
    final h = widget.habit;
    if (h.kind == HabitKind.duration) {
      return s.t(
        '${s.minutes(widget.entry.minutes)} of ${s.minutes(h.targetMinutes)} · daily goal',
        '${s.minutes(widget.entry.minutes)} / ${s.minutes(h.targetMinutes)} · 每日目标',
      );
    }
    if (h.kind == HabitKind.number) {
      return s.t('Daily goal: ', '每日目标：') +
          '${_numberLabel(h.targetNumber)} ${h.unit}'.trimRight();
    }
    if (h.note.isNotEmpty) return h.note;
    return switch (h.kind) {
      HabitKind.check => s.t('One small action, every day.', '每天完成一个小行动。'),
      HabitKind.single => s.t('Choose one option for this day.', '为这一天选择一个选项。'),
      HabitKind.multiple => s.t(
        'Choose every option that applies.',
        '选择所有适用的选项。',
      ),
      HabitKind.text => s.t('Leave a note about your day.', '记录这一天的感受。'),
      _ => '',
    };
  }

  @override
  Widget build(BuildContext context) {
    final progress = widget.habit
        .progress(widget.entry)
        .clamp(0.0, 1.0)
        .toDouble();
    return Panel(
      padding: const EdgeInsets.all(18),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final narrow =
              constraints.maxWidth < 610 ||
              (widget.habit.kind == HabitKind.duration &&
                  (widget.habit.options.isNotEmpty ||
                      widget.entry.sessions.isNotEmpty));
          final heading = Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Stack(
                clipBehavior: Clip.none,
                children: [
                  Container(
                    width: 44,
                    height: 48,
                    decoration: BoxDecoration(
                      color: RhythmTheme.canvas,
                      border: Border.all(color: RhythmTheme.line),
                      borderRadius: BorderRadius.circular(3),
                    ),
                    child: Icon(
                      RhythmTheme.iconFor(widget.habit.symbol),
                      size: 21,
                      color: Color(
                        0xff000000 |
                            (int.tryParse(
                                  widget.habit.colorHex.replaceAll('#', ''),
                                  radix: 16,
                                ) ??
                                0xf34b3f),
                      ),
                    ),
                  ),
                  if (progress >= 1)
                    const Positioned(
                      right: -3,
                      bottom: -3,
                      child: DecoratedBox(
                        decoration: BoxDecoration(color: RhythmTheme.accent),
                        child: Padding(
                          padding: EdgeInsets.all(3),
                          child: Icon(
                            Icons.check,
                            size: 10,
                            color: RhythmTheme.canvas,
                          ),
                        ),
                      ),
                    ),
                ],
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      s.kind(widget.habit.kind).toUpperCase(),
                      style: RhythmTheme.mono(
                        9,
                        color: RhythmTheme.secondary,
                      ).copyWith(letterSpacing: 1.2),
                    ),
                    const SizedBox(height: 5),
                    Text(
                      widget.habit.title,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                    const SizedBox(height: 5),
                    Text(
                      _subtitle,
                      style: const TextStyle(
                        fontSize: 11,
                        color: RhythmTheme.secondary,
                      ),
                    ),
                    if (widget.habit.kind == HabitKind.duration ||
                        widget.habit.kind == HabitKind.number) ...[
                      const SizedBox(height: 10),
                      SizedBox(
                        width: 140,
                        child: LinearProgressIndicator(
                          value: progress,
                          minHeight: 2,
                          backgroundColor: RhythmTheme.line,
                          color: RhythmTheme.accent,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              if (narrow) _actions(),
            ],
          );
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (narrow) ...[
                heading,
                const SizedBox(height: 17),
                _input(),
              ] else
                Row(
                  children: [
                    Expanded(child: heading),
                    const SizedBox(width: 22),
                    SizedBox(
                      width: widget.habit.kind == HabitKind.text ? 270 : 235,
                      child: _input(),
                    ),
                    const SizedBox(width: 6),
                    _actions(),
                  ],
                ),
              if (!widget.enabled) ...[
                const SizedBox(height: 10),
                Text(
                  s.t('Future days are read-only.', '未来的日期仅供查看。'),
                  style: const TextStyle(
                    fontSize: 10,
                    color: RhythmTheme.secondary,
                  ),
                ),
              ],
            ],
          );
        },
      ),
    );
  }

  Widget _actions() => PopupMenuButton<String>(
    tooltip: s.t('Habit actions', '习惯操作'),
    padding: EdgeInsets.zero,
    icon: const Icon(Icons.more_horiz, size: 19, color: RhythmTheme.secondary),
    onSelected: (value) {
      if (value == 'edit') widget.onEdit();
      if (value == 'archive') widget.onArchive?.call();
      if (value == 'restore') widget.onRestore?.call();
      if (value == 'clear') {
        _replace(_hours, '');
        _replace(_minutes, '');
        _replace(_number, '');
        _replace(_text, '');
        setState(() => _numberError = null);
        widget.onClear();
      }
    },
    itemBuilder: (_) => [
      PopupMenuItem(value: 'edit', child: Text(s.t('Edit habit', '编辑习惯'))),
      if (widget.onArchive != null)
        PopupMenuItem(
          value: 'archive',
          child: Text(s.t('Archive habit', '归档习惯')),
        ),
      if (widget.onRestore != null)
        PopupMenuItem(
          value: 'restore',
          child: Text(s.t('Restore habit', '恢复习惯')),
        ),
      PopupMenuItem(
        value: 'clear',
        enabled: widget.enabled,
        child: Text(s.t('Clear this day’s entry', '清除此日记录')),
      ),
    ],
  );

  InputDecoration _decoration(String label, {String? hint, String? error}) =>
      InputDecoration(
        labelText: label,
        hintText: hint,
        errorText: error,
        errorMaxLines: 2,
        isDense: true,
        filled: true,
        fillColor: RhythmTheme.canvas,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 12,
          vertical: 14,
        ),
      );

  Widget _input() {
    switch (widget.habit.kind) {
      case HabitKind.check:
        return Align(
          alignment: Alignment.centerRight,
          child: Semantics(
            label: widget.habit.title,
            child: InkWell(
              borderRadius: BorderRadius.circular(3),
              onTap: widget.enabled
                  ? () => widget.onChanged(
                      widget.entry.copyWith(checked: !widget.entry.checked),
                    )
                  : null,
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 3, horizontal: 4),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      widget.entry.checked
                          ? s.t('COMPLETE', '已完成')
                          : s.t('MARK DONE', '标记完成'),
                      style: RhythmTheme.mono(
                        10,
                        color: widget.enabled
                            ? RhythmTheme.ink
                            : RhythmTheme.muted,
                      ),
                    ),
                    const SizedBox(width: 9),
                    Checkbox(
                      value: widget.entry.checked,
                      onChanged: widget.enabled
                          ? (value) => widget.onChanged(
                              widget.entry.copyWith(checked: value ?? false),
                            )
                          : null,
                    ),
                  ],
                ),
              ),
            ),
          ),
        );
      case HabitKind.single:
        final selected = widget.entry.selections.isEmpty
            ? ''
            : widget.entry.selections.first;
        return DropdownButtonFormField<String>(
          // ValueKey makes a selection made externally (clear/import/day switch)
          // visible, without affecting any editable text controller.
          key: ValueKey('single:${widget.entry.day}:$selected'),
          initialValue: widget.habit.options.contains(selected) ? selected : '',
          isExpanded: true,
          decoration: _decoration(s.t('Single choice', '单选')),
          items: [
            DropdownMenuItem(
              value: '',
              child: Text(s.t('Choose an option', '选择一项')),
            ),
            for (final option in widget.habit.options)
              DropdownMenuItem(
                value: option,
                child: Text(
                  option,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
          ],
          onChanged: widget.enabled
              ? (value) => widget.onChanged(
                  widget.entry.copyWith(
                    selections: value == null || value.isEmpty ? [] : [value],
                  ),
                )
              : null,
        );
      case HabitKind.multiple:
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            OutlinedButton(
              onPressed: widget.enabled ? _showMultiple : null,
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 15,
                ),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      widget.entry.selections.isEmpty
                          ? s.t('Choose options', '选择多项')
                          : s.t(
                              'Selected: ${widget.entry.selections.length}',
                              '已选 ${widget.entry.selections.length} 项',
                            ),
                    ),
                  ),
                  const Icon(Icons.expand_more, size: 17),
                ],
              ),
            ),
            if (widget.entry.selections.isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(
                widget.entry.selections.join(' / '),
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
                style: RhythmTheme.mono(10, color: RhythmTheme.secondary),
              ),
            ],
          ],
        );
      case HabitKind.duration:
        if (widget.habit.options.isNotEmpty ||
            widget.entry.sessions.isNotEmpty) {
          return DurationSessions(
            habit: widget.habit,
            entry: widget.entry,
            strings: s,
            enabled: widget.enabled,
            allowNewCategories: widget.onDurationSessionsChanged != null,
            onChanged: (entry, categories) {
              final onSessions = widget.onDurationSessionsChanged;
              if (onSessions != null) {
                onSessions(entry, categories);
              } else {
                widget.onChanged(entry);
              }
            },
          );
        }
        return Row(
          children: [
            Expanded(
              child: TextField(
                controller: _hours,
                enabled: widget.enabled,
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                textAlign: TextAlign.center,
                style: RhythmTheme.mono(16),
                decoration: _decoration(s.t('Hours', '小时'), hint: '0'),
                onChanged: (_) => _updateDuration(_hours, 999),
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8),
              child: Text(
                ':',
                style: RhythmTheme.mono(17, color: RhythmTheme.secondary),
              ),
            ),
            Expanded(
              child: TextField(
                controller: _minutes,
                enabled: widget.enabled,
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                textAlign: TextAlign.center,
                style: RhythmTheme.mono(16),
                decoration: _decoration(s.t('Minutes', '分钟'), hint: '0'),
                onChanged: (_) => _updateDuration(_minutes, 59),
              ),
            ),
          ],
        );
      case HabitKind.number:
        return TextField(
          controller: _number,
          enabled: widget.enabled,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          style: RhythmTheme.mono(16),
          decoration: _decoration(
            widget.habit.unit.isEmpty ? s.t('Value', '数值') : widget.habit.unit,
            hint: '0',
            error: _numberError,
          ),
          onChanged: _updateNumber,
        );
      case HabitKind.text:
        return TextField(
          controller: _text,
          enabled: widget.enabled,
          minLines: 1,
          maxLines: 5,
          maxLength: 10000,
          decoration: _decoration(
            s.t('A note for this day', '记录这一天'),
          ).copyWith(counterText: ''),
          style: const TextStyle(fontSize: 13),
          onChanged: (value) =>
              widget.onChanged(widget.entry.copyWith(text: value)),
        );
    }
  }

  Future<void> _showMultiple() async {
    final selected = widget.entry.selections.toSet();
    await showDialog<void>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, updateDialog) {
          void publish() {
            widget.onChanged(
              widget.entry.copyWith(
                selections: widget.habit.options
                    .where(selected.contains)
                    .toList(),
              ),
            );
          }

          return AlertDialog(
            title: Text(widget.habit.title),
            content: SizedBox(
              width: 340,
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    for (final option in widget.habit.options)
                      CheckboxListTile(
                        title: Text(option),
                        value: selected.contains(option),
                        contentPadding: EdgeInsets.zero,
                        controlAffinity: ListTileControlAffinity.leading,
                        onChanged: (checked) {
                          updateDialog(() {
                            if (checked == true) {
                              selected.add(option);
                            } else {
                              selected.remove(option);
                            }
                          });
                          publish();
                        },
                      ),
                  ],
                ),
              ),
            ),
            actions: [
              TextButton(
                onPressed: () {
                  updateDialog(selected.clear);
                  publish();
                },
                child: Text(s.t('Clear selection', '清除选择')),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(context),
                child: Text(s.t('Done', '完成')),
              ),
            ],
          );
        },
      ),
    );
  }
}
