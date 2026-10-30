// Real API + KEmulator + Chromium: the Pause button suspends the game, a hidden page does too.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const dir = mkdtempSync(path.join(tmpdir(), 'jgo-pause-'));
const port = 20600 + Math.floor(Math.random() * 300);
const base = `http://127.0.0.1:${port}`;
const server = spawn('node', ['apps/api/dist/server.js'], { env: { ...process.env, PORT: String(port), DATA_DIR: dir, HOST: '127.0.0.1', LOG_LEVEL: 'warn' }, stdio: ['ignore', 'inherit', 'inherit'] });
let browser;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wait = async (fn, what = 'condition') => { for (let i = 0; i < 150; i++) { try { if (await fn()) return; } catch {} await sleep(100); } throw Error(`timeout: ${what}`); };
try {
  await wait(async () => (await fetch(base + '/api/health')).ok, 'server');
  await fetch(base + '/api/setup/skip', { method: 'POST' });
  const fd = new FormData();
  fd.append('jar', new Blob([readFileSync('tests/fixtures/labgames/build/kemgame.jar')]), 'kemgame.jar');
  const up = await fetch(base + '/api/games', { method: 'POST', body: fd });
  assert.equal(up.status, 201);
  const game = (await up.json()).game;
  const session = async () => (await (await fetch(base + '/api/sessions')).json()).find((x) => x.state === 'running');
  const frames = async () => (await session()).framesReceived;

  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(base + '/play/' + game.id);
  await p.locator('.ctrl-col').getByRole('button', { name: 'Start', exact: true }).click();
  await wait(async () => (await session())?.framesReceived > 10, 'game drawing');

  await p.getByRole('button', { name: /Pause/ }).click();
  await wait(async () => (await session()).paused === true, 'session paused');
  await p.getByRole('button', { name: /Resume/ }).waitFor();
  assert.match(await p.getByTestId('state-badge').textContent(), /paused/);
  await sleep(400);
  const frozen = await frames();
  await sleep(1000);
  assert.equal(await frames(), frozen, 'no frames while paused');
  await p.getByRole('button', { name: /Resume/ }).click();
  await wait(async () => (await session()).paused === false && (await frames()) > frozen + 5, 'running again');

  // a hidden page (the only viewer) suspends the game, and showing it resumes
  const hide = (hidden) => p.evaluate((h) => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => h }); document.dispatchEvent(new Event('visibilitychange')); }, hidden);
  await hide(true);
  await wait(async () => (await session()).paused === true, 'hidden page suspends the game');
  await hide(false);
  await wait(async () => (await session()).paused === false, 'visible page resumes it');

  assert.deepEqual(errors, []);
  console.log('pause e2e OK');
} finally {
  await browser?.close();
  server.kill();
  rmSync(dir, { recursive: true, force: true });
}
