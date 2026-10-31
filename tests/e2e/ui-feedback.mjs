// beta.5 feedback: choosing a library folder imports it by itself, the library has a compact list view,
// the phones on /phones are buttons that change the phone of the game opened last, Sony Ericsson phones use their own key layout,
// the Settings page keeps its width with ten phones. Real API + Chromium.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root = process.cwd();
const { makeJar } = await import(pathToFileURL(path.join(root, 'apps/api/src/dev/testing.ts')).href);
const dir = mkdtempSync(path.join(tmpdir(), 'jgo-fb-'));
const lib = mkdtempSync(path.join(tmpdir(), 'jgo-fb-lib-'));
for (const n of ['Alpha', 'Bravo', 'Charlie']) writeFileSync(path.join(lib, `${n}.jar`), makeJar(n, { vendor: 'ACME' }));
const port = 22100 + Math.floor(Math.random() * 300);
const base = `http://127.0.0.1:${port}`;
const server = spawn('node', ['apps/api/dist/server.js'], { env: { ...process.env, PORT: String(port), DATA_DIR: dir, HOST: '127.0.0.1', LOG_LEVEL: 'warn', LIBRARY_ROOTS: lib }, stdio: ['ignore', 'inherit', 'inherit'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wait = async (fn, what) => { for (let i = 0; i < 150; i++) { try { if (await fn()) return; } catch {} await sleep(100); } throw Error(`timeout: ${what}`); };
const games = async () => (await fetch(base + '/api/games')).json();
let browser;
try {
  await wait(async () => (await fetch(base + '/api/health')).ok, 'server');
  await fetch(base + '/api/setup/skip', { method: 'POST' });
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));

  // ---- 1. the folder is imported as soon as it is chosen ----
  assert.equal((await games()).length, 0);
  await p.goto(base + '/settings#library');
  await p.locator('.root', { hasText: lib }).click();
  await p.getByRole('button', { name: 'Use this folder' }).click();
  await wait(async () => (await games()).length === 3, 'the 3 games were imported without pressing Scan');
  console.log('✔ choosing the library folder imports it by itself');

  // ---- 2. Settings: ten phones wrap inside the page ----
  await p.goto(base + '/settings#phone');
  await p.locator('.skin-picker.wrap .skin-opt').first().waitFor();
  const w = await p.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth, picker: document.querySelector('.skin-picker.wrap').getBoundingClientRect().width, settings: document.querySelector('.settings').getBoundingClientRect().width, count: document.querySelectorAll('.skin-picker.wrap .skin-opt').length }));
  assert.ok(w.doc <= w.win, `no horizontal scroll (${w.doc} > ${w.win})`);
  assert.ok(w.count >= 10, `${w.count} phones`);
  assert.ok(w.settings > 1100, `the settings page is wide (${w.settings}px)`);
  console.log('✔ Settings is wide and the phone picker wraps:', JSON.stringify(w));

  // ---- 3. library list view ----
  await p.goto(base);
  await p.locator('.game-card').first().waitFor();
  assert.equal(await p.locator('.lib-grid').getAttribute('data-view'), 'tiles');
  await p.getByRole('radio', { name: 'List' }).click();
  assert.equal(await p.locator('.lib-grid').getAttribute('data-view'), 'list');
  const rowH = await p.locator('.game-card').first().evaluate((e) => e.getBoundingClientRect().height);
  assert.ok(rowH < 80, `a list row is compact (${rowH}px)`);
  await p.reload();
  await p.locator('.game-card').first().waitFor();
  assert.equal(await p.locator('.lib-grid').getAttribute('data-view'), 'list');
  await p.getByRole('radio', { name: 'Tiles' }).click();
  console.log('✔ the library has a compact list view and remembers the choice');

  // ---- 4. /phones: a click changes the phone of the game opened last; SE uses its own layout ----
  const g = (await games())[0];
  await p.goto(`${base}/play/${g.id}`);
  await p.locator('[data-testid=phone-profile-match]').waitFor();
  await p.getByRole('link', { name: 'Game', exact: true }).waitFor(); // the game is loaded and remembered
  await p.goto(base + '/phones');
  await p.getByRole('button', { name: /K790i/ }).click();
  await p.waitForURL(`**/play/${g.id}`, { waitUntil: 'commit' });
  await wait(async () => (await games()).find((x) => x.id === g.id).settings.skinId === 'sony-ericsson-k790i', 'the game now has the K790i');
  const s = (await games()).find((x) => x.id === g.id).settings;
  assert.equal(s.layout, 'sonyericsson');
  assert.equal(s.profileMode, 'auto');
  await p.locator('.skin-box[data-skin="sony-ericsson-k790i"]').waitFor();
  const chips = await p.locator('[data-testid=phone-profile-match]').innerText();
  assert.match(chips, /Sony Ericsson/, chips);
  assert.doesNotMatch(chips, /Nokia/);
  console.log('✔ /phones changes the phone of the game; Sony Ericsson shows its own key layout:', chips.replace(/\n/g, ' · '));

  assert.deepEqual(errors, []);
  console.log('ui feedback e2e OK');
} finally {
  await browser?.close();
  server.kill();
  await sleep(500);
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); rmSync(lib, { recursive: true, force: true }); } catch { /* temp */ }
}
