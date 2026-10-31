# Changelog

Formatted after [Keep a Changelog](https://keepachangelog.com/); versions follow [SemVer](https://semver.org/).
`-beta` releases are complete enough to use but not yet proven on a variety of hardware.

## [Unreleased]

### Added
- **Genres.** A game's genre is metadata of the game (all its versions), not of a folder: table `game_classifications`, 13 genres plus free tags, chips with counts over the library, a genre badge and dialog on every card.
- **Genre catalog** (`jgo_catalog.json` in JGO's format or the J2ME Curator manifest, matched by SHA-256; file paths are stripped in the browser and never sent; curator confidence `heuristic`/`unclassified` is kept as an unconfirmed genre): preview, then import in one transaction, idempotent; export. Genres chosen by hand are locked; MobyGames outranks the catalog; no paths are sent to the API. See `docs/LIBRARY.md`.

### Fixed
- **Games did not start in Docker** (beta.5): the emulator died at the game's icon with `NoClassDefFoundError ... swt.internal.gtk.OS`,
  because SWT's native library cannot be unpacked in a container. Images are now decoded with the JDK's ImageIO when SWT is unusable (patch `0014`).
- Choosing a library folder now imports it at once; before, the library stayed empty until *Scan* was pressed.
- Sony Ericsson phones use the Sony Ericsson key layout (was labelled Nokia).
- Settings: wider page, the ten phones wrap instead of stretching the form.

- Sidebar item **Game** returns to the game opened last.
- A button next to the screenshot shows the frame rate in green digits in the corner of the phone screen.

### Fixed (round 2)
- **Music stopped after a minute** (e.g. Die Hard): a game restarting its track from `END_OF_MEDIA` on the player thread raced with the old thread's cleanup and lost the player (patch `0015`).
- "Session limit reached" no longer appears: starting a game ends the running one first.

### Changed
- The player: no phone picker below the phone, a larger phone, narrower top bars; the touch keys sit left of the screen (also in Lights Out) and no longer cover it; monoblocks (5800, S5230) have no *Screen* view.
- `/phones` shows a switched-off (black) display, or the running game's current frame.
- Help sentences became tooltips (i) so the right panel is shorter.
- The emulation profile shows short icons instead of sentences; the manifest's screen size is applied automatically; rotation is one button that also moves the picture to the landscape phone.
- `/phones`: a click on a phone sets it for the game opened last (or as the default for new games).
- The library has a compact list view next to the tiles.

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
