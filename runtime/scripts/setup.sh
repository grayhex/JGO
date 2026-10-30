#!/usr/bin/env bash
# Native (non-Docker) setup: builds everything needed to run `npm start`.
# Needs: JDK 21 (javac), git, Node >= 22.13, Rust (cargo), python3 (fixtures only).
set -euo pipefail
cd "$(dirname "$0")/../.."
need() { command -v "$1" >/dev/null || { echo "missing: $1" >&2; exit 1; }; }
for c in javac git node npm cargo; do need "$c"; done
[ -f runtime/build/kemulator/KEmulator.jar ] || bash runtime/scripts/build-kemulator.sh
cargo build --release --manifest-path bridge/kemulator-adapter/Cargo.toml
[ -d node_modules ] || npm ci
npm run build
bash tests/fixtures/testmidlet/build.sh runtime/build/kemulator/KEmulator.jar >/dev/null
MIDLET_NAME=KemTest2 MIDLET_VERSION=2.0.0 bash tests/fixtures/testmidlet/build.sh runtime/build/kemulator/KEmulator.jar tests/fixtures/testmidlet/build/kemtest2.jar >/dev/null
bash tests/fixtures/testmidlet3d/build.sh runtime/build/kemulator/KEmulator.jar >/dev/null
bash tests/fixtures/labgames/build.sh runtime/build/kemulator/KEmulator.jar >/dev/null
echo "OK. Start with:  npm start   (http://127.0.0.1:8080)"
echo "3D games need a display: run under 'xvfb-run -a' or set KEM_DISPLAY=:99 with Xvfb running (see README)."
