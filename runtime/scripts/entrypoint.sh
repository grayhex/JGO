#!/bin/sh
# Container entrypoint: private Xvfb (needed by GLFW/OpenGL for M3G + Mascot Capsule), then the API.
set -eu

# One-file NAS install: if no token was configured, generate a private persistent
# credential in /data and expose it to the API. Never run publicly unauthenticated.
if [ -z "${AUTH_TOKEN:-}" ]; then
  AUTH_TOKEN="$(node /usr/local/bin/jgo-auth-token.cjs)" || exit 1
  export AUTH_TOKEN
fi

if [ "${KEM_XVFB:-1}" = "1" ]; then
  export DISPLAY="${KEM_DISPLAY:-:99}"
  rm -f "/tmp/.X11-unix/X${DISPLAY#:}" "/tmp/.X${DISPLAY#:}-lock"
  mkdir -p /tmp/.X11-unix
  Xvfb "$DISPLAY" -screen 0 640x480x24 -nolisten tcp -noreset +extension GLX >/tmp/xvfb.log 2>&1 &
  XVFB_PID=$!
  i=0
  while [ ! -S "/tmp/.X11-unix/X${DISPLAY#:}" ]; do
    i=$((i + 1)); [ $i -gt 100 ] && { echo "Xvfb did not start:"; cat /tmp/xvfb.log; exit 1; }
    sleep 0.1
  done
  export KEM_DISPLAY="$DISPLAY" LIBGL_ALWAYS_SOFTWARE=1
fi

# Forward SIGTERM/SIGINT so the API can stop sessions (and flush RMS) before the container dies.
node /app/apps/api/dist/server.js &
API_PID=$!
trap 'kill -TERM $API_PID 2>/dev/null' TERM INT
wait $API_PID
STATUS=$?
[ -n "${XVFB_PID:-}" ] && kill "$XVFB_PID" 2>/dev/null || true
exit $STATUS
