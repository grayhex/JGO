# Phone artwork for J2ME Web

Ten independently shaped handset illustrations, **review drafts**. Files are original generated artwork informed by the linked photographic references; they are not manufacturer-authorized reproductions. Historical acceptance (especially tiny legends, materials and precise physical key boundaries) is still required. Reference independence gaps are recorded in each references.md; do not interpret export validation as historical certification.

## Files per phone

- `body.png`, `body.webp`: full phone, RGBA / lossless alpha, 2048 px export height.
- `zoom.png`, `zoom.webp`: upper shell with active display, without the lower hardware controls. This is a crop of the full export, not a new drawing; alignment is identical.
- `glass.png`, `zoom-glass.png`: intentionally empty transparent optional layers, no glare.
- `hitboxes.svg`: full-view physical control regions, transparent by default.
- `preview.webp`: small full-view thumbnail with alpha.
- `config.json`: dimensions, display resolution, normalized window rectangles, polygons and logical gameplay bindings.
- `references.md`: source links, exclusions and remaining visual acceptance work.

Original generated PNGs are in `design/phones/<id>/source.png`. Native sizes are recorded in config; scaling the export to 2048 px does not add source detail. Export and validation scripts are in `tools/phones/`. Requires Python 3, Pillow and NumPy. Run from the repository root:

```sh
python3 tools/phones/export_assets.py
python3 tools/phones/export_measured.py
python3 tools/phones/validate_assets.py
```

`export_assets.py` retains the original five exports. `export_measured.py` reads `design/phones/<id>/layout.json` for W995, K790i, RAZR V3, 5800 and S5230; it does not rewrite the original five. Each measured file records native pixel coordinates, the source crop, LCD bounds, individual physical key polygons and a silhouette mask. `source.png` is immutable. Technical alpha masks remove generator fringes without redrawing the handset. `generation.json` records provenance; `silhouette.svg` makes the mask reviewable.

## Coordinates and two view modes

`views.full` defines the complete handset. `views.screen` defines zoom mode (upper portion of phone). Each contains its own `width`, `height`, `body`, `glass` and `screenRect`. Rectangles use fractions of that view's asset dimensions: `left=x*100%`, `top=y*100%`, `width=width*100%`, `height=height*100%`. Always maintain the view's width/height ratio. `screen.width/height` are emulator pixels, not asset dimensions.

Place live Canvas under the body, optional glass above, SVG hitboxes last. Canvas must use contain/letterboxing when framebuffer ratio differs from the handset display; never stretch the framebuffer. Use integer game rendering where practical. E71 remains a vertical handset with a horizontal 320×240 window.

Only full mode has physical hitboxes. In screen mode provide separate touch keypad/softkeys, keyboard and gamepad; keep ongoing input state shared and release held sources when switching modes. Zoom changes display presentation only. It must not resize the emulated game or restart a MIDlet.

`keyMappings` are logical game bindings, not a complete reconstruction of the handset OS. Null means no game binding: do not send a fabricated J2ME code. E71's W/A/S/D game bindings and R/T/Y/F/G/H/V/B/N/M digit bindings are explicit configuration decisions, not automatic support for an emulated E71 keyboard. Call/End, OS shortcuts and Fn/Chr need an explicit implementation before enabling. 6100 has four navigation sectors and no invented central Fire key.

## Added handsets

| ID | Variant | LCD | Controls |
|---|---|---|---|
| sony-ericsson-w995 | Progressive Black, numeric slider open (2009) | 240×320 | 12 keys, navigation, soft keys and Back/C |
| sony-ericsson-k790i | Velvet Black, EDGE (2006) | 240×320 | 12 keys, joystick and Back/C; no K800i front camera |
| motorola-razr-v3 | Original Silver, clamshell open (2004) | 176×220 | Individually outlined etched keypad cells; zoom is the inner display lid |
| nokia-5800 | Standard XpressMusic Black/Red (2008) | 360×640 | Touch display; real Call/Menu/End and media shortcut, no invented D-pad |
| samsung-s5230 | Original non-Wi-Fi GT-S5230 Black (2009) | 240×400 | Touch display; Call, Back and End, no invented numeric keypad |

`input.kind`, `input.pointer` and `input.externalKeypad` describe input surfaces, not emulator hardware capabilities. 5800/S5230 always show the external game keypad in full view as well as zoom, and their Canvas receives real pointer events. OS-only keys remain unbound; Samsung Back uses the explicitly configured clear action. New phone profiles resolve to existing generic presets and retain their actual keys/fullscreen policy/platform properties. See `docs/PLAYER_CONTROLS.md` for the mapping.

## Validation and limitations

Validation checks exact zero alpha inside full and zoom active windows (PNG and decoded WebP), exact display proportions, nonoverlapping button polygons and binding coverage. Native originals remain retained. Pixel-level alpha and geometry checks do not prove historical authenticity or that game input works end-to-end.

Body illustrations have not been visually signed off. Some button polygons approximate the physical curves; compare debug overlays with reference photos before final acceptance. K750i Back currently shares the clear gameplay binding; this does not assert that the two physical keys are equivalent on a real device. Empty glass layers are intentional. No game/menu image is embedded in any active display.

Integration task: see `docs/PHONE_SKINS_AGENT_PROMPT.md`.
