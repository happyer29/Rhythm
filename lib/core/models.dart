/// Civil-day keys and immutable journal values. Version 2 adds timed sessions.
// Exact browser integer limit.
const maxSafeInteger = 9007199254740991;

int addMinutes(int total, int minutes) {
  final positive = minutes < 0 ? 0 : minutes;
  return positive > maxSafeInteger - total ? maxSafeInteger : total + positive;
}

enum HabitKind { check, single, multiple, duration, number, text }

class Habit {
  Habit({
    required String id,
    required this.title,
    required this.startDay,
    this.note = '',
    this.kind = HabitKind.check,
    this.colorHex = 'F34B3F',
    this.symbol = 'waveform.path',
    List<String> options = const [],
    this.targetMinutes = 30,
    this.targetNumber = 1,
    this.unit = '',
    this.archivedOn,
  }) : id = id.toUpperCase(),
       options = List.unmodifiable(options);

  final String id, title, note, colorHex, symbol, unit, startDay;
  final HabitKind kind;
  final List<String> options;
  final int targetMinutes;
  final double targetNumber;
  final String? archivedOn;

  Habit copyWith({
    String? id,
    String? title,
    String? note,
    HabitKind? kind,
    String? colorHex,
    String? symbol,
    List<String>? options,
    int? targetMinutes,
    double? targetNumber,
    String? unit,
    String? startDay,
    String? archivedOn,
    bool clearArchivedOn = false,
  }) => Habit(
    id: id ?? this.id,
    title: title ?? this.title,
    note: note ?? this.note,
    kind: kind ?? this.kind,
    colorHex: colorHex ?? this.colorHex,
    symbol: symbol ?? this.symbol,
    options: options ?? this.options,
    targetMinutes: targetMinutes ?? this.targetMinutes,
    targetNumber: targetNumber ?? this.targetNumber,
    unit: unit ?? this.unit,
    startDay: startDay ?? this.startDay,
    archivedOn: clearArchivedOn ? null : archivedOn ?? this.archivedOn,
  );

  bool eligible(String day) =>
      day.compareTo(startDay) >= 0 &&
      (archivedOn == null || day.compareTo(archivedOn!) < 0);

  double progress(HabitEntry entry) {
    if (entry.habitID != id) return 0;
    switch (kind) {
      case HabitKind.check:
        return entry.checked ? 1 : 0;
      case HabitKind.single:
      case HabitKind.multiple:
        return entry.selections.any(options.contains) ? 1 : 0;
      case HabitKind.duration:
        return (entry.minutes / (targetMinutes > 0 ? targetMinutes : 1)).clamp(
          0.0,
          1.0,
        );
      case HabitKind.number:
        final value = entry.number;
        if (value == null || !value.isFinite || !targetNumber.isFinite) {
          return 0;
        }
        return (value / (targetNumber > 0 ? targetNumber : 1)).clamp(0.0, 1.0);
      case HabitKind.text:
        return entry.text.trim().isEmpty ? 0 : 1;
    }
  }

  bool complete(HabitEntry entry) => progress(entry) >= 1;

  factory Habit.fromJson(Map<String, dynamic> json) {
    final rawKind = jsonString(json, 'kind');
    final kind = HabitKind.values
        .where((kind) => kind.name == rawKind)
        .firstOrNull;
    if (kind == null) throw const FormatException('Unknown habit type.');
    return Habit(
      id: jsonString(json, 'id'),
      title: jsonString(json, 'title'),
      note: jsonString(json, 'note'),
      kind: kind,
      colorHex: jsonString(json, 'colorHex'),
      symbol: jsonString(json, 'symbol'),
      options: jsonStrings(json, 'options'),
      targetMinutes: jsonInt(json, 'targetMinutes'),
      targetNumber: jsonNumber(json, 'targetNumber'),
      unit: jsonString(json, 'unit'),
      startDay: jsonString(json, 'startDay'),
      archivedOn: jsonOptionalString(json, 'archivedOn'),
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'title': title,
    'note': note,
    'kind': kind.name,
    'colorHex': colorHex,
    'symbol': symbol,
    'options': options,
    'targetMinutes': targetMinutes,
    'targetNumber': targetNumber,
    'unit': unit,
    'startDay': startDay,
    if (archivedOn != null) 'archivedOn': archivedOn,
  };
}

class HabitSession {
  const HabitSession({required this.topic, required this.minutes});

  final String topic;
  final int minutes;

  HabitSession copyWith({String? topic, int? minutes}) => HabitSession(
    topic: topic ?? this.topic,
    minutes: minutes ?? this.minutes,
  );

  factory HabitSession.fromJson(Map<String, dynamic> json) => HabitSession(
    topic: jsonString(json, 'topic'),
    minutes: jsonInt(json, 'minutes'),
  );

  Map<String, dynamic> toJson() => {'topic': topic, 'minutes': minutes};
}

class HabitEntry {
  HabitEntry({
    required String habitID,
    required this.day,
    this.checked = false,
    List<String> selections = const [],
    List<HabitSession> sessions = const [],
    this.minutes = 0,
    this.number,
    this.text = '',
  }) : habitID = habitID.toUpperCase(),
       selections = List.unmodifiable(selections),
       sessions = List.unmodifiable(sessions);

  final String habitID, day, text;
  final bool checked;
  final List<String> selections;
  final List<HabitSession> sessions;
  final int minutes;
  final double? number;

  HabitEntry copyWith({
    String? habitID,
    String? day,
    bool? checked,
    List<String>? selections,
    List<HabitSession>? sessions,
    int? minutes,
    double? number,
    String? text,
    bool clearNumber = false,
  }) => HabitEntry(
    habitID: habitID ?? this.habitID,
    day: day ?? this.day,
    checked: checked ?? this.checked,
    selections: selections ?? this.selections,
    sessions: sessions ?? this.sessions,
    minutes: minutes ?? this.minutes,
    number: clearNumber ? null : number ?? this.number,
    text: text ?? this.text,
  );

  bool get hasValue =>
      checked ||
      selections.isNotEmpty ||
      sessions.isNotEmpty ||
      minutes > 0 ||
      number != null ||
      text.trim().isNotEmpty;

  int get sessionMinutes =>
      sessions.fold(0, (total, session) => addMinutes(total, session.minutes));

  int get unassignedMinutes =>
      (minutes - sessionMinutes).clamp(0, maxSafeInteger);

  factory HabitEntry.fromJson(Map<String, dynamic> json) => HabitEntry(
    habitID: jsonString(json, 'habitID'),
    day: jsonString(json, 'day'),
    checked: jsonBool(json, 'checked'),
    selections: jsonStrings(json, 'selections'),
    sessions: json.containsKey('sessions')
        ? jsonObjects(json, 'sessions').map(HabitSession.fromJson).toList()
        : const [],
    minutes: jsonInt(json, 'minutes'),
    number: json['number'] == null ? null : jsonNumber(json, 'number'),
    text: jsonString(json, 'text'),
  );

  Map<String, dynamic> toJson() => {
    'habitID': habitID,
    'day': day,
    'checked': checked,
    'selections': selections,
    if (sessions.isNotEmpty)
      'sessions': sessions.map((session) => session.toJson()).toList(),
    'minutes': minutes,
    if (number != null) 'number': number,
    'text': text,
  };
}

class Journal {
  Journal({
    this.schemaVersion = 2,
    List<Habit> habits = const [],
    List<HabitEntry> entries = const [],
  }) : habits = List.unmodifiable(habits),
       entries = List.unmodifiable(entries);

  final int schemaVersion;
  final List<Habit> habits;
  final List<HabitEntry> entries;

  Journal copyWith({List<Habit>? habits, List<HabitEntry>? entries}) => Journal(
    schemaVersion: schemaVersion,
    habits: habits ?? this.habits,
    entries: entries ?? this.entries,
  );

  factory Journal.fromJson(Map<String, dynamic> json) {
    final version = jsonInt(json, 'schemaVersion');
    if (version != 1 && version != 2) {
      throw FormatException('Data format version $version is not supported.');
    }
    final entries = jsonObjects(json, 'entries');
    if (version == 1 && entries.any((entry) => entry.containsKey('sessions'))) {
      throw const FormatException(
        'Timed sessions require data format version 2.',
      );
    }
    return Journal(
      habits: jsonObjects(json, 'habits').map(Habit.fromJson).toList(),
      entries: entries.map(HabitEntry.fromJson).toList(),
    );
  }
  Map<String, dynamic> toJson() => {
    'schemaVersion': schemaVersion,
    'habits': habits.map((habit) => habit.toJson()).toList(),
    'entries': entries.map((entry) => entry.toJson()).toList(),
  };

  HabitEntry entry(String id, String day) {
    final canonicalID = id.toUpperCase();
    return entries
            .where((entry) => entry.habitID == canonicalID && entry.day == day)
            .firstOrNull ??
        HabitEntry(habitID: canonicalID, day: day);
  }

  Journal withEntry(HabitEntry entry) => copyWith(
    entries: [
      ...entries.where(
        (old) => old.habitID != entry.habitID || old.day != entry.day,
      ),
      if (entry.hasValue) entry,
    ],
  );

  List<Habit> habitsOn(String day, {bool includeArchived = true}) {
    final recorded = entries
        .where((entry) => entry.day == day && entry.hasValue)
        .map((entry) => entry.habitID)
        .toSet();
    return habits
        .where(
          (habit) =>
              (includeArchived || habit.archivedOn == null) &&
              (habit.eligible(day) || recorded.contains(habit.id)),
        )
        .toList(growable: false);
  }

  double progress(String day, {String? habitID}) {
    final eligible = habitsOn(
      day,
    ).where((habit) => habitID == null || habit.id == habitID.toUpperCase());
    if (eligible.isEmpty) return 0;
    return eligible.fold<double>(
          0,
          (sum, habit) => sum + habit.progress(entry(habit.id, day)),
        ) /
        eligible.length;
  }

  int completedCount(String day) => habitsOn(
    day,
  ).where((habit) => habit.complete(entry(habit.id, day))).length;

  int totalMinutes({String? day}) {
    final timed = habits
        .where((habit) => habit.kind == HabitKind.duration)
        .map((habit) => habit.id)
        .toSet();
    return entries
        .where(
          (entry) =>
              timed.contains(entry.habitID) &&
              (day == null || entry.day == day),
        )
        .fold(0, (total, entry) => addMinutes(total, entry.minutes));
  }

  int activeDays({int? year, String? through}) => entries
      .where(
        (entry) =>
            entry.hasValue &&
            (year == null || DayKey.year(entry.day) == year) &&
            (through == null || entry.day.compareTo(through) <= 0),
      )
      .map((entry) => entry.day)
      .toSet()
      .length;

  int streak(String today) => streakFromDays(
    entries.where((entry) => entry.hasValue).map((entry) => entry.day).toSet(),
    today,
  );
}

int streakFromDays(Set<String> active, String today) {
  if (!DayKey.valid(today)) return 0;
  var cursor = active.contains(today) ? today : DayKey.add(today, -1);
  var count = 0;
  while (active.contains(cursor)) {
    count++;
    final previous = DayKey.add(cursor, -1);
    if (previous == cursor) break;
    cursor = previous;
  }
  return count;
}

class DayKey {
  static final _pattern = RegExp(r'^[0-9]{4}-[0-9]{2}-[0-9]{2}$');
  static String today() => fromDate(DateTime.now());
  static String fromDate(DateTime date) {
    final local = date.toLocal();
    return '${local.year.toString().padLeft(4, '0')}-${local.month.toString().padLeft(2, '0')}-${local.day.toString().padLeft(2, '0')}';
  }

  static DateTime? parse(String key) {
    if (!_pattern.hasMatch(key)) return null;
    final year = int.parse(key.substring(0, 4));
    if (year < 1 || year > 9999) return null;
    final date = DateTime(
      year,
      int.parse(key.substring(5, 7)),
      int.parse(key.substring(8, 10)),
      12,
    );
    return fromDate(date) == key ? date : null;
  }

  static bool valid(String key) => parse(key) != null;
  static int year(String key) =>
      valid(key) ? int.parse(key.substring(0, 4)) : 0;
  static String add(String key, int count) {
    final date = parse(key);
    if (date == null) return key;
    // Construct a civil date rather than adding 24-hour durations across DST.
    final result = fromDate(
      DateTime(date.year, date.month, date.day + count, 12),
    );
    return valid(result) ? result : key;
  }
}

String jsonString(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is! String) throw FormatException('Invalid or missing $key.');
  return value;
}

String? jsonOptionalString(Map<String, dynamic> json, String key) =>
    json[key] == null ? null : jsonString(json, key);
int jsonInt(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is! int || !value.isFinite || value < 0 || value > maxSafeInteger) {
    throw FormatException('Invalid or missing $key.');
  }
  return value;
}

double jsonNumber(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is! num || !value.isFinite) {
    throw FormatException('Invalid or missing $key.');
  }
  return value.toDouble();
}

bool jsonBool(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is! bool) throw FormatException('Invalid or missing $key.');
  return value;
}

List<String> jsonStrings(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is! List || value.any((item) => item is! String)) {
    throw FormatException('Invalid or missing $key.');
  }
  return value.cast<String>();
}

List<Map<String, dynamic>> jsonObjects(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is! List || value.any((item) => item is! Map<String, dynamic>)) {
    throw FormatException('Invalid or missing $key.');
  }
  return value.cast<Map<String, dynamic>>();
}
