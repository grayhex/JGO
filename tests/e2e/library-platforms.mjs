// The library keeps Java ME, S60, N-Gage 1.0 and N-Gage 2.0 games apart: separate cards even with the same title, a platform badge,
// a platform filter that survives a reload, and the right file kinds per platform. Real API + Chromium. Run with `node --import tsx`.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const { makeJar } = await import(pathToFileURL(path.join(process.cwd(), 'apps/api/src/dev/testing.ts')).href);
const dir = mkdtempSync(path.join(tmpdir(), 'jgo-plat-'));
const port = 23300 + Math.floor(Math.random() * 90);
const base = `http://127.0.0.1:${port}`;
const server = spawn('node', ['apps/api/dist/server.js'], { env: { ...process.env, PORT: String(port), DATA_DIR: dir, HOST: '127.0.0.1', LOG_LEVEL: 'warn' }, stdio: ['ignore', 'inherit', 'inherit'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wait = async (fn, what) => { for (let i = 0; i < 200; i++) { try { if (await fn()) return; } catch {} await sleep(100); } throw Error(`timeout: ${what}`); };
const send = async (name, bytes, fields = {}) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  fd.append('file', new Blob([bytes]), name);
  const r = await fetch(base + '/api/games', { method: 'POST', body: fd });
  return { status: r.status, body: await r.json() };
};
let browser;
try {
  await wait(async () => (await fetch(base + '/api/health')).ok, 'server');
  await fetch(base + '/api/setup/skip', { method: 'POST' });

  // ---- the API keeps them apart, also when the titles are the same ----
  const jar = await send('Alpha.jar', makeJar('Alpha'));
  const sis = await send('Alpha.sis', Buffer.from('s60 package'));
  const ng2 = await send('Alpha.n-gage', Buffer.from('n-gage 2 package'));
  const ng1 = await send('Alpha.zip', Buffer.from('PK\x03\x04card'), { platform: 'ngage' });
  for (const r of [jar, sis, ng2, ng1]) assert.equal(r.status, 201, JSON.stringify(r.body));
  const list = await (await fetch(base + '/api/games')).json();
  assert.deepEqual(list.map((g) => g.platform).sort(), ['j2me', 'ngage', 'ngage2', 'symbian']);
  assert.equal(new Set(list.map((g) => g.groupKey)).size, 4, 'four cards, not one group of four versions');
  // the wrong kind of file is refused instead of being filed under a platform it does not belong to
  assert.equal((await send('x.sis', Buffer.from('a'), { platform: 'ngage' })).status, 400);
  assert.equal((await send('x.n-gage', Buffer.from('b'), { platform: 'symbian' })).status, 400);
  assert.equal((await send('x.zip', Buffer.from('not a zip'))).status, 400);
  assert.equal((await send('x.exe', Buffer.from('MZ'))).status, 400);
  console.log('✔ the API files a .jar, .sis, .n-gage and an N-Gage 1.0 .zip under four platforms, as four cards');

  // ---- the library UI ----
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(base + '/');
  await p.locator('.game-card').first().waitFor();
  assert.equal(await p.locator('.game-card').count(), 4);
  assert.deepEqual((await p.getByTestId('platform-badge').allInnerTexts()).map((t) => t.toLowerCase()).sort(), ['n-gage', 'n-gage 2.0', 's60']);
  assert.deepEqual(await p.getByTestId('platform-filter').locator('option').allInnerTexts(), ['All platforms', 'Java ME', 'Symbian S60 / Symbian³', 'N-Gage', 'N-Gage 2.0']);
  for (const [value, badge] of [['j2me', null], ['symbian', 'S60'], ['ngage', 'N-Gage'], ['ngage2', 'N-Gage 2.0']]) {
    await p.getByTestId('platform-filter').selectOption(value);
    assert.equal(await p.locator('.game-card').count(), 1, `one ${value} game`);
    if (badge) assert.equal((await p.getByTestId('platform-badge').innerText()).toLowerCase(), badge.toLowerCase());
    else assert.equal(await p.getByTestId('platform-badge').count(), 0, 'a Java game has no EKA2L1 badge');
  }
  await p.getByTestId('platform-filter').selectOption('symbian');
  await p.reload();
  await p.locator('.game-card').first().waitFor();
  assert.equal(await p.getByTestId('platform-filter').inputValue(), 'symbian', 'the filter survives a reload');
  assert.equal(await p.locator('.game-card').count(), 1);
  await p.getByTestId('platform-filter').selectOption('all');
  assert.equal(await p.locator('.game-card').count(), 4);
  console.log('✔ four cards with their platform badges; the platform filter selects one each and survives a reload');

  // ---- dropping files of every kind into the window files each one under its platform ----
  await p.locator('input[type=file]').first().setInputFiles([
    { name: 'Beta.jar', mimeType: 'application/java-archive', buffer: Buffer.from(makeJar('Beta')) },
    { name: 'Beta.sisx', mimeType: 'application/octet-stream', buffer: Buffer.from('beta sisx') },
  ]);
  await wait(async () => (await (await fetch(base + '/api/games')).json()).length === 6, 'both uploads');
  const after = await (await fetch(base + '/api/games')).json();
  assert.deepEqual(after.filter((g) => g.name.startsWith('Beta')).map((g) => g.platform).sort(), ['j2me', 'symbian']);
  assert.deepEqual(errors, []);
  console.log('✔ a .jar and a .sisx dropped together land on their own platforms');
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  await sleep(300);
  rmSync(dir, { recursive: true, force: true });
}
