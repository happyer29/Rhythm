void attachBrowserHooks(Future<String> Function(String, String) action) {}
void setBrowserUnsaved(bool value) {}
void detachBrowserHooks() {}
Future<void> signOut() async {}
bool downloadBackup(String fileName, String json) => false;
Future<String?> pickBackup() async => null;
