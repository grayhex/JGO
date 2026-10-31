// Round 3: play time on the card, the handset-style keypad beside the screen, a faintly visible body in Lights Out. Real API + Chromium.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';

const dir = mkdtempSync(tmpdir() + '/jgo-r3-');
const port = 22500 + Math.floor(Math.random() * 90);
const base = `http://127.0.0.1:${port}`;
const server = spawn('node', ['apps/api/dist/server.js'], { env: { ...process.env, PORT: String(port), DATA_DIR: dir, HOST: '127.0.0.1', LOG_LEVEL: 'warn' }, stdio: ['ignore', 'inherit', 'inherit'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wait = async (fn, what) => { for (let i = 0; i < 200; i++) { try { if (await fn()) return; } catch {} await sleep(100); } throw Error(`timeout: ${what}`); };
const games = async () => (await fetch(base + '/api/games')).json();
let browser;
try {
  await wait(async () => (await fetch(base + '/api/health')).ok, 'server');
  await fetch(base + '/api/setup/skip', { method: 'POST' });
  const fd = new FormData();
  fd.append('jar', new Blob([readFileSync('tests/fixtures/testmidlet/build/kemtest.jar')]), 'kemtest.jar');
  const game = (await (await fetch(base + '/api/games', { method: 'POST', body: fd })).json()).game;
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: true });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));

  // ---- play time: none before the first launch, counted afterwards ----
  await p.goto(base + '/');
  await p.locator('.game-card').first().waitFor();
  assert.equal(await p.getByTestId('playtime').innerText(), '0');
  const s = await (await fetch(base + '/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ gameId: game.id }) })).json();
  await wait(async () => (await (await fetch(base + '/api/sessions/' + s.id)).json()).state === 'running', 'running');
  await sleep(3200);
  await fetch(base + '/api/sessions/' + s.id, { method: 'DELETE' });
  await wait(async () => (await games())[0].playSeconds >= 3, 'the time was counted');
  await p.reload();
  await p.locator('.game-card').first().waitFor();
  assert.equal(await p.getByTestId('playtime').innerText(), '< 1 min');
  console.log('✔ the card counts the time spent in the game:', await p.getByTestId('playtime').innerText(), `(${(await games())[0].playSeconds} s)`);

  // ---- the keypad looks like a handset keypad ----
  await p.goto(base + '/play/' + game.id);
  await p.locator('.skin-box').waitFor();
  const keypad = p.locator('.stage-foot.side .keypad');
  await keypad.waitFor();
  assert.equal(await keypad.locator('.numpad .key').count(), 12);
  assert.equal(await keypad.locator('.numpad .key-sub').filter({ hasText: 'abc' }).count(), 1, 'letters under the numerals');
  assert.equal(await keypad.locator('.key.clear').count(), 1, 'the C key');
  const shape = await p.evaluate(() => ({
    dpad: getComputedStyle(document.querySelector('.stage-foot.side .dpad')).borderRadius,
    wingL: getComputedStyle(document.querySelector('.stage-foot.side .key.soft.left')).borderRadius,
    wingR: getComputedStyle(document.querySelector('.stage-foot.side .key.soft.right')).borderRadius,
  }));
  assert.match(shape.dpad, /50%|px/);
  assert.notEqual(shape.wingL, shape.wingR, 'the soft keys lean towards the navigation key');
  assert.equal(await p.locator('.softkeys').count(), 0, 'no second row of soft keys');
  console.log('✔ the side keypad is a handset keypad:', JSON.stringify(shape));

  // ---- Lights Out keeps the body faintly visible ----
  await p.locator('.skin-lcd-overlay button.primary').click();
  await wait(async () => (await (await fetch(base + '/api/sessions')).json()).some((x) => x.state === 'running'), 'running again');
  await p.locator('.stage-bar').getByRole('radio', { name: 'Screen', exact: true }).click();
  await p.getByRole('button', { name: 'Lights Out' }).first().click();
  await p.locator('.player-grid.lights-out').waitFor();
  await sleep(500);
  const o = await p.evaluate(() => ({ body: Number(getComputedStyle(document.querySelector('.skin-body')).opacity), glass: document.querySelector('.skin-glass') ? Number(getComputedStyle(document.querySelector('.skin-glass')).opacity) : 0 }));
  assert.ok(o.body >= 0.1 && o.body <= 0.3, `the body is faintly visible (opacity ${o.body})`);
  console.log('✔ Lights Out keeps the phone body faintly visible:', JSON.stringify(o));

  assert.deepEqual(errors, []);
  console.log('round 3 e2e OK');
} finally {
  await browser?.close();
  server.kill();
  await sleep(500);
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* temp */ }
}
