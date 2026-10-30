#!/usr/bin/env bash
# Builds the lab fixture JARs into build/. Usage: build.sh <KEmulator.jar> [outdir]
set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd)/../../../runtime/scripts/lib.sh"
here="$(cd "$(dirname "$0")" && pwd)"
api="${1:?usage: build.sh <KEmulator.jar> [outdir]}"
out="${2:-$here/build}"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
mkdir -p "$work/classes" "$out"
javac_checked --release 8 -nowarn -cp "$api" -d "$work/classes" "$here"/src/labgames/*.java
python3 "$here/../tools/j2me_downgrade.py" "$work/classes"
# jar <file> <MIDlet-Name> <class> [extra manifest lines...]
mk() {
  local file="$1" name="$2" cls="$3"; shift 3
  { printf 'Manifest-Version: 1.0\nMIDlet-Name: %s\nMIDlet-Vendor: j2me-web\nMIDlet-Version: 1.0.0\nMIDlet-1: %s, , labgames.%s\nMicroEdition-Configuration: CLDC-1.1\nMicroEdition-Profile: MIDP-2.0\n' "$name" "$name" "$cls"
    for l in "$@"; do printf '%s\n' "$l"; done; } > "$work/MF"
  # only this MIDlet's own classes (KemX.class + KemX$*.class): the analyzer must not see its siblings
  ( cd "$work/classes" && jar cfm "$out/$file" "$work/MF" labgames/"$cls".class labgames/"$cls"\$*.class 2>/dev/null || jar cfm "$out/$file" "$work/MF" labgames/"$cls".class )
  echo "built $out/$file"
}
for s in form list textbox alert canvascmd; do mk "kemscreens-$s.jar" "KemScreens-$s" KemScreens "KemLab-Screen: $s"; done
mk kemgame.jar KemGame KemGame
mk kemnokia.jar KemNokia KemNokia "Nokia-MIDlet-Category: Game" "Nokia-UI-Enhancement: true"
mk kemmascot.jar KemMascot KemMascot
mk kemnet.jar KemNet KemNet "MIDlet-Permissions: javax.microedition.io.Connector.http"

mk kemtext.jar KemText KemText
mk kemsms.jar KemSms KemSms "MIDlet-Permissions: javax.wireless.messaging.sms.send"
mk kemmidi.jar KemMidi KemMidi
mk kemshutdown.jar KemShutdown KemShutdown

mk kemshutdown-hang.jar KemShutdownHang KemShutdown "KemShutdown-Hang: true"
