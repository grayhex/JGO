# Production and developer boundaries

Default `npm run build` emits the production API and UI. Static JAR analysis lives in `apps/api/src/analysis/` and remains available to import/compatibility features. Compatibility Lab's runner, discovery, report and CLI are developer-only in `src/lab`; test helpers/stand-in HTTP services live in `src/dev`. Neither is compiled into the production API.

`/phones` in production is a handset catalogue. The alignment patterns, hitbox diagnostics and experimental page live in `apps/web/src/dev/PhonesPage.tsx`, included only with `VITE_DEVELOPER_BUILD=true` and shown only when Developer Mode is enabled. A production build cannot load this module merely by changing browser storage. Developer Mode in Settings reveals extended telemetry/compatibility diagnostics; ordinary users keep necessary error information and normal device/profile settings.

Commands for repository developers:

```sh
npm run build                 # production, clean API output
npm run build:dev             # developer UI + compiled CLI Lab modules
npm run dev                   # development server
npm run lab -- devices        # CLI Lab via tsx in the source checkout
npm run fixtures:dev          # explicit test MIDlet construction
npm test
npm run test:integration
npm run test:e2e              # production browser scenarios, recovery and locales
npm run test:e2e:dev          # developer alignment-page tests
node tests/scripts/production.mjs  # run immediately after production build
```

Both tarball assembly and Docker runtime preparation use `tools/release/prune.mjs` on a *staged* app tree. Tarball assembly rejects a developer build before staging. They install/prune production dependencies and exclude JGO test resources, Lab, helpers, development sources, source maps, declarations and research manifests. Skin WebP/JSON/SVG, all five handsets, static analysis and normal application functions remain. Empty optional glass layers remain required runtime assets. Legal corresponding sources of KEmulator patches/audio are intentionally retained.

The installed archive is a runtime, not a source checkout: developer commands run from the repository with development dependencies. EN is the default; the EN/RU switch on login and in the header persists in this browser. Translation dictionary: `apps/web/src/i18n/ru.json`. Game names/content, filesystem paths, vendor platform strings, third-party descriptions and raw technical logs are not machine-translated.
