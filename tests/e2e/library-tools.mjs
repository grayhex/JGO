// Library tools: genres from the folder names, titles without release-group tags, sort and status filters, "file gone" clean-up,
// emptying the library, and two small player fixes (no "review draft" badge, the gamepad button stays inside its panel).
// Real API + Chromium. Run with `node --import tsx`.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const { makeJar } = await import(pathToFileURL(path.join(process.cwd(), 'apps/api/src/dev/testing.ts')).href);
const dir = mkdtempSync(path.join(tmpdir(), 'jgo-lt-'));
const lib = mkdtempSync(path.join(tmpdir(), 'jgo-lt-lib-'));
const put = (rel, jar) => { mkdirSync(path.dirname(path.join(lib, rel)), { recursive: true }); writeFileSync(path.join(lib, rel), jar); };
put('JGO-Top500/Racing/Turbo.jar', makeJar('Turbo Rally **MASYAKA**', { vendor: 'ACME' }));
put('JGO-Top500/Puzzle/Blocks.jar', makeJar('BlocksOfColorAndShape', { vendor: 'ACME' }));
put('JGO-Top500/Other/Mystery.jar', makeJar('Mystery', { vendor: 'ACME' }));
put('JGO-Top500/Action/Gone One.jar', makeJar('Gone One', { vendor: 'ACME' }));
put('JGO-Top500/Action/Gone Two.jar', makeJar('Gone Two -zub-', { vendor: 'ACME' }));
const port = 22600 + Math.floor(Math.random() * 90);
const base = `http://127.0.0.1:${port}`;
const server = spawn('node', ['apps/api/dist/server.js'], { env: { ...process.env, PORT: String(port), DATA_DIR: dir, HOST: '127.0.0.1', LOG_LEVEL: 'warn', LIBRARY_ROOTS: lib }, stdio: ['ignore', 'inherit', 'inherit'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wait = async (fn, what) => { for (let i = 0; i < 200; i++) { try { if (await fn()) return; } catch {} await sleep(100); } throw Error(`timeout: ${what}`); };
const games = async () => (await fetch(base + '/api/games')).json();
const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
let browser;
try {
  await wait(async () => (await fetch(base + '/api/health')).ok, 'server');
  await fetch(base + '/api/setup/skip', { method: 'POST' });
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('dialog', (d) => void d.accept());

  // ---- import: genres come from the folders, titles are clean ----
  await fetch(base + '/api/settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ libraryPath: lib }) });
  await post('/api/library/scan', { mode: 'full' });
  await wait(async () => (await games()).length === 5, 'imported');
  await wait(async () => (await games()).every((g) => g.classification), 'genres assigned from the folders');
  const byName = Object.fromEntries((await games()).map((g) => [g.name, g]));
  assert.deepEqual(Object.keys(byName).sort(), ['Blocks Of Color And Shape', 'Gone One', 'Gone Two', 'Mystery', 'Turbo Rally']);
  assert.deepEqual([byName['Turbo Rally'].classification.primaryGenre, byName['Turbo Rally'].classification.source, byName['Blocks Of Color And Shape'].classification.primaryGenre], ['Racing', 'folder', 'Puzzle']);
  console.log('✔ genres come from the folder names, titles lose the release-group tags');

  await p.goto(base + '/');
  await p.locator('.game-card').first().waitFor();
  const titles = async () => p.locator('.game-card h3').allInnerTexts();
  assert.deepEqual(await titles(), ['Blocks Of Color And Shape', 'Gone One', 'Gone Two', 'Mystery', 'Turbo Rally']);
  const bar = await p.getByTestId('genre-bar').innerText();
  assert.match(bar, /Racing\s*1/);
  assert.match(bar, /Action\s*2/);
  assert.equal(await p.getByTestId('playtime').first().innerText(), '0', 'a game never started shows 0, not a sentence');

  // ---- sorting and the status filter ----
  await p.getByTestId('sort').selectOption('name-desc');
  assert.deepEqual(await titles(), ['Turbo Rally', 'Mystery', 'Gone Two', 'Gone One', 'Blocks Of Color And Shape']);
  await p.getByTestId('sort').selectOption('genre');
  assert.equal((await titles())[0], 'Gone One', 'genre order: Action first, then by name');
  await p.getByTestId('status-filter').selectOption('unconfirmed');
  assert.deepEqual(await titles(), ['Mystery'], '"Other" is a genre that is not confirmed');
  await p.getByTestId('status-filter').selectOption('all');
  await p.getByTestId('sort').selectOption('name');
  console.log('✔ sorting and the status filter work');

  // ---- the files of two games disappear ----
  rmSync(path.join(lib, 'JGO-Top500/Action/Gone One.jar'));
  rmSync(path.join(lib, 'JGO-Top500/Action/Gone Two.jar'));
  await post('/api/library/scan', { mode: 'update' });
  await wait(async () => (await games()).filter((g) => g.sourceMissing).length === 2, 'two games lost their files');
  await p.reload();
  await p.locator('.game-card').first().waitFor();
  await p.getByTestId('status-filter').selectOption('gone');
  assert.deepEqual(await titles(), ['Gone One', 'Gone Two']);
  await p.getByTestId('status-filter').selectOption('all');

  await p.goto(base + '/settings#library');
  await p.getByTestId('cleanup-panel').waitFor();
  await wait(async () => /\(2\)/.test(await p.getByTestId('cleanup-missing').innerText()), 'the number of games with missing files');
  await p.getByTestId('cleanup-missing').click();
  await wait(async () => (await games()).length === 3, 'the two games were removed');
  assert.ok((await games()).every((g) => !g.sourceMissing));
  console.log('✔ games with missing files are removed together');

  // ---- empty the whole library: needs the word DELETE ----
  await p.getByTestId('cleanup-all').click();
  await p.getByTestId('cleanup-word').fill('delete');
  assert.equal(await p.getByTestId('cleanup-confirm').isDisabled(), true, 'the word must be typed exactly');
  await p.getByTestId('cleanup-word').fill('DELETE');
  await p.getByTestId('cleanup-confirm').click();
  await wait(async () => (await games()).length === 0, 'the library is empty');
  console.log('✔ the whole library can be emptied (after typing DELETE)');

  // ---- the scan brings the files back, with genres ----
  await post('/api/library/scan', { mode: 'update' });
  await wait(async () => (await games()).length === 3 && (await games()).every((g) => g.classification), 'imported again');

  // ---- player: no "review draft", the gamepad button stays inside its panel ----
  const g = (await games())[0];
  await p.goto(base + '/play/' + g.id);
  await p.getByTestId('change-phone').waitFor();
  assert.equal(await p.getByText(/review draft/i).count(), 0);
  const pad = p.getByRole('button', { name: 'Gamepad settings / UI navigation' });
  await pad.waitFor();
  const inside = await p.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === 'Gamepad settings / UI navigation');
    const panel = b.closest('.panel');
    const rb = b.getBoundingClientRect(), rp = panel.getBoundingClientRect();
    return { ok: rb.left >= rp.left - 1 && rb.right <= rp.right + 1, button: [Math.round(rb.left), Math.round(rb.right)], panel: [Math.round(rp.left), Math.round(rp.right)] };
  });
  assert.ok(inside.ok, JSON.stringify(inside));
  console.log('✔ no "review draft" badge; the gamepad button fits its panel', JSON.stringify(inside));

  assert.deepEqual(errors, []);
  console.log('library tools e2e OK');
} finally {
  await browser?.close();
  server.kill();
  await sleep(500);
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); rmSync(lib, { recursive: true, force: true }); } catch { /* temp */ }
}
