# MGO • WattVision brand & illustration kit

Original SVG assets for `grayhex/MGO`, based on the actual **WattVision** colors and site layout (inspected 2026-11-02).

- Background `#121212` · surfaces `#1E1E1E` · outline `#2C2C2E` · primary `#00E5FF` · primary text `#5CF0FF` · status `#32D74B` · error `#FF453A`
- All images are authored as SVG paths and shapes. **No raster content, embedded fonts, external images, or tracking.** Letterforms are outlined vector paths so SVGs remain portable.
- Most SVGs have transparent backgrounds. They are sized for the real component proportions, not square thumbnail placeholders.
- Artwork is original and intentionally stylized. No phone manufacturer logos/images are reused.

## Files

| Asset | Intended use | Native SVG viewBox |
|---|---|---|
| `brand/mark.svg` | Sidebar 32×32, app tile 64×64 | 80×80 |
| `brand/logo-sidebar.svg` | Sidebar expanded, replace `.brand-mark` + `.brand-text` | 210×48 |
| `brand/logo-horizontal.svg` | Login panel + About dialog | 422×86 |
| `brand/logo-minimal.svg` | Smaller horizontal use | 305×66 |
| `brand/favicon.svg` | Browser tabs + favicon | 64×64 |
| `brand/favicon-monochrome.svg` | Pinned/monochrome use | 64×64 |
| `brand/social-card.svg` | Social preview/README banner | 1200×630 |
| `auth/login-hero.svg` | Left login panel (responsive illustration) | 720×540 |
| `auth/token-shield.svg` | Access token heading/help | 96×96 |
| `actions/play-icon.svg` | Inline JSX/CSS button, 18–24px | 24×24 |
| `actions/play-icon-on-cyan.svg` | Icon on primary cyan background | 24×24 |
| `actions/play-circle.svg` | Cover play overlay, 40–56px | 56×56 |
| `actions/play-button.svg` | Example EN primary button, 168×48 | 168×48 |
| `actions/play-button-outline.svg` | Example EN secondary button | 168×48 |
| `actions/stop-icon.svg` | Stop/close session | 24×24 |
| `actions/restart-icon.svg` | Restart session | 24×24 |
| `states/library-empty.svg` | Empty library/import landing | 480×300 |
| `states/server-offline.svg` | EKA2L1 / server unavailable | 480×300 |

## Integration

Copy `brand`, `auth`, `actions`, `states` into `apps/web/public/brand/` (or keep subfolder structure inside `public/graphics/`).

### Sidebar

In `apps/web/src/components/Shell.tsx`, the existing `.brand` link currently contains `brand-mark` plus `brand-text`. Replace only that visual subtree:

```tsx
<img src="/graphics/brand/logo-sidebar.svg" alt="" className="brand-logo" />
```

```css
.brand-logo { width: 210px; max-width: 100%; height: 48px; object-fit: contain; object-position: left center; }
.shell-collapsed .brand-logo { display: none; }
.shell-collapsed .brand::before { content: ''; display: block; width: 32px; height: 32px; flex-shrink: 0; background: url('/graphics/brand/mark.svg') center / contain no-repeat; }
```

If using this CSS, remove old icon children and adjust `.brand` height or override it to 48px. Sidebar collapsed width is 64px, so a 32px mark fits within its padding.

### Login

In `apps/web/src/App.tsx` Login(), embed the wide logo and illustration in `.login-hero` above/below copy, with `<img src="/graphics/auth/login-hero.svg" alt="" />`. Mark illustration `alt=""` (decorative), retain login `<h1>` semantically or visually hide text. Example:

```tsx
<img src="/graphics/brand/logo-horizontal.svg" alt="" className="login-logo" />
<img src="/graphics/auth/login-hero.svg" alt="" className="login-art" />
```

```css
.login-logo { width: min(360px, 100%); height: auto; }
.login-art { display: block; width: min(640px, 100%); max-height: 49vh; object-fit: contain; }
@media (max-width: 760px) { .login-art { max-height: 180px; } }
```

**Security:** `login-hero.svg` uses fictional game/status motifs. It does not show or store an access token.

### Favicon

In `apps/web/index.html`, replace the old orange data-URL favicon with:

```html
<link rel="icon" href="/graphics/brand/favicon.svg" type="image/svg+xml" />
```

### Play buttons

Use `actions/play-icon-on-cyan.svg` inside the existing `.btn.primary` so label remains translated through `translateUI` and stays accessible. Avoid substituting an entire fixed-text SVG button for a real button: `play-button.svg` files are only visual examples (they say START in English). Example:

```tsx
<button className="btn primary"><img src="/graphics/actions/play-icon-on-cyan.svg" width="20" height="20" alt="" />{translateUI('Start')}</button>
```

For play overlays on library covers, use `actions/play-circle.svg` but keep the actual interactive hit area in HTML and provide an accessible label.

### Empty library / offline

Add `states/library-empty.svg` to empty view in `apps/web/src/components/Library.tsx`, keeping existing import actions and copy. Use `states/server-offline.svg` only when unavailable status is confirmed; don't turn a temporary loading state into an error.

## Preview

`preview/brand-system.png` contains the complete asset gallery, and `preview/login-and-library.png` demonstrates proportion at plausible UI scale. Both are previews; original files remain scalable.
