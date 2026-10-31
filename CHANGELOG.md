# Changelog

Formatted after [Keep a Changelog](https://keepachangelog.com/); versions follow [SemVer](https://semver.org/).
`-beta` releases are complete enough to use but not yet proven on a variety of hardware.

## [Unreleased]

### Added
- **`:edge` image**: `edge.yml` publishes `jgo:edge` and `jgo-gateway:edge` (and an immutable `sha-<commit>`) after every green CI on `main`, with Buildx and the Actions cache; a red CI publishes nothing. `latest` now moves only for an official release, and a version tag already in GHCR is never overwritten.
- **Library clean-up**: remove all games whose files are gone, or empty the whole library (type `DELETE`), optionally with saves. Genres and MobyGames data are kept.
- **Genres from folder names** (`JGO-Top500/Racing/…`), applied after every scan and by a button; sorting (name, added, last played, time played, genre) and a status filter (not played, played, file gone, genre not confirmed) in the library.
- **Play time** on every game card (hours and minutes, all versions of a game together): counted while a game's session runs, saved every 30 s and when it ends (column `games.play_seconds`).
- **Genres.** A game's genre is metadata of the game (all its versions), not of a folder: table `game_classifications`, 13 genres plus free tags, chips with counts over the library, a genre badge and dialog on every card.
- **Genre catalog** (`jgo_catalog.json` in JGO's format or the J2ME Curator manifest, matched by SHA-256; file paths are stripped in the browser and never sent; curator confidence `heuristic`/`unclassified` is kept as an unconfirmed genre): preview, then import in one transaction, idempotent; export. Genres chosen by hand are locked; MobyGames outranks the catalog; no paths are sent to the API. See `docs/LIBRARY.md`.

### Changed
- Titles are cleaned of release-group and site tags (`**MASYAKA**`, `-zub-`, `[NP]`, `dedomil.net`…) and file-name style words are split (`ExtremeAirSnowboarding3D`); a catalog title replaces an unreadable one (`ewjim` → `Earthworm Jim`).
- A game never started shows a clock icon and `0` instead of a sentence.
- No "review draft" badge on the phone model; the gamepad settings button wraps inside its panel.
- **Louder game sound**: the volume curve now reaches +9.5 dB (it topped out at the emulator's raw level, quieter than other tabs) and a limiter after it stops loud passages from clipping.
- **On-screen keypad** rebuilt like a handset: a chassis with wing-shaped soft keys that show the game's own labels, a round navigation key with OK, a C key, and rubber number keys with numerals and letters. The separate row of soft keys above it is gone.
- **Lights Out** keeps the phone body faintly visible (it was practically invisible).
- **New design: WattVision.** One dark theme (`#121212` workspace, `#1E1E1E` cards with 16 px radius, cyan `#00E5FF` accent, red alerts with a left bar, lime-green "live"), Inter and JetBrains Mono bundled for offline use, monospace 32 px telemetry values. The light theme and the theme switch are gone (the design rules out light backgrounds).
- The player: no phone picker below the phone, a larger phone, narrower top bars; the touch keys sit left of the screen (also in Lights Out) and no longer cover it; monoblocks (5800, S5230) have no *Screen* view.
- `/phones` shows a switched-off (black) display, or the running game's current frame.
- Help sentences became tooltips (i) so the right panel is shorter.
- The emulation profile shows short icons instead of sentences; the manifest's screen size is applied automatically; rotation is one button that also moves the picture to the landscape phone.
- `/phones`: a click on a phone sets it for the game opened last (or as the default for new games).
- The library has a compact list view next to the tiles.

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
