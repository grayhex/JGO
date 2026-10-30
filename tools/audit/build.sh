#!/usr/bin/env bash
# Builds the audit probes into tools/audit/build/: two MIDlets (media, LCDUI) and their assets.
# Needs the KEmulator build (runtime/build/kemulator/KEmulator.jar), ffmpeg (MP3/WAV) and python3.
# The AMR file is a synthetic bit stream (valid framing, arbitrary payload): it proves that the decoder
# path runs, not that it sounds right. Nothing here is copyrighted material.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
. "$root/runtime/scripts/lib.sh"
api="${1:-$root/runtime/build/kemulator/KEmulator.jar}"
out="$here/build"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
mkdir -p "$work/classes" "$out"
javac_checked --release 8 -nowarn -cp "$api" -d "$work/classes" "$here"/src/*.java
python3 "$root/tests/fixtures/tools/j2me_downgrade.py" "$work/classes"

# --- assets (all generated) ---
ffmpeg -v error -y -f lavfi -i "sine=frequency=440:duration=1.5" -ar 22050 -ac 1 -c:a pcm_s16le "$work/classes/a.wav"
ffmpeg -v error -y -f lavfi -i "sine=frequency=880:duration=1.5" -ar 22050 -ac 1 -c:a libmp3lame -b:a 64k "$work/classes/a.mp3"
python3 - "$work/classes" <<'PY'
import struct, sys
d = sys.argv[1]
# AMR-NB storage format: "#!AMR\n" + frames of (header byte, payload). Mode 7 (12.2 kbit/s) = 31 payload bytes.
x = 12345
frames = bytearray(b"#!AMR\n")
for _ in range(75):
    frames.append((7 << 3) | 4)
    for _ in range(31):
        x = (x * 1103515245 + 12345) & 0x7fffffff
        frames.append((x >> 16) & 0xff)
open(d + "/a.amr", "wb").write(frames)
# a 16x16 PNG icon, so that the MIDlet-Icon / "I" packet path is exercised
import zlib
def chunk(t, b): return struct.pack(">I", len(b)) + t + b + struct.pack(">I", zlib.crc32(t + b) & 0xffffffff)
rows = b"".join(b"\x00" + bytes([200, 60, 20, 255] * 16) for _ in range(16))
open(d + "/icon.png", "wb").write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 16, 16, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b""))
# Standard MIDI File, format 0, one channel, middle C for one second at 120 bpm
trk = bytearray()
trk += b"\x00\xc0\x00"                      # program 0
trk += b"\x00\x90\x3c\x64"                  # note on
trk += b"\x83\x60\x80\x3c\x40"              # +480 ticks note off
trk += b"\x00\xff\x2f\x00"
open(d + "/a.mid", "wb").write(b"MThd" + struct.pack(">IHHH", 6, 0, 1, 480) + b"MTrk" + struct.pack(">I", len(trk)) + trk)
PY
mk() { # mk <jar> <class> <name> [extra manifest lines]
  local file="$1" cls="$2" name="$3"; shift 3
  { printf 'Manifest-Version: 1.0\nMIDlet-Name: %s\nMIDlet-Vendor: j2me-web\nMIDlet-Version: 1.0.0\nMIDlet-Icon: /icon.png\nMIDlet-1: %s, /icon.png, %s\nMicroEdition-Configuration: CLDC-1.1\nMicroEdition-Profile: MIDP-2.0\n' "$name" "$name" "$cls"
    for l in "$@"; do printf '%s\n' "$l"; done; } > "$work/MF"
  ( cd "$work/classes" && jar cfm "$out/$file" "$work/MF" . )
  echo "built $out/$file"
}
mk probe-media.jar MediaProbe MediaProbe
mk probe-lcdui.jar LcduiProbe LcduiProbe
mk probe-api.jar ApiProbe ApiProbe
