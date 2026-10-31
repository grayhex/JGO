# Changelog

Formatted after [Keep a Changelog](https://keepachangelog.com/); versions follow [SemVer](https://semver.org/).
`-beta` releases are complete enough to use but not yet proven on a variety of hardware.

## [0.1.0-beta.1] - first beta

First public beta of JGO: a self-hosted web player for Java ME (J2ME/MIDP) games that runs the real
[KEmulator nnmod](https://github.com/shinovon/KEmulator) on your server.

### Installation
- **Docker is the main way** (NAS, server): images `ghcr.io/grayhex/jgo` and `ghcr.io/grayhex/jgo-gateway`, `compose.yaml` + `.env`
  (token required), optional data folder with `PUID`/`PGID`, read-only games folder, games without network access. See `docs/DOCKER.md`.
- Proxmox VE LXC (Community Scripts format, systemd, command `jgo`) as the additional way. See `docs/PROXMOX.md`.
- `jgo update` orders versions as SemVer (a beta is older than its release).

### Player
- Real KEmulator in the server, frames/audio/input over WebSocket; sessions survive page reloads and network drops.
- 2D, MMAPI sound (WAV, MP3, MIDI, tone), RMS saves, M3G (retained and immediate mode) on software OpenGL.
- Five phone skins plus the expansion models, key layouts, touch, gamepad, rotation, Lights Out.
- Text input (`TextField`/`TextBox`), pause and automatic pause of a hidden page, game speed, screenshots, input recording and playback.
- Per-game options (frame limit, phone language, font sizes, touch screen, pause behaviour), game file area (JSR-75) in the UI,
  custom MIDI SoundFont, link confirmation, diagnostics report.

### Library
- Upload or import a folder (SHA-256, duplicates, versions), MobyGames metadata, first-run wizard and Settings.

### Known limitations
- x86-64 only (no ARM images yet).
- No sensors/geolocation, SMS, camera, Bluetooth, video; X-Ray and the SWT debug windows of KEmulator are not available.
- Mascot Capsule 3D with `.mbac` models and real AMR audio are unverified; commercial games were tested by hand only on a few titles.
- Docker setup is verified in CI on Linux, not yet on real Synology/UGREEN hardware.
- Single owner, no user accounts.
