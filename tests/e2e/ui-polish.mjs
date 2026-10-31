// UI polish: no top bar on a desktop screen (language switch in the sidebar, search in the library toolbar), a bigger phone in the
// player, the list view as an even table, renaming a game. Real API + Chromium. Run with `node --import tsx`.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const { makeJar } = await import(pathToFileURL(path.join(process.cwd(), 'apps/api/src/dev/testing.ts')).href);
const dir = mkdtempSync(path.join(tmpdir(), 'jgo-pol-'));
const port = 22700 + Math.floor(Math.random() * 90);
const base = `http://127.0.0.1:${port}`;
const server = spawn('node', ['apps/api/dist/server.js'], { env: { ...process.env, PORT: String(port), DATA_DIR: dir, HOST: '127.0.0.1', LOG_LEVEL: 'warn' }, stdio: ['ignore', 'inherit', 'inherit'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wait = async (fn, what) => { for (let i = 0; i < 200; i++) { try { if (await fn()) return; } catch {} await sleep(100); } throw Error(`timeout: ${what}`); };
const games = async () => (await fetch(base + '/api/games')).json();
let browser;
try {
  await wait(async () => (await fetch(base + '/api/health')).ok, 'server');
  await fetch(base + '/api/setup/skip', { method: 'POST' });
  const names = [['Alpha Racer', 'Gameloft'], ['Beta Blocks With A Really Long Title That Must Be Cut Instead Of Pushing The Columns', 'A Publisher With A Long Name Ltd'], ['Gamma', 'X']];
  for (const [n, v] of names) {
    const fd = new FormData();
    fd.append('jar', new Blob([makeJar(n, { vendor: v })]), `${n.slice(0, 8)}.jar`);
    assert.equal((await fetch(base + '/api/games', { method: 'POST', body: fd })).status, 201);
  }
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));

  // ---- no top bar; language in the sidebar; search in the toolbar ----
  await p.goto(base + '/');
  await p.locator('.game-card').first().waitFor();
  assert.equal(await p.locator('header.header').isVisible(), false, 'no top bar on a desktop screen');
  assert.equal(await p.locator('.content').evaluate((e) => getComputedStyle(e).paddingTop), '0px');
  assert.equal(await p.locator('.sidebar .seg.lang').count(), 1, 'the language switch lives in the sidebar');
  await p.getByTestId('search').fill('gamma');
  assert.deepEqual(await p.locator('.game-card h3').allInnerTexts(), ['Gamma']);
  await p.getByTestId('search').fill('');
  await p.locator('.sidebar .seg.lang').getByRole('radio', { name: 'RU' }).click();
  await p.getByRole('heading', { name: 'Библиотека' }).waitFor();
  await p.locator('.sidebar .seg.lang').getByRole('radio', { name: 'EN' }).click();
  await p.getByRole('heading', { name: 'Library' }).waitFor();
  for (const route of ['/settings', '/phones']) {
    await p.goto(base + route);
    await p.locator('h1').waitFor();
    assert.equal(await p.locator('header.header').isVisible(), false, `no top bar on ${route}`);
  }
  console.log('✔ no top bar; language switch in the sidebar; search in the library toolbar');

  // ---- the list is a table: every row has the same columns ----
  await p.goto(base + '/');
  await p.getByRole('radio', { name: 'List' }).click();
  await p.locator('.game-row').first().waitFor();
  const cols = await p.evaluate(() => [...document.querySelectorAll('.game-row')].map((r) => {
    const x = (sel, side) => Math.round(r.querySelector(sel).getBoundingClientRect()[side]);
    return { vendor: x('.c-vendor', 'left'), genre: x('.c-genre', 'left'), version: x('.c-version', 'left'), timeRight: x('.c-time', 'right'), actions: x('.actions', 'left'), width: Math.round(r.getBoundingClientRect().width), h: Math.round(r.getBoundingClientRect().height) };
  }));
  for (const k of ['vendor', 'genre', 'version', 'timeRight', 'actions', 'width']) assert.equal(new Set(cols.map((c) => c[k])).size, 1, `column "${k}" lines up in every row: ${JSON.stringify(cols.map((c) => c[k]))}`);
  const head = await p.evaluate(() => ({ vendor: Math.round(document.querySelector('.lib-table-head .c-vendor').getBoundingClientRect().left), genre: Math.round(document.querySelector('.lib-table-head .c-genre').getBoundingClientRect().left) }));
  assert.ok(Math.abs(head.vendor - cols[0].vendor) <= 2 && Math.abs(head.genre - cols[0].genre) <= 2, `the header sits over its columns ${JSON.stringify([head, cols[0]])}`);
  assert.ok(cols.every((c) => c.h < 80), 'rows stay compact even with a long title');
  console.log('✔ list view: one table, columns line up', JSON.stringify(cols[0]));
  await p.getByRole('radio', { name: 'Tiles' }).click();

  // ---- rename a game ----
  const target = (await games()).find((g) => g.name === 'Gamma');
  await p.locator('.game-card', { hasText: 'Gamma' }).getByRole('button', { name: 'Game settings' }).click();
  await p.getByTestId('title-input').fill('Gamma Gold Edition');
  await p.getByTestId('title-save').click();
  await wait(async () => (await games()).find((g) => g.id === target.id).name === 'Gamma Gold Edition', 'renamed');
  await p.locator('.game-card h3', { hasText: 'Gamma Gold Edition' }).waitFor();
  await p.reload();
  await p.locator('.game-card h3', { hasText: 'Gamma Gold Edition' }).waitFor();
  await p.locator('.game-card', { hasText: 'Gamma Gold' }).getByRole('button', { name: 'Game settings' }).click();
  await p.getByTestId('title-reset').click();
  await wait(async () => (await games()).find((g) => g.id === target.id).name === 'Gamma', 'back to the automatic title');
  console.log('✔ a game can be renamed and the title reset');

  // ---- the player: no top bar, a bigger phone ----
  await p.goto(base + '/play/' + target.id);
  await p.locator('.skin-box').waitFor();
  await sleep(500);
  const m = await p.evaluate(() => ({ box: document.querySelector('.skin-box').getBoundingClientRect().height, win: window.innerHeight, top: document.querySelector('.stage-card').getBoundingClientRect().top }));
  assert.ok(m.box >= m.win * 0.88, `the phone uses the freed space: ${Math.round(m.box)}px of a ${m.win}px window`);
  assert.ok(m.top < 24, `the card starts at the top of the window (${m.top}px)`);
  console.log(`✔ the player has no top bar: the phone is ${Math.round(m.box)}px tall in a ${m.win}px window`);

  // ---- a phone-sized screen keeps a slim bar with the menu ----
  const mob = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })).newPage();
  await mob.goto(base + '/');
  await mob.locator('.game-card').first().waitFor();
  assert.equal(await mob.locator('header.header').isVisible(), true);
  await mob.getByRole('button', { name: 'Open menu' }).click();
  await mob.locator('.sidebar .seg.lang').waitFor({ state: 'visible' });
  assert.ok(await mob.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no horizontal scroll');
  console.log('✔ on a phone screen the slim bar with the menu stays');

  assert.deepEqual(errors, []);
  console.log('ui polish e2e OK');
} finally {
  await browser?.close();
  server.kill();
  await sleep(500);
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* temp */ }
}
