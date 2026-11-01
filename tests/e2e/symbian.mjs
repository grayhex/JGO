// Symbian / N-Gage in the real UI: Settings → Symbian (firmware upload + install), a .sis dropped into the library with its platform
// badge, the game played in the player (picture of the game's own size, a key reaches the emulator). Real API + real agent + Chromium.
// The emulator behind the agent is the FAKE EKA2L1 of tests/fixtures/fake-eka2l1: this proves JGO's UI and plumbing, not the real emulator.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const dir = mkdtempSync(path.join(tmpdir(), 'jgo-sym-e2e-'));
const free = () => new Promise((res) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wait = async (fn, what, n = 300) => { for (let i = 0; i < n; i++) { try { const v = await fn(); if (v) return v; } catch {} await sleep(100); } throw Error(`timeout: ${what}`); };
const token = 'e2e-token-0123456789abcdef';
const agentPort = await free(), port = await free(), control = await free();
const base = `http://127.0.0.1:${port}`;
const fx = path.join(process.cwd(), 'tests/fixtures/fake-eka2l1');
const agent = spawn(process.execPath, ['symbian/agent/agent.mjs'], { env: { PATH: process.env.PATH, AGENT_TOKEN: token, AGENT_PORT: String(agentPort), AGENT_HOST: '127.0.0.1', CONTROL_PORT: String(control), DATA_DIR: path.join(dir, 'agent'), EKA2L1_BIN: path.join(fx, 'fake-eka2l1.mjs'), AUDIO_CMD: `${process.execPath} ${path.join(fx, 'pcm.mjs')}` }, stdio: 'ignore' });
mkdirSync(path.join(dir, 'app'));
const server = spawn('node', ['apps/api/dist/server.js'], { env: { ...process.env, PORT: String(port), DATA_DIR: path.join(dir, 'app'), HOST: '127.0.0.1', LOG_LEVEL: 'warn', SYMBIAN_AGENT_URL: `http://127.0.0.1:${agentPort}`, SYMBIAN_AGENT_TOKEN: token }, stdio: ['ignore', 'inherit', 'inherit'] });
let browser;
try {
  await wait(async () => (await fetch(`http://127.0.0.1:${agentPort}/agent/ping`)).ok, 'agent');
  await wait(async () => (await fetch(base + '/api/health')).ok, 'server');
  await fetch(base + '/api/setup/skip', { method: 'POST' });
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));

  // ---- Settings → Symbian: connected, no firmware, then add it ----
  await p.goto(base + '/settings#symbian');
  const panel = p.getByTestId('symbian-panel');
  await panel.waitFor();
  await panel.getByText('Service connected').waitFor();
  await panel.getByText('No firmware yet').waitFor();
  assert.equal(await panel.getByTestId('fw-install').isDisabled(), true, 'nothing to install before a file is chosen');
  await panel.getByTestId('fw-rom').setInputFiles({ name: 'RM-84.rom', mimeType: 'application/octet-stream', buffer: Buffer.from('fake rom') });
  await panel.getByTestId('fw-rpkg').setInputFiles({ name: 'RM-84.rpkg', mimeType: 'application/octet-stream', buffer: Buffer.from('fake rpkg') });
  await panel.getByTestId('fw-install').click();
  await panel.getByText('RM-84', { exact: true }).waitFor({ timeout: 30000 });
  console.log('✔ firmware uploaded and installed from Settings → Symbian');
  assert.ok(await panel.getByTestId('symbian-diagnostics').isVisible());
  const diag = await (await fetch(base + '/api/symbian/diagnostics')).text();
  assert.match(diag, /devices: Nokia Fake RM-84/);

  // ---- the library: a .sis with its platform badge ----
  await p.goto(base + '/');
  await p.locator('input[type=file]').first().setInputFiles({ name: 'Space Impact (S60).sis', mimeType: 'application/octet-stream', buffer: Buffer.from('fake sis payload') });
  await p.locator('.game-card').first().waitFor();
  assert.equal(await p.getByTestId('platform-badge').first().innerText(), 'S60');
  console.log('✔ a .sis is accepted; the card shows the S60 badge');

  // ---- play it ----
  const game = (await (await fetch(base + '/api/games')).json())[0];
  assert.equal(game.platform, 'symbian');
  await p.goto(base + '/play/' + game.id);
  await p.locator('.skin-box').waitFor();
  await p.getByTestId('symbian-note').waitFor();
  assert.equal(await p.getByTestId('symbian-device').inputValue(), '', 'automatic device by default');
  assert.ok(await p.getByTestId('symbian-session-diagnostics').isVisible(), 'a diagnostics link next to the game');
  assert.equal(await p.getByText('Game speed').count(), 0, 'no J2ME speed control for a Symbian game');
  assert.equal(await p.getByTestId('phone-profile-match').count(), 0, 'no J2ME profile panel');
  await p.getByRole('button', { name: 'Start', exact: true }).first().click();
  await wait(async () => (await p.getByTestId('frame-size').innerText()) === '176×208', 'the game picture at its own size', 600);
  const st = (await (await fetch(base + '/api/sessions')).json())[0];
  assert.equal(st.backend, 'eka2l1');
  assert.equal(st.state, 'running');
  console.log('✔ the game runs at its own picture size 176×208 through the EKA2L1 adapter');

  const yellow = () => p.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) return 0;
    const g = c.getContext('2d');
    if (!g) return -1;
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 250 && d[i + 1] > 250 && d[i + 2] < 5) n++;
    return n;
  });
  await p.keyboard.down('Enter');
  await wait(async () => (await yellow()) > 100, 'the picture to react to Enter', 100);
  await p.keyboard.up('Enter');
  await wait(async () => (await yellow()) === 0, 'the picture to settle after the key is up', 100);
  mkdirSync('test-results', { recursive: true });
  await p.screenshot({ path: 'test-results/symbian-fake.png' });
  console.log('✔ a key reaches the emulator and the picture reacts');

  // ---- stop ----
  await p.getByRole('button', { name: 'Stop', exact: true }).first().click();
  await wait(async () => !(await (await fetch(base + '/api/symbian/status')).json()).busy, 'the service to become idle');
  assert.deepEqual(errors, [], 'no page errors');
  console.log('✔ stopped; the service is idle again');
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  agent.kill('SIGTERM');
  await sleep(300);
  rmSync(dir, { recursive: true, force: true });
}
