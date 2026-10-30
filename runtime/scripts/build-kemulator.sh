#!/usr/bin/env bash
# Builds KEmulator nnmod (x64 / multi-platform flavour) from source at a pinned commit,
# applying the patches in runtime/patches. Output: <outdir>/KEmulator.jar + native jars.
#
# Why from source: the upstream release jar is obfuscated and its `-bridge` switch never
# selects the Bridge frontend (see docs/BRIDGE.md, "Findings"). No KEmulator binaries or
# sources are stored in this repository.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
runtime_dir="$(dirname "$here")"
KEM_REPO="${KEM_REPO:-https://github.com/shinovon/KEmulator}"
# v2.22 (tag object resolves to this commit)
KEM_REF="${KEM_REF:-9ec1005af5448bca63a420e1dfa884ef53842d0f}"
KEM_SRC="${KEM_SRC:-}"          # optional: existing checkout to build from (it will be reset!)
outdir="$(realpath -m "${1:-$runtime_dir/build/kemulator}")"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

if [ -z "$KEM_SRC" ]; then
  KEM_SRC="$work/src"
  git init -q "$KEM_SRC"
  git -C "$KEM_SRC" remote add origin "$KEM_REPO"
  git -C "$KEM_SRC" fetch -q --depth 1 origin "$KEM_REF"
  git -C "$KEM_SRC" checkout -q FETCH_HEAD
else
  git -C "$KEM_SRC" checkout -q -f "$KEM_REF"
fi
actual="$(git -C "$KEM_SRC" rev-parse HEAD)"
[ "$actual" = "$KEM_REF" ] || { echo "unexpected commit $actual (wanted $KEM_REF)" >&2; exit 1; }

for p in "$runtime_dir"/patches/*.patch; do
  git -C "$KEM_SRC" apply "$p"
  echo "applied $(basename "$p")"
done

cd "$KEM_SRC"
# win32 SWT is needed at compile time only (FontData.data.lfHeight is used by the settings UI)
CP="home/swt-win32-x86_64.jar:$(ls lib/*.jar home/swt-gtk-linux-x86_64.jar | tr '\n' ':')"
find src/main src/media src/midp src/nnapi src/nokia src/oem src/3d x64/src m3g_lwjgl/src micro3d_gl/src \
  -name '*.java' > "$work/sources.txt"
mkdir -p "$work/stage"
javac -nowarn -encoding UTF-8 -source 8 -target 8 -XDignore.symbol.file \
  -cp "$CP" -d "$work/stage" @"$work/sources.txt" 2>&1 | grep -v '^Note:\|JAVA_TOOL_OPTIONS\|^warning' || true

# headless Java Sound provider (no sound card in containers); plain JDK APIs, our own code
mkdir -p "$work/audio-classes"
javac -nowarn -source 8 -target 8 -XDignore.symbol.file -d "$work/stage" $(find "$runtime_dir/audio/src" -name '*.java') 2>&1 \
  | grep -v '^Note:\|JAVA_TOOL_OPTIONS\|^warning' || true
mkdir -p "$work/stage/META-INF/services"
cp "$runtime_dir/audio/src/META-INF/services/javax.sound.sampled.spi.MixerProvider" "$work/stage/META-INF/services/"

# resources
cp -r src/res/. "$work/stage/"
for d in src/main src/media; do
  (cd "$d" && find . -type f ! -name '*.java' ! -path './META-INF/*' -exec cp --parents {} "$work/stage/" \;)
done
# bundled libraries (same set as the upstream KEmulator_x64 artifact)
for j in bridj-0.7.0 jinput jutils webcam-capture-0.3.12 asm-all-5.2 zip lwjgl-opengl lwjgl lwjgl3-swt-common \
         lwjgl-glfw vlcj-4.7.3 vlcj-natives-4.7.0 jna-5.7.0 jna-platform-5.7.0; do
  unzip -q -o "lib/$j.jar" -x 'META-INF/*' -d "$work/stage"
done
mkdir -p "$work/stage/META-INF"
printf 'Manifest-Version: 1.0\nGit-Revision: %s-j2meweb\n' "$(git describe --tags --always 2>/dev/null || echo "${KEM_REF:0:8}")" \
  > "$work/stage/META-INF/version.mf"

rm -rf "$outdir"; mkdir -p "$outdir"
jar cfm "$outdir/KEmulator.jar" src/main/META-INF/MANIFEST.MF -C "$work/stage" .
# runtime files expected next to KEmulator.jar
cp -r home/lang "$outdir/lang"
cp home/sensorsimulator.jar home/swt-gtk-linux-x86_64.jar \
   home/lwjgl-natives-linux.jar home/lwjgl-opengl-natives-linux.jar home/lwjgl-glfw-natives-linux.jar \
   home/lwjgl3-swt-linux.jar home/libjinput-linux64.so "$outdir/"
echo "$actual" > "$outdir/KEM_COMMIT"
echo "built $outdir/KEmulator.jar ($(du -h "$outdir/KEmulator.jar" | cut -f1)) from $actual"
