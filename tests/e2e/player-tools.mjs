// Real API + KEmulator + Chromium: the link dialog, screenshots and input recording.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const dir = mkdtempSync(path.join(tmpdir(), 'jgo-tools-'));
const port = 21200 + Math.floor(Math.random() * 300);
const base = `http://127.0.0.1:${port}`;
const server = spawn('node', ['apps/api/dist/server.js'], { env: { ...process.env, PORT: String(port), DATA_DIR: dir, HOST: '127.0.0.1', LOG_LEVEL: 'warn' }, stdio: ['ignore', 'inherit', 'inherit'] });
let browser;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wait = async (fn, what) => { for (let i = 0; i < 150; i++) { try { if (await fn()) return; } catch {} await sleep(100); } throw Error(`timeout: ${what}`); };
const uploadGame = async (file) => {
  const fd = new FormData();
  fd.append('jar', new Blob([readFileSync(file)]), path.basename(file));
  const r = await fetch(base + '/api/games', { method: 'POST', body: fd });
  assert.equal(r.status, 201);
  return (await r.json()).game;
};
const logOf = async () => {
  const s = (await (await fetch(base + '/api/sessions')).json()).find((x) => x.state === 'running');
  return s ? (await (await fetch(base + '/api/sessions/' + s.id)).json()).logTail.join('\n') : '';
};
const pngSize = (buf) => [buf.readUInt32BE(16), buf.readUInt32BE(20)];

try {
  await wait(async () => (await fetch(base + '/api/health')).ok, 'server');
  await fetch(base + '/api/setup/skip', { method: 'POST' });
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  const start = async (game) => {
    await p.goto(base + '/play/' + game.id);
    await p.locator('.ctrl-col').getByRole('button', { name: 'Start', exact: true }).click();
    await wait(async () => (await (await fetch(base + '/api/sessions')).json()).some((s) => s.state === 'running' && s.framesReceived >= 1), 'game drawing');
  };
  const stop = async () => { for (const s of await (await fetch(base + '/api/sessions')).json()) await fetch(base + '/api/sessions/' + s.id, { method: 'DELETE' }); await wait(async () => !(await (await fetch(base + '/api/sessions')).json()).some((s) => s.state === 'running'), 'stopped'); };

  // ---- a link the game opens: nothing happens until the viewer confirms ----
  await start(await uploadGame('tests/fixtures/labgames/build/kemnet.jar'));
  await p.keyboard.press('Digit2'); // KemNet: platformRequest
  await p.getByRole('dialog', { name: /Permission/ }).getByRole('button', { name: 'Allow' }).click();
  const dlg = p.getByRole('dialog', { name: /link/ });
  await dlg.waitFor();
  assert.match(await dlg.getByTestId('game-link').textContent(), /^http:\/\/example\.invalid\//);
  const open = dlg.getByRole('link', { name: 'Open' });
  assert.equal(await open.getAttribute('target'), '_blank');
  assert.match(await open.getAttribute('rel'), /noopener/);
  assert.match(await open.getAttribute('rel'), /noreferrer/);
  await dlg.getByRole('button', { name: 'Cancel' }).click();
  await dlg.waitFor({ state: 'hidden' });
  await stop();

  // ---- a 2D game: screenshots and input recording ----
  await start(await uploadGame('tests/fixtures/labgames/build/kemgame.jar'));
  const [dl] = await Promise.all([p.waitForEvent('download'), p.getByTestId('screenshot').click()]);
  assert.match(dl.suggestedFilename(), /-240x320\.png$/);
  const png = readFileSync(await dl.path());
  assert.deepEqual(pngSize(png), [240, 320], 'the screenshot has the game frame size');

  const fires = async () => ((await logOf()).match(/GAME_FIRE/g) ?? []).length;
  await p.getByText('Input recording', { exact: true }).click();
  await p.getByRole('button', { name: /Record/ }).click();
  await p.keyboard.down('Enter'); await sleep(300); await p.keyboard.up('Enter');
  await sleep(200);
  await p.getByRole('button', { name: /Stop recording/ }).click();
  await wait(async () => /\d+ events/.test(await p.getByTestId('recording-status').textContent()), 'recording kept');
  const before = await fires();
  assert.ok(before > 3, `the live press fired ${before} times`);

  const [saved] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: 'Save…' }).click()]);
  const rec = JSON.parse(readFileSync(await saved.path(), 'utf8'));
  assert.equal(rec.format, 'jgo-input-recording');
  assert.deepEqual([rec.width, rec.height], [240, 320]);
  assert.equal(rec.events.filter((e) => e.ev.t === 'key').length, 2);

  await p.getByRole('button', { name: /Play/ }).click();
  await wait(async () => (await fires()) > before + 3, 'the replay fired the game again');
  await p.getByRole('button', { name: /Play/ }).waitFor();

  // a file of another game is refused with a reason
  rec.gameId = 'someone-else';
  await p.locator('input[type=file][accept*=json]').setInputFiles({ name: 'other.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(rec)) });
  await p.getByText(/belongs to another game/).waitFor();

  assert.deepEqual(errors, []);
  console.log('player tools e2e OK');
} finally {
  await browser?.close();
  server.kill();
  rmSync(dir, { recursive: true, force: true });
}
