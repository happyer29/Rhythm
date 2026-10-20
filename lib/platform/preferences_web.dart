import 'package:web/web.dart' as web;

class Preferences {
  static String? read() => web.window.localStorage.getItem('rhythm.language');
  static void write(String language) =>
      web.window.localStorage.setItem('rhythm.language', language);
}
