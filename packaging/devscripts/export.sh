#!/usr/bin/env bash
# Prepares the files for a pull request to community-scripts/DevScripts (nothing is published by this script):
#   dist-devscripts/{ct/jgo.sh, install/jgo-install.sh, json/jgo.json, PR.md}
# The scripts in this repository point at grayhex/JGO; the exported copy points at DevScripts and carries the
# community-scripts header, which is what that repository's rules ask for. Usage: packaging/devscripts/export.sh [outdir]
set -euo pipefail
cd "$(dirname "$0")/../.."
out="$(realpath -m "${1:-dist-devscripts}")"
rm -rf "$out"
mkdir -p "$out"/{ct,install,json}

hdr() { # rewrite the licence header to the DevScripts one
  sed -e 's|^# Copyright (c) 2026 JGO contributors|# Copyright (c) 2021-2026 community-scripts ORG|' \
    -e 's|^# License: MIT .*|# License: MIT \| https://github.com/community-scripts/DevScripts/raw/main/LICENSE|' "$1"
}
hdr ct/jgo.sh | sed 's|^_CS_DEFAULT_URL=.*|_CS_DEFAULT_URL="https://raw.githubusercontent.com/community-scripts/DevScripts/main"|' >"$out/ct/jgo.sh"
hdr install/jgo-install.sh >"$out/install/jgo-install.sh"
jq --arg d "$(date -u +%F)" '.date_created=$d' json/jgo.json >"$out/json/jgo.json"
chmod +x "$out/ct/jgo.sh" "$out/install/jgo-install.sh"

node_major=$(jq -r '.engines.node' package.json)
sed -e "s|@NODE@|$node_major|" -e "s|@KEM_COMMIT@|$(grep -oP '^KEM_REF="\$\{KEM_REF:-\K[0-9a-f]+' runtime/scripts/build-kemulator.sh)|" \
  -e "s|@DATE@|$(date -u +%F)|" packaging/devscripts/PR_TEMPLATE.md >"$out/PR.md"

echo "exported to $out"
packaging/devscripts/lint.sh "$out" | tail -3
