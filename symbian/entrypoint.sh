#!/bin/sh
# mgo-symbian: a virtual screen (Xvfb), a virtual sound card (PulseAudio null sink "jgo_sink", captured with parec) and the agent.
# EKA2L1 itself is started by the agent, one instance per game.
set -eu

export HOME="${HOME_OVERRIDE:-/tmp/jgo-home}"
mkdir -p "$HOME"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/runtime}"
export DISPLAY="${DISPLAY:-:99}"
mkdir -p "$XDG_RUNTIME_DIR" /tmp/.X11-unix
chmod 700 "$XDG_RUNTIME_DIR"

if [ -z "${AGENT_TOKEN_FILE:-}" ] && { [ -z "${AGENT_TOKEN:-}" ] || [ "${#AGENT_TOKEN}" -lt 16 ]; }; then
  echo "AGENT_TOKEN (at least 16 characters) or AGENT_TOKEN_FILE is required: it is the shared secret between MGO and this service" >&2
  exit 1
fi

# Software rendering only: no GPU is passed through, llvmpipe draws the OpenGL that EKA2L1's renderer needs.
Xvfb "$DISPLAY" -screen 0 "${XVFB_SCREEN:-1024x768x24}" +extension GLX -nolisten tcp -noreset >/tmp/xvfb.log 2>&1 &
i=0
until [ -S "/tmp/.X11-unix/X${DISPLAY#:}" ]; do
  i=$((i + 1)); [ "$i" -gt 100 ] && { echo "Xvfb did not start" >&2; cat /tmp/xvfb.log >&2; exit 1; }
  sleep 0.1
done

pulseaudio -n --daemonize=yes --exit-idle-time=-1 --log-target=stderr \
  --load="module-native-protocol-unix auth-anonymous=1" \
  --load="module-null-sink sink_name=jgo_sink sink_properties=device.description=MGO" \
  || { echo "PulseAudio did not start: sound will be missing" >&2; }

# only the agent listens on the network; EKA2L1's own control port is bound to 127.0.0.1 inside this container
exec node /opt/mgo-symbian/agent.mjs
