// Genres: a catalog imported in Settings (preview, then confirm), chips over the library, the badge and the dialog,
// a hand-chosen genre that a second import leaves alone. Real API + Chromium. Run with `node --import tsx`.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const { makeJar } = await import(pathToFileURL(path.join(process.cwd(), 'apps/api/src/dev/testing.ts')).href);
const dir = mkdtempSync(path.join(tmpdir(), 'jgo-gen-'));
const port = 22400 + Math.floor(Math.random() * 90);
const base = `http://127.0.0.1:${port}`;
const server = spawn('node', ['apps/api/dist/server.js'], { env: { ...process.env, PORT: String(port), DATA_DIR: dir, HOST: '127.0.0.1', LOG_LEVEL: 'warn' }, stdio: ['ignore', 'inherit', 'inherit'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wait = async (fn, what) => { for (let i = 0; i < 150; i++) { try { if (await fn()) return; } catch {} await sleep(100); } throw Error(`timeout: ${what}`); };
const jars = { Turbo: makeJar('Turbo Race', { vendor: 'ACME' }), Blocks: makeJar('Blocks', { vendor: 'ACME' }), Mystery: makeJar('Mystery', { vendor: 'ACME' }), Evil: makeJar('<img src=x onerror=alert(1)>', { vendor: 'ACME' }) };
const sha = (b) => createHash('sha256').update(b).digest('hex');
let browser;
try {
  await wait(async () => (await fetch(base + '/api/health')).ok, 'server');
  await fetch(base + '/api/setup/skip', { method: 'POST' });
  for (const [n, jar] of Object.entries(jars)) {
    const fd = new FormData();
    fd.append('jar', new Blob([jar]), `${n}.jar`);
    assert.equal((await fetch(base + '/api/games', { method: 'POST', body: fd })).status, 201);
  }
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  let dialogs = 0;
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('dialog', (d) => { dialogs++; void d.dismiss(); });

  // ---- before any catalog: no chips, every card says the genre is not confirmed ----
  await p.goto(base + '/');
  await p.locator('.game-card').first().waitFor();
  assert.equal(await p.getByTestId('genre-bar').count(), 0);
  assert.equal(await p.getByTestId('genre-badge').filter({ hasText: 'Genre not confirmed' }).count(), 4);
  console.log('✔ without genres the cards offer to choose one');

  // ---- Settings: preview shows what would happen and changes nothing; confirm writes ----
  // the curator's own format, with the paths of its collection: they must stay in the browser
  const item = (jar, over) => ({ rank: 1, title_key: 'x', genre_confidence: 'manual', source_relative: 'Gameloft (Nokia N81)\\Secret Path.jar', file: 'Secret Path.jar', resolution: '', vendor: 'ACME', version: '1', sha256: sha(jar), ...over });
  const catalog = { schema: 'jgo-curator-manifest-v1', generated_by: 'J2ME Curator', report_source_root: '\\\\192.168.1.5\\Games', target: 500, items: [
    item(jars.Turbo, { title: 'Turbo Race', genre: 'Racing' }),
    item(jars.Blocks, { title: 'Blocks', genre: 'Puzzle' }),
    item(jars.Evil, { title: 'Evil', genre: 'Action' }),
    item(jars.Turbo, { sha256: 'f'.repeat(64), title: 'Not here', genre: 'Sports' }),
    item(jars.Mystery, { title: 'Mystery', genre: 'Space opera' }),
  ] };
  const sent = [];
  p.on('request', (r) => { if (r.url().includes('/api/library/catalog/')) sent.push(r.postData() ?? ''); });
  await p.goto(base + '/settings#library');
  await p.getByTestId('catalog-file').setInputFiles({ name: 'jgo_catalog.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(catalog)) });
  const rep = p.getByTestId('catalog-report');
  await rep.waitFor();
  assert.ok(sent.length > 0 && sent.every((b) => !/Secret Path|192\.168|source_relative/.test(b)), 'no file paths were sent to the server');
  await rep.waitFor();
  const txt = await rep.innerText();
  assert.match(txt, /preview/i);
  assert.match(txt, /In the file: 5/);
  assert.match(txt, /Not in the library: 1/);
  assert.match(txt, /Rejected entries: 1/);
  assert.equal((await (await fetch(base + '/api/games')).json()).filter((g) => g.classification).length, 0, 'the preview wrote nothing');
  await p.getByTestId('catalog-confirm').click();
  await wait(async () => (await (await fetch(base + '/api/games')).json()).filter((g) => g.classification).length === 3, 'genres written');
  await wait(async () => /Racing 1/.test(await p.getByTestId('genre-stats').innerText()), 'the numbers under the importer');
  console.log('✔ preview first, then import by SHA-256:', txt.replace(/\n/g, ' | '));

  // ---- the library: chips with counts, a filter, badges; markup in a title stays text ----
  await p.goto(base + '/');
  await p.getByTestId('genre-bar').waitFor();
  const bar = await p.getByTestId('genre-bar').innerText();
  assert.match(bar, /Racing\s*1/);
  assert.match(bar, /No genre\s*1/);
  await p.getByTestId('genre-bar').getByRole('button', { name: /^Racing/ }).click();
  assert.deepEqual(await p.locator('.game-card h3').allInnerTexts(), ['Turbo Race']);
  await p.getByTestId('genre-bar').getByRole('button', { name: /^No genre/ }).click();
  assert.deepEqual(await p.locator('.game-card h3').allInnerTexts(), ['Mystery']);
  await p.reload();
  await p.locator('.game-card').first().waitFor();
  assert.equal(await p.locator('.game-card').count(), 1, 'the chosen genre is remembered');
  await p.getByTestId('genre-bar').getByRole('button', { name: /^All genres/ }).click();
  assert.equal(await p.locator('.game-card').count(), 4);
  assert.equal(await p.locator('.game-card h3', { hasText: '<img src=x onerror=alert(1)>' }).count(), 1, 'shown as text');
  assert.equal(await p.locator('.game-card img[src="x"]').count(), 0);
  console.log('✔ chips with counts filter the library:', bar.replace(/\n/g, ' '));

  // ---- change a genre by hand; a second import must not touch it ----
  await p.locator('.game-card', { hasText: 'Turbo Race' }).getByTestId('genre-badge').click();
  await p.getByLabel('Genre', { exact: true }).selectOption('Arcade');
  await p.getByRole('button', { name: 'Save', exact: true }).click();
  await wait(async () => (await (await fetch(base + '/api/games')).json()).find((g) => g.name === 'Turbo Race').classification.locked === true, 'locked');
  const again = await (await fetch(base + '/api/library/catalog/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(catalog) })).json();
  assert.equal(again.locked, 1);
  const turbo = (await (await fetch(base + '/api/games')).json()).find((g) => g.name === 'Turbo Race');
  assert.equal(turbo.classification.primaryGenre, 'Arcade');
  await p.reload();
  await p.locator('.game-card', { hasText: 'Turbo Race' }).getByTestId('genre-badge').filter({ hasText: 'Arcade' }).waitFor();
  console.log('✔ a hand-picked genre is shown and survives another import');

  assert.equal(dialogs, 0, 'no alert() fired');
  assert.deepEqual(errors, []);
  console.log('genres e2e OK');
} finally {
  await browser?.close();
  server.kill();
  await sleep(500);
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* temp */ }
}
