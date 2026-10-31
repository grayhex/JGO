# syntax=docker/dockerfile:1.7
# Build context: repository root.   docker build -f runtime/Dockerfile -t j2me-web .
#
# Nothing third-party is stored in the repository: KEmulator is cloned from upstream at a
# pinned commit and built here (BASE_REGISTRY can point at a mirror if Docker Hub rate-limits you); dependencies come from npm/crates.io/apt at build time.

ARG BASE_REGISTRY=docker.io/library

# ---- 1. KEmulator nnmod (pinned commit + our patches) -------------------------------------
FROM ${BASE_REGISTRY}/ubuntu:24.04 AS kem-build
ARG KEM_COMMIT=9ec1005af5448bca63a420e1dfa884ef53842d0f
ARG KEM_REPO=https://github.com/shinovon/KEmulator
RUN apt-get update && apt-get install -y --no-install-recommends openjdk-21-jdk-headless git ca-certificates unzip \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY runtime/patches runtime/patches
COPY runtime/audio runtime/audio
COPY runtime/scripts/build-kemulator.sh runtime/scripts/lib.sh runtime/scripts/
# Optional: behind a TLS-inspecting proxy pass the proxy CA with
#   docker build --secret id=extra_ca,src=/path/to/ca.pem --build-arg HTTPS_PROXY=... ...
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -s /run/secrets/extra_ca ]; then cp /run/secrets/extra_ca /usr/local/share/ca-certificates/extra-ca.crt && update-ca-certificates; fi \
    && KEM_REF="$KEM_COMMIT" KEM_REPO="$KEM_REPO" runtime/scripts/build-kemulator.sh /out/kemulator

# ---- 2. Rust bridge adapter --------------------------------------------------------------
FROM ${BASE_REGISTRY}/rust:1-bookworm AS adapter-build
WORKDIR /src
COPY bridge/kemulator-adapter ./
RUN cargo build --release --locked

# ---- 3. API + web UI ---------------------------------------------------------------------
FROM ${BASE_REGISTRY}/node:22-bookworm-slim AS app-build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages packages
COPY apps apps
COPY tools/release/prune.mjs /tmp/jgo-release-prune.mjs
RUN npm ci && npm run build && npm prune --omit=dev && node /tmp/jgo-release-prune.mjs /app && rm /tmp/jgo-release-prune.mjs

# ---- Gateway (optional image): the only container with a published port ---------------
# The app container sits on an internal Docker network without a route out, so a MIDlet cannot call the
# internet or the LAN; this nginx forwards the browser's HTTP and WebSocket traffic to it.
#   docker build -f runtime/Dockerfile --target gateway -t jgo-gateway .
FROM ${BASE_REGISTRY}/nginx:1.27-alpine AS gateway
COPY infrastructure/local/nginx.conf /etc/nginx/conf.d/default.conf

# ---- 4. Runtime (the default target: keep it the last stage) --------------------------------------------------------------------------
FROM ${BASE_REGISTRY}/ubuntu:24.04 AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
      openjdk-21-jdk-headless \
      xvfb libgl1 libglx-mesa0 libgl1-mesa-dri libegl1 libxext6 libxrender1 libxtst6 libxi6 libxrandr2 libxcursor1 libxinerama1 \
      fontconfig fonts-dejavu-core ca-certificates libharfbuzz0b libfreetype6 libfontconfig1 liblcms2-2 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=app-build /usr/local/bin/node /usr/local/bin/node
# The token volume can be written by NAS-selected UID:GID (e.g. 1000:10 or 10001:10001).
# It is a sticky directory, like /tmp; the token itself stays a private 0600 file.
RUN useradd --system --uid 10001 --home-dir /nonexistent --shell /usr/sbin/nologin j2me \
    && mkdir -p /data /opt/kemulator /jgo-auth \
    && chown j2me /data \
    && chmod 1777 /jgo-auth
COPY --from=kem-build /out/kemulator /opt/kemulator
COPY --from=adapter-build /src/target/release/kem-adapter /usr/local/bin/kem-adapter
COPY --from=app-build /app /app
COPY runtime/scripts/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY runtime/scripts/docker-auth-token.cjs /usr/local/bin/jgo-auth-token.cjs

# jdk-headless (not only the JRE) so that the diagnostics report can ask the emulator's JVM for heap and threads (jcmd)
ARG JGO_VERSION=dev
ENV JGO_VERSION=${JGO_VERSION} \
    NODE_ENV=production \
    HOST=0.0.0.0 PORT=8080 \
    DATA_DIR=/data KEM_DIR=/opt/kemulator ADAPTER_BIN=/usr/local/bin/kem-adapter \
    WEB_DIR=/app/apps/web/dist RUN_DIR=/dev/shm/j2me-web \
    MAX_SESSIONS=1
USER 10001:10001
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=4s --start-period=10s CMD ["node", "-e", "fetch('http://127.0.0.1:8080/api/health').then(r=>r.json()).then(j=>process.exit(j.ok?0:1)).catch(()=>process.exit(1))"]
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
