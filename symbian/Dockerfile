# syntax=docker/dockerfile:1.7
# jgo-symbian: EKA2L1 (Symbian / N-Gage emulator) behind a small agent, for JGO. OPTIONAL: JGO runs without it.
#   docker build -f symbian/Dockerfile -t jgo-symbian .        (build context: the repository root)
#
# NOTHING proprietary is in here: no ROM, no firmware, no game. EKA2L1 is compiled from upstream source at a pinned commit; the
# user adds their own firmware through JGO (Settings -> Symbian) into the /data volume.
#
# EKA2L1's HTTP control API (the thing this integration drives) is on upstream `master` only, it is not in a release yet.
# The commit below is the one this integration was developed and built against; moving it needs a new check (docs/SYMBIAN.md).
ARG BASE_REGISTRY=docker.io/library

# ---- 1. EKA2L1 from source (long: it builds FFmpeg and many third-party libraries) ---------------------------------------------
FROM ${BASE_REGISTRY}/ubuntu:24.04 AS eka-build
ARG EKA2L1_REPO=https://github.com/EKA2L1/EKA2L1
ARG EKA2L1_COMMIT=e04eb030653d185483a44f0394d42a319ad334f2
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential cmake ninja-build git ca-certificates python3 pkg-config nasm \
      qt6-base-dev qt6-base-private-dev qt6-tools-dev qt6-tools-dev-tools qt6-svg-dev qt6-multimedia-dev qt6-l10n-tools linguist-qt6 \
      libsdl2-dev libudev-dev libssl-dev libcurl4-openssl-dev zlib1g-dev libpng-dev libfreetype-dev libfontconfig-dev \
      libpulse-dev libasound2-dev libdbus-1-dev libglib2.0-dev libgl-dev libgles-dev libopengl-dev libglu1-mesa-dev libvulkan-dev \
      libx11-dev libxi-dev libxrandr-dev libxcursor-dev libxinerama-dev libxkbcommon-dev libxcb1-dev libxcb-render0-dev libxcb-shm0-dev \
      libwayland-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
# optional: behind a TLS-inspecting proxy pass the CA with --secret id=extra_ca,src=/path/ca.pem
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -s /run/secrets/extra_ca ]; then cp /run/secrets/extra_ca /usr/local/share/ca-certificates/extra-ca.crt && update-ca-certificates; fi \
    && git init -q . && git remote add origin "$EKA2L1_REPO" \
    && git fetch -q --depth 1 origin "$EKA2L1_COMMIT" && git checkout -q FETCH_HEAD \
    && git submodule update --init --recursive --depth 1 --jobs 4
COPY symbian/patches/ /tmp/jgo-eka2l1-patches/
RUN for patch in /tmp/jgo-eka2l1-patches/*.patch; do git apply --check "$patch" && git apply "$patch"; done
RUN cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release \
      -DEKA2L1_BUILD_TESTS=OFF -DEKA2L1_BUILD_TOOLS=OFF -DEKA2L1_SCRIPTING_LUA=OFF \
    && cmake --build build --target eka2l1_qt -j"$(nproc)" \
    && mkdir -p /out && cp -a build/bin/. /out/ \
    && rm -f /out/*.a \
    && echo "EKA2L1 master-$(echo "$EKA2L1_COMMIT" | cut -c1-7)+jgo-vpl1" > /out/VERSION

# ---- 2. node binary for the agent (the agent has no dependencies) --------------------------------------------------------------
FROM ${BASE_REGISTRY}/node:22-bookworm-slim AS node

# ---- 3. runtime ----------------------------------------------------------------------------------------------------------------
FROM ${BASE_REGISTRY}/ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      xvfb pulseaudio pulseaudio-utils unzip ca-certificates fonts-dejavu-core tini \
      libqt6widgets6t64 libqt6gui6t64 libqt6network6t64 libqt6multimedia6 libqt6svg6 libqt6openglwidgets6t64 libqt6dbus6t64 qt6-qpa-plugins \
      libsdl2-2.0-0 libpulse0 libasound2t64 libgl1 libegl1 libglu1-mesa libgl1-mesa-dri libglx-mesa0 libvulkan1 \
      libxcb-cursor0 libxkbcommon-x11-0 libxcb-icccm4 libxcb-image0 libxcb-keysyms1 libxcb-render-util0 libxcb-xinerama0 libxcb-xkb1 libxcb-shape0 libxcb-xfixes0 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --create-home --home-dir /home/jgo --shell /usr/sbin/nologin jgo \
    && mkdir -p /data /opt/eka2l1 /opt/jgo-symbian && chown jgo:jgo /data
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=eka-build /out/ /opt/eka2l1/
COPY symbian/agent/agent.mjs symbian/agent/policy.mjs symbian/agent/factory.mjs /opt/jgo-symbian/
COPY symbian/entrypoint.sh /opt/jgo-symbian/entrypoint.sh

ENV EKA2L1_BIN=/opt/eka2l1/eka2l1_qt \
    EKA2L1_VERSION_FILE=/opt/eka2l1/VERSION \
    DATA_DIR=/data \
    AGENT_PORT=8766 \
    QT_QPA_PLATFORM=xcb \
    LIBGL_ALWAYS_SOFTWARE=1 \
    DISPLAY=:99
USER jgo
WORKDIR /data
VOLUME ["/data"]
EXPOSE 8766
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.AGENT_PORT||8766)+'/agent/ping').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--", "/opt/jgo-symbian/entrypoint.sh"]
