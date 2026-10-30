// Production UI -> real KEmulator: every added handset, body keys, touch and zoom.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const ids = ['sony-ericsson-w995', 'sony-ericsson-k790i', 'motorola-razr-v3', 'nokia-5800', 'samsung-s5230'];
const data = mkdtempSync(path.join(tmpdir(), 'jgo-phones-'));
const port = 20500 + Math.floor(Math.random() * 300), base = `http://127.0.0.1:${port}`;
mkdirSync('test-results', { recursive: true });
const server = spawn('node', ['apps/api/dist/server.js'], {
  env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), DATA_DIR: data, LOG_LEVEL: 'warn' },
  stdio: ['ignore', 'inherit', 'inherit'],
});
let browser;
async function wait(fn, label) {
  for (let i = 0; i < 200; i++) {
    try { if (await fn()) return; } catch { /* startup/reconnection */ }
    await new Promise(r => setTimeout(r, 100));
  }
  throw Error(`Timeout: ${label}`);
}

try {
  await wait(async () => (await fetch(base + '/api/health')).ok, 'server');
  await fetch(base + '/api/setup/skip', { method: 'POST' });
  const fd = new FormData();
  fd.append('jar', new Blob([readFileSync('tests/fixtures/testmidlet/build/kemtest.jar')]), 'kemtest.jar');
  const upload = await fetch(base + '/api/games', { method: 'POST', body: fd });
  assert.equal(upload.status, 201);
  const { game } = await upload.json();
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, hasTouch: true });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.goto(base + '/play/' + game.id);
  await page.locator('.skin-picker [role=radio]').last().waitFor();
  assert.equal(await page.locator('.skin-picker [role=radio]').count(), 10);

  for (const id of ids) {
    const c = JSON.parse(readFileSync(`apps/web/public/phones/${id}/config.json`, 'utf8'));
    await page.locator('.stage-bar').getByRole('radio', { name: 'Phone', exact: true }).click();
    await page.locator('.skin-picker [role=radio]').filter({ hasText: c.model }).click();
    await page.locator(`.skin-box[data-skin="${id}"][data-view=full]`).waitFor();
    await wait(async () => {
      const settings = (await (await fetch(base + '/api/games/' + game.id)).json()).settings;
      return settings.skinId === id && settings.width === c.screen.width && settings.height === c.screen.height;
    }, id + ' persisted automatic profile');
    await page.locator('.ctrl-col').getByRole('button', { name: 'Start', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-testid=state-badge]').textContent.includes('running'));
    await page.waitForFunction(({ w, h }) => {
      const canvas = document.querySelector('.skin-canvas');
      return canvas?.width === w && canvas.height === h && canvas.getContext('2d').getImageData(0, 0, 1, 1).data[0] === 255;
    }, { w: c.screen.width, h: c.screen.height });
    const running = (await (await fetch(base + '/api/sessions')).json()).find(s => s.state === 'running');
    assert.ok(running);
    const logs = async () => (await (await fetch(base + '/api/sessions/' + running.id)).json()).logTail.join('\n');
    const body = page.locator(`.skin-box[data-skin="${id}"][data-view=full]`);
    await body.scrollIntoViewIfNeeded();
    const fullLcd = await page.getByTestId('skin-lcd').boundingBox();
    const fullCanvas = await page.locator('.skin-canvas').boundingBox();
    if (c.input.kind === 'keypad') {
      const key = c.buttons.find(b => b.id === 'd5');
      const x = key.polygon.reduce((n, p) => n + p[0], 0) / key.polygon.length;
      const y = key.polygon.reduce((n, p) => n + p[1], 0) / key.polygon.length;
      const box = await body.boundingBox();
      await page.mouse.move(box.x + x * box.width, box.y + y * box.height);
      await page.mouse.down();
      await wait(async () => (await logs()).includes('KEY_DOWN 53'), id + ' physical 5');
      await page.locator('.stage-bar').getByRole('radio', { name: 'Screen', exact: true }).dispatchEvent('click');
      await wait(async () => (await logs()).includes('KEY_UP 53'), id + ' zoom releases key');
      await page.mouse.up();
    } else {
      assert.ok(await page.getByTestId('keypad').isVisible(), 'touch handset has external keys in full view');
      assert.ok(await page.getByRole('checkbox', { name: 'On-screen keypad', exact: true }).isChecked());
      assert.ok(await page.getByRole('checkbox', { name: 'On-screen keypad', exact: true }).isDisabled());
      const canvas = page.locator('.skin-canvas'), box = await canvas.boundingBox();
      const x = Math.round(c.screen.width * 0.37), y = Math.round(c.screen.height * 0.41);
      await page.touchscreen.tap(box.x + box.width * x / c.screen.width, box.y + box.height * y / c.screen.height);
      await wait(async () => (await logs()).includes(`POINTER_DOWN ${x},${y}`) && (await logs()).includes(`POINTER_UP ${x},${y}`), id + ' real touch coordinates');
      await page.getByTestId('keypad').getByRole('button', { name: '5 jkl', exact: true }).click();
      await wait(async () => (await logs()).includes('KEY_DOWN 53') && (await logs()).includes('KEY_UP 53'), id + ' external 5');
      await page.locator('.stage-bar').getByRole('radio', { name: 'Screen', exact: true }).click();
    }
    await page.locator(`.skin-box[data-skin="${id}"][data-view=screen]`).waitFor();
    const still = await (await fetch(base + '/api/sessions/' + running.id)).json();
    assert.equal(still.state, 'running'); assert.equal(still.createdAt, running.createdAt);
    assert.deepEqual([still.width, still.height], [c.screen.width, c.screen.height]);
    assert.equal(await page.locator('.skin-hit polygon').count(), 0, 'zoom has no body hitboxes');
    const metrics = await page.locator('.skin-canvas').evaluate(el => ({ w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height }));
    assert.ok(Math.abs(metrics.w / metrics.h - c.screen.width / c.screen.height) < 0.01);
    const zoomLcd = await page.getByTestId('skin-lcd').boundingBox();
    assert.ok(zoomLcd.width > fullLcd.width + 1, id + ' zoom enlarges the physical LCD area');
    assert.ok(metrics.w >= fullCanvas.width - 1, id + ' integer scaling may retain size but never shrink the game');
    await page.locator('.stage-card').screenshot({ path: `test-results/${id}-zoom.png` });
    await page.reload();
    await page.locator(`.skin-box[data-skin="${id}"][data-view=screen]`).waitFor();
    const attached = (await (await fetch(base + '/api/sessions')).json()).find(s => s.state === 'running');
    assert.equal(attached.id, running.id, 'reload retains phone and attaches same session');
    await page.locator('.stage-bar').getByRole('radio', { name: 'Phone', exact: true }).click();
    for (const theme of ['light', 'dark']) {
      await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
      await page.locator('.stage-card').screenshot({ path: `test-results/${id}-${theme}.png` });
    }
    await page.locator('.ctrl-col').getByRole('button', { name: 'Stop', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-testid=state-badge]').textContent.includes('exited'));
    console.log(`PASS ${id}: real ${c.screen.width}×${c.screen.height}, ${c.input.kind} input, zoom and persisted session.`);
  }
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  if (server.exitCode === null && server.signalCode === null) {
    const exited = new Promise(resolve => server.once('exit', resolve));
    server.kill('SIGTERM'); await exited;
  }
  rmSync(data, { recursive: true, force: true });
}
