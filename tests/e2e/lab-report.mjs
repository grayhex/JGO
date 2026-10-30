// Opens a lab report (lab-out/report.html by default) in Chromium and checks the manual-rating workflow.
// Usage: node tests/e2e/lab-report.mjs [path/to/report.html]
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const report = path.resolve(process.argv[2] ?? path.join(root, 'lab-out/report.html'));
const out = path.join(root, 'test-results');
mkdirSync(out, { recursive: true });
let failed = 0;
const ok = (n, c, x = '') => { console.log(`${c ? '✔' : '✖'} ${n}${x ? ' — ' + x : ''}`); if (!c) failed++; };

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(pathToFileURL(report).href);
  const cards = await page.locator('article.card').count();
  ok('report lists the games', cards > 0, `${cards} cards`);
  ok('every card has screenshots', (await page.locator('article.card:not(.st-fail) .shots img').count()) > 0);
  ok('screenshots are embedded (no external requests)', (await page.locator('.shots img').evaluateAll((l) => l.every((i) => i.src.startsWith('data:image/png')))));
  await page.screenshot({ path: path.join(out, 'lab-report.png') });

  // manual rating -> counters -> persisted -> exported
  const first = page.locator('article.card').first();
  await first.locator('input[value="works"]').check();
  await first.locator('.note').fill('played the first level');
  await page.locator('article.card').nth(1).locator('input[value="broken"]').check();
  ok('manual counters update', (await page.locator('#m-works').textContent()) === '1' && (await page.locator('#m-broken').textContent()) === '1');
  await page.reload();
  ok('ratings survive a reload (localStorage)', await first.locator('input[value="works"]').isChecked() && (await first.locator('.note').inputValue()) === 'played the first level');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export')]);
  const saved = JSON.parse(readFileSync(await dl.path(), 'utf8'));
  const rated = Object.values(saved.ratings).filter((r) => r.rating !== 'untested');
  ok('export writes ratings.json with both ratings', saved.version === 1 && rated.length === 2 && rated.some((r) => r.note === 'played the first level'), JSON.stringify(rated.map((r) => r.rating)));

  // filtering
  await page.fill('#q', 'zzzz-nothing');
  ok('search hides non-matching cards', (await page.locator('article.card:visible').count()) === 0);
  await page.fill('#q', '');
  ok('no script errors', errors.length === 0, errors.slice(0, 2).join(' | '));
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
