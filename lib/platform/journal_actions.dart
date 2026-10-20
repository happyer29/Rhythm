import 'dart:convert';
import '../core/models.dart';
import '../core/integer_preflight.dart';
import '../store.dart';

Future<String> runJournalAction(
  RhythmStore store,
  String name,
  String input, {
  required void Function(String) openDay,
  required void Function() startCreation,
}) async {
  try {
    validateWebIntegerFields(input);
    final args = jsonDecode(input);
    if (args is! Map<String, dynamic>) {
      throw const FormatException('Expected an object.');
    }
    void fields(Set<String> allowed) {
      if (args.keys.any((key) => !allowed.contains(key))) {
        throw const FormatException('Unexpected input field.');
      }
    }

    switch (name) {
      case 'read_journal':
        fields({});
        return jsonEncode({
          'journal': store.journal.toJson(),
          'selectedDay': store.selectedDay,
          'ready': store.ready,
          'saved': !store.hasUnsavedChanges && !store.saving,
        });
      case 'open_journal_day':
        fields({'day'});
        final day = args['day'];
        if (day is! String || !DayKey.valid(day)) {
          throw const FormatException('Invalid day.');
        }
        openDay(day);
        return jsonEncode({'selectedDay': day});
      case 'start_habit_creation':
        fields({});
        if (!store.ready || store.importing) {
          throw StateError('Journal unavailable.');
        }
        startCreation();
        return jsonEncode({'status': 'form_opened'});
      case 'record_habit_entries':
        fields({'entries'});
        final raw = args['entries'];
        if (raw is! List || raw.isEmpty || raw.length > 100) {
          throw const FormatException('Expected 1–100 entries.');
        }
        final entries = <HabitEntry>[];
        for (final value in raw) {
          if (value is! Map<String, dynamic> ||
              value.keys.any(
                (key) => !{
                  'habitID',
                  'day',
                  'checked',
                  'selections',
                  'sessions',
                  'minutes',
                  'number',
                  'text',
                }.contains(key),
              )) {
            throw const FormatException('Invalid entry.');
          }
          final id = jsonString(value, 'habitID').toUpperCase();
          final day = jsonString(value, 'day');
          final current = store.journal.entry(id, day);
          if (value.containsKey('sessions') && !value.containsKey('minutes')) {
            throw const FormatException(
              'Include the total minutes when updating timed sessions.',
            );
          }
          final habit = store.journal.habits
              .where((habit) => habit.id == id)
              .firstOrNull;
          if (habit?.kind == HabitKind.duration &&
              habit!.options.isNotEmpty &&
              value.containsKey('minutes') &&
              value['minutes'] != current.minutes &&
              !value.containsKey('sessions')) {
            throw const FormatException(
              'Include sessions when changing the total for a categorized duration habit.',
            );
          }
          entries.add(
            HabitEntry.fromJson({...current.toJson(), ...value, 'habitID': id}),
          );
        }
        await store.recordEntries(entries);
        return jsonEncode({'saved': true, 'entriesUpdated': entries.length});
      default:
        throw const FormatException('Unknown action.');
    }
  } catch (error) {
    return jsonEncode({'isError': true, 'message': error.toString()});
  }
}
