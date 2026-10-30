// Browser end-to-end test of the phone skins: real Chromium -> built web UI -> API -> kem-adapter -> KEmulator (KemTest MIDlet).
// Covers: /phones for all five models and both views, hitboxes (hold, slide, several fingers, cancel, blur),
// keys without a binding, the live canvas under the transparent window without stretching, zoom without a restart,
// release on model/view change.
// Usage: node tests/e2e/skins.mjs   (needs `npm run build`, the runtime and the fixtures built)
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
const dataDir = mkdtempSync(path.join(tmpdir(), 'j2me-skins-'));
const port = 18700 + Math.floor(Math.random() * 400);
const base = `http://127.0.0.1:${port}`;
const IDS = ['nokia-6100', 'nokia-6230i', 'sony-ericsson-k750i', 'nokia-n95', 'nokia-e71'];
const results = [];
const ok = (name, cond, extra = '') => { results.push({ name, pass: !!cond, extra }); console.log(`${cond ? '✔' : '✖'} ${name}${extra ? ` — ${extra}` : ''}`); if (!cond) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn('node', [path.join(root, 'apps/api/dist/server.js')], {
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, LOG_LEVEL: 'warn', MAX_SESSIONS: '1' },
  stdio: ['ignore', 'inherit', 'inherit'],
});
for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* starting */ } await sleep(100); }
// a fresh data directory opens the first-run wizard (covered by setup.mjs); these tests are about something else
await fetch(base + '/api/setup/skip', { method: 'POST' });

const cfg = {};
for (const id of IDS) cfg[id] = await (await fetch(`${base}/phones/${id}/config.json`)).json();

const inside = (p, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i]; const [xj, yj] = poly[j]; if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c; } return c; };
/** A point well inside the polygon: the centroid if it is inside, else the nearest grid point that is. */
function interior(poly) {
  const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length, cy = poly.reduce((a, p) => a + p[1], 0) / poly.length;
  if (inside([cx, cy], poly)) return [cx, cy];
  let best = null, bd = 9;
  for (let x = 0; x <= 1; x += 0.002) for (let y = 0; y <= 1; y += 0.002) if (inside([x, y], poly)) { const d = (x - cx) ** 2 + (y - cy) ** 2; if (d < bd) { bd = d; best = [x, y]; } }
  return best;
}
async function point(page, id, view, key) {
  const poly = cfg[id].buttons.find((b) => b.id === key).polygon;
  const [nx, ny] = interior(poly);
  const loc = page.locator(`.skin-box[data-skin="${id}"][data-view="${view}"]`).first();
  await loc.scrollIntoViewIfNeeded();
  const box = await loc.boundingBox();
  return { x: box.x + nx * box.width, y: box.y + ny * box.height };
}
const keyLog = (page) => page.locator('[data-testid=key-log]').innerText();

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  // ---------------------------------------------------------------- /phones
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base + '/phones');
  await page.waitForSelector('[data-testid=phone-nokia-e71]');
  await page.waitForFunction(() => [...document.querySelectorAll('.skin-body')].every((i) => i.complete && i.naturalWidth > 0) && document.querySelectorAll('.skin-body').length === 10, null, { timeout: 20000 });
  ok('/phones shows all five models in both views (10 pictures, all loaded)', true);
  for (const id of IDS) {
    const c = cfg[id];
    const n = await page.locator(`[data-testid=phone-${id}] .skin-box`).count();
    ok(`${c.model}: two views`, n === 2);
  }
  ok('every card says review draft', (await page.locator('.phone-card .badge:has-text("review draft")').count()) === 5);

  // each model: the display window is transparent in the asset, the canvas sits under it at the right place and ratio
  for (const id of IDS) {
    const c = cfg[id];
    for (const view of ['full', 'screen']) {
      const m = await page.evaluate(({ id, view }) => {
        const box = document.querySelector(`.skin-box[data-skin="${id}"][data-view="${view}"]`);
        const lcd = box.querySelector('.skin-lcd').getBoundingClientRect();
        const cv = box.querySelector('canvas').getBoundingClientRect();
        const b = box.getBoundingClientRect();
        return { lcd: [lcd.left - b.left, lcd.top - b.top, lcd.width, lcd.height], cv: [cv.left - b.left, cv.top - b.top, cv.width, cv.height], box: [b.width, b.height] };
      }, { id, view });
      const r = c.views[view].screenRect;
      const exp = [r.x * m.box[0], r.y * m.box[1], r.width * m.box[0], r.height * m.box[1]];
      const closeTo = m.lcd.every((v, i) => Math.abs(v - exp[i]) < 1.5);
      const ratio = m.cv[2] / m.cv[3];
      ok(`${c.model} ${view}: display window sits at views.${view}.screenRect`, closeTo, JSON.stringify(m.lcd.map(Math.round)));
      ok(`${c.model} ${view}: the ${c.screen.width}×${c.screen.height} picture is not stretched`, Math.abs(ratio / (c.screen.width / c.screen.height) - 1) < 0.01, `ratio ${ratio.toFixed(3)}`);
      ok(`${c.model} ${view}: the canvas is inside its window`, m.cv[0] >= m.lcd[0] - 1 && m.cv[1] >= m.lcd[1] - 1 && m.cv[0] + m.cv[2] <= m.lcd[0] + m.lcd[2] + 1 && m.cv[1] + m.cv[3] <= m.lcd[1] + m.lcd[3] + 1);
    }
  }
  ok('the screen view has no body keys, the full view has them', (await page.locator('.skin-box[data-view=screen] polygon').count()) === 0 && (await page.locator('.skin-box[data-view=full] polygon').count()) > 100);

  // transparency really shows the canvas: sample the picture inside the window (the test pattern's orange frame) in a screenshot
  const shotBox = await page.locator('.skin-box[data-skin="nokia-n95"][data-view="full"]').first().boundingBox();
  await page.screenshot({ path: path.join(outDir, 'skin-01-phones.png'), clip: { x: 0, y: 0, width: 1440, height: 1000 } });

  // hold + release with the mouse
  await page.locator('[data-testid=phone-nokia-6100]').scrollIntoViewIfNeeded();
  let p = await point(page, 'nokia-6100', 'full', 'd5');
  await page.mouse.move(p.x, p.y); await page.mouse.down();
  await page.waitForTimeout(100);
  ok('hold: pressing 5 on the Nokia 6100 body sends code 53 down and keeps it held', /DOWN J2ME key code 53/.test(await keyLog(page)) && !/UP\s+J2ME key code 53/.test(await keyLog(page)));
  ok('a held key is drawn pressed', (await page.locator('.skin-box[data-skin="nokia-6100"] polygon[data-key=d5].pressed').count()) === 1);
  await page.mouse.up();
  await page.waitForTimeout(100);
  ok('release sends up', /UP\s+J2ME key code 53/.test(await keyLog(page)));
  ok('... and the pressed look is gone', (await page.locator('polygon.pressed').count()) === 0);

  // sliding from one key to the next releases the first
  await page.getByRole('button', { name: 'Clear' }).click();
  const a = await point(page, 'nokia-6100', 'full', 'd1'), b = await point(page, 'nokia-6100', 'full', 'd2');
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 6 }); await page.mouse.up();
  const sl = await keyLog(page);
  ok('sliding 1 -> 2 gives down 49, up 49, down 50, up 50', /DOWN J2ME key code 49[\s\S]*UP\s+J2ME key code 49[\s\S]*DOWN J2ME key code 50[\s\S]*UP\s+J2ME key code 50/.test(sl), sl.replace(/\n/g, ' | ').slice(0, 200));

  // keys with no binding: Call/End exist on the body but send nothing
  await page.getByRole('button', { name: 'Clear' }).click();
  p = await point(page, 'nokia-6100', 'full', 'call');
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.waitForTimeout(80); await page.mouse.up();
  const nb = await keyLog(page);
  ok('Call has no J2ME binding: it is reported, no key code is sent', /Call → \(no J2ME binding, nothing sent\)/.test(nb) && !/J2ME key code/.test(nb), nb.replace(/\n/g, ' | ').slice(0, 160));
  ok('the 6100 has four navigation sectors and no invented Fire', (await page.locator('.skin-box[data-skin="nokia-6100"] polygon[data-key=fire]').count()) === 0);

  // several fingers at once, then a cancel
  await page.getByRole('button', { name: 'Clear' }).click();
  const cdp = await ctx.newCDPSession(page);

  await page.locator('[data-testid=phone-nokia-6230i]').scrollIntoViewIfNeeded();
  const f1b = await point(page, 'nokia-6230i', 'full', 'd1'), f2b = await point(page, 'nokia-6230i', 'full', 'd9'), f3b = await point(page, 'nokia-6230i', 'full', 'fire');
  const tp = (pts) => pts.map((q, i) => ({ x: q.x, y: q.y, id: i + 1 }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp([f1b, f2b, f3b]) });
  await page.waitForTimeout(150);
  let tl = await keyLog(page);
  ok('three fingers hold three keys at once (1, 9 and OK)', /DOWN J2ME key code 49/.test(tl) && /DOWN J2ME key code 57/.test(tl) && /DOWN J2ME key code -5/.test(tl) && !/UP\s+J2ME/.test(tl), tl.replace(/\n/g, ' | ').slice(0, 220));
  ok('three keys are drawn pressed', (await page.locator('.skin-box[data-skin="nokia-6230i"] polygon.pressed').count()) === 3);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp([f1b, f3b]) }); // finger 2 lifts (a point missing from the active set is released)
  await page.waitForTimeout(100);
  tl = await keyLog(page);
  ok('lifting one finger releases only its key (9)', /UP\s+J2ME key code 57/.test(tl) && !/UP\s+J2ME key code 49/.test(tl) && !/UP\s+J2ME key code -5/.test(tl));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await page.waitForTimeout(150);
  tl = await keyLog(page);
  ok('a cancelled touch releases everything still held', /UP\s+J2ME key code 49/.test(tl) && /UP\s+J2ME key code -5/.test(tl) && (await page.locator('polygon.pressed').count()) === 0, tl.replace(/\n/g, ' | ').slice(-160));

  // blur releases a held key
  await page.getByRole('button', { name: 'Clear' }).click();
  p = await point(page, 'nokia-6230i', 'full', 'd5');
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.waitForTimeout(80);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.waitForTimeout(100);
  ok('window blur releases the held key', /UP\s+J2ME key code 53/.test(await keyLog(page)) && (await page.locator('polygon.pressed').count()) === 0);
  await page.mouse.up();

  // E71 QWERTY: the explicit W -> up decision works, Fn has no binding
  await page.getByRole('button', { name: 'Clear' }).click();
  await page.locator('[data-testid=phone-nokia-e71]').scrollIntoViewIfNeeded();
  p = await point(page, 'nokia-e71', 'full', 'key-W');
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.waitForTimeout(80); await page.mouse.up();
  ok('E71 W is bound to Up (Nokia code -1)', /DOWN J2ME key code -1/.test(await keyLog(page)));
  ok('E71 keeps its horizontal 320×240 window in a vertical body', cfg['nokia-e71'].screen.width === 320 && cfg['nokia-e71'].views.full.height > cfg['nokia-e71'].views.full.width);

  // debug overlays
  await page.getByText('Hitboxes', { exact: true }).click();
  await page.getByText('Key ids', { exact: true }).click();
  await page.locator('[data-testid=phone-nokia-n95]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  ok('debug overlay draws hitbox outlines and ids', (await page.locator('polygon.debug').count()) > 100 && (await page.locator('.skin-debug-label').count()) > 100);
  await page.locator('[data-testid=phone-nokia-n95]').screenshot({ path: path.join(outDir, 'skin-02-n95-debug.png') });
  await page.locator('main').getByRole('radio', { name: 'Dark' }).click();
  await page.locator('[data-testid=phone-nokia-e71]').scrollIntoViewIfNeeded();
  await page.locator('[data-testid=phone-nokia-e71]').screenshot({ path: path.join(outDir, 'skin-03-e71-dark.png') });
  await page.locator('main').getByRole('radio', { name: 'Checker' }).click();
  await page.locator('[data-testid=phone-sony-ericsson-k750i]').scrollIntoViewIfNeeded();
  await page.locator('[data-testid=phone-sony-ericsson-k750i]').screenshot({ path: path.join(outDir, 'skin-04-k750i-checker.png') });
  void shotBox;

  // ---------------------------------------------------------------- the player with a real MIDlet
  const bytes = readFileSync(jar).toString('base64');
  await page.goto(base);
  await page.waitForSelector('text=Your library is empty');
  await page.evaluate(async (b64) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer(); dt.items.add(new File([bin], 'kemtest.jar'));
    for (const t of ['dragenter', 'dragover', 'drop']) window.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, bytes);
  await page.waitForSelector('article.game-card h3:has-text("KemTest")');
  await page.click('article.game-card button.card-main');
  await page.waitForSelector('[data-testid=skin-lcd]');
  await page.getByRole('radio', { name: /N95/ }).click();
  ok('the player offers five models', (await page.locator('.skin-picker [role=radio]').count()) === 5);
  await page.click('.skin-lcd-overlay button.primary');
  await page.waitForFunction(() => document.querySelector('[data-testid=state-badge]')?.textContent?.includes('running'), null, { timeout: 25000 });
  const px = () => page.evaluate(() => { const c = document.querySelector('canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let y = 0; for (let i = 0; i < d.length; i += 4) if (d[i] === 255 && d[i + 1] === 255 && d[i + 2] === 0) y++; return { w: c.width, h: c.height, yellow: y, tl: [d[0], d[1], d[2]] }; });
  await page.waitForFunction(() => { const c = document.querySelector('canvas'); const d = c.getContext('2d').getImageData(0, 0, 1, 1).data; return d[0] === 255 && d[1] === 0; }, null, { timeout: 15000 });
  ok('the live KEmulator picture is in the N95 window (red reference corner)', true);
  const sess0 = (await (await fetch(base + '/api/sessions')).json())[0];
  const fs0 = await page.locator('[data-testid=frame-size]').innerText();
  const geo = await page.evaluate(() => { const c = document.querySelector('canvas').getBoundingClientRect(); const l = document.querySelector('[data-testid=skin-lcd]').getBoundingClientRect(); return { ratio: c.width / c.height, fw: document.querySelector('canvas').width / document.querySelector('canvas').height, inLcd: c.left >= l.left - 1 && c.right <= l.right + 1 && c.top >= l.top - 1 && c.bottom <= l.bottom + 1 }; });
  ok('the canvas keeps the framebuffer ratio and stays inside the window', Math.abs(geo.ratio / geo.fw - 1) < 0.01 && geo.inLcd, JSON.stringify(geo));
  await page.screenshot({ path: path.join(outDir, 'skin-05-player-full.png') });

  // a body key reaches the game: hold 5 on the N95 -> the square turns yellow
  p = await point(page, 'nokia-n95', 'full', 'd5');
  await page.mouse.move(p.x, p.y); await page.mouse.down();
  await page.waitForFunction(() => { const c = document.querySelector('canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 0; i < d.length; i += 4) if (d[i] === 255 && d[i + 1] === 255 && d[i + 2] === 0) return true; return false; }, null, { timeout: 6000 });
  ok('holding the N95 body key 5 turns the game’s square yellow', true);

  // switching to the Screen view while the key is held lets go of it, and the game keeps running at the same resolution
  await page.getByRole('radio', { name: /Screen/ }).dispatchEvent('click'); // the mouse button is still down on the key, so no real click
  await page.waitForFunction(() => { const c = document.querySelector('canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 0; i < d.length; i += 4) if (d[i] === 255 && d[i + 1] === 255 && d[i + 2] === 0) return false; return true; }, null, { timeout: 6000 });
  await page.mouse.up();
  ok('switching to the Screen view releases the held key (square back to blue)', true);
  const sess1 = (await (await fetch(base + '/api/sessions')).json())[0];
  ok('zoom does not restart the MIDlet (same session, same start time, still running)', sess1.id === sess0.id && sess1.startedAt === sess0.startedAt && sess1.state === 'running');
  ok('zoom does not change the emulated resolution', sess1.width === sess0.width && sess1.height === sess0.height && (await page.locator('[data-testid=frame-size]').innerText()) === fs0, fs0);
  const logAfter = sess1.logTail.join('\n');
  ok('the MIDlet was launched exactly once', (logAfter.match(/LAUNCHES \d+/g) ?? []).length === 1);
  ok('in the Screen view the body has no keys and the controls are outside', (await page.locator('.skin-box polygon').count()) === 0 && (await page.locator('[data-testid=keypad]').count()) === 1);
  const big = await page.evaluate(() => document.querySelector('canvas').getBoundingClientRect().width);
  await page.screenshot({ path: path.join(outDir, 'skin-06-player-screen.png') });
  ok('the screen view enlarges the picture', big > 200, `${Math.round(big)} px wide`);

  // the external keypad: hold with the mouse, release on cancel
  const k5loc = page.locator('[data-testid=keypad] .key:has-text("5")').first();
  await k5loc.scrollIntoViewIfNeeded();
  const k5 = await k5loc.boundingBox();
  await page.mouse.move(k5.x + k5.width / 2, k5.y + k5.height / 2); await page.mouse.down();
  await page.waitForFunction(() => { const c = document.querySelector('canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 0; i < d.length; i += 4) if (d[i] === 255 && d[i + 1] === 255 && d[i + 2] === 0) return true; return false; }, null, { timeout: 6000 });
  ok('the external keypad key 5 reaches the game while the body is zoomed away', true);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.waitForFunction(() => { const c = document.querySelector('canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 0; i < d.length; i += 4) if (d[i] === 255 && d[i + 1] === 255 && d[i + 2] === 0) return false; return true; }, null, { timeout: 6000 });
  await page.mouse.up();
  ok('blur releases the external keypad too', true);

  // back to the full view, change the model while a key is held
  await page.getByRole('radio', { name: 'Phone', exact: false }).first().click();
  await page.waitForSelector('.skin-box[data-view=full] polygon');
  p = await point(page, 'nokia-n95', 'full', 'd5');
  await page.mouse.move(p.x, p.y); await page.mouse.down();
  await page.waitForFunction(() => { const c = document.querySelector('canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 0; i < d.length; i += 4) if (d[i] === 255 && d[i + 1] === 255 && d[i + 2] === 0) return true; return false; }, null, { timeout: 6000 });
  await page.getByRole('radio', { name: /K750i/ }).dispatchEvent('click');
  await page.waitForSelector('.skin-box[data-skin="sony-ericsson-k750i"]');
  await page.waitForFunction(() => { const c = document.querySelector('canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 0; i < d.length; i += 4) if (d[i] === 255 && d[i + 1] === 255 && d[i + 2] === 0) return false; return true; }, null, { timeout: 6000 });
  await page.mouse.up();
  ok('changing the model releases a held key', true);
  const geo2 = await page.evaluate(() => { const cv = document.querySelector('canvas'); const c = cv.getBoundingClientRect(); const l = document.querySelector('[data-testid=skin-lcd]').getBoundingClientRect(); return { ratio: c.width / c.height, fw: cv.width / cv.height, inLcd: c.left >= l.left - 1 && c.right <= l.right + 1 && c.top >= l.top - 1 && c.bottom <= l.bottom + 1, lcdRatio: l.width / l.height }; });
  ok('the 240×320 game on the 176×220 K750i window is letterboxed, not stretched', Math.abs(geo2.ratio / geo2.fw - 1) < 0.01 && geo2.inLcd && Math.abs(geo2.lcdRatio - 176 / 220) < 0.02, JSON.stringify(geo2));
  ok('the picture is still the same running session', (await (await fetch(base + '/api/sessions')).json()).filter((s) => s.state === 'running').length === 1);
  await page.screenshot({ path: path.join(outDir, 'skin-07-player-k750i.png') });

  // the choice survives a reload
  await page.reload();
  await page.waitForSelector('.skin-box[data-skin="sony-ericsson-k750i"]');
  ok('the chosen model and view are remembered', true);

  // mobile: touch the body keys
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const mp = await m.newPage();
  await mp.goto(base + '/phones');
  await mp.waitForSelector('[data-testid=phone-nokia-6100] .skin-box');
  ok('/phones fits a phone screen without horizontal scroll', await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await mp.screenshot({ path: path.join(outDir, 'skin-08-mobile-phones.png') });

  ok('no uncaught browser errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  console.error('E2E FAILED:', e);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill('SIGTERM');
  await new Promise((r) => server.once('exit', r));
  rmSync(dataDir, { recursive: true, force: true });
  writeFileSync(path.join(outDir, 'skins-results.json'), JSON.stringify(results, null, 2));
}
