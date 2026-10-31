<div align="center">

# JGO

**A self-hosted web player for Java ME (J2ME) games.**
Games run in the real [KEmulator nnmod](https://github.com/shinovon/KEmulator) emulator on your server and open in any browser.

[![CI](https://github.com/grayhex/JGO/actions/workflows/ci.yml/badge.svg)](https://github.com/grayhex/JGO/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](#license)
![Proxmox VE](https://img.shields.io/badge/Proxmox%20VE-LXC-E57000)

English · [Русский](README.md)

<img src="docs/img/player.png" alt="The JGO player: a game in a Nokia E71" width="760">

</div>

## Features

- **A real emulator.** Games are executed by KEmulator nnmod on the server; the browser receives frames and audio and sends input.
- **2D, sound, 3D.** MIDP 2.0 / CLDC 1.1, MMAPI, RMS saves, M3G (JSR-184) on software OpenGL.
- **59 device profiles:** resolution, key layout, full-screen policy.
- **Server-side sessions.** Reloading the page or losing the connection does not interrupt the game.
- **Ten handsets:** Nokia 6100, 6230i, N95-1, E71, 5800 XpressMusic; Sony Ericsson K750i, W995, K790i; Motorola RAZR V3; Samsung S5230 Star. Every handset has full and screen close-up views.
- **Controls:** handset keys, on-screen keypad, PC keyboard, gamepad, multi-touch.
- **Text input** in `TextField`/`TextBox`, **pause**, game **speed**, screenshots, **input recording and playback**, **game files** (JSR-75), a custom MIDI **SoundFont**.
- **Display:** picture rotation, landscape mode, full screen, light and dark themes, English and Russian UI.
- **Library:** drag-and-drop JAR/JAD or import a whole folder; duplicate detection; optional [MobyGames](https://www.mobygames.com) metadata.
- **Easy install:** a ready-made Docker image for NAS (Synology, UGREEN, QNAP) and servers; additionally a Proxmox VE LXC container with the `jgo` command for updates and backups.
- **Security:** game code is untrusted — separate user, container isolation, resource limits, no network access.

<div align="center">
<img src="docs/img/player-portrait.gif" alt="A portrait game in a Nokia N95" width="320">
</div>

## Quick start

### Docker (recommended: Synology / UGREEN / QNAP NAS, Linux server)

Needs Docker Compose v2 and x86-64. **One file only: [compose.yaml](compose.yaml).** No `.env`, manual token creation or local build.

On Synology/UGREEN/Portainer: paste `compose.yaml` as a project/stack, edit `./games` to the host folder containing your JAR/JAD collection if needed, then **Deploy**.

On Linux:

```bash
mkdir jgo && cd jgo
curl -fsSLO https://raw.githubusercontent.com/grayhex/JGO/main/compose.yaml
docker compose up -d
docker compose logs app
```

At first boot JGO generates a secure random login token in a separate Docker-managed volume `jgo-auth`, at `/jgo-auth/.jgo-auth-token`. This avoids NAS shared-folder ACL restrictions. The token is shown **once** in `app` container logs as `First-run login token`; later retrieve it with `docker compose exec app cat /jgo-auth/.jgo-auth-token`. Keep these logs private.

Open `http://<NAS address>:8080`, enter the token, and finish the first-run wizard. To update: `docker compose pull && docker compose up -d`. The configuration is also attached to [GitHub releases](https://github.com/grayhex/JGO/releases); pin a version by editing the image tags or using optional `JGO_VERSION`.

Step-by-step guides for Synology and UGREEN, folder permissions, backups, HTTPS and troubleshooting: [docs/DOCKER.md](docs/DOCKER.md) (Russian).

> Do not expose port 8080 to the internet without a VPN or a TLS proxy.

### Proxmox VE (additional)

Run in the Proxmox VE host shell:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/grayhex/JGO/main/ct/jgo.sh)"
```

This creates an unprivileged Debian 13 LXC (4 CPU, 4 GB RAM, 20 GB disk), without Docker. The access token is printed at the end of the install; `jgo token` shows it later. Open `http://<container IP>:8080`.

| Path | Purpose |
|---|---|
| `/opt/jgo` | application |
| `/var/lib/jgo` | library, saves, settings |
| `/etc/jgo/jgo.env` | configuration and token |

Details: [docs/PROXMOX.md](docs/PROXMOX.md), backups — [docs/BACKUP.md](docs/BACKUP.md).

### From source

Requires Linux or WSL2, Node.js ≥ 22.13, OpenJDK 21, Rust, Xvfb and Mesa.

```bash
sudo apt install openjdk-21-jdk-headless git nodejs xvfb libgl1-mesa-dri
npm run setup      # builds KEmulator, the Rust adapter and the web UI
npm start          # http://127.0.0.1:8080
```

3D needs a GLX display: `Xvfb :99 -screen 0 640x480x24 +extension GLX &`, then `KEM_DISPLAY=:99 LIBGL_ALWAYS_SOFTWARE=1 npm start`.

## Usage

1. **Add games:** drop `.jar` (and `.jad`) files onto the window or connect a folder — *Settings → Game library*. For Proxmox: `tools/proxmox/jgo-library-mount.sh <CTID> /host/path` ([docs/LIBRARY.md](docs/LIBRARY.md)).
2. **Start** a game with *Start*. Audio is enabled after the first user action, as browsers require.
3. **Play** with digits and arrows (Enter is "Fire"), the handset keys, the on-screen keypad or a gamepad. The layout is under *Keys…*.
4. **Fit the screen.** If the game's manifest names its screen size, JGO sets it by itself. If a game is drawn sideways, press the rotate button in the player header: the picture turns and the phone changes to the Nokia E71 with its landscape display (turn back to restore it).
5. **Quit with Stop:** the regular `destroyApp()` runs and RMS saves are written atomically.

## Compatibility

MIDP 2.0 / CLDC 1.0–1.1 and class files version ≤ 48 (genuine J2ME JARs) are supported. Known limitations:

- no sensors, geolocation, SMS, camera or Bluetooth (games get a regular error), no video;
- games have no network access (`jgo network allow` disables the isolation);
- Mascot Capsule 3D, video and camera were not verified.

The full feature matrix is in [docs/EMULATOR_FEATURE_MATRIX.md](docs/EMULATOR_FEATURE_MATRIX.md) (in Russian); more in [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).

## Configuration

Most options are set in *Settings*. Low-level values: with Docker in the `.env` file (variable list: [docs/DOCKER.md](docs/DOCKER.md)), on Proxmox in `/etc/jgo/jgo.env` (after editing: `systemctl restart jgo`). The application variables (in Docker `compose.yaml` passes some of them on):

| Variable | Default | Purpose |
|---|---|---|
| `HOST`, `PORT` | `0.0.0.0`, `8080` | listen address and port |
| `AUTH_TOKEN` | generated (Docker: `JGO_TOKEN`) | access token (≥ 16 characters) |
| `ALLOWED_ORIGINS` | — | extra origins behind a reverse proxy |
| `MAX_SESSIONS` | `1` | concurrent games |
| `SESSION_MAX_MINUTES`, `SESSION_IDLE_MINUTES` | `120`, `5` | session length cap and idle timeout |
| `MAX_UPLOAD_MB`, `LIBRARY_QUOTA_MB` | `32`, `2048` (Docker and Proxmox set `4096`) | file size and library quota |
| `LIBRARY_ROOTS` | `/mnt/jgo-library /srv/jgo-library` | folders games can be imported from |
| `MOBYGAMES_API_KEY` | — | MobyGames key (usually entered in Settings) |

The full list is in `packaging/jgo.env.example`.

## The `jgo` command (Proxmox)

Only available in the Proxmox container. With Docker, update with `docker compose pull && docker compose up -d` and back up by copying the data folder ([docs/DOCKER.md](docs/DOCKER.md)).

| Command | Action |
|---|---|
| `jgo status` | version, services, address, health |
| `jgo update [--check] [--to vX.Y.Z]` | update with SHA-256 verification and automatic rollback |
| `jgo backup` / `jgo restore FILE` | backup and restore |
| `jgo rollback` | return to the previous release |
| `jgo doctor [--online]` | system diagnostics |
| `jgo library` | library folder status |
| `jgo token [--rotate]` | show or replace the token |
| `jgo network [deny\|allow]` | game network access |
| `jgo logs [-f]` | service logs |

## Architecture

```
browser (React) ⇄ WebSocket / REST ⇄ apps/api (Fastify) ⇄ kem-adapter (Rust) ⇄ KEmulator (JVM)
```

| Directory | Purpose |
|---|---|
| `apps/web` | React + Vite: library, player, handsets, settings |
| `apps/api` | Fastify: REST, WebSocket, SQLite library, sessions |
| `bridge/kemulator-adapter` | Rust: link to the KEmulator Bridge |
| `packages/protocol` | shared protocol types |
| `runtime/` | KEmulator build and patches |
| `packaging/`, `ct/`, `install/` | release, the `jgo` command, Proxmox VE install |

More: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). KEmulator nnmod v2.22 (commit `9ec1005`) is built from source with small patches ([docs/BRIDGE.md](docs/BRIDGE.md)); its code is not part of this repository.

## Security

- The service runs as user `jgo` with no capabilities, `NoNewPrivileges`, a syscall filter and limits; every game runs in its own network namespace with no interfaces.
- A token or cookie for every API endpoint except `/api/health`; `Host` and `Origin` checks.
- The API never reads files outside the allowed folders; the MobyGames key is stored with 0600 permissions and never returned to the client.
- JGO does not download games from the internet.

More: [docs/SECURITY.md](docs/SECURITY.md).

## Development

```bash
npm run build              # production build
npm test                   # unit tests
npm run test:integration   # tests against the real KEmulator
npm run test:e2e           # browser scenarios (Chromium)
cargo test --manifest-path bridge/kemulator-adapter/Cargo.toml
```

## Documentation

| Document | Contents |
|---|---|
| [DOCKER.md](docs/DOCKER.md) | Docker (NAS) install, update, backups (Russian) |
| [PROXMOX.md](docs/PROXMOX.md), [BACKUP.md](docs/BACKUP.md) | Proxmox container: install, update, backups |
| [LIBRARY.md](docs/LIBRARY.md) | wizard, settings, import, MobyGames |
| [UI.md](docs/UI.md), [PLAYER_CONTROLS.md](docs/PLAYER_CONTROLS.md) | interface, handsets, controls |
| [SESSION_RECOVERY.md](docs/SESSION_RECOVERY.md) | session recovery, RMS saves |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md), [BRIDGE.md](docs/BRIDGE.md) | system design, Bridge patches |
| [EMULATOR_FEATURE_MATRIX.md](docs/EMULATOR_FEATURE_MATRIX.md), [SENSORS.md](docs/SENSORS.md) | KEmulator feature coverage, sensors (Russian) |
| [COMPATIBILITY.md](docs/COMPATIBILITY.md), [LAB.md](docs/LAB.md) | compatibility, lab |
| [SECURITY.md](docs/SECURITY.md) | security |

## Acknowledgements

- [KEmulator nnmod](https://github.com/shinovon/KEmulator) (shinovon) — the emulator JGO is built on.
- [Proxmox VE Community Scripts](https://github.com/community-scripts/ProxmoxVE) — the install script format.
- [MobyGames](https://www.mobygames.com) — metadata when the integration is enabled.

## License

The repository code is released under the MIT license. KEmulator nnmod is not shipped with the project: it is built from the upstream sources. Upstream contains code under GPLv3, Apache-2.0 and EPL (see the KEmulator README); check the terms with the author before distributing built artifacts publicly. Game titles and trademarks belong to their owners.
