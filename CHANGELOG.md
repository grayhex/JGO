# Changelog

Formatted after [Keep a Changelog](https://keepachangelog.com/); versions follow [SemVer](https://semver.org/).
`-beta` releases are complete enough to use but not yet proven on a variety of hardware.

## [Unreleased]

### Changed
- Complete MGO naming for images, CLI, services, configuration and documentation; migration notes preserve access to existing data.
- HTTPS gateway with persistent certificates, HTTP redirect, WSS and streamed large uploads.
- Settings tabs, live container monitoring, separate Java/N-Gage/SIS directories and platform phone defaults; compact phone cards and a current-game sidebar with three version/status entries.
- Original N-Gage catalog metadata and cached covers from All About Symbian, with attribution and protected manual classifications.

### Fixed
- Symbian audio uses an explicit shared PulseAudio socket/sink despite isolated per-game HOME directories, reports capture errors, and reassembles fragmented HTTP PCM into complete stereo frames.
- N95 8GB RM-320 is recognized; package generation takes priority over an incompatible platform default. Choosing a native phone binds its real firmware.
- A game's own running instance no longer causes a busy warning.


### Changed (deployment)
- **One `compose.yaml` now contains the Symbian service** (`mgo-symbian`): no `compose.symbian*.yaml`, no `SYMBIAN_TOKEN` to type in. The app and the service share a secret through the `symbian-auth` volume (the service creates it on the first start; the app mounts it read-only). The service sits on an internal `symbian` network with no route out, with the same hardening and limits as before. `compose.build.yaml` also builds `mgo-symbian`; CI builds only `app gateway` there because the EKA2L1 build takes 30-60 minutes (it has its own workflow). Remove the `mgo-symbian` block and the `SYMBIAN_*` lines if you only play Java ME games.

### Fixed (first real Symbian run: Contra on Nokia N70, RM-84)
- **A failed start is now explained, not just "failed".** The session carries a start-failure report (`SessionStatus.failure`, `SessionError.details`, the diagnostics file and a card in the player): cause and stage, package UID, install result, the `launch` HTTP answer, the application/process state timeline, the `/v1/screenshot` probe answers, the EKA2L1 error lines, font notes and hints. Nothing is invented: when EKA2L1 gives no cause, the report says so. The FreeType line "failed to query face count ... unknown file format" is a benign probe (EKA2L1 tries FreeType, then its own GDR loader, for fonts without a `.ttf` extension) and is labelled as such. The cause of the Contra run itself is **not** established from the supplied log (it has no panic and no emulator error text); the next run will contain the evidence.
- **Package/firmware generation check.** A Symbian 9 package (`.sisx`, `uid1 0x10201A7A`) cannot be installed on Symbian 8.1a firmware (N70/RM-84, S60v2): the start is refused before the emulator is touched with a clear "incompatible package" message instead of a silent 0-frame run (wormsworld). The library records the package format.
- **Native games run only on compatible phones.** Choosing a skin for a Symbian/N-Gage game no longer falls back to the Sony Ericsson K790i: the device and its skin come from the installed firmware (Nokia N70 → N70 body, 176x208); stale incompatible skins are replaced; `/phones` marks which handsets fit Symbian/N-Gage (and which generation), and which of them have a firmware loaded.
- **N-Gage screen outside the phone** (`/phones`): a legacy `.phone-preview img {height: 280px; object-fit: contain}` rule hit the skin body image; it is now scoped, and `tests/e2e/phones-native.mjs` asserts that every screen lies inside its handset.

### Changed (Settings → Symbian)
- Firmware is added from **one place: a firmware archive** (or a file from the inbox folder). ROM + RPKG and "Factory kit" forms are gone from the UI (the API is unchanged; pack such files into one archive). "Installed devices" are cards with model, code, OS generation and what each device can run; "Default device per platform" has hints. The player panel for native games no longer shows service-internal lines (service state, device counts, "first frame" placeholders): only the device and, on failure, the report.

### Added
- **Original factory firmware kits (`.vpl` + `.fpsx`) without a prior ROM dump**: the service patches the pinned EKA2L1 Control API to call its actual desktop installer, keeps files in isolated original-named bundles, supports explicit variants, progress and inbox, and reports missing/corrupt images. The real-binary CI smoke uses synthetic negative cases; successful genuine firmware/game installation remains a manual test.
- Five realistic measured Nokia skins: N-Gage Classic, N-Gage QD, N70, 5320 XpressMusic and N8, bringing the catalog to fifteen. Independent PhoneSkin / EmulatedDevice / GamePlatform catalogs, reusable Symbian profiles for N95/E71/5800, native firmware checks before replacing an active game, and full/screen views including the central N-Gage crop and N8 close-up.
- Native-core testing UI on top of PR #35: live service/firmware readiness, explicit profiles and actual installed-device selection, matching-skin action without replacing firmware, platform filters, upload progress/cancellation, resumable firmware-job monitoring, starting-session logs and diagnostics. Symbian UI tests use a fake emulator and do not certify a real game.

### Added (experimental)
- **Symbian S60 and N-Gage 1.0/2.0 through EKA2L1** as a second emulation core, in an optional container (`mgo-symbian`, `compose.symbian.yaml`): the library knows the platforms `j2me`, `symbian`, `ngage`, `ngage2` (`.sis`, `.sisx`, `.n-gage`, N-Gage 1.0 card `.zip`) and picks the core automatically; the KEmulator path is unchanged. Frames, sound and input use the existing WebSocket protocol (frames carry their own size). Firmware is added by the user in Settings → Symbian, streamed into the service and never stored in the repository or the image. EKA2L1 is built from a pinned upstream commit (its HTTP control API is not in a release yet). See `docs/SYMBIAN.md` for what was verified (control API on the real binary, the agent, the adapter against a fake) and what was not (a real game with real firmware).
- **Large uploads through the gateway.** The nginx gateway had a global `client_max_body_size 40m`, which would have stopped a firmware (up to 2 GB) and a Symbian package (up to 512 MB) with `413` before they reached the app. Now `/api/games` (1 GB) and `/api/symbian/firmware` (4 GB) have their own limits and stream the body (`proxy_request_buffering off`: nothing is spooled to the gateway's tmpfs); everything else keeps 40 MB; the app and the Symbian service still enforce the real limits. Tested through a real nginx (`tests/integration/gateway.test.ts`, with the old configuration as a control). `tools/symbian/check-upload.mjs` + `POST /api/symbian/upload-probe` check the path through your own reverse proxy or tunnel.
- **A game is bound to a device (firmware)**: `symbianDevice` in the game's settings, a default per platform in the Symbian service, otherwise the only installed device; with several devices and no choice the start is refused (`409 device_required`) instead of taking the first one.
- **Firmware from a folder** (`/inbox`, read-only): for files that are too big for the browser or the proxy. **Symbian diagnostics** (`/api/symbian/diagnostics`): service log, emulator output and `EKA2L1.log` of the last run. N-Gage 1.0 card zips may have a wrapping folder and any letter case.
- **Free-space guard** in the Symbian service: uploads and firmware installs are refused with `507 insufficient_storage` when the volume cannot hold them (installation needs about twice the input size - an estimate), and the panel/diagnostics show the free space. Failed firmware jobs are written to the service log, so they appear in the diagnostics report.
- **Fix:** installing a factory firmware (VPL) without an explicit variant failed with `bad_request` because the patched Control API read `body["variant"]` with the inserting `operator[]` before testing `contains()`. Found by the real-binary smoke test in CI; verified against a rebuilt `eka2l1_qt`.
- `tests/e2e/library-platforms.mjs`: Java ME, S60, N-Gage 1.0 and N-Gage 2.0 games stay apart in the library (separate cards even with the same title, badges, platform filter).
- `docs/SYMBIAN_TESTING.md`: a step-by-step guide for the first test with a real firmware and game.
- `EmulatorAdapter` interface (`apps/api/src/emulator.ts`); `SessionStatus.backend`; `GameMeta.platform`.

### Added
- **Rename a game** (Game settings → Title): the title applies to every version, beats a catalog title and the automatic one, and can be reset. Stored in `game_titles`, kept when the library is emptied.
- `tools/docs-screenshots.mjs`: takes the README screenshots from any folder of JARs.

### Changed
- **No top bar** on a desktop screen (a slim bar with the menu stays on phone-sized screens): the language switch moved to the sidebar, the search to the library toolbar (with smaller Scan/Add buttons). The phone in the player grew into the freed space.
- The library list is an even table (title, publisher, genre, version, time) with a header row; long titles are cut instead of pushing the columns.
- README and screenshots renewed; the old ones are removed.

### Added
- **`:edge` image**: `edge.yml` publishes `mgo:edge` and `mgo-gateway:edge` (and an immutable `sha-<commit>`) after every green CI on `main`, with Buildx and the Actions cache; a red CI publishes nothing. `latest` now moves only for an official release, and a version tag already in GHCR is never overwritten.
- **Library clean-up**: remove all games whose files are gone, or empty the whole library (type `DELETE`), optionally with saves. Genres and MobyGames data are kept.
- **Genres from folder names** (`MGO-Top500/Racing/…`), applied after every scan and by a button; sorting (name, added, last played, time played, genre) and a status filter (not played, played, file gone, genre not confirmed) in the library.
- **Play time** on every game card (hours and minutes, all versions of a game together): counted while a game's session runs, saved every 30 s and when it ends (column `games.play_seconds`).
- **Genres.** A game's genre is metadata of the game (all its versions), not of a folder: table `game_classifications`, 13 genres plus free tags, chips with counts over the library, a genre badge and dialog on every card.
- **Genre catalog** (`mgo_catalog.json` in MGO's format or the J2ME Curator manifest, matched by SHA-256; file paths are stripped in the browser and never sent; curator confidence `heuristic`/`unclassified` is kept as an unconfirmed genre): preview, then import in one transaction, idempotent; export. Genres chosen by hand are locked; MobyGames outranks the catalog; no paths are sent to the API. See `docs/LIBRARY.md`.

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

First public beta of MGO: a self-hosted web player for Java ME (J2ME/MIDP) games that runs the real
[KEmulator nnmod](https://github.com/shinovon/KEmulator) on your server.

### Installation
- **Docker is the main way** (NAS, server): images `ghcr.io/grayhex/mgo` and `ghcr.io/grayhex/mgo-gateway`, `compose.yaml` + `.env`
  (token required), optional data folder with `PUID`/`PGID`, read-only games folder, games without network access. See `docs/DOCKER.md`.
- Proxmox VE LXC (Community Scripts format, systemd, command `mgo`) as the additional way. See `docs/PROXMOX.md`.
- `mgo update` orders versions as SemVer (a beta is older than its release).

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
