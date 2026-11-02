import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
const dir = mkdtempSync(path.join(tmpdir(), 'mgo-h-'));
const port = 21000 + Math.floor(Math.random() * 500);
const srv = spawn('node', ['apps/api/dist/server.js'], { env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dir, LOG_LEVEL: 'fatal' }, stdio: 'ignore' });
const base = `http://127.0.0.1:${port}`;
for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
await fetch(base + '/api/setup/skip', { method: 'POST' });
const b = await chromium.launch({ args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
await p.goto(base + '/phones'); await p.locator('.phone-pick').first().waitFor(); await p.waitForTimeout(800);
console.log(JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('.phone-pick')].map((e) => [e.getAttribute('aria-label'), Math.round(e.getBoundingClientRect().height)]))));
await b.close(); srv.kill();
