// Symbian / N-Gage in the real UI: Settings → Symbian (firmware upload + install), a .sis dropped into the library with its platform
// badge, the game played in the player (picture of the game's own size, a key reaches the emulator). Real API + real agent + Chromium.
// The emulator behind the agent is the FAKE EKA2L1 of tests/fixtures/fake-eka2l1: this proves MGO's UI and plumbing, not the real emulator.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const dir = mkdtempSync(path.join(tmpdir(), 'mgo-sym-e2e-'));
const launchGate = path.join(dir, 'launch-ready');
const free = () => new Promise((res) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wait = async (fn, what, n = 300) => { for (let i = 0; i < n; i++) { try { const v = await fn(); if (v) return v; } catch {} await sleep(100); } throw Error(`timeout: ${what}`); };
const token = 'e2e-token-0123456789abcdef';
const agentPort = await free(), port = await free(), control = await free();
const base = `http://127.0.0.1:${port}`;
const fx = path.join(process.cwd(), 'tests/fixtures/fake-eka2l1');
const agent = spawn(process.execPath, ['symbian/agent/agent.mjs'], { env: { PATH: process.env.PATH, EKA2L1_ENV_PASSTHROUGH: 'FAKE_LAUNCH_GATE', FAKE_LAUNCH_GATE: launchGate, AGENT_TOKEN: token, AGENT_PORT: String(agentPort), AGENT_HOST: '127.0.0.1', CONTROL_PORT: String(control), DATA_DIR: path.join(dir, 'agent'), EKA2L1_BIN: path.join(fx, 'fake-eka2l1.mjs'), AUDIO_CMD: `${process.execPath} ${path.join(fx, 'pcm.mjs')}` }, stdio: 'ignore' });
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
  // one way to add firmware: an archive. The ROM / RPKG / factory-kit forms are gone.
  assert.equal(await panel.getByTestId('fw-rom').count() + await panel.getByTestId('fw-rpkg').count() + await panel.getByTestId('factory-mode').count() + await panel.getByTestId('fw-factory').count(), 0, 'only the firmware archive is offered');
  await panel.getByTestId('fw-archive').setInputFiles({ name: 'RM-84.zip', mimeType: 'application/zip', buffer: Buffer.from('fake firmware archive') });
  // Cancel an upload before it reaches the service; retrying must not install twice.
  await p.route('**/api/symbian/firmware?slot=archive', async route => { await sleep(1500); await route.abort().catch(() => undefined); });
  await panel.getByTestId('fw-install').click();
  await panel.getByRole('button', { name: 'Cancel upload', exact: true }).click();
  await p.unroute('**/api/symbian/firmware?slot=archive');
  await wait(async () => !(await panel.getByTestId('fw-install').isDisabled()), 'upload cancelled');
  assert.equal((await (await fetch(base + '/api/symbian/status')).json()).firmware.devices.length, 0);
  await panel.getByTestId('fw-install').click();
  await panel.getByTestId('device-RM-84').waitFor({ timeout: 30000 });
  // the installed device reads as a phone, not as a code: its name, OS, what it runs and the default marks
  const card = panel.getByTestId('device-RM-84');
  await card.getByRole('heading', { name: 'Nokia N70' }).waitFor();
  assert.match(await card.innerText(), /Symbian 8\.1a/);
  assert.ok(await card.locator('.sym-thumb img').count() === 1, 'a picture of the phone');
  assert.ok(await card.locator('img.platform-icon').count() >= 1, 'what it runs is shown as pictures');
  // one installed device: every platform it can run is offered it automatically, those it cannot run say so
  const defaults = panel.getByTestId('defaults');
  assert.equal(await defaults.locator('select').count(), 3);
  assert.match(await panel.getByTestId('default-ngage').innerText(), /No installed firmware can run these games|Automatic|not set/);
  await panel.getByText('No installed firmware can run these games.').first().waitFor();
  assert.ok(await defaults.locator('.hint-mark').count() >= 3, 'every platform has a hint');
  console.log('✔ firmware uploaded and installed from Settings → Symbian');
  assert.ok(await panel.getByTestId('symbian-diagnostics').isVisible());
  const diag = await (await fetch(base + '/api/symbian/diagnostics')).text();
  assert.match(diag, /devices: Nokia Fake RM-84/);

  // ---- the library: a .sis with its platform badge ----
  await p.goto(base + '/');
  await p.locator('input[type=file]').first().setInputFiles({ name: 'Space Impact (S60).sis', mimeType: 'application/octet-stream', buffer: Buffer.from('fake sis payload') });
  await p.locator('.game-card').first().waitFor();
  assert.equal(await p.getByTestId('platform-badge').first().getAttribute('data-platform'), 'symbian');
  console.log('✔ a .sis is accepted; the card shows the S60 badge');
  const java = new FormData(); java.append('jar', new Blob([readFileSync('tests/fixtures/testmidlet/build/kemtest.jar')]), 'test.jar');
  await fetch(base + '/api/games', { method: 'POST', body: java });
  const n2 = new FormData(); n2.append('file', new Blob([Buffer.from('ngage two')]), 'Other.n-gage');
  await fetch(base + '/api/games', { method: 'POST', body: n2 });
  await p.reload();
  await p.getByTestId('platform-filter').locator('button[data-platform="ngage2"]').click();
  await wait(async () => await p.locator('.game-card').count() === 1, 'N-Gage 2 filter');
  assert.equal(await p.getByTestId('platform-badge').getAttribute('data-platform'), 'ngage2');
  await p.reload();
  assert.equal(await p.getByTestId('platform-filter').locator('button[aria-pressed="true"]').getAttribute('data-platform'), 'ngage2');
  await p.getByTestId('platform-filter').locator('button[data-platform="symbian"]').click();
  await wait(async () => await p.locator('.game-card').count() === 1, 'Symbian filter');
  assert.ok(await p.locator('.card-main').isEnabled(), 'missing KEmulator must not block a native game');

  // ---- play it ----
  const game = (await (await fetch(base + '/api/games')).json()).find(g => g.platform === 'symbian');
  assert.equal(game.platform, 'symbian');
  await p.goto(base + '/play/' + game.id);
  await p.locator('.skin-box').waitFor();
  // the player says what a player needs: whether it can start and on which phone's firmware; no service internals
  await wait(async () => await p.getByTestId('native-readiness').getAttribute('data-ready') === '1', 'native ready');
  assert.match(await p.getByTestId('native-readiness').innerText(), /Runs on\s+Nokia N70/);
  const panelText = await p.locator('.ctrl-col').innerText();
  for (const noise of ['Installed devices', 'Test readiness', 'Service connected', 'First frame', 'Refresh status', 'Use matching skin', 'EKA2L1 master', 'The skin changes appearance', 'Emulated device']) assert.ok(!panelText.includes(noise), `no "${noise}" in the player`);
  assert.equal(await p.getByTestId('symbian-device').count(), 0, 'one installed firmware: nothing to choose');
  assert.equal(await p.getByText('Game speed').count(), 0, 'no J2ME speed control for a Symbian game');
  assert.equal(await p.getByTestId('phone-profile-match').count(), 0, 'no J2ME profile panel');
  await p.locator('.skin-box[data-skin="nokia-n70"]').waitFor();
  // Choosing an unavailable model must request its real firmware, never boot the old one under a new picture.
  await p.getByTestId('change-phone').click();
  await p.getByRole('button', { name: 'Nokia N8', exact: true }).click();
  await wait(async () => (await p.getByTestId('native-readiness').innerText()).includes('not installed'), 'N8 firmware is missing');
  assert.equal((await (await fetch(base + '/api/games/' + game.id)).json()).settings.symbianDevice, 'RM-596');
  await p.getByTestId('change-phone').click();
  await p.getByRole('button', { name: 'Nokia N70', exact: true }).click();
  await wait(async () => await p.getByTestId('native-readiness').getAttribute('data-ready') === '1', 'installed N70');
  // Installation monitoring may attach before POST /sessions returns. Keep that
  // response pending, then complete it while Enter is held: it must not replace
  // the existing viewer and release the game's inputs.
  let completeStart;
  const startGate = new Promise(resolve => { completeStart = resolve; });
  let responseReady = false;
  const streams = [];
  let receivedFrames = 0;
  let receivedAudioBytes = 0;
  let startingViewer = false;
  p.on('websocket', socket => {
    if (!socket.url().endsWith('/stream')) return;
    streams.push(socket.url());
    socket.on('framereceived', ({ payload }) => {
      if (typeof payload === 'string') {
        const event = JSON.parse(payload);
        if (event.t === 'hello' && event.state === 'starting') startingViewer = true;
        return;
      }
      if (payload[0] === 1) receivedFrames++;
      if (payload[0] === 2) receivedAudioBytes += payload.length - 1;
    });
  });
  await p.route('**/api/sessions', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch();
    responseReady = true;
    await startGate;
    await route.fulfill({ response });
  });
  await p.getByRole('button', { name: 'Start', exact: true }).first().click();
  await wait(() => startingViewer, 'viewer attached before native launch completes');
  writeFileSync(launchGate, 'ready');
  await wait(() => responseReady, 'launch response held for the attachment race');
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
  await wait(async () => (await p.getByTestId('state-badge').textContent()) === 'running', 'running state reaches the viewer before the HTTP response', 100);
  await wait(() => receivedAudioBytes > 4000, 'early viewer receives sound without reconnecting', 100);
  await p.keyboard.down('Enter');
  await wait(async () => (await yellow()) > 100, 'the picture to react to Enter', 100);
  const attachedStreams = streams.length;
  completeStart();
  await wait(async () => await p.getByRole('button', { name: 'Restart', exact: true }).isEnabled(), 'launch response applied');
  const framesBefore = receivedFrames;
  await wait(() => receivedFrames > framesBefore + 2, 'fresh frames after the launch response');
  assert.equal(streams.length, attachedStreams, 'the same session must keep its existing stream');
  assert.ok(await yellow() > 100, 'the key stays pressed when the launch response completes');
  await p.unroute('**/api/sessions');
  await p.keyboard.up('Enter');
  await wait(async () => (await yellow()) === 0, 'the picture to settle after the key is up', 100);
  console.log('✔ early viewer receives running/audio; the launch response preserves its stream and held key');
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
  // A second firmware archive; the job survives a reload and a temporary monitoring failure.
  await p.goto(base + '/settings#symbian');
  const second = p.getByTestId('symbian-panel');
  await second.getByTestId('fw-archive').setInputFiles({ name: 'RM-596.zip', mimeType: 'application/zip', buffer: Buffer.from('fake firmware archive 2') });
  const request = p.waitForRequest(r => r.url().endsWith('/api/symbian/firmware/install') && r.method() === 'POST');
  await second.getByTestId('fw-install').click();
  const payload = (await request).postDataJSON();
  assert.match(payload.archive, /RM-596\.zip$/); assert.equal(payload.rom, undefined); assert.equal(payload.vpl, undefined);
  await wait(async () => await p.evaluate(() => !!localStorage.getItem('mgo.symbian.job.v1')), 'firmware job retained');
  await p.route('**/api/symbian/jobs/*', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'unavailable', message: 'Temporary monitoring interruption' }) }), { times: 1 });
  await p.reload();
  await p.getByRole('button', { name: 'Resume monitoring', exact: true }).click();
  await p.getByTestId('symbian-panel').getByTestId('device-RM-596').waitFor({ timeout: 30000 });
  await p.getByTestId('symbian-panel').getByRole('heading', { name: 'Nokia N8' }).waitFor();
  // two devices: the platform defaults only offer the devices that can run that platform
  const opts = async (pl) => (await p.getByTestId(`default-${pl}`).locator('option').allInnerTexts()).join('|');
  assert.match(await opts('symbian'), /Nokia N70/); assert.match(await opts('symbian'), /Nokia N8/);
  assert.doesNotMatch(await opts('ngage'), /Nokia N70|Nokia N8/, 'neither phone runs N-Gage 1.0 cards');
  console.log('✔ Settings → Symbian: one archive format, devices shown as phones, defaults offer only fitting devices, job survives reload');
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
