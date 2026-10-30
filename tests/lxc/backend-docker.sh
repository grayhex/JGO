# shellcheck shell=bash
# Backend: a privileged Docker container with systemd as PID 1 (local runs, fast). Sourced by run.sh.
NET="${DOCKER_NET:-bridge}"
IMAGE="jgo-lxc-test-base"

be_prepare() { docker build -q --network host --build-arg "BASE=${BASE_IMAGE:-debian:trixie}" -t "$IMAGE" "$here" >/dev/null; }

be_host_ip() { if [[ $NET == host ]]; then echo 127.0.0.1; else docker network inspect bridge -f '{{(index .IPAM.Config 0).Gateway}}'; fi; }
be_ip() { if [[ $NET == host ]]; then echo 127.0.0.1; else docker inspect -f '{{.NetworkSettings.IPAddress}}' "$1"; fi; }

be_start() { # be_start NAME [snapshot token]
  local name=$1 image=${2:-$IMAGE} ip i
  ip=$(be_host_ip)
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker run -d --name "$name" --privileged --cgroupns=host --network "$NET" \
    -v /sys/fs/cgroup:/sys/fs/cgroup:rw --tmpfs /run --tmpfs /run/lock \
    --add-host "api.github.com:$ip" --add-host "github.com:$ip" --add-host "codeload.github.com:$ip" --add-host "objects.githubusercontent.com:$ip" \
    -v "$CORE_DIR:/opt/cs-core:ro" -v "$root/ct:/opt/jgo-src/ct:ro" -v "$root/install:/opt/jgo-src/install:ro" -v "$root/json:/opt/jgo-src/json:ro" \
    -v "$WORK/tls/ca.crt:/usr/local/share/ca-certificates/jgo-test-ca.crt:ro" \
    ${EXTRA_CA:+-v "$EXTRA_CA:/usr/local/share/ca-certificates/egress-proxy.crt:ro"} \
    "$image" >/dev/null
  for i in {1..40}; do
    [[ $(docker exec "$name" systemctl is-system-running 2>/dev/null) =~ ^(running|degraded)$ ]] && break
    sleep 0.5
  done
  docker exec "$name" update-ca-certificates >/dev/null 2>&1
  # a host that reaches the internet through a CONNECT-only proxy cannot serve plain-http mirrors
  [[ ${#PROXY_ENV[@]} -gt 0 ]] && docker exec "$name" sh -c 'sed -i "s|http://|https://|" /etc/apt/sources.list.d/*.sources /etc/apt/sources.list 2>/dev/null; true'
  return 0
}

be_exec() { local name=$1; shift; docker exec -i "${PROXY_ENV[@]}" "$name" "$@"; }
be_cp_to() { docker cp "$2" "$1:$3"; }
be_cp_from() { docker cp "$1:$2" "$3"; }
be_restart() { docker restart -t 20 "$1" >/dev/null; }
be_snapshot() { docker commit "$1" jgo-lxc-test-fresh >/dev/null && echo jgo-lxc-test-fresh; }
be_rm() { docker rm -f "$@" >/dev/null 2>&1 || true; }
be_describe() { echo "Docker (privileged, systemd as PID 1)"; }
