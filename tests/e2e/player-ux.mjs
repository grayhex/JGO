// Round 2 of the player UX: sidebar "Game", no picker below the phone, a bigger phone, the touch keys left of the screen,
// frame rate in the corner, /phones showing a dark display or the running game, help texts as tooltips. Real API + KEmulator + Chromium.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const dir = mkdtempSync(path.join(tmpdir(), 'jgo-ux-'));
const port = 22500 + Math.floor(Math.random() * 300);
const base = `http://127.0.0.1:${port}`;
const server = spawn('node', ['apps/api/dist/server.js'], { env: { ...process.env, PORT: String(port), DATA_DIR: dir, HOST: '127.0.0.1', LOG_LEVEL: 'warn' }, stdio: ['ignore', 'inherit', 'inherit'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wait = async (fn, what) => { for (let i = 0; i < 200; i++) { try { if (await fn()) return; } catch {} await sleep(100); } throw Error(`timeout: ${what}`); };
const upload = async (file) => {
  const fd = new FormData();
  fd.append('jar', new Blob([readFileSync(file)]), path.basename(file));
  const r = await fetch(base + '/api/games', { method: 'POST', body: fd });
  assert.equal(r.status, 201);
  return (await r.json()).game;
};
let browser;
try {
  await wait(async () => (await fetch(base + '/api/health')).ok, 'server');
  await fetch(base + '/api/setup/skip', { method: 'POST' });
  const game = await upload('tests/fixtures/labgames/build/kemgame.jar');
  const other = await upload('tests/fixtures/testmidlet/build/kemtest.jar');
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));

  // ---- the sidebar item "Game" appears once a game was opened and leads back to it ----
  await p.goto(base + '/');
  await p.locator('.game-card').first().waitFor();
  assert.equal(await p.locator('.sidebar').getByRole('link', { name: 'Game', exact: true }).count(), 0, 'no game opened yet: no item');
  await p.locator('.game-card', { hasText: 'KemGame' }).locator('button.card-main').click();
  await p.waitForURL('**/play/' + game.id);
  await p.locator('.skin-box').waitFor();
  await p.locator('.sidebar').getByRole('link', { name: 'Library', exact: true }).click();
  await p.locator('.game-card').first().waitFor();
  const back = p.locator('.sidebar').getByRole('link', { name: 'Game', exact: true });
  assert.equal(await back.count(), 1);
  await back.click();
  await p.waitForURL('**/play/' + game.id);
  console.log('✔ the sidebar item "Game" returns to the opened game');

  // ---- no phone picker under the phone; the phone is bigger than before ----
  await p.locator('.skin-box').waitFor();
  assert.equal(await p.locator('.skin-picker').count(), 0);
  await sleep(500);
  const m = await p.evaluate(() => ({ box: document.querySelector('.skin-box').getBoundingClientRect().height, win: window.innerHeight, header: 0 }));
  assert.ok(m.box >= (m.win - m.header) * 0.88, `phone height ${m.box}px of ${m.win - m.header}px available`);
  const sh = await p.evaluate(() => { const r = document.querySelector('.stage-card').getBoundingClientRect(); return [r.top, r.bottom, window.innerHeight]; }); assert.ok(sh[0] >= 0 && sh[1] <= sh[2] + 2, 'the game card fits the window: ' + sh);
  console.log(`✔ the phone is ${Math.round(m.box)}px tall in a ${m.win}px window (was about 520px), game card fits the window`);

  // ---- help texts are tooltips ----
  await p.locator('.ctrl-col').getByRole('button', { name: 'Start', exact: true }).click();
  await wait(async () => (await (await fetch(base + '/api/sessions')).json()).some((s) => s.state === 'running' && s.framesReceived > 5), 'running');
  assert.equal(await p.getByText(/Stop requests a safe MIDlet shutdown/).count(), 0, 'no Stop paragraph');
  assert.match(await p.locator('.ctrl-col').getByRole('button', { name: 'Stop', exact: true }).getAttribute('title'), /safe MIDlet shutdown/);
  console.log('✔ the Stop explanation is a tooltip');

  // ---- frame rate in the corner ----
  assert.equal(await p.getByTestId('fps-badge').count(), 0);
  await p.getByTestId('fps-toggle').click();
  await wait(async () => /^\d+$/.test((await p.getByTestId('fps-badge').textContent()) ?? '') && Number(await p.getByTestId('fps-badge').textContent()) > 3, 'a frame rate');
  console.log('✔ the frame rate shows as small digits on the screen:', await p.getByTestId('fps-badge').textContent());

  // ---- /phones: the running game is drawn on the phones ----
  await p.locator('.sidebar').getByRole('link', { name: 'Phones', exact: true }).click();
  await p.locator('.phone-pick').nth(9).waitFor();
  const lit = async (id) => p.evaluate((i) => {
    const c = document.querySelector(`[data-testid="phone-card-${i}"] canvas`);
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let colored = 0;
    for (let k = 0; k < d.length; k += 4) if (d[k] + d[k + 1] + d[k + 2] > 60) colored++;
    return { colored, live: c.closest('[data-live]').getAttribute('data-live') };
  }, id);
  await wait(async () => (await lit('nokia-n95')).colored > 500, 'the running game on a phone');
  console.log('✔ /phones draws the current frame of the running game');

  // stop the game: the displays go dark
  for (const s of await (await fetch(base + '/api/sessions')).json()) await fetch(base + '/api/sessions/' + s.id, { method: 'DELETE' });
  await wait(async () => !(await (await fetch(base + '/api/sessions')).json()).some((s) => s.state === 'running'), 'stopped');
  await p.reload();
  await p.locator('.phone-pick').nth(9).waitFor();
  await sleep(500);
  const dark = await lit('nokia-n95');
  assert.equal(dark.colored, 0, 'a switched-off phone is black');
  assert.equal(dark.live, '0');
  console.log('✔ with no game running the displays are black');

  // ---- touch phone: no Screen view; keys sit left of the screen, not over it ----
  await p.getByRole('button', { name: /5800/ }).click();
  await p.waitForURL('**/play/' + game.id);
  await p.locator('.skin-box[data-skin="nokia-5800"]').waitFor();
  assert.equal(await p.locator('.stage-bar').getByRole('radio', { name: 'Screen', exact: true }).count(), 0);
  const geo = await p.evaluate(() => { const f = document.querySelector('.stage-foot.side').getBoundingClientRect(); const s = document.querySelector('.stage').getBoundingClientRect(); const l = document.querySelector('[data-testid=skin-lcd]').getBoundingClientRect(); return { footRight: f.right, stageLeft: s.left, lcdLeft: l.left, footW: f.width }; });
  assert.ok(geo.footRight <= geo.stageLeft + 1 && geo.footRight <= geo.lcdLeft, JSON.stringify(geo));
  assert.ok(geo.footW <= 200, `compact keys (${geo.footW}px)`);
  console.log('✔ monoblock: no Screen view, the keys are a narrow column left of the phone', JSON.stringify(geo));

  assert.deepEqual(errors, []);
  console.log('player ux e2e OK');
} finally {
  await browser?.close();
  server.kill();
  await sleep(800);
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* temp */ }
}
