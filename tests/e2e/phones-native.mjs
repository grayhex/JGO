// /phones and the player for Symbian / N-Gage games: compatible phones only, the firmware of each phone, and the phone bodies sit on their screens
// (the N-Gage screen used to float above the phone on /phones). Real API + real agent + FAKE EKA2L1 + Chromium.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { crc32 } from 'node:zlib';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const cwd = process.cwd();
function makeZip(entries) { const files = [], central = []; let offset = 0; for (const [name, text] of Object.entries(entries)) { const data = Buffer.from(text), nm = Buffer.from(name), crc = crc32(data); const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(20, 4); l.writeUInt32LE(crc, 14); l.writeUInt32LE(data.length, 18); l.writeUInt32LE(data.length, 22); l.writeUInt16LE(nm.length, 26); const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(data.length, 24); cd.writeUInt16LE(nm.length, 28); cd.writeUInt32LE(offset, 42); files.push(l, nm, data); central.push(cd, nm); offset += 30 + nm.length + data.length; } const cdb = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10); end.writeUInt32LE(cdb.length, 12); end.writeUInt32LE(offset, 16); return Buffer.concat([...files, cdb, end]); }
const free = () => new Promise((res) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wait = async (fn, what, n = 300) => { for (let i = 0; i < n; i++) { try { const v = await fn(); if (v) return v; } catch {} await sleep(100); } throw Error('timeout ' + what); };
const dir = mkdtempSync(path.join(tmpdir(), 'jgo-phones-'));
const token = 'e2e-token-0123456789abcdef';
const ap = await free(), port = await free(), cp = await free();
const fx = path.join(cwd, 'tests/fixtures/fake-eka2l1');
const agent = spawn(process.execPath, ['symbian/agent/agent.mjs'], { cwd, env: { PATH: process.env.PATH, AGENT_TOKEN: token, AGENT_PORT: String(ap), AGENT_HOST: '127.0.0.1', CONTROL_PORT: String(cp), DATA_DIR: path.join(dir, 'a'), EKA2L1_BIN: path.join(fx, 'fake-eka2l1.mjs'), AUDIO_CMD: `${process.execPath} ${path.join(fx, 'pcm.mjs')}` }, stdio: 'ignore' });
mkdirSync(path.join(dir, 'app'));
const server = spawn('node', ['apps/api/dist/server.js'], { cwd, env: { ...process.env, PORT: String(port), DATA_DIR: path.join(dir, 'app'), HOST: '127.0.0.1', LOG_LEVEL: 'warn', SYMBIAN_AGENT_URL: `http://127.0.0.1:${ap}`, SYMBIAN_AGENT_TOKEN: token }, stdio: 'ignore' });
const base = `http://127.0.0.1:${port}`;
let browser;
try {
  await wait(async () => (await fetch(`http://127.0.0.1:${ap}/agent/ping`)).ok, 'agent'); await wait(async () => (await fetch(base + '/api/health')).ok, 'server');
  await fetch(base + '/api/setup/skip', { method: 'POST' });
  // the N-Gage firmware (NEM-4 = N-Gage Classic) is installed; nothing else
  const fw = new FormData(); fw.append('file', new Blob(['rom']), 'NEM-4.rom');
  const up = await (await fetch(base + '/api/symbian/firmware?slot=rom', { method: 'POST', body: fw })).json();
  const job = await (await fetch(base + '/api/symbian/firmware/install', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rom: up.file }) })).json();
  await wait(async () => (await (await fetch(`${base}/api/symbian/jobs/${job.id}`)).json()).state === 'succeeded', 'install', 200);
  const zip = makeZip({ 'Card/System/Apps/pg/pg.app': 'app' });
  const g = new FormData(); g.append('platform', 'ngage'); g.append('file', new Blob([zip]), 'Pandemonium.zip');
  const game = (await (await fetch(base + '/api/games', { method: 'POST', body: g })).json()).game;
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; p.on('pageerror', (e) => errors.push(e.message));

  // ---- the N-Gage game starts on an N-Gage, not on the J2ME phone the browser remembered ----
  await p.addInitScript(() => { try { localStorage.setItem('j2me-web.skin.v1', JSON.stringify({ skinId: 'sony-ericsson-k790i', view: 'full', integer: true })); } catch {} });
  await p.goto(base + '/play/' + game.id);
  await p.locator('.skin-box').waitFor();
  await wait(async () => (await p.locator('.skin-box').getAttribute('data-skin')) === 'nokia-n-gage-classic', 'the phone to follow the firmware');
  assert.equal(await p.locator('.skin-box').getAttribute('data-skin'), 'nokia-n-gage-classic', 'a stale Sony Ericsson preference never hosts an N-Gage game');
  console.log('✔ the N-Gage game is shown on the N-Gage Classic although the browser remembered a Sony Ericsson');

  // ---- /phones: what fits, what has firmware, and every body sits exactly on its screen ----
  await p.getByRole('button', { name: 'Start', exact: true }).first().click();
  await wait(async () => (await p.getByTestId('frame-size').innerText()) === '176×208', 'the game picture');
  await p.goto(base + '/phones');
  await p.locator('[data-testid^=phone-card-]').first().waitFor();
  await p.evaluate(async () => { for (const img of document.querySelectorAll('img.skin-body')) { img.loading = 'eager'; try { await img.decode(); } catch {} } });
  await p.waitForTimeout(800);
  const cards = await p.evaluate(() => [...document.querySelectorAll('[data-testid^=phone-card-]')].map((el) => {
    const r = (s) => { const e = el.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, w: b.width, h: b.height }; };
    const btn = el.closest('button');
    return { id: el.getAttribute('data-testid').replace('phone-card-', ''), box: r('.skin-box'), body: r('.skin-body'), lcd: r('.skin-lcd'), fit: btn.getAttribute('data-fit'), disabled: btn.disabled };
  }));
  assert.equal(cards.length, 15);
  for (const c of cards) {
    // the regression: a legacy "height: 280px" rule on every image of the card pulled wide phones (N-Gage) away from their screen
    assert.ok(Math.abs(c.body.w - c.box.w) <= 1 && Math.abs(c.body.h - c.box.h) <= 1, `${c.id}: the body picture fills its box (${JSON.stringify(c.body)} vs ${JSON.stringify(c.box)})`);
    assert.ok(c.lcd.l >= c.box.l - 1 && c.lcd.t >= c.box.t - 1 && c.lcd.l + c.lcd.w <= c.box.l + c.box.w + 1 && c.lcd.t + c.lcd.h <= c.box.t + c.box.h + 1, `${c.id}: the screen is inside the phone`);
  }
  assert.deepEqual(cards.filter((c) => c.fit === 'yes').map((c) => c.id).sort(), ['nokia-n-gage-classic', 'nokia-n-gage-qd']);
  assert.ok(cards.filter((c) => c.fit === 'no').every((c) => c.disabled), 'a phone that cannot run N-Gage games cannot be chosen for it');
  for (const id of ['sony-ericsson-k790i', 'sony-ericsson-w995', 'motorola-razr-v3', 'samsung-s5230', 'nokia-6100']) {
    assert.equal(await p.getByTestId(`phone-incompatible-${id}`).count(), 1, `${id} is marked as unable to run N-Gage games`);
  }
  assert.equal(await p.getByTestId('phone-firmware-nokia-n-gage-classic').getAttribute('data-loaded'), '1', 'the installed NEM-4 firmware is shown for the N-Gage Classic');
  for (const id of ['nokia-n-gage-qd', 'nokia-n70', 'nokia-n95']) assert.equal(await p.getByTestId(`phone-firmware-${id}`).getAttribute('data-loaded'), '0', `${id}: its firmware is not installed`);
  assert.equal(await p.getByTestId('phone-firmware-sony-ericsson-k790i').count(), 0, 'a Java ME phone has no firmware to show');
  await p.getByTestId('phones-native-note').waitFor();
  await p.screenshot({ path: 'test-results/phones-native.png', fullPage: true });
  console.log('✔ /phones: bodies sit on their screens, only N-Gage phones can host the game, firmware state is shown per phone');

  // ---- the same bodies in the player, at several window sizes ----
  const exp = { x: 0.37127503663898387, y: 0.1239356669820246 };
  for (const [w, h] of [[1920, 1080], [1280, 720], [1024, 600], [820, 1180], [390, 844]]) {
    await p.setViewportSize({ width: w, height: h });
    await p.goto(base + '/play/' + game.id);
    await p.locator('.skin-box').waitFor();
    await p.waitForTimeout(300);
    const m = await p.evaluate(() => { const q = (s) => { const e = document.querySelector(s); const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, w: b.width, h: b.height }; }; return { box: q('.skin-box'), lcd: q('.skin-lcd'), body: q('.skin-body') }; });
    assert.ok(Math.abs(m.lcd.t - (m.box.t + exp.y * m.box.h)) < 1.5 && Math.abs(m.lcd.l - (m.box.l + exp.x * m.box.w)) < 1.5, `${w}x${h}: the screen is where the artwork has its window`);
    assert.ok(Math.abs(m.body.h - m.box.h) <= 1, `${w}x${h}: body = box`);
  }
  console.log('✔ in the player the N-Gage screen stays in its window at 5 window sizes');
  assert.deepEqual(errors, []);
} finally { await browser?.close(); server.kill('SIGTERM'); agent.kill('SIGTERM'); await sleep(300); rmSync(dir, { recursive: true, force: true }); }
