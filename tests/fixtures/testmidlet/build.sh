#!/usr/bin/env bash
# Builds kemtest.jar (env: MIDLET_NAME, MIDLET_VERSION to make variants). Needs a MIDP API on the classpath: pass the KEmulator jar as $1.
set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd)/../../../runtime/scripts/lib.sh"
here="$(cd "$(dirname "$0")" && pwd)"
api="${1:?usage: build.sh <KEmulator.jar> [out.jar]}"
out="${2:-$here/build/kemtest.jar}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/classes" "$(dirname "$out")"
javac_checked --release 8 -nowarn -cp "$api" -d "$work/classes" "$here"/src/kemtest/*.java
# KEmulator refuses class files >= 49 (Java 5); real J2ME jars are 46..48. Downgrade the
# major version of our Java-8 output (no lambdas/generics bridges are used by the MIDlet).
python3 "$here/../tools/j2me_downgrade.py" "$work/classes"
cat > "$work/MANIFEST.MF" <<MF
Manifest-Version: 1.0
MIDlet-Name: ${MIDLET_NAME:-KemTest}
MIDlet-Vendor: j2me-web
MIDlet-Version: ${MIDLET_VERSION:-1.0.0}
MIDlet-1: KemTest, , kemtest.KemTest
MicroEdition-Configuration: CLDC-1.1
MicroEdition-Profile: MIDP-2.0
MF
jar cfm "$out" "$work/MANIFEST.MF" -C "$work/classes" .
echo "built $out"
