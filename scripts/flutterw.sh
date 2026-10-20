#!/bin/bash
set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -n "${FLUTTER_BIN:-}" ]; then
  RHYTHM_FLUTTER="$FLUTTER_BIN"
elif command -v flutter >/dev/null 2>&1; then
  RHYTHM_FLUTTER="$(command -v flutter)"
else
  echo 'Flutter SDK not found. Add flutter to PATH or set FLUTTER_BIN to its executable.' >&2
  exit 1
fi
cd "$PROJECT_DIR"
if [ "${1:-}" = "dart" ]; then
  shift
  exec "$(dirname "$RHYTHM_FLUTTER")/dart" "$@"
fi
exec "$RHYTHM_FLUTTER" "$@"
