#!/usr/bin/env bash
# End-to-end test of the Proxmox/LXC install path, on a Debian 13 system container with systemd as PID 1.
#
#   tests/lxc/run.sh                      all scenarios (about 8 minutes, needs Docker + root)
#   ONLY="install functional" tests/lxc/run.sh
#   KEEP=1 tests/lxc/run.sh               leave the containers running for a look around
#
# What is real: install/jgo-install.sh runs unmodified, inside the container, with the Community Scripts engine
# (community-scripts/core at the commit in core.pin) as FUNCTIONS_FILE_PATH; ct/jgo.sh runs the same way an
# `update` inside a container does. What is faked: GitHub. A local TLS server answers for api.github.com and
# github.com, so the engine's own release helpers and `jgo update` fetch a locally built release.
# The same scenarios run on a real unprivileged LXC container in CI (tests/lxc/lxd.sh).
set -Eeuo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
WORK="${WORK:-$root/.lxc-test}"
CT="${CT:-jgo-lxc-test}"
CT_B="$CT-b"
BACKEND="${BACKEND:-docker}"
CORE_DIR="${CORE_DIR:-$WORK/core}"
ONLY="${ONLY:-}"
PORT=8080

mkdir -p "$WORK"
pass=0 fail=0 failed=()
log() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok() { printf '  \033[32m✔\033[0m %s\n' "$*"; pass=$((pass + 1)); }
no() { printf '  \033[31m✘\033[0m %s\n' "$*"; fail=$((fail + 1)); failed+=("$*"); }
check() { # check "description" command...
  local d=$1
  shift
  if "$@" >"$WORK/last.out" 2>&1; then ok "$d"; else
    no "$d"
    sed 's/^/      | /' "$WORK/last.out" | tail -n 15
  fi
}
expect_fail() { # expect_fail "description" command...
  local d=$1
  shift
  if "$@" >"$WORK/last.out" 2>&1; then
    no "$d (it succeeded)"
    sed 's/^/      | /' "$WORK/last.out" | tail -n 8
  else ok "$d"; fi
}
eq() { [[ "$1" == "$2" ]] || { echo "expected '$2', got '$1'"; return 1; }; }
ne() { [[ "$1" != "$2" ]] || { echo "both are '$1'"; return 1; }; }

# --- proxy / CA plumbing (only when the host itself needs an egress proxy, as in some sandboxes) ----------------
PROXY_ENV=()
EXTRA_CA="${HARNESS_EXTRA_CA:-}"
[[ -z $EXTRA_CA && -f /root/.ccr/ca-bundle.crt ]] && EXTRA_CA=/root/.ccr/ca-bundle.crt
if [[ -n ${HTTPS_PROXY:-} ]]; then
  PROXY_ENV=(-e "HTTPS_PROXY=$HTTPS_PROXY" -e "https_proxy=$HTTPS_PROXY" -e "HTTP_PROXY=${HTTP_PROXY:-$HTTPS_PROXY}" -e "http_proxy=${HTTP_PROXY:-$HTTPS_PROXY}"
    -e "NO_PROXY=api.github.com,github.com,127.0.0.1,localhost" -e "no_proxy=api.github.com,github.com,127.0.0.1,localhost")
fi
# shellcheck source=/dev/null
. "$here/backend-$BACKEND.sh"
cx() { be_exec "$CT" "$@"; }    # run in container A
cxb() { be_exec "$CT_B" "$@"; } # run in container B
sh_() { cx bash -c "$*"; }

ct_ip() { be_ip "$1"; }
token() { sh_ "sed -n 's/^AUTH_TOKEN=//p' /etc/jgo/jgo.env"; }
smoke() { BASE="http://$(ct_ip "$CT"):$PORT" TOKEN="$(token)" node "$here/smoke.mjs" "$@"; }
version() { sh_ "tr -d '[:space:]' </opt/jgo/VERSION"; }
health_version() { sh_ "curl -fsS http://127.0.0.1:$PORT/api/health | jq -r .version"; }
wait_health() { # wait_health <seconds> [container exec fn]
  local i
  for ((i = 0; i < $1; i++)); do
    sh_ "curl -fsS http://127.0.0.1:$PORT/api/health | jq -e .ok >/dev/null" 2>/dev/null && return 0
    sleep 1
  done
  return 1
}
wait_ct() { # wait until the container has an address and the API answers (after a snapshot or a restart)
  local i
  for ((i = 0; i < 120; i++)); do
    [[ -n $(ct_ip "$1") ]] && sh_ "curl -fsS http://127.0.0.1:$PORT/api/health >/dev/null" 2>/dev/null && return 0
    sleep 1
  done
  return 1
}
launches() { smoke launches | sed -n 's/^LAUNCHES=//p'; }

cleanup() {
  [[ ${KEEP:-0} == 1 ]] && { echo "KEEP=1: containers $CT / $CT_B and the fake GitHub (pid $(cat "$WORK/fake.pid" 2>/dev/null)) are left running"; return; }
  be_rm "$CT" "$CT_B" jgo-lxc-test-fresh
  [[ -f $WORK/fake.pid ]] && kill "$(cat "$WORK/fake.pid")" 2>/dev/null || true
}
trap cleanup EXIT

# ----------------------------------------------------------------------------------------------------------------
prepare() {
  log "prepare: engine checkout, releases, fake GitHub, image"
  if [[ ! -d $CORE_DIR/.git ]]; then
    git clone -q https://github.com/community-scripts/core.git "$CORE_DIR"
  fi
  git -C "$CORE_DIR" fetch -q origin "$(cat "$here/core.pin")" 2>/dev/null || true
  git -C "$CORE_DIR" checkout -q "$(cat "$here/core.pin")"
  ok "community-scripts/core at $(git -C "$CORE_DIR" rev-parse --short HEAD)"

  (cd "$root" && npm run build >/dev/null) && ok "API and web UI built from the working tree"
  rm -rf "$WORK/releases" "$WORK/tls"
  mkdir -p "$WORK/releases" "$WORK/tls" "$WORK/build"
  # A = what the installer deploys, B = a newer release, BAD = a release whose server dies on start, SUM = tampered download
  for v in 0.2.0-test 0.2.1-test; do
    "$root/packaging/build-release.sh" "$v" "$WORK/build/$v" >/dev/null
    mkdir -p "$WORK/releases/v$v"
    cp "$WORK/build/$v"/* "$WORK/releases/v$v/"
  done
  local tmp
  tmp=$(mktemp -d)
  tar -xzf "$WORK/build/0.2.1-test/jgo-0.2.1-test-linux-amd64.tar.gz" -C "$tmp"
  mv "$tmp/jgo-0.2.1-test" "$tmp/jgo-0.2.2-broken"
  echo 0.2.2-broken >"$tmp/jgo-0.2.2-broken/VERSION"
  chmod u+w "$tmp/jgo-0.2.2-broken/app/apps/api/dist/server.js"
  echo "throw new Error('this release is broken on purpose');" >"$tmp/jgo-0.2.2-broken/app/apps/api/dist/server.js"
  mkdir -p "$WORK/releases/v0.2.2-broken"
  tar -C "$tmp" -czf "$WORK/releases/v0.2.2-broken/jgo-0.2.2-broken-linux-amd64.tar.gz" jgo-0.2.2-broken
  (cd "$WORK/releases/v0.2.2-broken" && sha256sum ./*.tar.gz | sed 's# \./# #' >SHA256SUMS)
  mkdir -p "$WORK/releases/v0.2.3-badsum"
  cp "$WORK/build/0.2.1-test/jgo-0.2.1-test-linux-amd64.tar.gz" "$WORK/releases/v0.2.3-badsum/jgo-0.2.3-badsum-linux-amd64.tar.gz"
  echo "0000000000000000000000000000000000000000000000000000000000000000  jgo-0.2.3-badsum-linux-amd64.tar.gz" >"$WORK/releases/v0.2.3-badsum/SHA256SUMS"
  rm -rf "$tmp"
  echo v0.2.0-test >"$WORK/releases/latest"

  # TLS: a throwaway CA, trusted inside the container only, signs the certificate for the GitHub hostnames
  local d="$WORK/tls"
  openssl req -x509 -newkey rsa:2048 -nodes -keyout "$d/ca.key" -out "$d/ca.crt" -days 2 -subj "/CN=JGO test CA" 2>/dev/null
  openssl req -newkey rsa:2048 -nodes -keyout "$d/server.key" -out "$d/server.csr" -subj "/CN=api.github.com" 2>/dev/null
  printf 'subjectAltName=DNS:api.github.com,DNS:github.com,DNS:codeload.github.com,DNS:objects.githubusercontent.com\n' >"$d/san.cnf"
  openssl x509 -req -in "$d/server.csr" -CA "$d/ca.crt" -CAkey "$d/ca.key" -CAcreateserial -out "$d/server.crt" -days 2 -extfile "$d/san.cnf" 2>/dev/null
  node "$here/fake-github.mjs" "$WORK/releases" "$d" 443 >"$WORK/fake.log" 2>&1 &
  echo $! >"$WORK/fake.pid"
  local i
  for i in {1..30}; do grep -q 'fake GitHub on' "$WORK/fake.log" 2>/dev/null && break; sleep 0.2; done
  grep -q 'fake GitHub on' "$WORK/fake.log" || { cat "$WORK/fake.log"; echo "fake GitHub did not start (port 443 busy?)"; exit 1; }
  ok "fake GitHub serving v0.2.0-test (latest), v0.2.1-test, v0.2.2-broken, v0.2.3-badsum"

  be_prepare
  ok "backend: $(be_describe)"
}

install_in() { # install_in <exec fn>
  "$1" env \
    COMMUNITY_SCRIPTS_CORE_URL=file:///opt/cs-core COMMUNITY_SCRIPTS_CORE_DIR=/opt/cs-core \
    APPLICATION=JGO app=jgo NSAPP=jgo VERBOSE=no DIAGNOSTICS=no CTID=100 PCT_OSTYPE=debian PCT_OSVERSION=13 tz=Etc/UTC \
    PASSWORD= SSH_ROOT=no SESSION_ID=test RANDOM_UUID=test EXECUTION_ID=test var_ram=4096 PCT_DISK_SIZE=20 TELEMETRY_PLATFORM=pve \
    bash -c 'export FUNCTIONS_FILE_PATH="$(cat /opt/cs-core/lxc/install.func)"; bash /opt/jgo-src/install/jgo-install.sh'
}

run_ct() { # run the ct script as `update` does inside a container
  cx env COMMUNITY_SCRIPTS_CORE_DIR=/opt/cs-core COMMUNITY_SCRIPTS_ROOT=/opt/jgo-src COMMUNITY_SCRIPTS_CORE_URL=file:///opt/cs-core \
    COMMUNITY_SCRIPTS_URL=file:///opt/jgo-src PHS_SILENT=1 TERM=xterm bash /opt/jgo-src/ct/jgo.sh
}

# ---------------------------------------------------------------------------------------------------------- scenarios
t_install() {
  log "install: install/jgo-install.sh on a fresh Debian 13 container"
  be_start "$CT"
  check "the install script finishes" install_in cx
  check "version deployed from the (fake) GitHub release is 0.2.0-test" eq "$(version)" 0.2.0-test
  check "user jgo is a system user without a login shell" sh_ "getent passwd jgo | grep -q ':/usr/sbin/nologin\$'"
  check "services are active" sh_ "systemctl is-active --quiet jgo jgo-xvfb"
  check "services start at boot" sh_ "systemctl is-enabled --quiet jgo jgo-xvfb"
  check "/var/lib/jgo is jgo:700" eq "$(sh_ 'stat -c %U:%a /var/lib/jgo')" jgo:700
  check "/etc/jgo/jgo.env is root:jgo 640" eq "$(sh_ 'stat -c %U:%G:%a /etc/jgo/jgo.env')" root:jgo:640
  check "the application tree is not writable by jgo" expect_fail_in_ct "su -s /bin/sh jgo -c 'touch /opt/jgo/x'"
  check "a 32 character access token was generated" eq "$(token | wc -c)" 33
  check "/root/.jgo version stamp matches (so the engine's update check works)" eq "$(sh_ 'cat /root/.jgo')" 0.2.0-test
  check "jgo CLI is on the PATH" sh_ "command -v jgo"
  check "jgo doctor finds no problems" sh_ "jgo doctor"
  check "jgo status runs" sh_ "jgo status"
  be_snapshot "$CT" >"$WORK/snap" && ok "snapshot of the fresh install kept (for the migration test)"
  wait_ct "$CT"
}
expect_fail_in_ct() { ! sh_ "$1"; }

t_access() {
  log "access: authentication, headers"
  check "token auth: 401 without, 401 with a wrong one, 200 with the token, login cookie, UI, public health" smoke auth
  check "the service listens on the container address" sh_ "ss -ltn | grep -q '0.0.0.0:$PORT'"
}

t_functional() {
  log "functional: 2D, audio, M3G inside the container"
  check "2D game renders (reference pixels) and stops cleanly" smoke 2d
  check "game audio reaches the server" smoke audio
  check "M3G game renders on Mesa llvmpipe" smoke 3d
}

t_hardening() {
  log "hardening: sandbox and cgroup limits are in effect for the running emulator"
  local tok
  tok=$(token)
  BASE="http://$(ct_ip "$CT"):$PORT" TOKEN="$tok" node "$here/smoke.mjs" hold 40 >"$WORK/hold.out" 2>&1 &
  local holder=$!
  local jpid npid
  for _ in {1..40}; do jpid=$(sh_ "pgrep -x java | head -n1" || true); [[ -n $jpid ]] && break; sleep 0.5; done
  npid=$(sh_ "systemctl show -p MainPID --value jgo")
  if [[ -z $jpid ]]; then no "no emulator process found"; return; fi
  check "node API runs as jgo" eq "$(sh_ "ps -o user= -p $npid" | tr -d ' ')" jgo
  check "java runs as jgo" eq "$(sh_ "ps -o user= -p $jpid" | tr -d ' ')" jgo
  check "java has no capabilities and NoNewPrivs" eq "$(sh_ "grep -E '^(CapEff|NoNewPrivs)' /proc/$jpid/status | tr -s '\t ' ' ' | tr '\n' ' '")" "CapEff: 0000000000000000 NoNewPrivs: 1 "
  check "java is in its own network namespace (no network for games)" ne "$(sh_ "readlink /proc/$jpid/ns/net")" "$(sh_ "readlink /proc/$npid/ns/net")"
  check "inside that namespace there is no interface but lo" eq "$(sh_ "nsenter -t $jpid -n -- ip -o link | awk -F': ' '{print \$2}' | tr -d '\\n'")" lo
  check "java sits in the jgo.service cgroup" sh_ "grep -q 'jgo.service' /proc/$jpid/cgroup"
  check "the system-call filter is on (@system-service minus @privileged)" sh_ "grep -q '^Seccomp:.*2' /proc/$npid/status"
  check "memory, tasks and cpu limits are set on the unit" sh_ "systemctl show jgo -p MemoryMax -p TasksMax -p CPUQuotaPerSecUSec | grep -vq infinity"
  check "the JVM heap is capped (-Xmx768m)" sh_ "tr '\\0' ' ' </proc/$jpid/cmdline | grep -q -- '-Xmx768m'"
  # the service's own view of the file system, entered as root
  check "the service sees /opt/jgo read-only" expect_fail_in_ct "nsenter -t $npid -m -- touch /opt/jgo/should-not-work"
  check "the service sees /etc read-only" expect_fail_in_ct "nsenter -t $npid -m -- touch /etc/should-not-work"
  check "the service can write its data directory" sh_ "nsenter -t $npid -m -- touch /var/lib/jgo/.write-test && rm -f /var/lib/jgo/.write-test"
  check "/home is not visible to the service" expect_fail_in_ct "nsenter -t $npid -m -- ls /home/ | grep -q ."
  check "the service has a private /tmp" ne "$(sh_ "nsenter -t $npid -m -- stat -c %i /tmp")" "$(sh_ "stat -c %i /tmp")"
  check "doctor: emulator processes run as jgo while a game is running" sh_ "jgo doctor"
  kill "$holder" 2>/dev/null || true
  wait "$holder" 2>/dev/null || true
  sh_ "for s in \$(curl -fsS -H 'Authorization: Bearer $tok' http://127.0.0.1:$PORT/api/sessions | jq -r '.[].id'); do curl -fsS -X DELETE -H 'Authorization: Bearer $tok' http://127.0.0.1:$PORT/api/sessions/\$s >/dev/null; done" || true
}

t_rms_restart() {
  log "persistence: RMS survives session, service restart and a container reboot"
  local a b c d tok0
  tok0=$(token)
  a=$(launches)
  b=$(launches)
  check "RMS launch counter grows across sessions ($a -> $b)" eq "$b" "$((a + 1))"
  sh_ "systemctl restart jgo"
  wait_health 40 && ok "service restart: healthy again" || no "service did not come back after restart"
  c=$(launches)
  check "RMS survives a service restart ($b -> $c)" eq "$c" "$((b + 1))"
  be_restart "$CT"
  for _ in {1..60}; do wait_health 1 && break; sleep 1; done
  wait_health 60 && ok "container reboot: services came back by themselves" || no "services did not autostart after the reboot"
  d=$(launches)
  check "RMS survives a container reboot ($c -> $d)" eq "$d" "$((c + 1))"
  check "the access token survived the reboot unchanged" eq "$(token)" "$tok0"
}

t_library() {
  log "library folder, settings and secrets inside the container"
  be_cp_to "$CT" "$root/tests/fixtures/testmidlet/build/kemtest.jar" /root/kemtest-import.jar
  sh_ "install -d -o jgo -g jgo -m 755 /var/lib/jgo/import/sub && install -o jgo -g jgo -m 644 /root/kemtest-import.jar /var/lib/jgo/import/sub/kemtest.jar"
  check "jgo library lists the import folder" sh_ "jgo library | grep -q '/var/lib/jgo/import: readable'"
  check "settings, the folder check, the import and the secret handling" smoke library
  check "secrets.json is mode 600 and settings.json does not hold the key" sh_ "[ \$(stat -c %a /var/lib/jgo/secrets.json) = 600 ] && ! grep -q moby_lxc_test /var/lib/jgo/settings.json"
  check "jgo doctor accepts the library folder" sh_ "jgo doctor | grep -q 'library folder /var/lib/jgo/import is readable'"
}

t_backup() {
  log "backup and restore"
  local before after
  before=$(launches)
  check "jgo backup writes a checksummed archive (mode 600)" sh_ "jgo backup --out /var/backups/jgo/manual.tar.gz && [ \$(stat -c %a /var/backups/jgo/manual.tar.gz) = 600 ]"
  check "the archive holds the library, the saves and the configuration" sh_ "tar -tzf /var/backups/jgo/manual.tar.gz | grep -q library.sqlite && tar -tzf /var/backups/jgo/manual.tar.gz | grep -q 'saves/' && tar -tzf /var/backups/jgo/manual.tar.gz | grep -q 'etc/jgo.env'"
  check "... and the web settings with the MobyGames key" sh_ "tar -tzf /var/backups/jgo/manual.tar.gz | grep -q 'data/settings.json' && tar -tzf /var/backups/jgo/manual.tar.gz | grep -q 'data/secrets.json'"
  expect_fail "a damaged archive is refused" sh_ "cp /var/backups/jgo/manual.tar.gz /tmp/bad.tar.gz && printf x >>/tmp/bad.tar.gz && jgo restore /tmp/bad.tar.gz --yes"
  sh_ "systemctl stop jgo; rm -rf /var/lib/jgo/saves /var/lib/jgo/library.sqlite* /var/lib/jgo/settings.json /var/lib/jgo/secrets.json; systemctl start jgo"
  wait_health 40 || true
  check "after losing the data the counter starts from scratch" eq "$(launches)" 1
  check "jgo restore brings library and saves back" sh_ "jgo restore /var/backups/jgo/manual.tar.gz --yes"
  after=$(launches)
  check "the restored RMS continues where the backup was taken ($before -> $after)" eq "$after" "$((before + 1))"
  check "the restore brought the web settings back (volume 33, key stored, mode 600)" sh_ "grep -q '\"volume\": 33' /var/lib/jgo/settings.json && [ \$(stat -c %a /var/lib/jgo/secrets.json) = 600 ] && grep -q moby_lxc_test /var/lib/jgo/secrets.json"
  check "the restore made a safety copy first" sh_ "ls /var/backups/jgo/ | grep -q pre-restore"
}

run_ct_noop() {
  run_ct >"$WORK/ct-noop.out" 2>&1 || return 1
  grep -qi 'no update available' "$WORK/ct-noop.out"
}
publish() { echo "$1" >"$WORK/releases/latest"; }

t_update() {
  log "update: ct/jgo.sh update_script() against a newer release"
  local n0 n1
  n0=$(launches)
  publish v0.2.1-test
  check "ct script update finishes" run_ct
  check "installed version is now 0.2.1-test" eq "$(version)" 0.2.1-test
  check "the running service reports 0.2.1-test" eq "$(health_version)" 0.2.1-test
  check "/root/.jgo was advanced (engine's check_for_gh_release agrees)" eq "$(sh_ 'cat /root/.jgo')" 0.2.1-test
  check "the previous release is kept in /opt/jgo.prev" eq "$(sh_ 'cat /opt/jgo.prev/VERSION')" 0.2.0-test
  check "a pre-update backup was written" sh_ "ls /var/backups/jgo/ | grep -q pre-update-0.2.0-test"
  check "the access token was not touched" eq "$(token | wc -c)" 33
  n1=$(launches)
  check "RMS survived the update ($n0 -> $n1)" eq "$n1" "$((n0 + 1))"
  check "running the update again finds nothing to do" run_ct_noop
  check "jgo doctor is still clean" sh_ "jgo doctor"
  # the manual way back and forth, with the CLI directly
  check "jgo rollback returns to the previous release" sh_ "jgo rollback"
  check "... which is 0.2.0-test and healthy" eq "$(version) $(health_version)" "0.2.0-test 0.2.0-test"
  check "jgo update --yes goes forward again to 0.2.1-test" sh_ "jgo update --yes"
  check "... and the service runs it" eq "$(version) $(health_version)" "0.2.1-test 0.2.1-test"
  n1=$(launches)
  check "RMS survived both switches ($n0 -> $n1)" eq "$n1" "$((n0 + 2))"
}

t_update_failures() {
  log "update failures: rollback and verification"
  local n0 n1 since
  n0=$(launches)
  # 1. checksum mismatch: nothing may change, not even a restart
  publish v0.2.3-badsum
  since=$(sh_ "systemctl show jgo -p ActiveEnterTimestampMonotonic --value")
  expect_fail "a download whose SHA-256 does not match is refused" sh_ "jgo update --yes"
  check "... and the running service was not touched" eq "$(sh_ 'systemctl show jgo -p ActiveEnterTimestampMonotonic --value')" "$since"
  check "... and the version is unchanged" eq "$(version)" 0.2.1-test
  # 2. a release that crashes on start: automatic rollback
  publish v0.2.2-broken
  expect_fail "a release that does not start fails the update" sh_ "JGO_HEALTH_WAIT=15 jgo update --yes"
  check "rolled back: installed version is 0.2.1-test again" eq "$(version)" 0.2.1-test
  check "rolled back: the service runs 0.2.1-test and is healthy" eq "$(health_version)" 0.2.1-test
  check "rolled back: the broken tree is not left behind" expect_fail_in_ct "test -e /opt/jgo.failed"
  check "rolled back: /root/.jgo says 0.2.1-test" eq "$(sh_ 'cat /root/.jgo')" 0.2.1-test
  n1=$(launches)
  check "rolled back: RMS intact ($n0 -> $n1)" eq "$n1" "$((n0 + 1))"
}

t_migrate() {
  log "migration: restore a backup of container A into a freshly installed container B"
  local before after tokA
  before=$(launches)
  tokA=$(token)
  sh_ "jgo backup --out /var/backups/jgo/migrate.tar.gz" >/dev/null
  # A is finished with: stop it, so that B can have port 8080 and the X display on hosts where containers share a network namespace
  sh_ "systemctl stop jgo jgo-xvfb"
  be_cp_from "$CT" /var/backups/jgo/migrate.tar.gz "$WORK/migrate.tar.gz"
  # B = the snapshot taken right after the first install, with its own token
  be_start "$CT_B" "$(cat "$WORK/snap")"
  for _ in {1..60}; do cxb sh -c "curl -fsS http://127.0.0.1:$PORT/api/health >/dev/null" 2>/dev/null && break; sleep 1; done
  cxb jgo token --rotate >/dev/null
  local tokB
  tokB=$(cxb sed -n 's/^AUTH_TOKEN=//p' /etc/jgo/jgo.env)
  check "container B has a token of its own" ne "$tokA" "$tokB"
  be_cp_to "$CT_B" "$WORK/migrate.tar.gz" /root/migrate.tar.gz
  check "jgo restore --with-config on B" cxb jgo restore /root/migrate.tar.gz --yes --with-config
  check "B now uses the token of A" eq "$(cxb sed -n 's/^AUTH_TOKEN=//p' /etc/jgo/jgo.env)" "$tokA"
  after=$(BASE="http://$(ct_ip "$CT_B"):$PORT" TOKEN="$tokA" node "$here/smoke.mjs" launches 2>&1 | sed -n 's/^LAUNCHES=//p')
  check "the games and the RMS moved with it ($before -> $after)" eq "$after" "$((before + 1))"
  be_rm "$CT_B"
}

# --------------------------------------------------------------------------------------------------------------
prepare
for s in install access functional hardening rms_restart library backup update update_failures migrate; do
  if [[ -z $ONLY || " $ONLY " == *" $s "* ]]; then "t_$s"; fi
done
printf '\n\033[1m%d passed, %d failed\033[0m\n' "$pass" "$fail"
((fail == 0)) || { printf '  - %s\n' "${failed[@]}"; exit 1; }
