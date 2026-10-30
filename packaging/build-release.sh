#!/usr/bin/env bash
# Assembles the release tarball that `jgo update` and install/jgo-install.sh deploy:
#   jgo-<version>-linux-amd64.tar.gz  +  SHA256SUMS            (written to <outdir>, default dist-release/)
#
# Needs the project built already (npm run setup does it, CI does the same steps):
#   apps/api/dist, apps/web/dist, packages/protocol/dist, runtime/build/kemulator, bridge/kemulator-adapter/target/release
# Usage: packaging/build-release.sh <version> [outdir]
set -euo pipefail
cd "$(dirname "$0")/.."

version="${1:?usage: build-release.sh <version> [outdir]}"
version="${version#v}"
[[ $version =~ ^[0-9A-Za-z._+-]+$ ]] || { echo "bad version: $version" >&2; exit 1; }
out="$(realpath -m "${2:-dist-release}")"

need=(apps/api/dist/server.js apps/web/dist/index.html packages/protocol/dist/index.js
  runtime/build/kemulator/KEmulator.jar runtime/build/kemulator/KEM_COMMIT bridge/kemulator-adapter/target/release/kem-adapter)
for f in "${need[@]}"; do [[ -e $f ]] || { echo "missing build output: $f (run: npm run setup)" >&2; exit 1; }; done

stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
root="$stage/jgo-$version"
mkdir -p "$root"/{app/packages/protocol,app/apps/api,app/apps/web,bin,kemulator,share/systemd,share/source}

# application: the production tree (workspace layout, runtime dependencies only)
cp package.json package-lock.json tsconfig.base.json "$root/app/"
cp packages/protocol/package.json "$root/app/packages/protocol/"
cp -r packages/protocol/dist "$root/app/packages/protocol/dist"
cp apps/api/package.json "$root/app/apps/api/"
cp -r apps/api/dist "$root/app/apps/api/dist"
cp apps/web/package.json "$root/app/apps/web/"
cp -r apps/web/dist "$root/app/apps/web/dist"
find "$root/app" \( -name '*.test.js' -o -name '*.map' \) -delete
(cd "$root/app" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund >/dev/null)

# KEmulator (built from the pinned upstream commit + runtime/patches) and the Bridge supervisor
cp -r runtime/build/kemulator/. "$root/kemulator/"
install -m 755 bridge/kemulator-adapter/target/release/kem-adapter "$root/bin/kem-adapter"
install -m 755 packaging/bin/jgo "$root/bin/jgo"
install -m 644 packaging/systemd/jgo.service packaging/systemd/jgo-xvfb.service "$root/share/systemd/"
install -m 644 packaging/jgo.env.example "$root/share/jgo.env.example"

# KEmulator is GPL/Apache/EPL: the corresponding source (patches, build script, upstream pin) ships with the binary
cp -r runtime/patches "$root/share/source/patches"
cp -r runtime/audio "$root/share/source/audio"
cp runtime/scripts/build-kemulator.sh runtime/scripts/lib.sh "$root/share/source/"
cp LICENSE "$root/LICENSE"
cat >"$root/share/source/SOURCE.md" <<S
# Corresponding source of kemulator/KEmulator.jar

Upstream:  https://github.com/shinovon/KEmulator  at commit $(cat runtime/build/kemulator/KEM_COMMIT)
Changes:   patches/*.patch (applied in order) and audio/ (Java Sound mixer) in this directory
Build:     build-kemulator.sh (needs JDK 21 and git); it prints the commit it built
The complete upstream tree of that commit is also published as the release asset jgo-kemulator-source-<commit>.tar.gz.
S

echo "$version" >"$root/VERSION"
chmod -R go-w "$root"

mkdir -p "$out"
name="jgo-$version-linux-amd64.tar.gz"
tar --sort=name --owner=0 --group=0 --numeric-owner --mtime="@${SOURCE_DATE_EPOCH:-$(git log -1 --format=%ct 2>/dev/null || date +%s)}" \
  -C "$stage" -czf "$out/$name" "jgo-$version"
(cd "$out" && sha256sum "$name" >SHA256SUMS)
echo "$out/$name  ($(du -h "$out/$name" | cut -f1))"
cat "$out/SHA256SUMS"
