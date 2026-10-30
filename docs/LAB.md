# Compatibility lab

Runs a folder of **real** J2ME games one after another in the real KEmulator (through the same API, Bridge adapter and
WebSocket stream the web player uses), measures what happens and writes a self-contained HTML report with screenshots
and a manual rating form. Games are read from wherever you point it; **nothing is copied into Git** (`*.jar`, `*.jad`,
`lab-out/`, `lab-data/`, `games/` are git-ignored on purpose).

## Quick start

```bash
npm run setup                                   # once: emulator, adapter, web, fixtures
mkdir -p ~/j2me-games                           # put your own .jar (+ same-named .jad) files here
npm run lab -- run ~/j2me-games --out lab-out   # sequential run, ~15-20 s per game
xdg-open lab-out/report.html                    # or open it in any browser (works from file://)
```

3D games need an X display with GLX. The lab starts a private Xvfb (and sets `LIBGL_ALWAYS_SOFTWARE=1`) when it finds
`/usr/bin/Xvfb` and no `DISPLAY`/`KEM_DISPLAY`; pass `--no-xvfb` to disable.

| Command | What it does |
|---|---|
| `lab run <jar\|dir>... [--out lab-out] [--device auto\|none\|<preset-id>] [--measure 6] [--timeout 25] [--filter name] [--config lab.json] [--ratings ratings.json] [--fail-on-error]` | upload, analyse, run, measure, report |
| `lab analyze <jar\|dir>... [--json]` | static analysis only (no emulator run) |
| `lab report [--out lab-out] [--ratings ratings.json]` | re-render `report.html` from `results.json` (e.g. after manual rating) |
| `lab devices` | list the 59 KEmulator device presets |
| `--base http://host:8080 --token T` | drive an already running server instead of an in-process one (CPU/RAM then come from that host) |

`--config lab.json` sets per-game overrides keyed by file name (with or without `.jar`):

```json
{ "games": { "Asphalt3_240x320": { "device": "240x320-common-full-screen", "heapMb": 384, "measureSeconds": 10,
                                   "keys": [-5, -6, 53], "midlet": "com.gameloft.Main" } } }
```

## What is measured per game

* **start**: upload accepted, class version, session started, time to first frame;
* **frames**: FPS while idle and after input, number of distinct pictures, blank / static detection (frame hashes, dominant-colour share);
* **input smoke test** on the device's own key codes: fire, both soft keys, d-pad, `5`, `0`, `*`, `#`, then a pointer tap in the centre of the screen;
* **resources** of the emulator process tree (adapter + JVM): average and peak RSS, CPU time and average CPU %;
* **sound**: PCM bytes received, seconds, peak level;
* **platform interaction**: soft key labels, command menus (answered with the first entry), permission prompts (allowed), vibration, URL requests, title;
* **screenshots**: first frame, end of the idle window, after the input sequence, final;
* **logs, diagnostics, error lines** from the emulator, exit code and whether shutdown was clean;
* **static analysis** of the JAR (below).

### Automatic verdict

`fail` – upload/start failure, crash, no frame, blank picture. `warn` – picture never changes even after input, low FPS, emulator
diagnostics, error lines in the log, blocking findings from static analysis. `pass` – everything else.
This cannot judge gameplay; it finds games that are *obviously* broken and records numbers for the rest.

### Manual check

Every card in the report has *Works / Playable, minor issues / Broken / Not tested* and a note. Ratings are kept in the browser
(localStorage) while you work; **Export ratings.json** saves them, and
`npm run lab -- report --out lab-out --ratings ratings.json` bakes them into the report. *Import ratings…* merges a file back.

## Static analysis (`lab analyze`)

The constant pool of every class is parsed (no bytecode is run) and each referenced class is checked against the **actual
class list of the built emulator**:

* API families: M3G (JSR-184), Mascot Capsule v3 and the Motorola/Vodafone/J-Phone variants, OpenGL ES, Nokia UI / Sound / M3D,
  Sony Ericsson, Siemens, Motorola, Samsung, LG, Sprint, DoJa, MMAPI/AMMS, FileConnection/PIM, Bluetooth, WMA, Location, SVG, sensors, network, GameCanvas, RMS, high-level LCDUI;
* **missing classes**: vendor/JSR classes referenced directly but provided neither by the JAR nor by the emulator (predicted
  `NoClassDefFoundError`); names only probed via `Class.forName` are listed separately as usually harmless;
  (KEmulator v2.22 ships no `com.sonyericsson.*` classes at all, so any use of them is reported);
* class-file versions (KEmulator needs <= 48), platform family and evidence, screen-size hints (`Nokia-MIDlet-Original-Display-Size`,
  `SEMC-Screen-Size`, `MIDxlet-ScreenSize`, `WxH` in the file name), profile/configuration, need for OpenGL.

## Device presets

`GET /api/devices` (and `lab devices`) list the presets of KEmulator's own `res/presets.xml`: phone model (from the comments in that file),
screen size, key layout (`Nokia`, `Motorola`, `Motorola_Triplets`, `MotorolaV8`, `Siemens`, `LG`, `Sagem`, `Sharp`, …), `FORCE_FULLSCREEN`, and for Nokia/Sony Ericsson models a
conventional `microedition.platform` value. Selecting a preset (`settings.device`, or `--device` in the lab) writes the game's
`midlets.ini` section (`DevicePreset`, screen size, key codes, `IgnoreFullScreenMode`, `MIDPPlatform`) before launch, exactly as the desktop settings dialog would.
`--device auto` uses the analyzer's recommendation: a preset matching a size hint, or (for Siemens/Motorola/DoJa/J-Phone only) a vendor
preset so the key codes work; otherwise the emulator default is kept.
Generic “COMMON” presets deliberately leave the platform string alone, because games sniff it.
