#!/bin/bash
set -euo pipefail
RHYTHM_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RHYTHM_ROOT"
./scripts/flutterw.sh pub get
# Direct Dart analysis handles non-ASCII workspace paths in Flutter 3.47.
./scripts/flutterw.sh dart analyze --fatal-infos
./scripts/flutterw.sh test
./scripts/flutterw.sh build web --release --no-web-resources-cdn
node scripts/prepare-dist.mjs
