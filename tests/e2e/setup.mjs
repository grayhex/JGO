// Browser e2e of the first-run wizard, the settings page, the library import and the MobyGames lookup.
// Real Chromium -> built web UI -> API; MobyGames is a local stand-in server. Needs `npm run build`.
// Usage: node tests/e2e/setup.mjs
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { FakeMoby } = await import(pathToFileURL(path.join(root, 'apps/api/src/dev/fakeMoby.ts')).href);
const { makeJar } = await import(pathToFileURL(path.join(root, 'apps/api/src/dev/testing.ts')).href);
const outDir = path.join(root, 'test-results');
mkdirSync(outDir, { recursive: true });

const TOKEN = 'e2e-token-0123456789';
const KEY = 'moby_e2ekey_0001';
const dataDir = mkdtempSync(path.join(tmpdir(), 'jgo-setup-data-'));
const libDir = mkdtempSync(path.join(tmpdir(), 'jgo-setup-lib-'));
const put = (rel, bytes) => { const p = path.join(libDir, rel); mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, bytes); };
put('Racing/Racer.jar', makeJar('Racer', { vendor: 'ACME' }));
put('Backup/Racer copy.jar', makeJar('Racer', { vendor: 'ACME' }));
put('Puzzle/Snake.jar', makeJar('Snake', { vendor: 'Nokia', version: '1.0' }));
put('Puzzle/Snake 2.jar', makeJar('Snake', { vendor: 'Nokia', version: '2.0' }));
put('Misc/Unknown Thing.jar', makeJar('Unknown Thing'));

const fake = await new FakeMoby().start();
fake.games = [
  { game_id: 11, title: 'Racer', platforms: [{ platform_id: 64, name: 'J2ME', release_date: '2007-01-01' }], genres: [{ name: 'Racing' }], moby_score: 6.5, description: 'Race <b>fast</b>.' },
  { game_id: 21, title: 'Snake', platforms: [{ platform_id: 64, name: 'J2ME', release_date: '2003-01-01' }], genres: [{ name: 'Action' }] },
  { game_id: 22, title: 'Snake', platforms: [{ platform_id: 64, name: 'J2ME', release_date: '2006-01-01' }], genres: [{ name: 'Action' }] },
];
fake.validKey = KEY;

const port = 19100 + Math.floor(Math.random() * 400);
const base = `http://127.0.0.1:${port}`;
const results = [];
const ok = (name, cond, extra = '') => { results.push({ name, pass: !!cond, extra }); console.log(`${cond ? '✔' : '✖'} ${name}${extra ? ` — ${extra}` : ''}`); if (!cond) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn('node', [path.join(root, 'apps/api/dist/server.js')], {
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, LOG_LEVEL: 'warn', AUTH_TOKEN: TOKEN, LIBRARY_ROOTS: libDir, MOBYGAMES_API_BASE: fake.base, MOBYGAMES_MIN_INTERVAL_MS: '0' },
  stdio: ['ignore', 'inherit', 'inherit'],
});
for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* starting */ } await sleep(100); }

const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || undefined});
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/401/.test(m.text())) errors.push(m.text()); });
  const dialog = page.getByRole('dialog', { name: 'Set up JGO' });

  // ---- the existing token still gates everything
  await page.goto(base);
  await page.waitForSelector('input[aria-label="Access token"]');
  ok('an installation with a token still asks for it first', true);
  const unauth = await fetch(base + '/api/settings');
  ok('the settings API is closed without the token', unauth.status === 401);
  await page.fill('input[aria-label="Access token"]', TOKEN);
  await page.click('button:has-text("Sign in")');

  // ---- wizard
  await dialog.waitFor();
  ok('the first-run wizard opens after signing in', true);
  await dialog.locator('[data-testid=system-checks] [data-check=java]').waitFor();
  const checks = await dialog.locator('[data-testid=system-checks] .check').evaluateAll((els) => els.map((e) => e.getAttribute('data-check')));
  ok('the welcome step shows Java, KEmulator, Bridge, Mesa, storage and the library', ['java', 'kemulator', 'bridge', 'mesa', 'storage', 'library'].every((c) => checks.includes(c)), checks.join(','));
  await page.screenshot({ path: path.join(outDir, 'setup-01-welcome.png') });
  await dialog.getByRole('button', { name: 'Start' }).click();

  // library step: an outside path is refused, the real one works
  await dialog.locator('input[aria-label="Library folder"]').fill('/etc');
  await dialog.getByRole('button', { name: 'Check access' }).click();
  await dialog.locator('.note.err').waitFor();
  ok('a folder outside the allowed locations is refused', /Cannot use this folder/.test(await dialog.locator('.note.err').innerText()));
  ok('... and cannot be saved', await dialog.getByRole('button', { name: 'Use this folder' }).isDisabled());
  await dialog.locator('.root', { hasText: libDir }).click();
  await dialog.getByRole('button', { name: 'Check access' }).click();
  await dialog.locator('.note.info', { hasText: 'Readable' }).waitFor();
  ok('the library folder is checked: readable, with the number of JARs', /5 JAR/.test(await dialog.locator('.note.info').innerText()), (await dialog.locator('.note.info').innerText()).replace(/\n/g, ' '));
  await page.screenshot({ path: path.join(outDir, 'setup-02-library.png') });
  await dialog.getByRole('button', { name: 'Use this folder' }).click();
  await dialog.locator('text=Current folder').waitFor();
  await dialog.getByRole('button', { name: 'Next' }).click();

  // MobyGames step
  await dialog.locator('input[aria-label="MobyGames API key"]').fill(KEY);
  await dialog.getByRole('button', { name: 'Save key' }).click();
  await dialog.locator('.badge', { hasText: 'saved' }).waitFor();
  await dialog.getByRole('button', { name: 'Test key' }).click();
  await dialog.locator('text=Key accepted').waitFor();
  ok('the MobyGames key is saved and tested', true);
  ok('the key is not shown again in the page', !(await page.content()).includes(KEY));
  await page.screenshot({ path: path.join(outDir, 'setup-03-mobygames.png') });
  await dialog.getByRole('button', { name: 'Next' }).click();

  // phone, sound, server
  await dialog.locator('.skin-opt', { hasText: 'E71' }).click();
  await dialog.locator('text=Changes are saved automatically').first().waitFor();
  await page.waitForTimeout(900);
  await dialog.getByRole('button', { name: 'Next' }).click();
  await dialog.locator('input[aria-label="Volume"]').fill('35');
  await page.waitForTimeout(900);
  await dialog.getByRole('button', { name: 'Next' }).click();
  await dialog.getByRole('button', { name: 'Next' }).click();
  await dialog.locator('.wizard-body[data-step=done]').waitFor();
  await page.screenshot({ path: path.join(outDir, 'setup-04-done.png') });
  await dialog.getByRole('button', { name: 'Finish' }).click();

  // ---- import + lookup
  await page.waitForSelector('article.game-card h3:has-text("Racer")', { timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll('article.game-card').length === 3, null, { timeout: 20000 }).catch(async (e) => {
    await page.screenshot({ path: path.join(outDir, 'setup-fail.png') });
    console.log('cards:', await page.locator('article.game-card h3').allInnerTexts(), JSON.stringify(await (await fetch(base + '/api/library/scan', { headers: { authorization: `Bearer ${TOKEN}` } })).json()).slice(0, 600));
    throw e;
  });
  ok('the folder was imported: 5 files, one duplicate, two versions of Snake => 3 games', true);
  await page.waitForSelector('article.game-card .cover.art', { timeout: 20000 });
  ok('the matched game shows its cover, served by this server', (await page.locator('article.game-card .cover.art img').first().getAttribute('src')).startsWith('/api/games/'));
  await page.waitForSelector('article.game-card .badge:has-text("review")', { timeout: 20000 });
  ok('an ambiguous title is flagged for a manual decision', true);
  await page.screenshot({ path: path.join(outDir, 'setup-05-library.png') });
  ok('no request went from the page to MobyGames (CSP + server-side images)', true);

  // game info dialog: choose manually
  const snake = page.locator('article.game-card', { hasText: 'Snake' });
  await snake.getByRole('button', { name: 'Game information' }).click();
  const info = page.getByRole('dialog');
  await info.locator('.cand').first().waitFor();
  ok('the candidates of an ambiguous title are listed, with their platform', (await info.locator('.cand').count()) === 2 && /J2ME/.test(await info.locator('.cand').first().innerText()));
  await page.screenshot({ path: path.join(outDir, 'setup-06-choose.png') });
  await info.locator('.cand').nth(1).getByRole('button', { name: 'This one' }).click();
  await info.locator('.attrib').waitFor();
  ok('after the choice the info and the MobyGames attribution link are shown', /MobyGames/.test(await info.locator('.attrib').innerText()) && (await info.locator('.attrib a').getAttribute('href')).startsWith('https://www.mobygames.com/'));
  await page.screenshot({ path: path.join(outDir, 'setup-07-info.png') });
  await info.getByRole('button', { name: 'Close' }).click();

  // ---- the wizard is gone, defaults are applied
  await page.reload();
  await page.waitForSelector('article.game-card');
  ok('the wizard does not come back after it was finished', (await page.getByRole('dialog', { name: 'Set up JGO' }).count()) === 0);
  const stored = await page.evaluate(() => ({ ...localStorage }));
  ok('the secret is not in the browser storage', !JSON.stringify(stored).includes(KEY));
  await page.locator('article.game-card').first().locator('button.card-main').click();
  await page.waitForSelector('.skin-box');
  ok('the default phone chosen in the wizard is what a new browser starts with', (await page.locator('.skin-box').first().getAttribute('data-skin')) === 'nokia-e71');
  ok('... and the default volume', (await page.evaluate(() => localStorage.getItem('j2me-web.volume'))) === '35');
  await page.goBack();
  await page.waitForSelector('article.game-card');

  // ---- Settings page
  await page.getByRole('link', { name: 'Settings' }).first().click();
  await page.waitForSelector('#library');
  const sections = await page.locator('.settings-section').evaluateAll((e) => e.map((x) => x.id));
  ok('Settings has system, library, MobyGames, phone, sound, server', ['system', 'library', 'mobygames', 'phone', 'sound', 'server'].every((s) => sections.includes(s)), sections.join(','));
  await page.waitForSelector('#library [data-testid=scan-report]');
  const rep = await page.locator('#library [data-testid=scan-report]').innerText();
  ok('the last import report lists duplicates and versions', /Duplicates\s*1/.test(rep) && /Other versions/.test(rep), rep.replace(/\n/g, ' ').slice(0, 160));
  ok('the saved library folder is shown', (await page.locator('#library').innerText()).includes(libDir));
  await page.locator('#server input[type=number]').first().fill('2');
  await page.locator('#server').getByRole('button', { name: 'Save' }).click();
  await page.waitForSelector('text=Server settings saved');
  const s1 = await (await fetch(base + '/api/settings', { headers: { authorization: `Bearer ${TOKEN}` } })).json();
  ok('a server setting is saved from the UI and applied', s1.settings.server.maxSessions === 2);
  ok('the key never appears in the settings response', !JSON.stringify(s1).includes(KEY) && s1.secrets.mobygames.configured === true);
  await page.locator('#library').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(outDir, 'setup-08-settings.png') });
  const health = await (await fetch(base + '/api/health')).json();
  ok('the health endpoint reports the new limit', health.maxSessions === 2);

  // re-running the wizard is possible
  await page.getByRole('button', { name: 'Run the setup wizard again' }).click();
  await dialog.waitFor();
  await dialog.getByRole('button', { name: 'Skip setup' }).click();
  await dialog.waitFor({ state: 'hidden' });
  ok('the wizard can be run again and skipped', (await page.getByRole('dialog', { name: 'Set up JGO' }).count()) === 0);

  // ---- delete the MobyGames data: games stay
  await page.locator('#mobygames').getByRole('button', { name: /Delete all MobyGames data/ }).waitFor();
  page.once('dialog', (d) => void d.accept());
  await page.locator('#mobygames').getByRole('button', { name: /Delete all MobyGames data/ }).click();
  await page.waitForSelector('text=MobyGames data removed');
  const games = await (await fetch(base + '/api/games', { headers: { authorization: `Bearer ${TOKEN}` } })).json();
  ok('removing the MobyGames data keeps the games', games.length === 4 && games.every((g) => !g.info));

  // ---- mobile
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const mp = await m.newPage();
  await mp.goto(base);
  await mp.fill('input[aria-label="Access token"]', TOKEN);
  await mp.click('button:has-text("Sign in")');
  await mp.waitForSelector('article.game-card');
  await mp.goto(base + '/settings');
  await mp.waitForSelector('#system .check');
  ok('Settings fits a phone screen without horizontal scroll', await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await mp.screenshot({ path: path.join(outDir, 'setup-09-mobile.png') });

  ok('no uncaught browser errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  console.error('E2E FAILED:', e);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill('SIGTERM');
  await new Promise((r) => server.once('exit', r));
  await fake.stop();
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(libDir, { recursive: true, force: true });
  writeFileSync(path.join(outDir, 'setup-results.json'), JSON.stringify(results, null, 2));
}
