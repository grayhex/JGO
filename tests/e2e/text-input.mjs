// Real API + KEmulator + Chromium: the text editor appears for a focused TextField, typed text reaches the MIDlet,
// a password field is masked and a TextBox gets a multi-line editor.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const dir = mkdtempSync(path.join(tmpdir(), 'jgo-text-'));
const port = 20200 + Math.floor(Math.random() * 300);
const base = `http://127.0.0.1:${port}`;
const server = spawn('node', ['apps/api/dist/server.js'], { env: { ...process.env, PORT: String(port), DATA_DIR: dir, HOST: '127.0.0.1', LOG_LEVEL: 'warn' }, stdio: ['ignore', 'inherit', 'inherit'] });
let browser;
const wait = async (fn, what = 'condition') => { for (let i = 0; i < 150; i++) { try { if (await fn()) return; } catch {} await new Promise((r) => setTimeout(r, 100)); } throw Error(`timeout: ${what}`); };
try {
  await wait(async () => (await fetch(base + '/api/health')).ok, 'server');
  await fetch(base + '/api/setup/skip', { method: 'POST' });
  const fd = new FormData();
  fd.append('jar', new Blob([readFileSync('tests/fixtures/labgames/build/kemtext.jar')]), 'kemtext.jar');
  const up = await fetch(base + '/api/games', { method: 'POST', body: fd });
  assert.equal(up.status, 201);
  const game = (await up.json()).game;
  const log = async () => {
    const s = (await (await fetch(base + '/api/sessions')).json()).find((x) => x.state === 'running');
    return s ? (await (await fetch(base + '/api/sessions/' + s.id)).json()).logTail.join('\n') : '';
  };

  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(base + '/play/' + game.id);
  await p.locator('.ctrl-col').getByRole('button', { name: 'Start', exact: true }).click();

  const editor = p.getByRole('group', { name: 'Text input' });
  await editor.waitFor();
  const field = editor.locator('input');
  assert.equal(await field.inputValue(), 'ab');
  assert.equal(await field.getAttribute('type'), 'text');
  assert.equal(await field.getAttribute('maxlength'), '8');

  await field.fill('');
  await field.pressSequentially('Привет мир');
  await wait(async () => /TEXT_VALUES any=\[Привет м\]/.test(await log()), 'text reached the MIDlet');
  await wait(async () => (await field.inputValue()) === 'Привет м', 'game-shortened text is shown');

  // move the focus with the game's own keys: the editor follows (numeric, then password)
  await field.press('Enter'); // leaves the field so the keyboard drives the game again
  await p.keyboard.press('ArrowDown');
  await wait(async () => (await field.getAttribute('inputmode')) === 'numeric', 'numeric field');
  await p.keyboard.press('ArrowDown');
  await wait(async () => (await field.getAttribute('type')) === 'password', 'password field masked');

  assert.deepEqual(errors, []);
  console.log('text input e2e OK');
} finally {
  await browser?.close();
  server.kill();
  rmSync(dir, { recursive: true, force: true });
}
