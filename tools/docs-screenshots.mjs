#!/usr/bin/env node
// Takes the screenshots used by the READMEs and docs: docs/img/{library,library-list,player,phones,settings}.png
//   node tools/docs-screenshots.mjs <folder with .jar files> [output folder]
// It starts a throw-away server (own data folder), imports the JARs, gives them titles and genres, runs a game on a phone and
// photographs the UI in the dark theme at 1440x900. Needs a built app (npm run build) and Chromium. The JARs are only read,
// they are never copied into the repository: use games you may show.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const [jarDir, outArg] = process.argv.slice(2);
if (!jarDir) { console.error('usage: node tools/docs-screenshots.mjs <folder with .jar files> [output folder]'); process.exit(2); }
const out = path.resolve(outArg ?? 'docs/img');
mkdirSync(out, { recursive: true });
const jars = readdirSync(jarDir).filter((f) => /\.jar$/i.test(f)).sort().map((f) => path.join(jarDir, f));
if (!jars.length) { console.error('no .jar files in', jarDir); process.exit(2); }

const dir = mkdtempSync(path.join(tmpdir(), 'jgo-shots-'));
const port = 23800 + Math.floor(Math.random() * 90);
const base = `http://127.0.0.1:${port}`;
const server = spawn('node', ['apps/api/dist/server.js'], { env: { ...process.env, PORT: String(port), DATA_DIR: dir, HOST: '127.0.0.1', LOG_LEVEL: 'warn' }, stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (method, url, body) => fetch(base + url, { method, ...(method === 'POST' || method === 'PUT' || method === 'PATCH' ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) } : {}) }).then((r) => (r.status === 204 ? null : r.json()));
let browser;
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* starting */ } await sleep(100); }
  await json('POST', '/api/setup/skip');
  const games = [];
  for (const f of jars) {
    const fd = new FormData();
    fd.append('jar', new Blob([readFileSync(f)]), path.basename(f));
    const r = await (await fetch(base + '/api/games', { method: 'POST', body: fd })).json();
    if (r.game) games.push(r.game);
  }
  // titles and genres as a collection would have them (the JARs of this repository's test fixtures are skipped by the caller)
  const GENRE = [/spider|assassin|iron|batman|gangstar/i, 'Action', /pool|football|fifa|nba|tennis/i, 'Sports', /asphalt|racing|rally|taxi/i, 'Racing', /tetris|bubble|block|puzzle/i, 'Puzzle'];
  const TITLE = { 'amazing spider': 'The Amazing Spider-Man', assassins: "Assassin's Creed" };
  for (const g of games) {
    for (let i = 0; i < GENRE.length; i += 2) if (GENRE[i].test(g.name)) await json('PATCH', `/api/library/groups/${g.groupKey}/classification`, { primaryGenre: GENRE[i + 1] });
    for (const [k, t] of Object.entries(TITLE)) if (g.name.toLowerCase().includes(k)) await json('PUT', `/api/library/groups/${g.groupKey}/title`, { title: t });
  }
  // a few seconds of play, so the cards show a time
  for (const g of games) {
    const s = await json('POST', '/api/sessions', { gameId: g.id });
    await sleep(4000);
    await json('DELETE', `/api/sessions/${s.id}`);
    await sleep(800);
  }

  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const shot = (name) => page.screenshot({ path: path.join(out, name) });

  await page.goto(base + '/');
  await page.locator('.game-card').first().waitFor();
  await sleep(600);
  await shot('library.png');
  await page.getByRole('radio', { name: 'List' }).click();
  await sleep(400);
  await shot('library-list.png');
  await page.getByRole('radio', { name: 'Tiles' }).click();

  // the player: the first game that really draws something (a game may sit on a black or white splash for a long time)
  const look = () => page.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c || !c.width) return { colours: 0, white: 1 };
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const seen = new Set(); let white = 0, n = 0;
    for (let k = 0; k < d.length; k += 12) { n++; seen.add(((d[k] >> 4) << 8) | ((d[k + 1] >> 4) << 4) | (d[k + 2] >> 4)); if (d[k] > 235 && d[k + 1] > 235 && d[k + 2] > 235) white++; }
    return { colours: seen.size, white: white / n };
  });
  const order = [...games.filter((g) => /pool/i.test(g.name)), ...games.filter((g) => !/pool/i.test(g.name))];
  let shown = null;
  for (const hero of order) {
    await page.goto(base + '/play/' + hero.id);
    await page.locator('.skin-lcd-overlay button.primary').click();
    let st = { colours: 0, white: 1 };
    for (let i = 0; i < 70; i++) { // up to 35 s per game
      st = await look();
      if (st.colours >= 70 && st.white < 0.3) break;
      await sleep(500);
    }
    console.log(hero.name, JSON.stringify(st));
    if (st.colours >= 70 && st.white < 0.3) { shown = hero; break; }
    const live = await json('GET', '/api/sessions');
    for (const x of live) await json('DELETE', `/api/sessions/${x.id}`);
    await sleep(1500);
  }
  if (!shown) console.warn('no game drew a rich picture: the player screenshot shows whatever is on the screen');
  await sleep(1200);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot('player.png');
  for (const x of await json('GET', '/api/sessions')) await json('DELETE', `/api/sessions/${x.id}`);

  await page.goto(base + '/phones');
  await page.locator('.phone-pick').nth(9).waitFor();
  await sleep(800);
  await shot('phones.png');
  await page.goto(base + '/settings');
  await page.locator('#library').waitFor();
  await sleep(800);
  await shot('settings.png');
  console.log('screenshots written to', out);
} finally {
  await browser?.close();
  server.kill();
  await sleep(500);
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* temp */ }
}
