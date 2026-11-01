#!/bin/sh
# mgo-symbian: a virtual screen (Xvfb), a virtual sound card (PulseAudio null sink "mgo_sink", captured with parec) and the agent.
# EKA2L1 itself is started by the agent, one instance per game.
set -eu

export HOME="${HOME_OVERRIDE:-/tmp/mgo-home}"
mkdir -p "$HOME"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/mgo-runtime}"
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

# Clients run with separate HOME directories. Pin their shared socket instead of
# relying on per-user autospawn/cookie discovery (which left cubeb without sound).
export PULSE_RUNTIME_PATH="$XDG_RUNTIME_DIR/pulse"
export PULSE_SERVER="unix:$PULSE_RUNTIME_PATH/native"
export PULSE_SINK=mgo_sink
export PULSE_SOURCE=mgo_sink.monitor
mkdir -p "$PULSE_RUNTIME_PATH"
pulseaudio -n --daemonize=yes --exit-idle-time=-1 --log-target=file:/tmp/mgo-pulse.log \
  --load="module-native-protocol-unix socket=$PULSE_RUNTIME_PATH/native auth-anonymous=1" \
  --load="module-null-sink sink_name=mgo_sink rate=44100 channels=2 sink_properties=device.description=MGO" \
  || { cat /tmp/mgo-pulse.log >&2; exit 1; }
pactl set-default-sink "$PULSE_SINK"
pactl set-default-source "$PULSE_SOURCE"
pactl info > /tmp/mgo-audio-info.txt

# only the agent listens on the network; EKA2L1's own control port is bound to 127.0.0.1 inside this container
exec node /opt/mgo-symbian/agent.mjs
