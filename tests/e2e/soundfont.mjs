// Real API + Chromium: install and remove a MIDI SoundFont in Settings → Sound.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const dir = mkdtempSync(path.join(tmpdir(), 'jgo-sf-e2e-'));
const port = 20900 + Math.floor(Math.random() * 300);
const base = `http://127.0.0.1:${port}`;
const server = spawn('node', ['apps/api/dist/server.js'], { env: { ...process.env, PORT: String(port), DATA_DIR: dir, HOST: '127.0.0.1', LOG_LEVEL: 'warn' }, stdio: ['ignore', 'inherit', 'inherit'] });
let browser;
const wait = async (fn, what) => { for (let i = 0; i < 150; i++) { try { if (await fn()) return; } catch {} await new Promise((r) => setTimeout(r, 100)); } throw Error(`timeout: ${what}`); };
try {
  await wait(async () => (await fetch(base + '/api/health')).ok, 'server');
  await fetch(base + '/api/setup/skip', { method: 'POST' });
  const sf2 = Buffer.alloc(4096);
  sf2.write('RIFF', 0, 'latin1'); sf2.writeUInt32LE(4096 - 8, 4); sf2.write('sfbk', 8, 'latin1');

  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const p = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(base + '/settings');
  await p.getByText('MIDI SoundFont', { exact: true }).waitFor();
  await p.getByText('Built-in bank', { exact: true }).waitFor();

  await p.locator('input[type=file][accept=".sf2"]').setInputFiles({ name: 'room.sf2', mimeType: 'application/octet-stream', buffer: sf2 });
  await p.getByText(/room\.sf2 · 0\.0 MB/).waitFor();
  assert.equal((await (await fetch(base + '/api/settings')).json()).soundfont.name, 'room.sf2');

  await p.locator('input[type=file][accept=".sf2"]').setInputFiles({ name: 'broken.sf2', mimeType: 'application/octet-stream', buffer: Buffer.from('nope') });
  await p.getByText(/too small to be a SoundFont/i).waitFor();
  assert.equal((await (await fetch(base + '/api/settings')).json()).soundfont.name, 'room.sf2', 'a rejected file keeps the installed bank');

  await p.getByRole('button', { name: 'Remove' }).click();
  await p.getByText('Built-in bank', { exact: true }).waitFor();
  assert.equal((await (await fetch(base + '/api/settings')).json()).soundfont, null);
  assert.deepEqual(errors, []);
  console.log('soundfont e2e OK');
} finally {
  await browser?.close();
  server.kill();
  rmSync(dir, { recursive: true, force: true });
}
