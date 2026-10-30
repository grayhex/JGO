#!/usr/bin/env bash
# Builds kemtest3d.jar (M3G smoke test). Usage: build.sh <KEmulator.jar> [out.jar]
set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd)/../../../runtime/scripts/lib.sh"
here="$(cd "$(dirname "$0")" && pwd)"
api="${1:?usage: build.sh <KEmulator.jar> [out.jar]}"
out="${2:-$here/build/kemtest3d.jar}"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
mkdir -p "$work/classes" "$(dirname "$out")"
javac_checked --release 8 -nowarn -cp "$api" -d "$work/classes" "$here"/src/kemtest3d/*.java
python3 - "$work/classes" <<'PY'
import sys, pathlib
for f in pathlib.Path(sys.argv[1]).rglob("*.class"):
    b = bytearray(f.read_bytes()); b[6:8] = (48).to_bytes(2, "big"); f.write_bytes(bytes(b))
PY
cat > "$work/MANIFEST.MF" <<MF
Manifest-Version: 1.0
MIDlet-Name: Kem3D
MIDlet-Vendor: j2me-web
MIDlet-Version: 1.0.0
MIDlet-1: Kem3D, , kemtest3d.Kem3D
MicroEdition-Configuration: CLDC-1.1
MicroEdition-Profile: MIDP-2.0
MIDlet-API-Version: 1.0
MF
jar cfm "$out" "$work/MANIFEST.MF" -C "$work/classes" .
echo "built $out"
