// Real API + KEmulator + Chromium: per-game compatibility options and the game speed control.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const dir = mkdtempSync(path.join(tmpdir(), 'jgo-emu-'));
const port = 21600 + Math.floor(Math.random() * 300);
const base = `http://127.0.0.1:${port}`;
const server = spawn('node', ['apps/api/dist/server.js'], { env: { ...process.env, PORT: String(port), DATA_DIR: dir, HOST: '127.0.0.1', LOG_LEVEL: 'warn' }, stdio: ['ignore', 'inherit', 'inherit'] });
let browser;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wait = async (fn, what) => { for (let i = 0; i < 150; i++) { try { if (await fn()) return; } catch {} await sleep(100); } throw Error(`timeout: ${what}`); };
const upload = async (file) => {
  const fd = new FormData();
  fd.append('jar', new Blob([readFileSync(file)]), path.basename(file));
  const r = await fetch(base + '/api/games', { method: 'POST', body: fd });
  assert.equal(r.status, 201);
  return (await r.json()).game;
};
const running = async () => (await (await fetch(base + '/api/sessions')).json()).find((x) => x.state === 'running');

try {
  await wait(async () => (await fetch(base + '/api/health')).ok, 'server');
  await fetch(base + '/api/setup/skip', { method: 'POST' });
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const p = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));

  // ---- options are saved for the game and reach it ----
  const props = await upload('tests/fixtures/labgames/build/kemprops.jar');
  await p.goto(base + '/play/' + props.id);
  await p.getByText('Game compatibility options', { exact: true }).click();
  await p.getByLabel('Language of the phone').fill('ru-RU');
  await p.getByLabel('Font size medium').fill('30');
  await p.getByLabel('Font size small').fill('20');
  await p.getByLabel('Font size large').fill('40');
  await p.getByText('Tell the game the phone has a touch screen', { exact: true }).click();
  await wait(async () => { const g = (await (await fetch(base + '/api/games')).json()).find((x) => x.id === props.id); return g.settings.emulation?.locale === 'ru-RU' && g.settings.emulation?.pointerEvents === false; }, 'options saved for the game');
  await p.locator('.ctrl-col').getByRole('button', { name: 'Start', exact: true }).click();
  await wait(async () => { const s = await running(); return s && (await (await fetch(base + '/api/sessions/' + s.id)).json()).logTail.some((l) => /PROPS locale=ru-RU pointer=false/.test(l)); }, 'the game sees the options');
  for (const s of await (await fetch(base + '/api/sessions')).json()) await fetch(base + '/api/sessions/' + s.id, { method: 'DELETE' });
  await wait(async () => !(await running()), 'stopped');

  await p.reload();
  await p.getByText('Game compatibility options', { exact: true }).click();
  await wait(async () => (await p.getByLabel('Language of the phone').inputValue()) === 'ru-RU', 'saved options are shown after a reload');
  await p.getByRole('button', { name: 'Back to the emulator defaults' }).click();
  await wait(async () => { const g = (await (await fetch(base + '/api/games')).json()).find((x) => x.id === props.id); return g.settings.emulation === undefined; }, 'defaults restored');

  // ---- game speed ----
  const game = await upload('tests/fixtures/labgames/build/kemgame.jar');
  await p.goto(base + '/play/' + game.id);
  await p.locator('.ctrl-col').getByRole('button', { name: 'Start', exact: true }).click();
  await wait(async () => (await running())?.framesReceived > 5, 'game drawing');
  await p.getByRole('radio', { name: '×0.5', exact: true }).click();
  await wait(async () => (await running()).speed === -50, 'half speed');
  await wait(async () => (await p.getByRole('radio', { name: '×0.5', exact: true }).getAttribute('aria-checked')) === 'true', 'the control shows the speed');
  await p.getByRole('radio', { name: '×2', exact: true }).click();
  await wait(async () => (await running()).speed === 2, 'double speed');
  await p.reload();
  await p.getByRole('radio', { name: '×2', exact: true }).waitFor();
  await wait(async () => (await p.getByRole('radio', { name: '×2', exact: true }).getAttribute('aria-checked')) === 'true', 'speed shown after a reload');
  assert.deepEqual(errors, []);
  console.log('emulation options e2e OK');
} finally {
  await browser?.close();
  server.kill();
  await new Promise((r) => setTimeout(r, 800)); // the emulator may still be writing its log
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* temp dir: not worth hiding the real result */ }
}
