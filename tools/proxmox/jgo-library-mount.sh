#!/usr/bin/env bash
# Share a folder of the Proxmox VE host with a JGO container as the game library (read-only by default).
#
#   jgo-library-mount.sh CTID /path/on/host [--rw] [--mp mpN] [--no-reboot] [--dry-run]
#   jgo-library-mount.sh CTID --remove       [--no-reboot] [--dry-run]
#
# Run it on the Proxmox host as root. It only adds one bind mount (mp<N>) to the container configuration:
# the folder appears inside the container at /mnt/jgo-library, which JGO accepts as a library location.
# Nothing is copied, and nothing in the folder is changed (the mount is read-only unless you ask for --rw).
set -Eeuo pipefail

PCT=${PCT_BIN:-pct}
TARGET=/mnt/jgo-library
dry=0 reboot=1 ro=1 mp='' remove=0 ct='' dir=''

die() { printf '✘ %s\n' "$*" >&2; exit 1; }
say() { printf '%s\n' "$*"; }
run() { if ((dry)); then printf '+ %s\n' "$*"; else "$@"; fi; }

while (($#)); do
  case $1 in
  --rw) ro=0 ;;
  --mp) mp=${2:-}; shift ;;
  --no-reboot) reboot=0 ;;
  --dry-run) dry=1 ;;
  --remove) remove=1 ;;
  -h | --help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  -*) die "unknown option: $1" ;;
  *) if [[ -z $ct ]]; then ct=$1; elif [[ -z $dir ]]; then dir=$1; else die "unexpected argument: $1"; fi ;;
  esac
  shift
done

[[ $ct =~ ^[0-9]{3,9}$ ]] || die "usage: $(basename "$0") CTID /path/on/host [--rw] [--mp mpN] [--no-reboot] [--dry-run]"
[[ -z $mp || $mp =~ ^mp[0-9]{1,3}$ ]] || die "--mp must look like mp0"
if ((!dry)) && [[ -z ${PCT_BIN:-} ]]; then
  [[ $EUID -eq 0 ]] || die "run as root on the Proxmox VE host"
fi
command -v "$PCT" >/dev/null 2>&1 || die "pct not found: run this on the Proxmox VE host"

conf=$("$PCT" config "$ct" 2>/dev/null) || die "container $ct does not exist"
existing=$(printf '%s\n' "$conf" | sed -n "s|^\(mp[0-9]*\): .*mp=$TARGET\(,.*\)\{0,1\}\$|\1|p" | head -n1)

if ((remove)); then
  [[ -n $existing ]] || die "container $ct has no library mount at $TARGET"
  run "$PCT" set "$ct" --delete "$existing"
  say "✔ removed $existing from container $ct"
  ((reboot)) && run "$PCT" reboot "$ct"
  exit 0
fi

[[ -n $dir ]] || die "give the folder on the host that holds your .jar/.jad files"
# the value ends up inside a pct option string: no commas, spaces, quotes or anything else that could add options
[[ $dir =~ ^/[A-Za-z0-9_./+@-]+$ ]] || die "the path may only contain letters, digits and _ . / + @ - (no spaces or commas)"
[[ $dir != *..* ]] || die "the path must not contain .."
case $dir in
/ | /etc | /etc/* | /root | /root/* | /boot | /boot/* | /proc | /proc/* | /sys | /sys/* | /dev | /dev/* | /run | /run/* | /var/lib/pve-cluster | /var/lib/pve-cluster/* | /var/lib/lxc | /var/lib/lxc/*)
  die "refusing to share $dir with a container" ;;
esac
[[ -d $dir ]] || die "$dir is not a directory on this host"
real=$(readlink -f "$dir")
[[ $real == "$dir" ]] || die "$dir is a symbolic link to $real: give the real path"

[[ -z $existing ]] || die "container $ct already has $existing mounted at $TARGET (remove it first with --remove)"
if [[ -z $mp ]]; then
  for i in $(seq 0 255); do
    printf '%s\n' "$conf" | grep -q "^mp$i:" || { mp=mp$i; break; }
  done
fi
[[ -n $mp ]] || die "no free mount point slot"
printf '%s\n' "$conf" | grep -q "^$mp:" && die "$mp is already used by container $ct"

opts="$dir,mp=$TARGET"
((ro)) && opts="$opts,ro=1"
run "$PCT" set "$ct" "--$mp" "$opts"
say "✔ $dir will appear in container $ct at $TARGET ($( ((ro)) && echo read-only || echo read-write))"

# an unprivileged container maps its users to 100000+uid on the host: "others" must be able to read the files
mode=$(stat -c %a "$dir")
if (( (8#$mode & 5) != 5 )); then
  say "! $dir is not readable and enterable by 'others' (mode $mode). An unprivileged container will not be able to read it."
  say "  Fix:  chmod o+rx '$dir' && find '$dir' -type d -exec chmod o+rx {} + && find '$dir' -type f -exec chmod o+r {} +"
fi
if ((reboot)); then
  say "Restarting container $ct so that the mount point appears (games that are running are stopped)..."
  run "$PCT" reboot "$ct"
else
  say "Restart the container to apply it:  pct reboot $ct"
fi
say "Then open JGO > Settings > Game library and choose $TARGET."
