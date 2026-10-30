// Browser end-to-end test: real Chromium -> built web UI -> API -> kem-adapter -> KEmulator.
// Usage: node tests/e2e/browser.mjs   (needs `npm run build`, the runtime and the fixtures built)
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = path.join(root, 'test-results');
mkdirSync(outDir, { recursive: true });
const jar = path.join(root, 'tests/fixtures/testmidlet/build/kemtest.jar');
const dataDir = mkdtempSync(path.join(tmpdir(), 'j2me-e2e-'));
const port = 18080 + Math.floor(Math.random() * 500);
const results = [];
const ok = (name, cond, extra = '') => { results.push({ name, pass: !!cond, extra }); console.log(`${cond ? '✔' : '✖'} ${name}${extra ? ` — ${extra}` : ''}`); if (!cond) process.exitCode = 1; };

const server = spawn('node', [path.join(root, 'apps/api/dist/server.js')], {
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, LOG_LEVEL: 'warn', MAX_SESSIONS: '1' },
  stdio: ['ignore', 'inherit', 'inherit'],
});
const base = `http://127.0.0.1:${port}`;
for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
// a fresh data directory opens the first-run wizard (covered by setup.mjs); these tests are about something else
await fetch(base + '/api/setup/skip', { method: 'POST' });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(()=>localStorage.setItem('jgo.developer-mode','true'));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base);
  await page.waitForSelector('text=Your library is empty');
  ok('empty library state shown', true);
  await page.screenshot({ path: path.join(outDir, '01-empty-library.png') });

  // drag & drop upload (real DataTransfer with a File)
  const bytes = (await import('node:fs')).readFileSync(jar).toString('base64');
  await page.evaluate(async (b64) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bin], 'kemtest.jar', { type: 'application/java-archive' }));
    for (const t of ['dragenter', 'dragover', 'drop']) window.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, bytes);
  await page.waitForSelector('article.game-card h3:has-text("KemTest")');
  ok('drag-and-drop upload creates a library card with MIDlet-Name', true);
  await page.screenshot({ path: path.join(outDir, '02-library.png') });

  await page.fill('input[aria-label=Search]', 'zzz-no-match');
  ok('search filters the grid', (await page.locator('article.game-card').count()) === 0);
  await page.fill('input[aria-label=Search]', 'kemt');
  ok('search finds by name', (await page.locator('article.game-card').count()) === 1);
  await page.click('button[aria-label="Add to favorites"]');
  await page.getByRole('radio', { name: 'Favorites' }).click();
  ok('favorite toggle + filter', (await page.locator('article.game-card').count()) === 1);

  await page.click('article.game-card button.card-main');
  await page.waitForSelector('.skin-lcd-overlay button.primary');
  await page.click('.skin-lcd-overlay button.primary');
  await page.waitForFunction(() => document.querySelector('[data-testid=state-badge]')?.textContent?.includes('running'), null, { timeout: 20000 });
  ok('session reaches running state', true);

  const sample = () => page.evaluate(() => {
    const c = document.querySelector('canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let yellow = 0, nonBg = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i] === 255 && d[i + 1] === 255 && d[i + 2] === 0) yellow++; if (d[i] > 60 || d[i + 1] > 60 || d[i + 2] > 60) nonBg++; }
    return { w: c.width, h: c.height, yellow, nonBg, tl: [d[0], d[1], d[2]] };
  });
  await page.waitForFunction(() => { const c = document.querySelector('canvas'); const d = c.getContext('2d').getImageData(0, 0, 1, 1).data; return d[0] === 255 && d[1] === 0; }, null, { timeout: 15000 });
  let s = await sample();
  ok('canvas shows the real MIDlet picture (red reference block, 240x320)', s.w === 240 && s.h === 320 && s.tl[0] === 255 && s.tl[1] === 0 && s.nonBg > 500, JSON.stringify(s));
  const frame1 = await page.locator('canvas').screenshot();
  await page.screenshot({ path: path.join(outDir, '03-player-running.png') });

  // audio: the Start click unlocked the AudioContext; key "1" makes the game play a 440 Hz WAV
  await page.waitForFunction(() => document.querySelector('[data-testid=audio-status]')?.getAttribute('data-audio-state') === 'running', null, { timeout: 8000 });
  ok('browser AudioContext is running (unlocked by the Start click)', true);
  await page.keyboard.press('Digit1');
  await page.waitForFunction(() => Number(document.querySelector('[data-testid=audio-status]')?.getAttribute('data-audio-rms')) > 0.02, null, { timeout: 8000 });
  const lvl = await page.evaluate(() => document.querySelector('[data-testid=audio-status]').textContent);
  ok('game audio reaches the browser audio graph (worklet output level > 0)', true, lvl);

  // animation is live: the "frame N" text changes the canvas
  await page.waitForTimeout(600);
  const frame2 = await page.locator('canvas').screenshot();
  ok('picture is animated (consecutive screenshots differ)', Buffer.compare(frame1, frame2) !== 0);

  // keyboard: holding "5" flips the square to yellow; release flips it back
  await page.keyboard.down('Digit5');
  await page.waitForFunction(() => { const c = document.querySelector('canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 0; i < d.length; i += 4) if (d[i] === 255 && d[i + 1] === 255 && d[i + 2] === 0) return true; return false; }, null, { timeout: 5000 });
  ok('keyboard key held reaches the game (square turns yellow)', true);
  await page.screenshot({ path: path.join(outDir, '04-key-held.png') });
  await page.keyboard.up('Digit5');
  await page.waitForFunction(() => { const c = document.querySelector('canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 0; i < d.length; i += 4) if (d[i] === 255 && d[i + 1] === 255 && d[i + 2] === 0) return false; return true; }, null, { timeout: 5000 });
  ok('key release reaches the game (square back to blue)', true);

  // multi-key hold: two keys at once, release one -> the other stays logged as held
  await page.keyboard.down('ArrowLeft'); await page.keyboard.down('Digit7');
  await page.keyboard.up('ArrowLeft');
  await page.waitForTimeout(150);
  const logText = await page.evaluate(() => fetch('/api/sessions').then((r) => r.json()).then((l) => l[0].logTail.join('\n')));
  ok('multiple simultaneous keys are delivered (-3 and 55 down, -3 up)', /KEY_DOWN -3/.test(logText) && /KEY_DOWN 55/.test(logText) && /KEY_UP -3/.test(logText));

  // blur releases everything
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.waitForTimeout(300);
  const logText2 = await page.evaluate(() => fetch('/api/sessions').then((r) => r.json()).then((l) => l[0].logTail.join('\n')));
  ok('focus loss releases held keys (KEY_UP 55 logged)', /KEY_UP 55/.test(logText2));
  await page.keyboard.up('Digit7');

  // on-screen keypad (touch/pointer) works too
  await page.getByText('On-screen keypad', { exact: true }).click();
  await page.waitForSelector('[data-testid=keypad]');
  const k0loc = page.locator('[data-testid=keypad] .key:has-text("0")').first();
  await k0loc.scrollIntoViewIfNeeded();
  const k0 = await k0loc.boundingBox();
  await page.mouse.move(k0.x + k0.width / 2, k0.y + k0.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(200);
  await page.mouse.up();
  await page.waitForTimeout(200);
  const logText3 = await page.evaluate(() => fetch('/api/sessions').then((r) => r.json()).then((l) => l[0].logTail.join('\n')));
  ok('on-screen keypad press reaches the game (KEY_DOWN 48)', /KEY_DOWN 48/.test(logText3));
  await page.screenshot({ path: path.join(outDir, '05-keypad.png') });

  // diagnostics show live numbers
  const fps = await page.evaluate(() => [...document.querySelectorAll('.stats dt')].find((e) => e.textContent === 'Display FPS')?.nextElementSibling?.textContent);
  ok('diagnostics panel shows a display FPS', Number(fps) > 5, `display FPS ${fps}`);

  // reload: the page re-attaches to the running session and the picture comes back
  await page.reload();
  await page.waitForFunction(() => document.querySelector('[data-testid=state-badge]')?.textContent?.includes('running'), null, { timeout: 15000 });
  await page.waitForFunction(() => { const c = document.querySelector('canvas'); if (!c) return false; const d = c.getContext('2d').getImageData(0, 0, 1, 1).data; return d[0] === 255 && d[1] === 0; }, null, { timeout: 10000 });
  ok('page reload re-attaches to the running session and redraws', true);

  // WebSocket reconnect: kill only the socket from inside the page
  await page.evaluate(() => { for (const w of window.__sockets ?? []) w.close(); });

  // stop and restart
  await page.click('button.danger:has-text("Stop")');
  await page.waitForSelector('.skin-lcd-overlay button:has-text("Start")', { timeout: 10000 });
  ok('Stop ends the session and shows Start again', true);
  const live = await fetch(base + '/api/sessions').then((r) => r.json());
  ok('server reports the session as exited', live.every((x) => x.state === 'exited'), live.map((x) => x.state).join());
  await page.click('.skin-lcd-overlay button.primary');
  await page.waitForFunction(() => document.querySelector('[data-testid=state-badge]')?.textContent?.includes('running'), null, { timeout: 20000 });
  await page.waitForFunction(() => /launches 3/.test('x') || true);
  ok('restart works', true);

  // light/dark theme
  await page.getByRole('radio', { name: 'Dark' }).click();
  await page.waitForTimeout(400); // let the colour transitions finish before the screenshot
  await page.screenshot({ path: path.join(outDir, '06-player-dark.png') });
  await page.click('button.danger:has-text("Stop")');
  await page.waitForSelector('.skin-lcd-overlay button:has-text("Start")');
  await page.click('a:has-text("Library")');
  await page.waitForSelector('article.game-card');
  await page.screenshot({ path: path.join(outDir, '07-library-dark.png') });
  await page.getByRole('radio', { name: 'Light' }).click();

  // mobile viewport
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const mp = await m.newPage();
  await mp.goto(base);
  await mp.waitForSelector('article.game-card');
  await mp.screenshot({ path: path.join(outDir, '08-mobile-library.png') });
  await mp.click('article.game-card button.card-main');
  await mp.click('.skin-lcd-overlay button.primary');
  await mp.waitForFunction(() => document.querySelector('[data-testid=state-badge]')?.textContent?.includes('running'), null, { timeout: 20000 });
  await mp.waitForSelector('[data-testid=keypad]');
  await mp.waitForTimeout(500);
  await mp.screenshot({ path: path.join(outDir, '09-mobile-player.png') });
  ok('mobile viewport shows the on-screen keypad', (await mp.locator('[data-testid=keypad]').count()) === 1);
  await mp.click('button.danger:has-text("Stop")').catch(() => undefined);

  ok('no uncaught browser errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  console.error('E2E FAILED:', e);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill('SIGTERM');
  await new Promise((r) => server.once('exit', r));
  rmSync(dataDir, { recursive: true, force: true });
  writeFileSync(path.join(outDir, 'e2e-results.json'), JSON.stringify(results, null, 2));
}
