import 'dart:convert';

/// Validate JSON integer fields before jsonDecode can round their source tokens.
///
/// This is a lexical preflight, not the journal schema validator. Call it before
/// jsonDecode, then run normal schema validation. It preserves number and
/// targetNumber tokens unchanged because those fields have Double semantics.
/// A browser-compatible journal uses canonical integer tokens in the range
/// 0...9007199254740991 for schemaVersion, targetMinutes, and minutes, including
/// each nested timed session's minutes.
void validateWebIntegerFields(String source) {
  _IntegerFieldPreflight(source).validate();
}

class _IntegerFieldPreflight {
  _IntegerFieldPreflight(this.source);

  static final _maximum = BigInt.parse('9007199254740991');
  static const _integerFields = {'schemaVersion', 'targetMinutes', 'minutes'};
  static const _maximumDepth = 256;
  final String source;
  int _index = 0;

  void validate() {
    _value(0);
    _whitespace();
    if (_index != source.length) _fail('Unexpected trailing JSON content.');
  }

  void _value(int depth, {String? integerField}) {
    if (depth > _maximumDepth) _fail('JSON nesting is too deep.');
    _whitespace();
    if (_index == source.length) _fail('Expected a JSON value.');
    final code = source.codeUnitAt(_index);
    if (integerField != null && code != 45 && !_isDigit(code)) {
      _fail('The $integerField field must be a whole JSON number.');
    }
    if (code == 45 || _isDigit(code)) {
      _number(integerField);
      return;
    }
    switch (code) {
      case 123: // {
        _index++;
        _whitespace();
        if (_take(125)) return;
        while (true) {
          _whitespace();
          if (_peek != 34) _fail('Expected a JSON object key.');
          final key = _string();
          _whitespace();
          _expect(58); // :
          _value(
            depth + 1,
            integerField: _integerFields.contains(key) ? key : null,
          );
          _whitespace();
          if (_take(125)) return;
          _expect(44); // ,
        }
      case 91: // [
        _index++;
        _whitespace();
        if (_take(93)) return;
        while (true) {
          _value(depth + 1);
          _whitespace();
          if (_take(93)) return;
          _expect(44);
        }
      case 34: // "
        _string();
        return;
      case 116:
        _literal('true');
        return;
      case 102:
        _literal('false');
        return;
      case 110:
        _literal('null');
        return;
      default:
        _fail('Invalid JSON value.');
    }
  }

  String _string() {
    final start = _index;
    _expect(34);
    while (_index < source.length) {
      final code = source.codeUnitAt(_index++);
      if (code == 34) {
        // Decode strings only: this handles escaped keys (including \u006d),
        // invalid escape sequences, and unescaped control characters correctly.
        try {
          return jsonDecode(source.substring(start, _index)) as String;
        } on FormatException {
          _fail('Invalid JSON string.');
        }
      }
      if (code == 92) {
        if (_index == source.length) _fail('Unterminated JSON escape.');
        _index++; // An escaped quote must not end this string.
      }
    }
    _fail('Unterminated JSON string.');
  }

  void _number(String? integerField) {
    final start = _index;
    _take(45); // -
    if (_take(48)) {
      if (_isDigit(_peek)) _fail('Leading zeros are not valid JSON numbers.');
    } else {
      if (_peek < 49 || _peek > 57) _fail('Invalid JSON number.');
      _digits();
    }
    var integerToken = true;
    if (_take(46)) {
      // .
      integerToken = false;
      if (!_isDigit(_peek)) _fail('Missing fractional digits.');
      _digits();
    }
    if (_peek == 69 || _peek == 101) {
      // E/e
      integerToken = false;
      _index++;
      if (_peek == 43 || _peek == 45) _index++;
      if (!_isDigit(_peek)) _fail('Missing exponent digits.');
      _digits();
    }
    if (integerField == null) return;
    if (!integerToken) {
      _fail(
        'The $integerField field must use an integer JSON token without a decimal point or exponent.',
      );
    }
    // Bound the token before constructing BigInt, so an oversized import
    // cannot spend time allocating an arbitrarily large integer.
    if (_index - start > 17) {
      _fail(
        'The $integerField field is outside the exact browser integer range (0–9007199254740991).',
      );
    }
    final value = BigInt.parse(source.substring(start, _index));
    if (value < BigInt.zero || value > _maximum) {
      _fail(
        'The $integerField field is outside the exact browser integer range (0–9007199254740991).',
      );
    }
  }

  void _digits() {
    while (_isDigit(_peek)) {
      _index++;
    }
  }

  void _literal(String value) {
    if (!source.startsWith(value, _index)) _fail('Invalid JSON literal.');
    _index += value.length;
  }

  void _whitespace() {
    while (_peek == 32 || _peek == 9 || _peek == 10 || _peek == 13) {
      _index++;
    }
  }

  bool _take(int code) {
    if (_peek != code) return false;
    _index++;
    return true;
  }

  void _expect(int code) {
    if (!_take(code)) _fail('Expected ${String.fromCharCode(code)} in JSON.');
  }

  int get _peek => _index < source.length ? source.codeUnitAt(_index) : -1;
  static bool _isDigit(int code) => code >= 48 && code <= 57;
  Never _fail(String message) => throw FormatException(message, null, _index);
}
