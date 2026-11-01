// Symbian / N-Gage in the real UI: Settings → Symbian (firmware upload + install), a .sis dropped into the library with its platform
// badge, the game played in the player (picture of the game's own size, a key reaches the emulator). Real API + real agent + Chromium.
// The emulator behind the agent is the FAKE EKA2L1 of tests/fixtures/fake-eka2l1: this proves JGO's UI and plumbing, not the real emulator.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { factoryManifest } from '../fixtures/factory-kit.mjs';

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
const server = spawn('node', ['apps/api/dist/server.js'], { env: { ...process.env, PORT: String(port), DATA_DIR: path.join(dir, 'app'), HOST: '127.0.0.1', LOG_LEVEL: 'warn', SYMBIAN_AGENT_URL: `http://127.0.0.1:${agentPort}`, SYMBIAN_AGENT_TOKEN: token, KEM_DIR: path.join(dir, 'no-java-runtime') }, stdio: ['ignore', 'inherit', 'inherit'] });
let browser;
try {
  await wait(async () => (await fetch(`http://127.0.0.1:${agentPort}/agent/ping`)).ok, 'agent');
  await wait(async () => (await fetch(base + '/api/health')).ok, 'server');
  await fetch(base + '/api/setup/skip', { method: 'POST' });
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));

  // Native readiness is independent of KEmulator health and cannot be supplied by a skin.
  const initial = new FormData();
  initial.append('file', new Blob([Buffer.from('fake sis payload')]), 'Space Impact (S60).sis');
  const seeded = await (await fetch(base + '/api/games', { method: 'POST', body: initial })).json();
  await p.goto(base + '/play/' + seeded.game.id);
  await p.getByTestId('native-readiness').waitFor();
  await wait(async () => (await p.getByTestId('native-readiness').innerText()).includes('No firmware'), 'missing firmware state');
  assert.ok(await p.locator('.ctrl-col').getByRole('button', { name: 'Start', exact: true }).isDisabled());
  assert.equal(await p.getByText('Game compatibility options', { exact: true }).count(), 0);
  assert.equal(await p.getByText('Game files', { exact: true }).count(), 0);
  console.log('✔ before firmware: native launch is blocked with an actionable warning, no Java controls');

  // ---- Settings → Symbian: connected, no firmware, then add it ----
  await p.goto(base + '/settings#symbian');
  const panel = p.getByTestId('symbian-panel');
  await panel.waitFor();
  await panel.getByText('Service connected').waitFor();
  await panel.getByText('No firmware yet').waitFor();
  assert.equal(await panel.getByTestId('fw-install').isDisabled(), true, 'nothing to install before a file is chosen');
  await panel.getByTestId('fw-rom').setInputFiles({ name: 'RM-84.rom', mimeType: 'application/octet-stream', buffer: Buffer.from('fake rom') });
  await panel.getByTestId('fw-rpkg').setInputFiles({ name: 'RM-84.rpkg', mimeType: 'application/octet-stream', buffer: Buffer.from('fake rpkg') });
  // Cancel an upload before it reaches the service; retrying must not install twice.
  await p.route('**/api/symbian/firmware?slot=rom', async route => { await sleep(1500); await route.abort().catch(() => undefined); });
  await panel.getByTestId('fw-install').click();
  await panel.getByRole('button', { name: 'Cancel upload', exact: true }).click();
  await p.unroute('**/api/symbian/firmware?slot=rom');
  await wait(async () => !(await panel.getByTestId('fw-install').isDisabled()), 'upload cancelled');
  assert.equal((await (await fetch(base + '/api/symbian/status')).json()).firmware.devices.length, 0);
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
  const java = new FormData(); java.append('jar', new Blob([readFileSync('tests/fixtures/testmidlet/build/kemtest.jar')]), 'test.jar');
  await fetch(base + '/api/games', { method: 'POST', body: java });
  const n2 = new FormData(); n2.append('file', new Blob([Buffer.from('ngage two')]), 'Other.n-gage');
  await fetch(base + '/api/games', { method: 'POST', body: n2 });
  await p.reload();
  await p.getByTestId('platform-filter').selectOption('ngage2');
  await wait(async () => await p.locator('.game-card').count() === 1, 'N-Gage 2 filter');
  assert.equal(await p.getByTestId('platform-badge').textContent(), 'N-Gage 2.0');
  await p.reload();
  assert.equal(await p.getByTestId('platform-filter').inputValue(), 'ngage2');
  await p.getByTestId('platform-filter').selectOption('symbian');
  await wait(async () => await p.locator('.game-card').count() === 1, 'Symbian filter');
  assert.ok(await p.locator('.card-main').isEnabled(), 'missing KEmulator must not block a native game');

  // ---- play it ----
  const game = (await (await fetch(base + '/api/games')).json()).find(g => g.platform === 'symbian');
  assert.equal(game.platform, 'symbian');
  await p.goto(base + '/play/' + game.id);
  await p.locator('.skin-box').waitFor();
  await p.getByTestId('symbian-note').waitFor();
  assert.equal(await p.getByTestId('symbian-device').inputValue(), '', 'automatic device by default');
  assert.ok(await p.getByTestId('symbian-session-diagnostics').isVisible(), 'a diagnostics link next to the game');
  assert.equal(await p.getByText('Game speed').count(), 0, 'no J2ME speed control for a Symbian game');
  assert.equal(await p.getByTestId('phone-profile-match').count(), 0, 'no J2ME profile panel');
  await wait(async () => await p.getByTestId('native-readiness').getAttribute('data-ready') === '1', 'native ready');
  await p.locator('.skin-box[data-skin="nokia-n70"]').waitFor();
  await p.getByLabel('Emulated device', { exact: true }).selectOption('eka2l1-n8');
  await wait(async () => (await p.getByTestId('native-readiness').innerText()).includes('not installed'), 'missing N8 profile');
  assert.ok(await p.locator('.ctrl-col').getByRole('button', { name: 'Start', exact: true }).isDisabled());
  assert.equal((await (await fetch(base + '/api/games/' + game.id)).json()).settings.symbianDevice, 'RM-596');
  await p.getByLabel('Emulated device', { exact: true }).selectOption('eka2l1-n70');
  await wait(async () => await p.getByTestId('native-readiness').getAttribute('data-ready') === '1', 'N70 profile');
  await p.reload();
  await wait(async () => await p.getByTestId('native-readiness').getAttribute('data-ready') === '1', 'ready after reload');
  assert.equal(await p.getByLabel('Emulated device', { exact: true }).inputValue(), 'eka2l1-n70');
  // Picking another Symbian skin changes no actual firmware.
  await p.getByTestId('change-phone').click();
  await p.getByRole('button', { name: 'Nokia N8', exact: true }).click();
  await p.locator('.skin-box[data-skin="nokia-n8"]').waitFor();
  assert.equal((await (await fetch(base + '/api/games/' + game.id)).json()).settings.symbianDevice, 'RM-84');
  await p.getByRole('button', { name: 'Use matching skin', exact: true }).click();
  await p.locator('.skin-box[data-skin="nokia-n70"]').waitFor();
  await p.getByRole('button', { name: 'Start', exact: true }).first().click();
  await wait(async () => (await p.getByTestId('frame-size').innerText()) === '176×208', 'the game picture at its own size', 600);
  const st = await wait(async () => (await (await fetch(base + '/api/sessions')).json()).find(s => s.state === 'running'), 'running session');
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
  await p.evaluate(() => {
    window.testPadPressed = true;
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [{ id: 'UI test pad', index: 0, connected: true, mapping: 'standard', axes: [0,0,0,0], buttons: Array.from({length:17}, (_, i) => ({ pressed: i === 0 && window.testPadPressed, touched: false, value: i === 0 && window.testPadPressed ? 1 : 0 })) }] });
  });
  await wait(async () => (await yellow()) > 100, 'gamepad fire reaches native adapter', 100);
  await p.evaluate(() => { window.testPadPressed = false; });
  await wait(async () => (await yellow()) === 0, 'gamepad release', 100);
  const touch = await p.context().newCDPSession(p);
  const canvasBox = await p.locator('.skin-canvas').boundingBox();
  const white = () => p.locator('.skin-canvas').evaluate(c => {
    const pixels = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let count = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i] === 255 && pixels[i+1] === 255 && pixels[i+2] === 255) count++;
    return count;
  });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: canvasBox.x + canvasBox.width * .3, y: canvasBox.y + canvasBox.height * .4 }, { id: 2, x: canvasBox.x + canvasBox.width * .7, y: canvasBox.y + canvasBox.height * .6 }] });
  await wait(async () => (await white()) > 40, 'two independent native touch contacts', 100);
  await p.locator('.stage-bar').getByRole('radio', { name: 'Screen', exact: true }).dispatchEvent('click');
  await wait(async () => (await white()) === 0, 'changing view releases both contacts', 100);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await touch.detach();
  mkdirSync('test-results', { recursive: true });
  await p.screenshot({ path: 'test-results/symbian-fake.png' });
  console.log('✔ a key reaches the emulator and the picture reacts');

  // ---- stop ----
  await p.getByRole('button', { name: 'Stop', exact: true }).first().click();
  await wait(async () => !(await (await fetch(base + '/api/symbian/status')).json()).busy, 'the service to become idle');
  // Original VPL/FPSX files through the real form/API/agent, against the explicitly fake emulator.
  await p.goto(base + '/settings#symbian');
  const factory = p.getByTestId('symbian-panel');
  await factory.getByTestId('factory-mode').click();
  const manifest = factoryManifest([{ label: 'First language', product: '0000001', files: ['first.core.fpsx'] }, { label: 'Second language', product: '0000002', files: ['second.core.fpsx'] }]);
  const kit = [
    { name: 'RM-596_factory.vpl', mimeType: 'application/xml', buffer: Buffer.from(manifest) },
    { name: 'first.core.fpsx', mimeType: 'application/octet-stream', buffer: Buffer.from('fake-only factory image') },
  ];
  // getRandomValues works on a LAN HTTP origin where randomUUID is unavailable.
  await p.evaluate(() => Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: undefined }));
  await factory.getByTestId('fw-factory').setInputFiles(kit);
  await factory.getByTestId('fw-variant').waitFor();
  assert.ok(await factory.getByTestId('fw-install').isDisabled(), 'multi-variant kits need an explicit choice');
  await factory.getByTestId('fw-variant').selectOption('1');
  await factory.getByText('Missing FPSX images', { exact: false }).waitFor();
  assert.ok(await factory.getByTestId('fw-install').isDisabled(), 'missing image cannot start an installation');
  await factory.getByTestId('fw-variant').selectOption('0');
  const request = p.waitForRequest(r => r.url().endsWith('/api/symbian/firmware/install') && r.method() === 'POST');
  await factory.getByTestId('fw-install').click();
  const payload = (await request).postDataJSON();
  assert.equal(payload.vpl, 'RM-596_factory.vpl'); assert.equal(payload.variant, 0); assert.match(payload.bundle, /^[a-f0-9]{32}$/);
  assert.equal(payload.rom, undefined); assert.equal(payload.archive, undefined);
  await wait(async () => await p.evaluate(() => !!localStorage.getItem('jgo.symbian.job.v1')), 'firmware job retained');
  await p.route('**/api/symbian/jobs/*', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'unavailable', message: 'Temporary monitoring interruption' }) }), { times: 1 });
  await p.reload();
  await p.getByRole('button', { name: 'Resume monitoring', exact: true }).click();
  await p.getByTestId('symbian-panel').getByText('RM-596', { exact: true }).waitFor({ timeout: 30000 });
  console.log('✔ VPL factory kit: variant selection, missing-image check, original names, no ROM dump, job survives reload (fake emulator)');
  await p.goto(base + '/play/' + game.id);
  await p.getByTestId('native-readiness').waitFor();
  await p.setViewportSize({ width: 390, height: 844 });
  await p.waitForTimeout(250);
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'native controls fit mobile');
  agent.kill('SIGTERM');
  await wait(async () => (await p.getByTestId('native-readiness').innerText()).includes('not reachable'), 'service loss visible');
  assert.ok(await p.locator('.ctrl-col').getByRole('button', { name: 'Start', exact: true }).isDisabled());
  assert.deepEqual(errors, [], 'no page errors');
  console.log('✔ stopped; the service is idle again');
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  agent.kill('SIGTERM');
  await sleep(300);
  rmSync(dir, { recursive: true, force: true });
}
