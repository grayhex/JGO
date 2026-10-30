# shellcheck shell=bash
# Backend: a real unprivileged LXC container (LXD/Incus `lxc` client) running the official Debian 13 image.
# This is the same kernel mechanism Proxmox VE uses for its containers. Sourced by run.sh; needs `lxc` and root or the lxd group.
LXC="${LXC_BIN:-lxc}"
LXD_IMAGE="${LXD_IMAGE:-images:debian/13}"

LXC_ENV=()
for _a in "${PROXY_ENV[@]}"; do [[ $_a == -e ]] || LXC_ENV+=(--env "$_a"); done
unset _a

be_prepare() { "$LXC" version >/dev/null; }

be_host_ip() { "$LXC" network get lxdbr0 ipv4.address 2>/dev/null | cut -d/ -f1 || true; }
be_ip() { "$LXC" list "^$1\$" -c 4 -f csv | awk '{print $1}'; }

be_start() { # be_start NAME [snapshot token]
  local name=$1 from=${2:-} i ip
  ip=$(be_host_ip)
  "$LXC" delete -f "$name" >/dev/null 2>&1 || true
  if [[ -n $from ]]; then
    "$LXC" copy "$from" "$name" >/dev/null && "$LXC" start "$name"
  else
    "$LXC" launch "$LXD_IMAGE" "$name" -c security.nesting=true >/dev/null
  fi
  for i in {1..90}; do
    [[ $("$LXC" exec "$name" -- systemctl is-system-running 2>/dev/null) =~ ^(running|degraded)$ ]] && break
    sleep 1
  done
  if [[ -z $from ]]; then
    "$LXC" exec "$name" -- sh -c "echo '$ip api.github.com github.com codeload.github.com objects.githubusercontent.com' >>/etc/hosts"
    "$LXC" file push "$WORK/tls/ca.crt" "$name/usr/local/share/ca-certificates/jgo-test-ca.crt"
    "$LXC" exec "$name" -- sh -c 'for i in $(seq 1 30); do getent hosts deb.debian.org >/dev/null && break; sleep 1; done
      apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends ca-certificates curl sudo mc gnupg2 jq procps iproute2 util-linux file xz-utils openssl >/dev/null
      update-ca-certificates >/dev/null 2>&1'
    "$LXC" file push -r -p "$CORE_DIR" "$name/opt/"
    "$LXC" exec "$name" -- mv /opt/"$(basename "$CORE_DIR")" /opt/cs-core
    "$LXC" exec "$name" -- mkdir -p /opt/jgo-src
    local d
    for d in ct install json; do "$LXC" file push -r -p "$root/$d" "$name/opt/jgo-src/"; done
  fi
}

be_exec() { local name=$1; shift; "$LXC" exec "$name" "${LXC_ENV[@]}" -- "$@"; }
be_cp_to() { "$LXC" file push "$2" "$1$3"; }
be_cp_from() { "$LXC" file pull "$1$2" "$3"; }
be_restart() { "$LXC" restart "$1"; }
be_snapshot() { "$LXC" delete -f jgo-lxc-test-fresh >/dev/null 2>&1 || true; "$LXC" stop "$1" >/dev/null && "$LXC" copy "$1" jgo-lxc-test-fresh >/dev/null && "$LXC" start "$1" >/dev/null && echo jgo-lxc-test-fresh; }
be_rm() { local n; for n in "$@"; do "$LXC" delete -f "$n" >/dev/null 2>&1 || true; done; }
be_describe() { echo "unprivileged LXC ($("$LXC" --version 2>/dev/null | head -n1), image $LXD_IMAGE)"; }
