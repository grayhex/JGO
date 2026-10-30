# Phones, Lights Out and gamepads

## Automatic phone profiles

`packages/protocol/src/phones.ts` is the explicit shared mapping. The API resolves IDs against `res/presets.xml` in the installed KEmulator jar; no synthetic device entries or platform identities are added.

| Phone | Actual preset ID | Match | Resolution | Layout | FORCE_FULLSCREEN | Platform |
|---|---|---|---|---|---|---|
| Nokia 6100 | 128x128-common-full-screen | generic | 128×128 | Nokia | false | unchanged emulator default |
| Nokia 6230i | 208x208-nokia-full-screen | exact, comment names 6230i | 208×208 | Nokia | false | Nokia6230i |
| Nokia N95-1 | 240x320-common-full-screen | generic | 240×320 | Nokia | false | unchanged emulator default |
| Nokia E71 | 320x240-common-full-screen | generic | 320×240 | Nokia | false | unchanged emulator default |
| Sony Ericsson K750i | 176x220-common-full-screen | generic | 176×220 | Nokia-compatible codes | false | unchanged emulator default |
| Sony Ericsson W995 | 240x320-common-full-screen | generic | 240×320 | Nokia-compatible codes | false | unchanged emulator default |
| Sony Ericsson K790i | 240x320-common-full-screen | generic | 240×320 | Nokia-compatible codes | false | unchanged emulator default |
| Motorola RAZR V3 | 176x220-common-full-screen | generic | 176×220 | Nokia-compatible codes | false | unchanged emulator default |
| Nokia 5800 XpressMusic | 360x640-common-full-screen | generic | 360×640 | Nokia-compatible codes + pointer | false | unchanged emulator default |
| Samsung S5230 Star | 240x400-common-full-screen | generic | 240×400 | Nokia-compatible codes + pointer | false | unchanged emulator default |

The table describes the pinned build's 59 presets, not full hardware emulation. A generic profile does not impersonate a Nokia N95, E71 or Sony Ericsson platform. Properties and fullscreen policy follow the selected *existing* preset via midlets.ini; no manufacturer API support is inferred from a skin.

Automatic mode applies skinId → device + width/height + layout on the server, including saved settings on subsequent starts. `skinId` and `profileMode` are saved in the game's SQLite settings. Advanced mode preserves independent skin, preset and explicit resolution/layout overrides. Existing callers without profileMode keep the prior API behavior. UI changes are saved immediately after automatic profile fields are synchronized. Running session status returns its actual layout/device/heap; changing pending settings never changes its key codes. The restart prompt compares device, layout, resolution and heap, not just dimensions. Screen/Zoom remains presentation only.

## Lights Out

Screen view has a moon button. **Alt+L** toggles, **Escape** exits. A persistent visible Exit button is also available. Presentation preference is saved locally across visits. The player covers the page with a near-black background; side panels and the model picker disappear, handset/glass decorations fade. The LCD canvas and all its ancestors keep normal opacity and brightness; no framebuffer filter, decode change or JVM operation is performed. Moving/touching the pointer reveals a transient fullscreen/touch-controls HUD. Touch controls may overlay the lower area when explicitly requested. Fullscreen uses the existing browser API, handles rejection, and remains optional; mobile browsers that lack it keep Lights Out inside the viewport. Reduced motion is respected.

## Gamepads

GamepadPoller reuses InputController's per-source/reference-counted input. It polls all browser-visible connected devices; Xbox/PlayStation use the browser's standard mapping where supplied. HID indices and operating-system layouts vary; arbitrary buttons and signed axes can be rebound. A browser may require a user gesture, HTTPS/localhost or pressing a controller button before exposing it. The app does not pair Bluetooth devices itself.

Open **Gamepad settings / UI navigation** or press default Start (button 9). Input is released while configuring. Select an action, press a button or move a stick; adjust deadzone and Save mapping globally or for the game. Per-game overrides take precedence; Use global removes the override. Fn/physical handset functions not implemented by the existing logical input system remain unmapped.

Default standard controls: D-pad/left stick directions, face bottom = Fire, face left/right = soft keys, face top = 5, shoulders = */#. Start enters/exits player UI navigation; Back exits menus/Lights Out. In navigation mode directions move focus, Fire activates; left/right on selects change the value. Every Java ME digit/action plus UI lights/fullscreen/menu/back can be explicitly bound. Connected IDs and held actions are shown, and shared keypad/PhoneSkin feedback uses InputController.

Focus loss/hidden page, disconnect and remapping release only relevant sources. Unfocused/disabled held inputs are blocked until neutral before rearming. Multiple controllers, keyboard, skin and touches can hold the same action without releasing one another.

## Validation

- `npm run build`, `npm test`
- `npm run test:integration` (real KEmulator; phones.test.ts covers all ten mappings, frame size, Fire, platform, emitted fullscreen policy, persistence and unchanged active session).
- `node tests/e2e/phone-expansion.mjs`: five added handsets, body keys, real pointer coordinates, full/zoom views and session persistence; included in `npm run test:e2e`.
- `CHROMIUM_PATH=/usr/bin/chromium node tests/e2e/player-features.mjs` for system Chromium; omit the variable to use Playwright's installed browser.

Browser tests use the real backend/MIDlet and simulated Gamepad API data. They cannot certify actual USB/Bluetooth hardware or browser-specific controller drivers. Device disconnect/focus/deadzone/multiple-source behavior also has deterministic unit tests.
