# Illustration originals

These PNGs are generated source illustrations used to build the website assets. They are original illustrations based on references, not copied reference photographs. Export masks, crops, coordinates and conversions live in tools/phones/export_assets.py.

`source.png` is the current illustration for each handset. `nokia-e71/source-before-number-correction.png` preserves the intermediate original before the explicit 9/0 secondary legend correction. Do not use that intermediate version for runtime assets.

All ten sets remain visual review drafts. See apps/web/public/phones/README.md for native resolution, historical acceptance limitations and integration contract. Review source/reference geometry and spelling before signing off authenticity.

The five additions (W995, K790i, original open RAZR V3, 5800 XpressMusic and S5230) retain source.png plus source-space layout.json, silhouette.svg and generation.json. Export them with `python3 tools/phones/export_measured.py`. Only alpha masks, cropping, resampling and format conversion are applied programmatically. The exporter never fabricates text or key artwork. Source photographs remain outside this repository with URLs/checksums in each reference dossier.
