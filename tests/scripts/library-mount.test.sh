#!/usr/bin/env bash
# tools/proxmox/jgo-library-mount.sh against a fake `pct`: what it passes to Proxmox, and what it refuses.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
SCRIPT=$PWD/tools/proxmox/jgo-library-mount.sh
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/games/sub" "$tmp/private"
chmod 755 "$tmp/games" "$tmp/games/sub"
chmod 700 "$tmp/private"
ln -s "$tmp/games" "$tmp/link"
fail=0
check() { if "$@"; then printf '  ✔ %s\n' "$DESC"; else printf '  ✘ %s\n' "$DESC"; fail=$((fail + 1)); fi; }

# fake pct: `pct config N` prints $CONF (exit 2 for unknown containers), everything else is logged
cat >"$tmp/pct" <<'F'
#!/usr/bin/env bash
if [[ $1 == config ]]; then
  [[ $2 == 101 ]] || exit 2
  [[ -f $FAKE_CONF ]] && cat "$FAKE_CONF"
  exit 0
fi
echo "pct $*" >>"$FAKE_LOG"
F
chmod +x "$tmp/pct"
export PCT_BIN="$tmp/pct" FAKE_CONF="$tmp/conf" FAKE_LOG="$tmp/log"
printf 'arch: amd64\nhostname: jgo\nunprivileged: 1\n' >"$tmp/conf"

run() { : >"$FAKE_LOG"; OUT=$(bash "$SCRIPT" "$@" 2>&1); RC=$?; LOG=$(cat "$FAKE_LOG"); }

DESC="read-only bind mount to /mnt/jgo-library, then a reboot"
run 101 "$tmp/games"
check test $RC -eq 0 -a "$LOG" = "pct set 101 --mp0 $tmp/games,mp=/mnt/jgo-library,ro=1
pct reboot 101"

DESC="--rw leaves out ro=1, --no-reboot does not reboot"
run 101 "$tmp/games" --rw --no-reboot
check test $RC -eq 0 -a "$LOG" = "pct set 101 --mp0 $tmp/games,mp=/mnt/jgo-library"

DESC="the next free slot is used"
printf 'mp0: /x,mp=/mnt/other\nmp1: /y,mp=/mnt/more,ro=1\n' >"$tmp/conf"
run 101 "$tmp/games" --no-reboot
check test $RC -eq 0 -a "$LOG" = "pct set 101 --mp2 $tmp/games,mp=/mnt/jgo-library,ro=1"

DESC="a second library mount is refused"
printf 'mp0: /srv/games,mp=/mnt/jgo-library,ro=1\n' >"$tmp/conf"
run 101 "$tmp/games"
check test $RC -ne 0 -a -z "$LOG"

DESC="--remove deletes exactly that mount point"
run 101 --remove --no-reboot
check test $RC -eq 0 -a "$LOG" = "pct set 101 --delete mp0"
printf 'arch: amd64\n' >"$tmp/conf"

DESC="--remove without a mount is an error"
run 101 --remove
check test $RC -ne 0 -a -z "$LOG"

DESC="--dry-run prints the command and runs nothing"
run 101 "$tmp/games" --dry-run
check test $RC -eq 0 -a -z "$LOG" && grep -q 'pct set 101 --mp0' <<<"$OUT"

for bad in "$tmp/games,ro=0" "$tmp/games ro" "$tmp/games/../private" '/' '/etc' '/etc/ssh' '/root' '/proc/1' 'relative/dir' "$tmp/nope" "$tmp/link" "$tmp/games;x" "$tmp/\$(id)"; do
  DESC="refused: $bad"
  run 101 "$bad" --no-reboot
  check test $RC -ne 0 -a -z "$LOG"
done

DESC="unknown container is refused"
run 999 "$tmp/games"
check test $RC -ne 0 -a -z "$LOG"

DESC="a folder that others cannot read gets a warning with the fix (still mounted)"
run 101 "$tmp/private" --no-reboot
check test $RC -eq 0 && grep -q 'not readable' <<<"$OUT" && grep -q 'chmod o+rx' <<<"$OUT"

DESC="a readable folder gets no such warning"
run 101 "$tmp/games" --no-reboot
check test $RC -eq 0 && ! grep -q 'not readable' <<<"$OUT"

echo
if ((fail)); then echo "library-mount: $fail check(s) failed"; exit 1; fi
echo "library-mount: all checks passed"
