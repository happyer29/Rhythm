import 'dart:js_interop';
import 'dart:convert';

@JS('rhythmBrowser.attach')
external void _attach(JSFunction callback);
@JS('rhythmBrowser.setUnsaved')
external void _unsaved(JSBoolean value);
@JS('rhythmBrowser.detach')
external void _detach();
@JS('rhythmBrowser.logout')
external JSPromise<JSAny?> _logout();
@JS('rhythmBrowser.download')
external void _download(JSString fileName, JSString json);
@JS('rhythmBrowser.pickBackup')
external JSPromise<JSString> _pickBackup();

void attachBrowserHooks(Future<String> Function(String, String) action) {
  _attach(
    ((JSString name, JSString input) => action(
      name.toDart,
      input.toDart,
    ).then((value) => value.toJS).toJS).toJS,
  );
}

void setBrowserUnsaved(bool value) => _unsaved(value.toJS);
void detachBrowserHooks() => _detach();
Future<void> signOut() async {
  await _logout().toDart;
}

bool downloadBackup(String fileName, String json) {
  _download(fileName.toJS, json.toJS);
  return true;
}

Future<String?> pickBackup() async {
  final value =
      jsonDecode((await _pickBackup().toDart).toDart) as Map<String, dynamic>;
  if (value['cancelled'] == true) return null;
  if (value['error'] == true) {
    throw const FormatException(
      'Backup must be valid UTF-8 JSON smaller than 20 MB.',
    );
  }
  return value['json'] as String;
}
