// Regenerates the pictures used by README.md from a running build, with real games in the phone.
//
//   npm run build && GAMES_DIR=/path/with/your/jars node tools/docs/capture-readme.mjs
//
// The JARs are never copied into the repository: they are uploaded to a throw-away data directory.
// The games are matched by name: a JAR whose file name contains "pool" is used for the landscape animation,
// one containing "assassin" for the portrait animation. Needs Python 3 with Pillow for the GIFs.
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(root, 'package.json'));
const { chromium } = require('playwright');
const gamesDir = process.env.GAMES_DIR;
if (!gamesDir) { console.error('Set GAMES_DIR to a folder with a few .jar files.'); process.exit(2); }
const outDir = path.join(root, 'docs/img');
const work = mkdtempSync(path.join(tmpdir(), 'jgo-readme-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jars = readdirSync(gamesDir).filter((f) => /\.jar$/i.test(f));

async function boot(env = {}, fixedDataDir = null) {
  const dataDir = fixedDataDir ?? mkdtempSync(path.join(work, 'data-'));
  if (fixedDataDir) mkdirSync(fixedDataDir, { recursive: true });
  const port = 21000 + Math.floor(Math.random() * 900);
  const base = `http://127.0.0.1:${port}`;
  const server = spawn('node', [path.join(root, 'apps/api/dist/server.js')], { env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, LOG_LEVEL: 'error', ...env }, stdio: 'ignore' });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* starting */ } await sleep(100); }
  return { base, server, dataDir };
}
async function upload(base, file) {
  const fd = new FormData();
  fd.append('jar', new Blob([readFileSync(path.join(gamesDir, file))]), file);
  return (await (await fetch(base + '/api/games', { method: 'POST', body: fd })).json()).game;
}
const post = (base, p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
const startSession = async (base, gameId, settings) => (await (await post(base, '/api/sessions', { gameId, settings: { device: null, profileMode: 'advanced', ...settings } })).json());

/** A GIF of the phone area while the game runs; `keys` are pressed one by one while frames are taken. */
async function animation(page, locator, name, { seconds, every = 900, keys = [], width = 460 }) {
  const dir = path.join(work, name);
  mkdirSync(dir, { recursive: true });
  // the first seconds of a start are black: begin when the game has drawn something
  await page.waitForFunction(() => { const c = document.querySelector('canvas.skin-canvas'); if (!c) return false; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 0; i < d.length; i += 64) if (d[i] > 24 || d[i + 1] > 24 || d[i + 2] > 24) return true; return false; }, null, { timeout: 40000 }).catch(() => undefined);
  const t0 = Date.now();
  let n = 0;
  let k = 0;
  while (Date.now() - t0 < seconds * 1000) {
    await page.locator(locator).screenshot({ path: path.join(dir, `f${String(n++).padStart(3, '0')}.png`) });
    if (n % 3 === 0 && keys[k]) { const key = keys[k++]; await page.keyboard.down(key); await sleep(120); await page.keyboard.up(key); }
    await sleep(every);
  }
  execFileSync('python3', ['-I', '-c', `
import glob, sys
from PIL import Image
fs = sorted(glob.glob(sys.argv[1] + '/f*.png'))
ims = [Image.open(f).convert('RGB') for f in fs]
w = int(sys.argv[3]); ims = [i.resize((w, round(i.height * w / i.width)), Image.LANCZOS) for i in ims]
pal = [i.quantize(colors=96, method=Image.MEDIANCUT, dither=Image.NONE) for i in ims]
pal[0].save(sys.argv[2], save_all=True, append_images=pal[1:], duration=int(sys.argv[4]), loop=0, optimize=True, disposal=1)
print(sys.argv[2], len(ims), 'frames')
`, dir, path.join(outDir, `${name}.gif`), String(width), String(every + 250)], { stdio: 'inherit' });
}

const only = process.env.ONLY; // 'games' or 'wizard' to redo one part
const browser = await chromium.launch();
try {
  // ---- the library with real games, the player, the animations ------------------------------------------------
  if (!only || only === 'games') {
    const { base, server } = await boot();
    await fetch(base + '/api/setup/skip', { method: 'POST' });
    const games = {};
    for (const f of jars) { const g = await upload(base, f); games[f.toLowerCase()] = g; }
    const find = (needle) => Object.entries(games).find(([f]) => f.includes(needle))?.[1];
    const pool = find('pool'); const assassin = find('assassin');
    const light = await browser.newContext({ viewport: { width: 1280, height: 760 }, colorScheme: 'light' });
    const page = await light.newPage();
    await page.goto(base); await page.waitForSelector('article.game-card'); await sleep(400);
    await page.screenshot({ path: path.join(outDir, 'library.png') });
    const dark = await browser.newContext({ viewport: { width: 1280, height: 760 }, colorScheme: 'dark' });
    const dp = await dark.newPage();
    await dp.goto(base); await dp.waitForSelector('article.game-card'); await sleep(400);
    await dp.screenshot({ path: path.join(outDir, 'library-dark.png') });

    if (pool) {
      // a landscape game on the Nokia E71: 480×800 picture turned by 270°
      const s = await startSession(base, pool.id, { width: 480, height: 800 });
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
      await ctx.addInitScript(([k, v, k2, v2]) => { localStorage.setItem(k, v); localStorage.setItem(k2, v2); }, [`j2me-web.rotation.${pool.id}`, '270', 'j2me-web.skin.v1', JSON.stringify({ skinId: 'nokia-e71', view: 'full', integer: true })]);
      const p = await ctx.newPage();
      await p.goto(`${base}/play/${pool.id}`); await p.waitForSelector('canvas.skin-canvas');
      await animation(p, '.skin-box', 'player-landscape', { seconds: 30, width: 340, keys: ['Enter', 'Digit5', 'Enter', 'Digit5', 'ArrowDown', 'Enter', 'Digit5', 'Enter', 'Digit5'] });
      await p.screenshot({ path: path.join(outDir, 'player.png') });
      await p.getByRole('radio', { name: /Screen/ }).click(); await sleep(700);
      await p.screenshot({ path: path.join(outDir, 'player-screen.png') });
      await fetch(`${base}/api/sessions/${s.id}`, { method: 'DELETE' }); await sleep(2000);
      await ctx.close();
    }
    if (assassin) {
      const s = await startSession(base, assassin.id, { width: 480, height: 800 });
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
      await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), ['j2me-web.skin.v1', JSON.stringify({ skinId: 'nokia-n95', view: 'full', integer: true })]);
      const p = await ctx.newPage();
      await p.goto(`${base}/play/${assassin.id}`); await p.waitForSelector('canvas.skin-canvas');
      await animation(p, '.skin-box', 'player-portrait', { seconds: 22, width: 300, keys: ['Enter', 'Digit5', 'Enter', 'Digit5', 'Enter', 'Digit5', 'Enter'] });
      await fetch(`${base}/api/sessions/${s.id}`, { method: 'DELETE' });
      // mobile
      await sleep(2000);
      const s2 = await startSession(base, assassin.id, { width: 480, height: 800 });
      const m = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
      await m.addInitScript(([k, v]) => localStorage.setItem(k, v), ['j2me-web.skin.v1', JSON.stringify({ skinId: 'nokia-n95', view: 'full', integer: true })]);
      const mp = await m.newPage();
      await mp.goto(`${base}/play/${assassin.id}`); await mp.waitForSelector('canvas.skin-canvas'); await sleep(12000);
      await mp.screenshot({ path: path.join(outDir, 'mobile.png') });
      await fetch(`${base}/api/sessions/${s2.id}`, { method: 'DELETE' });
    }
    server.kill('SIGTERM');
  }

  // ---- first run: the wizard on an empty server, then Settings after an import --------------------------------
  if (!only || only === 'wizard') {
    // paths as on an installed container, when this machine allows creating them (they are removed again)
    const realPaths = process.getuid?.() === 0 && !existsSync('/mnt/jgo-library') && !existsSync('/var/lib/jgo');
    const lib = realPaths ? '/mnt/jgo-library' : path.join(work, 'collection');
    mkdirSync(path.join(lib, 'Gameloft'), { recursive: true });
    for (const f of jars) copyFileSync(path.join(gamesDir, f), path.join(lib, 'Gameloft', f));
    // a virtual display, as on an installed container, so that the system check shows the 3D prerequisites as present
    const xvfb = existsSync('/usr/bin/Xvfb') ? spawn('Xvfb', [':96', '-screen', '0', '640x480x24', '+extension', 'GLX', '-nolisten', 'tcp'], { stdio: 'ignore' }) : null;
    if (xvfb) for (let i = 0; i < 50 && !existsSync('/tmp/.X11-unix/X96'); i++) await sleep(100);
    const { base, server } = await boot({ LIBRARY_ROOTS: lib, ...(xvfb ? { KEM_DISPLAY: ':96', LIBGL_ALWAYS_SOFTWARE: '1' } : {}) }, realPaths ? '/var/lib/jgo' : null);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 } });
    const p = await ctx.newPage();
    await p.goto(base);
    const dialog = p.getByRole('dialog', { name: 'Set up JGO' });
    await dialog.waitFor();
    await dialog.locator('[data-testid=system-checks] .check').first().waitFor(); await sleep(900);
    await p.screenshot({ path: path.join(outDir, 'wizard.png') });
    await dialog.getByRole('button', { name: 'Start' }).click();
    await dialog.locator('.root', { hasText: lib }).click();
    await dialog.getByRole('button', { name: 'Check access' }).click();
    await dialog.locator('.note.info', { hasText: 'Readable' }).waitFor();
    await p.screenshot({ path: path.join(outDir, 'wizard-library.png') });
    await dialog.getByRole('button', { name: 'Use this folder' }).click();
    await dialog.locator('text=Current folder').waitFor();
    await dialog.getByRole('button', { name: 'Skip setup' }).click();
    await dialog.waitFor({ state: 'hidden' });
    await post(base, '/api/library/scan', { mode: 'update' });
    await sleep(2500);
    await p.goto(`${base}/settings`); await p.waitForSelector('#library [data-testid=scan-report]');
    await p.locator('#library').scrollIntoViewIfNeeded(); await sleep(300);
    await p.screenshot({ path: path.join(outDir, 'settings.png') });
    server.kill('SIGTERM');
    xvfb?.kill('SIGTERM');
    await sleep(500);
    if (realPaths) { rmSync('/mnt/jgo-library', { recursive: true, force: true }); rmSync('/var/lib/jgo', { recursive: true, force: true }); }
  }
} finally {
  await browser.close();
  rmSync(work, { recursive: true, force: true });
}
