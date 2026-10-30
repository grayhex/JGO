// Games made for another screen: the size hint from the JAR, the landscape shortcut (Nokia E71 + turned picture), the turn itself.
// Real API + KEmulator + Chromium.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root = process.cwd();
const { makeJar } = await import(pathToFileURL(path.join(root, 'apps/api/src/dev/testing.ts')).href);
const outDir = path.join(root, 'test-results');
mkdirSync(outDir, { recursive: true });
const dir = mkdtempSync(path.join(tmpdir(), 'jgo-orient-'));
const port = 20100 + Math.floor(Math.random() * 300);
const base = `http://127.0.0.1:${port}`;
const server = spawn('node', ['apps/api/dist/server.js'], { env: { ...process.env, PORT: String(port), DATA_DIR: dir, HOST: '127.0.0.1', LOG_LEVEL: 'warn' }, stdio: ['ignore', 'inherit', 'inherit'] });
const wait = async (fn) => { for (let i = 0; i < 150; i++) { try { if (await fn()) return; } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 100)); } throw Error('timeout'); };
const results = [];
const ok = (name, cond, extra = '') => { results.push({ name, pass: !!cond, extra }); console.log(`${cond ? '✔' : '✖'} ${name}${extra ? ` — ${extra}` : ''}`); if (!cond) process.exitCode = 1; };
let browser;
try {
  await wait(async () => (await fetch(base + '/api/health')).ok);
  await fetch(base + '/api/setup/skip', { method: 'POST' });
  const up = async (name, bytes) => { const fd = new FormData(); fd.append('jar', new Blob([bytes]), name); const r = await fetch(base + '/api/games', { method: 'POST', body: fd }); const j = await r.json(); assert.equal(r.status, 201, JSON.stringify(j)); return j.game; };
  const kem = await up('kemtest.jar', readFileSync('tests/fixtures/testmidlet/build/kemtest.jar'));
  const big = await up('big.jar', makeJar('Made For Big Screens', { extra: 'SEMC-Screen-Size: 480,800\n' }));

  browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // a game that names its screen size gets a one-click suggestion
  await page.goto(`${base}/play/${big.id}`);
  await page.locator('[data-testid=size-hint]').waitFor();
  ok('a JAR that declares a 480×800 screen gets a size suggestion', /480×800/.test(await page.locator('[data-testid=size-hint]').innerText()));
  await page.locator('[data-testid=size-hint] button').click();
  await page.waitForFunction(() => document.querySelector('select[aria-label="Resolution"]')?.value === '480x800');
  ok('the suggestion switches to advanced mode with that resolution', (await page.locator('select[aria-label="Resolution"]').inputValue()) === '480x800');
  ok('... and goes away once the resolution matches', (await page.locator('[data-testid=size-hint]').count()) === 0);

  // landscape shortcut on a normal game
  await page.goto(`${base}/play/${kem.id}`);
  await page.waitForSelector('.skin-box');
  ok('the landscape shortcut is offered for a turned-off picture', (await page.locator('[data-testid=landscape-quick]').count()) === 1);
  await page.locator('[data-testid=landscape-quick]').getByRole('button', { name: /turn right/ }).click();
  await page.waitForSelector('.skin-box[data-skin="nokia-e71"]');
  ok('it picks the Nokia E71 (landscape display)', true);
  ok('... and turns the picture by 90°', (await page.locator('canvas.skin-canvas').getAttribute('data-rotation')) === '90');
  ok('... in advanced mode, so the game keeps its own resolution', await page.locator('label.switch', { hasText: 'Advanced' }).locator('input').isChecked());
  await page.locator('.ctrl-col').getByRole('button', { name: 'Start', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid=state-badge]')?.textContent?.includes('running'), null, { timeout: 30000 });
  await page.waitForTimeout(800);
  const geo = await page.evaluate(() => { const c = document.querySelector('canvas.skin-canvas'); const b = c.getBoundingClientRect(); const l = document.querySelector('[data-testid=skin-lcd]').getBoundingClientRect(); return { w: b.width, h: b.height, bw: c.width, bh: c.height, inside: b.left >= l.left - 1 && b.right <= l.right + 1 && b.top >= l.top - 1 && b.bottom <= l.bottom + 1 }; });
  ok('the 240×320 framebuffer is shown as a landscape picture inside the display window', geo.bw === 240 && geo.bh === 320 && geo.w > geo.h && geo.inside, JSON.stringify(geo));
  ok('... in the right proportions (not stretched)', Math.abs(geo.w / geo.h - 320 / 240) < 0.02);
  await page.screenshot({ path: path.join(outDir, 'orientation-e71.png') });

  // a tap on the turned picture reaches the game in framebuffer coordinates: the visual top-right is the framebuffer's top-left
  const box = await page.locator('canvas.skin-canvas').boundingBox();
  const tap = async (u, v) => { await page.mouse.click(box.x + box.width * u, box.y + box.height * v); await page.waitForTimeout(400); };
  await tap(0.9, 0.1);
  await tap(0.1, 0.9);
  const log = ((await (await fetch(base + '/api/sessions')).json())[0].logTail ?? []).join('\n');
  const downs = [...log.matchAll(/POINTER_DOWN (\d+),(\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  ok('the visual top-right corner is the game\'s top-left (24,32)', downs.some(([x, y]) => Math.abs(x - 24) <= 4 && Math.abs(y - 32) <= 4), JSON.stringify(downs));
  ok('the visual bottom-left corner is the game\'s bottom-right (216,288)', downs.some(([x, y]) => Math.abs(x - 216) <= 4 && Math.abs(y - 288) <= 4), JSON.stringify(downs));
  const sess = (await (await fetch(base + '/api/sessions')).json())[0];
  ok('the session was not restarted or resized by turning the picture', sess.width === 240 && sess.height === 320 && sess.state === 'running');

  // remembered per game, cycles back to upright
  await page.reload();
  await page.waitForSelector('canvas.skin-canvas');
  ok('the turn is remembered for this game after a reload', (await page.locator('canvas.skin-canvas').getAttribute('data-rotation')) === '90');
  for (let i = 0; i < 3; i++) await page.locator('[data-testid=rotate]').click();
  ok('the turn button cycles 90 → 180 → 270 → 0', (await page.locator('canvas.skin-canvas').getAttribute('data-rotation')) === '0' || (await page.locator('canvas.skin-canvas').getAttribute('data-rotation')) === null);
  ok('the stored turn is removed when the picture is upright again', (await page.evaluate((id) => localStorage.getItem(`j2me-web.rotation.${id}`), kem.id)) === null);
  const other = await page.evaluate((id) => localStorage.getItem(`j2me-web.rotation.${id}`), big.id);
  ok('other games are not affected', other === null);
  await page.click('button.danger:has-text("Stop")').catch(() => undefined);
  ok('no uncaught browser errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  console.error('E2E FAILED:', e);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  rmSync(dir, { recursive: true, force: true });
}
