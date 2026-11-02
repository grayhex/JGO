import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
const free = () => new Promise((res) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const { makeJar, put } = await import(new URL('../../apps/api/src/dev/testing.ts', import.meta.url).href);
const dir = mkdtempSync(path.join(tmpdir(), 'mgo-a11y-')); const lib = path.join(dir, 'games');
for (const n of ['Racer', 'Snake']) put(lib, `java/${n}.jar`, makeJar(n));
put(lib, 'ngage/Pandemonium.zip', Buffer.from('PK\x03\x04 c'));
mkdirSync(path.join(dir, 'app'));
const port = await free();
const srv = spawn('node', ['apps/api/dist/server.js'], { env: { ...process.env, PORT: String(port), DATA_DIR: path.join(dir, 'app'), HOST: '127.0.0.1', LOG_LEVEL: 'fatal', LIBRARY_ROOTS: lib }, stdio: 'ignore' });
const base = `http://127.0.0.1:${port}`;
for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
await fetch(base + '/api/setup/skip', { method: 'POST' });
await fetch(base + '/api/settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ libraryPaths: { j2me: path.join(lib, 'java'), ngage: path.join(lib, 'ngage'), symbian: null } }) });
await fetch(base + '/api/library/scan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
await new Promise((r) => setTimeout(r, 2500));
const games = await (await fetch(base + '/api/games')).json();
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const pages = ['/', '/phones', '/settings#system', '/settings#library', '/settings#mobygames', '/settings#phone', '/settings#sound', '/settings#symbian', '/settings#server', '/play/' + games[0].id, '/nonexistent/page'];
for (const [name, vp] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport: vp, hasTouch: name === 'mobile', isMobile: name === 'mobile' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push('pageerror ' + e.message)); p.on('response', (r) => { if (r.status() >= 400) errs.push(`HTTP ${r.status()} ${r.url().replace(base, '')}`); }); p.on('console', (m) => { if (m.type() === 'error') errs.push('console ' + m.text().slice(0, 160)); });
  for (const u of pages) {
    errs.length = 0;
    await p.goto(base + u, { waitUntil: 'networkidle' }).catch(() => undefined);
    if (u.includes('#')) await p.reload({ waitUntil: 'networkidle' }).catch(() => undefined);
    await p.waitForTimeout(700);
    const r = await p.evaluate(() => {
      const name = (el) => (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim() || el.getAttribute('aria-labelledby');
      const noName = [...document.querySelectorAll('button, a[href], [role=button], [role=tab], select, input:not([type=hidden]):not([type=file])')].filter((e) => { const labelled = e.labels?.length || e.closest('label') || name(e); return !labelled; }).map((e) => e.outerHTML.slice(0, 110));
      const noAlt = [...document.querySelectorAll('img')].filter((i) => !i.hasAttribute('alt')).map((i) => i.src.slice(-40));
      const tiny = [...document.querySelectorAll('button, a[href]')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 24 || r.width < 24) && getComputedStyle(e).visibility !== 'hidden'; }).length;
      return { overflow: document.documentElement.scrollWidth - innerWidth, h1: document.querySelectorAll('h1').length, noName: noName.slice(0, 4), noAlt: noAlt.slice(0, 3), tiny, title: document.title };
    });
    const bad = r.overflow > 1 || r.noName.length || r.noAlt.length || errs.length;
    console.log(bad ? '✖' : '✔', name, u, JSON.stringify({ ...r, errs: errs.slice(0, 2) }).slice(0, 420));
  }
  await ctx.close();
}
await browser.close(); srv.kill('SIGTERM');
