# Phone artwork for J2ME Web

Five independently shaped handset illustrations, **review drafts**. Files are original generated artwork informed by the linked photographic references; they are not manufacturer-authorized reproductions. Historical acceptance (especially tiny legends, materials and precise physical key boundaries) is still required. Reference independence gaps are recorded in each references.md; do not interpret export validation as historical certification.

## Files per phone

- `body.png`, `body.webp`: full phone, RGBA / lossless alpha, 2048 px export height.
- `zoom.png`, `zoom.webp`: upper shell with active display, without the numeric/QWERTY keyboard. This is a crop of the full export, not a new drawing; alignment is identical.
- `glass.png`, `zoom-glass.png`: intentionally empty transparent optional layers, no glare.
- `hitboxes.svg`: full-view physical control regions, transparent by default.
- `preview.webp`: small full-view thumbnail with alpha.
- `config.json`: dimensions, display resolution, normalized window rectangles, polygons and logical gameplay bindings.
- `references.md`: source links, exclusions and remaining visual acceptance work.

Original generated PNGs are in `design/phones/<id>/source.png`. Native sizes are recorded in config; scaling the export to 2048 px does not add source detail. Export and validation scripts are in `tools/phones/`. Requires Python 3, Pillow and NumPy. Run from the repository root:

```sh
python3 tools/phones/export_assets.py
python3 tools/phones/validate_assets.py
```

## Coordinates and two view modes

`views.full` defines the complete handset. `views.screen` defines zoom mode (upper portion of phone). Each contains its own `width`, `height`, `body`, `glass` and `screenRect`. Rectangles use fractions of that view's asset dimensions: `left=x*100%`, `top=y*100%`, `width=width*100%`, `height=height*100%`. Always maintain the view's width/height ratio. `screen.width/height` are emulator pixels, not asset dimensions.

Place live Canvas under the body, optional glass above, SVG hitboxes last. Canvas must use contain/letterboxing when framebuffer ratio differs from the handset display; never stretch the framebuffer. Use integer game rendering where practical. E71 remains a vertical handset with a horizontal 320×240 window.

Only full mode has physical hitboxes. In screen mode provide separate touch keypad/softkeys, keyboard and gamepad; keep ongoing input state shared and release held sources when switching modes. Zoom changes display presentation only. It must not resize the emulated game or restart a MIDlet.

`keyMappings` are logical game bindings, not a complete reconstruction of the handset OS. Null means no game binding: do not send a fabricated J2ME code. E71's W/A/S/D game bindings and R/T/Y/F/G/H/V/B/N/M digit bindings are explicit configuration decisions, not automatic support for an emulated E71 keyboard. Call/End, OS shortcuts and Fn/Chr need an explicit implementation before enabling. 6100 has four navigation sectors and no invented central Fire key.

## Validation and limitations

Validation checks exact zero alpha inside full and zoom active windows (PNG and decoded WebP), exact display proportions, nonoverlapping button polygons and binding coverage. Native originals remain retained. Pixel-level alpha and geometry checks do not prove historical authenticity or that game input works end-to-end.

Body illustrations have not been visually signed off. Some button polygons approximate the physical curves; compare debug overlays with reference photos before final acceptance. K750i Back currently shares the clear gameplay binding; this does not assert that the two physical keys are equivalent on a real device. Empty glass layers are intentional. No game/menu image is embedded in any active display.

Integration task: see `docs/PHONE_SKINS_AGENT_PROMPT.md`.
