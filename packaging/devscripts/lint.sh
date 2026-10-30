#!/usr/bin/env bash
# Mechanical check of ct/jgo.sh, install/jgo-install.sh and json/jgo.json against the rules in
# community-scripts/DevScripts AGENTS.md (the ones that can be checked without a human).
# Deviations that are on purpose are listed in packaging/devscripts/DEVIATIONS.md and are the only things allowed to differ.
# Usage: packaging/devscripts/lint.sh [dir containing ct/ install/ json/]   (default: the repository root)
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
base="${1:-.}"
ct="$base/ct/jgo.sh" inst="$base/install/jgo-install.sh" js="$base/json/jgo.json"
bad=0
fail() { printf '  ✘ %s\n' "$*"; bad=$((bad + 1)); }
ok() { printf '  ✔ %s\n' "$*"; }
chk() { local d=$1; shift; if "$@" >/dev/null 2>&1; then ok "$d"; else fail "$d"; fi; }

for f in "$ct" "$inst" "$js"; do [[ -f $f ]] || { echo "missing $f"; exit 1; }; done
echo "ct/jgo.sh"
chk "bash syntax" bash -n "$ct"
chk "shebang, then _CS_DEFAULT_URL on line 2" bash -c "[[ \$(sed -n 1p '$ct') == '#!/usr/bin/env bash' && \$(sed -n 2p '$ct') == _CS_DEFAULT_URL=* ]]"
chk "_cs_boot sourced from the engine on lines 3-4" bash -c "sed -n 3p '$ct' | grep -q '^_cs_boot=' && sed -n 4p '$ct' | grep -q 'source \"\$_cs_boot\"'"
chk "header: Copyright, Author, License, Source" bash -c "grep -q '^# Copyright' '$ct' && grep -q '^# Author:' '$ct' && grep -q '^# License:' '$ct' && grep -q '^# Source:' '$ct'"
chk "all var_* declarations present" bash -c "for v in var_tags var_cpu var_ram var_disk var_os var_version var_unprivileged; do grep -q \"^\$v=\" '$ct' || exit 1; done"
chk "var_arm64 decided, with a reason" grep -Eq '^var_arm64="\$\{var_arm64:-(yes|no)\}" #' "$ct"
chk "update_script is the only function" bash -c "[[ \$(grep -cE '^(function )?[a-z_]+\(\) *\{|^function [a-z_]+' '$ct') -eq 1 ]] && grep -q '^function update_script()' '$ct'"
chk "update_script: header_info, check_container_storage, check_container_resources" bash -c "grep -q '^  header_info' '$ct' && grep -q '^  check_container_storage' '$ct' && grep -q '^  check_container_resources' '$ct'"
chk "update_script: install check, check_for_gh_release, ends with exit" bash -c "grep -q 'No \${APP} Installation Found' '$ct' && grep -q 'check_for_gh_release \"jgo\" \"grayhex/JGO\"' '$ct' && grep -q '^  exit\$' '$ct'"
chk "tail: start, build_container, description, URL echo" bash -c "tail -12 '$ct' | grep -q '^start\$' && tail -12 '$ct' | grep -q '^build_container\$' && tail -12 '$ct' | grep -q '^description\$' && grep -q 'GATEWAY' '$ct'"
chk "no Docker, apt-get, sudo, su -c, banners" bash -c "! grep -Eiq 'docker|apt-get|sudo |su -c|^# *[=#-]{4,}' '$ct' '$inst'"
echo "install/jgo-install.sh"
chk "bash syntax" bash -n "$inst"
chk "header: Copyright, Author, License, Source" bash -c "grep -q '^# Copyright' '$inst' && grep -q '^# Author:' '$inst' && grep -q '^# License:' '$inst' && grep -q '^# Source:' '$inst'"
chk "engine preamble in the standard order" bash -c "grep -A6 'FUNCTIONS_FILE_PATH' '$inst' | tr '\n' ' ' | grep -q 'color.*verb_ip6.*catch_errors.*setting_up_container.*network_check.*update_os'"
chk "defines no functions" bash -c "! grep -Eq '^(function )?[a-z_]+\(\) *\{' '$inst'"
chk "ends with motd_ssh, customize, cleanup_lxc" bash -c "[[ \$(grep -v '^\$' '$inst' | tail -3 | tr '\n' ' ') == 'motd_ssh customize cleanup_lxc ' ]]"
chk "runtime through the engine: setup_nodejs" grep -q 'NODE_VERSION="22" setup_nodejs' "$inst"
chk "release through fetch_and_deploy_gh_release (explicit mode)" grep -q 'fetch_and_deploy_gh_release "jgo" "grayhex/JGO" "prebuild"' "$inst"
chk "random_password for the secret" grep -q 'random_password' "$inst"
chk "every apt call is silenced with \$STD" bash -c "! grep -E '^\s*apt ' '$inst'"
chk "msg_info / msg_ok are balanced" bash -c "[[ \$(grep -c '^msg_info' '$inst') -eq \$(grep -c '^msg_ok' '$inst') ]]"
chk "no decorative comment banners, no restating comments" bash -c "! grep -Eq '^# *[=#-]{4,}' '$inst'"
echo "json/jgo.json"
chk "valid JSON with the required fields" jq -e 'has("name") and has("slug") and has("categories") and has("date_created") and has("type") and has("updateable") and has("privileged") and has("interface_port") and has("documentation") and has("website") and has("repository") and has("logo") and has("description") and has("install_methods") and has("default_credentials") and has("notes")' "$js"
chk "slug is jgo, type ct, updateable, unprivileged" jq -e '.slug=="jgo" and .type=="ct" and .updateable==true and .privileged==false' "$js"
chk "repository is a full URL" jq -e '.repository|startswith("https://")' "$js"
chk "category id is valid (0-25)" jq -e '(.categories|length) as $n | ([.categories[]|select(.>=0 and .<=25)]|length)==$n' "$js"
chk "at most 3 notes, each of a known type, each <= 200 characters" jq -e '(.notes|length)<=3 and ([.notes[]|select((.type|IN("info","warning","error")) and (.text|length)<=200)]|length)==(.notes|length)' "$js"
chk "description <= 400 characters" jq -e '(.description|length)<=400' "$js"
chk "architectures agree with var_arm64=no" bash -c "jq -e '.architectures==[\"amd64\"]' '$js' && grep -q 'var_arm64:-no' '$ct'"
chk "install method resources match the ct defaults" bash -c "jq -r '.install_methods[0].resources|\"\\(.cpu) \\(.ram) \\(.hdd)\"' '$js' | grep -qx \"\$(grep -oP '^var_cpu=.*:-\\K[0-9]+' '$ct') \$(grep -oP '^var_ram=.*:-\\K[0-9]+' '$ct') \$(grep -oP '^var_disk=.*:-\\K[0-9]+' '$ct')\""
chk "script path exists" bash -c "[[ -f '$base/'\$(jq -r '.install_methods[0].script' '$js') ]]"
echo
((bad == 0)) && echo "DevScripts lint: all checks passed" || { echo "DevScripts lint: $bad problem(s)"; exit 1; }
