// My phones, the phone that follows the game, and "on another phone this looks better": Settings -> My phones, /phones, the player.
// Real API + Chromium. Java ME games only (needs the real KEmulator only to open the page, no game is started).
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const cwd = process.cwd();
const free = () => new Promise((res) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wait = async (fn, what, n = 200) => { for (let i = 0; i < n; i++) { try { const v = await fn(); if (v) return v; } catch {} await sleep(100); } throw Error('timeout ' + what); };
const { makeJar } = await import(new URL('../../apps/api/src/dev/testing.ts', import.meta.url).href).catch(() => ({}));
const dir = mkdtempSync(path.join(tmpdir(), 'mgo-myphones-'));
const port = await free();
mkdirSync(path.join(dir, 'app'));
const server = spawn('node', ['apps/api/dist/server.js'], { cwd, env: { ...process.env, PORT: String(port), DATA_DIR: path.join(dir, 'app'), HOST: '127.0.0.1', LOG_LEVEL: 'warn' }, stdio: ['ignore', 'inherit', 'inherit'] });
const base = `http://127.0.0.1:${port}`;
const api = async (p, init) => (await fetch(base + p, init)).json();
const patch = (body) => api('/api/settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
let browser;
try {
  await wait(async () => (await fetch(base + '/api/health')).ok, 'server');
  await fetch(base + '/api/setup/skip', { method: 'POST' });
  // a Java game made for 240x320 (it says so in its manifest), and one that says nothing
  const upload = async (name, title, extra) => { const f = new FormData(); f.append('jar', new Blob([makeJar(title, { extra })]), name); return (await api('/api/games', { method: 'POST', body: f })).game; };
  const made = await upload('Racer.jar', 'Racer', 'Nokia-MIDlet-Original-Display-Size: 240,320\n');
  const plain = await upload('Plain.jar', 'Plain');

  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; p.on('pageerror', (e) => errors.push(e.message));

  // ---- Settings -> My phones ----
  await p.goto(base + '/settings#phone');
  await p.getByTestId('my-phones').waitFor();
  assert.equal(await p.locator('.phone-grid .phone-card').count(), 15, 'the whole catalog is offered');
  await p.getByTestId('phone-nokia-n-gage-classic').click();
  await p.getByTestId('phone-nokia-n70').click();
  await wait(async () => (await api('/api/settings')).settings.myPhones?.includes('nokia-n70'), 'my phones saved');
  const s1 = (await api('/api/settings')).settings;
  assert.ok(s1.myPhones.includes('nokia-n-gage-classic') && s1.myPhones.includes('nokia-n70'));
  assert.equal(s1.nativePhones.ngage, 'nokia-n-gage-classic', 'the only N-Gage phone becomes the N-Gage default');
  assert.ok(s1.myPhones.includes('nokia-n95'), 'the phone that was already the default stays among my phones');
  assert.equal(s1.nativePhones.symbian, 'nokia-n95', 'the Symbian default stays while it is still chosen');
  assert.equal(await p.locator('[data-testid=default-phone-ngage] option').count(), 1);
  assert.deepEqual((await p.locator('[data-testid=default-phone-symbian] option').evaluateAll((o) => o.map((x) => x.value))).sort(), ['nokia-n-gage-classic', 'nokia-n70', 'nokia-n95'], 'only phones that can run Symbian programs are offered (an N-Gage runs S60 1st Edition)');
  await p.getByTestId('default-phone-symbian').selectOption('nokia-n70');
  await wait(async () => (await api('/api/settings')).settings.nativePhones.symbian === 'nokia-n70', 'symbian default');
  // a phone that cannot run N-Gage cannot be the N-Gage default; unchecking a default moves it to another fitting phone
  await p.getByTestId('phone-nokia-n-gage-classic').click();
  await wait(async () => !(await api('/api/settings')).settings.myPhones.includes('nokia-n-gage-classic'), 'unchecked');
  assert.equal((await api('/api/settings')).settings.nativePhones.ngage, undefined, 'no chosen phone runs N-Gage: no default');
  await p.getByTestId('phones-missing').waitFor();
  assert.match(await p.getByTestId('phones-missing').innerText(), /N-Gage/);
  await p.getByTestId('phone-nokia-n-gage-classic').click();
  await p.getByTestId('default-phone-j2me').selectOption('nokia-n95');
  await wait(async () => (await api('/api/settings')).settings.phone.skinId === 'nokia-n95', 'java default');
  console.log('✔ My phones: chosen from the catalog, defaults follow what fits, the missing kind is named');

  // ---- /phones shows only my phones, with a switch to see all ----
  await p.goto(base + '/phones');
  await p.getByTestId('only-mine').waitFor();
  const mine = (await api('/api/settings')).settings.myPhones.length;
  await wait(async () => (await p.locator('.phone-pick').count()) === mine, 'only my phones');
  await p.getByTestId('only-mine').uncheck();
  await wait(async () => (await p.locator('.phone-pick').count()) === 15, 'all phones');
  assert.equal(await p.locator('.phone-pick .ptag').first().isVisible(), true, 'platforms are a drawing and a word');
  console.log('✔ /phones lists my phones first-class; the rest is one switch away; platforms are pictures');

  // ---- the Java game made for 240x320 on an N-Gage phone: a reminder with a one-click switch ----
  await p.addInitScript(() => { try { localStorage.setItem('j2me-web.skin.v1', JSON.stringify({ skinId: 'nokia-n-gage-classic', view: 'full', integer: true })); } catch {} });
  await api('/api/games/' + made.id, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings: { skinId: 'nokia-n-gage-classic' } }) });
  await p.goto(base + '/play/' + made.id);
  await p.locator('.skin-box').waitFor();
  const tip = p.getByTestId('phone-suggestion');
  await tip.waitFor();
  assert.match(await tip.innerText(), /Nokia N95.*240×320/s);
  assert.equal(await p.locator('.skin-box').getAttribute('data-skin'), 'nokia-n-gage-classic', 'the phone that works is never changed on its own');
  await p.getByTestId('phone-suggestion-switch').click();
  await wait(async () => (await p.locator('.skin-box').getAttribute('data-skin')) === 'nokia-n95', 'switched');
  await tip.waitFor({ state: 'detached' });
  console.log('✔ a phone with the screen the game was made for is offered; one click switches; nothing changes by itself');

  // ---- a Java game without a phone of its own does not inherit the N-Gage the browser remembered ----
  await p.goto(base + '/play/' + plain.id);
  await p.locator('.skin-box').waitFor();
  await wait(async () => (await p.locator('.skin-box').getAttribute('data-skin')) === 'nokia-n95', 'the Java default phone');
  console.log('✔ opening a Java game after an N-Gage one starts on the Java default phone');

  // ---- audio is right under the session controls ----
  const order = await p.locator('.ctrl-col > details.panel > summary').allInnerTexts();
  assert.ok(order.findIndex((t) => /Audio/.test(t)) <= 2, `Audio is near the top of the controls (${order.join(' | ')})`);
  console.log('✔ the Audio panel sits right under Session');

  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  rmSync(dir, { recursive: true, force: true });
}
