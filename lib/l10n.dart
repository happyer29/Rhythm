import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'core/models.dart';
import 'core/repository.dart';

enum AppLanguage { english, simplifiedChinese }

extension LanguageDetails on AppLanguage {
  String get code => this == AppLanguage.english ? 'en' : 'zh-Hans';
  String get nativeName => this == AppLanguage.english ? 'English' : '简体中文';
  Locale get locale => this == AppLanguage.english
      ? const Locale('en', 'US')
      : const Locale.fromSubtags(
          languageCode: 'zh',
          scriptCode: 'Hans',
          countryCode: 'CN',
        );
  static AppLanguage fromCode(Object? code) =>
      code == 'zh-Hans' ? AppLanguage.simplifiedChinese : AppLanguage.english;
}

class Strings {
  const Strings(this.language);
  final AppLanguage language;
  String t(String en, String zh) => language == AppLanguage.english ? en : zh;
  String get localeName => t('en_US', 'zh_CN');
  static final Map<String, DateFormat> _formatters = {};
  String dayLabel(String day, {String? pattern}) {
    final date = DayKey.parse(day);
    if (date == null) return day;
    final format = pattern ?? t('MMMM d, yyyy', 'yyyy年M月d日');
    final formatter = _formatters.putIfAbsent(
      '$localeName/$format',
      () => DateFormat(format, localeName),
    );
    return formatter.format(date);
  }

  String minutes(int minutes) {
    if (minutes < 60) return t('$minutes min', '$minutes 分钟');
    final hours = minutes ~/ 60;
    return minutes % 60 == 0
        ? t('$hours hr', '$hours 小时')
        : t('$hours hr ${minutes % 60} min', '$hours 小时 ${minutes % 60} 分钟');
  }

  String kind(HabitKind kind) => switch (kind) {
    HabitKind.check => t('Checkbox', '勾选'),
    HabitKind.single => t('Single choice', '单选'),
    HabitKind.multiple => t('Multiple choice', '多选'),
    HabitKind.duration => t('Duration', '时长'),
    HabitKind.number => t('Number', '数值'),
    HabitKind.text => t('Text', '文字'),
  };
  String weekday(int monday1, {bool short = true}) {
    final names = short
        ? ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
        : [
            'Monday',
            'Tuesday',
            'Wednesday',
            'Thursday',
            'Friday',
            'Saturday',
            'Sunday',
          ];
    final chinese = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    final i = (monday1 - 1).clamp(0, 6);
    return t(names[i], chinese[i]);
  }

  String month(int month, {bool short = true}) => dayLabel(
    '2024-${month.toString().padLeft(2, '0')}-01',
    pattern: short ? 'MMM' : 'MMMM',
  );
  String error(Object error) {
    if (error is RepositoryFailure) {
      if (error.code == 'conflict') {
        return t(
          'Newer changes were saved to your account elsewhere. Export this draft before loading the saved version.',
          '其他设备已向账号保存较新的更改。加载已保存版本前，请先导出此草稿。',
        );
      }
      if (error.code == 'quota') {
        return t(
          'The journal exceeds the account storage limit (900 KB). Export your draft as JSON before reducing its size.',
          '日记超过账号存储上限（900 KB）。请先将草稿导出为 JSON，再减少内容。',
        );
      }
      return t(
        'Account storage is unavailable. Check your connection, keep this tab open and export a JSON backup before retrying.',
        '账号存储暂时不可用。请检查网络连接，保持此标签页开启并导出 JSON 备份后重试。',
      );
    }
    if (error is FormatException) {
      return t(
        'This file is not a valid Rhythm backup. Your existing data has been kept.',
        '此文件不是有效的律动备份。现有数据已保留。',
      );
    }
    return t(
      'Could not save or read your data. Keep this tab open and export a backup if you have unsaved changes.',
      '无法保存或读取数据。如有未保存的更改，请保持此标签页开启并导出备份。',
    );
  }
}
