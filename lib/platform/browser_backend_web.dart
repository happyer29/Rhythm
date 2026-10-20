import 'dart:convert';
import 'dart:js_interop';
import '../core/repository.dart';

@JS('rhythmStorageCall')
external JSPromise<JSString> _call(
  JSString method,
  JSString json,
  JSNumber revision,
);

JournalBackend createJournalBackend() => BrowserBackend();

class BrowserBackend implements JournalBackend, JournalBackupBackend {
  Future<dynamic> _request(
    String method, {
    String json = '',
    int revision = 0,
  }) async {
    try {
      final result = jsonDecode(
        (await _call(method.toJS, json.toJS, revision.toJS).toDart).toDart,
      );
      if (result is! Map<String, dynamic>) {
        throw const RepositoryFailure('unavailable');
      }
      if (result['ok'] != true) {
        final observed = result['observedRevision'];
        throw RepositoryFailure(
          result['code'] as String? ?? 'unavailable',
          observedRevision: method == 'read' && observed is int
              ? observed
              : null,
        );
      }
      return result['value'];
    } on RepositoryFailure {
      rethrow;
    } catch (_) {
      throw const RepositoryFailure('unavailable');
    }
  }

  @override
  Future<Map<String, dynamic>> read() async =>
      Map<String, dynamic>.from(await _request('read') as Map);
  @override
  Future<int> write(String json, int revision) async =>
      await _request('write', json: json, revision: revision) as int;
  @override
  Future<String?> readBackup() async {
    final value = await _request('backup');
    return value == null ? null : value['json'] as String;
  }
}
