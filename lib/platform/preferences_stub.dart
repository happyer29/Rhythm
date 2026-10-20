class Preferences {
  static String? _value;
  static String? read() => _value;
  static void write(String language) {
    _value = language;
  }
}
