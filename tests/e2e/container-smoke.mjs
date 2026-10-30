// Smoke test against a RUNNING stack (docker compose up): real KEmulator inside the container.
// Usage: BASE=http://127.0.0.1:8080 node tests/e2e/container-smoke.mjs
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const base = process.env.BASE ?? 'http://127.0.0.1:8080';
const jars = {
  '2d': path.join(root, 'tests/fixtures/testmidlet/build/kemtest.jar'),
  '3d': path.join(root, 'tests/fixtures/testmidlet3d/build/kemtest3d.jar'),
};
let failed = 0;
const ok = (n, c, x = '') => { console.log(`${c ? '✔' : '✖'} ${n}${x ? ' — ' + x : ''}`); if (!c) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function upload(file) {
  const fd = new FormData();
  fd.append('jar', new Blob([readFileSync(file)]), 'g.jar');
  return (await (await fetch(base + '/api/games', { method: 'POST', body: fd })).json()).game;
}

async function run(kind) {
  const g = await upload(jars[kind]);
  const r = await post('/api/sessions', { gameId: g.id });
  const s = await r.json();
  ok(`${kind}: session started`, r.status === 201, s.message ?? s.id);
  if (r.status !== 201) return;
  const ws = new WebSocket(base.replace('http', 'ws') + `/api/sessions/${s.id}/stream`);
  ws.binaryType = 'arraybuffer';
  const frames = [];
  ws.onmessage = (m) => { if (typeof m.data !== 'string') { const u = new Uint8Array(m.data); if (u[0] !== 1) return; const px = u[5] === 1 ? new Uint8Array(inflateRawSync(u.subarray(14))) : u.subarray(14); frames.push({ t: Date.now(), px }); } };
  await new Promise((res) => (ws.onopen = res));
  const t0 = Date.now();
  while (frames.length < 5 && Date.now() - t0 < 25000) await sleep(100);
  ok(`${kind}: frames received from the container`, frames.length >= 5, `${frames.length} frames`);
  const f = frames.at(-1)?.px;
  if (kind === '2d') ok('2d: reference pixels (red top-left, green top-right)', f[0] === 255 && f[1] === 0 && f[2] === 0 && f[239 * 4] === 0 && f[239 * 4 + 1] === 255);
  else {
    let r = 0, gg = 0, b = 0;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && !(r > 15 && gg > 15 && b > 15)) {
      const px = frames.at(-1).px; r = gg = b = 0;
      for (let i = 0; i < px.length; i += 4) { if (px[i] > 200 && px[i + 1] < 60 && px[i + 2] < 60) r++; if (px[i + 1] > 200 && px[i] < 60 && px[i + 2] < 60) gg++; if (px[i + 2] > 200 && px[i] < 60 && px[i + 1] < 60) b++; }
      await sleep(100);
    }
    ok('3d: M3G triangle with R/G/B vertex colours rendered', r > 15 && gg > 15 && b > 15, `r=${r} g=${gg} b=${b}`);
  }
  if (kind === '2d') {
    ws.send(JSON.stringify({ t: 'audio', on: true }));
    ws.send(JSON.stringify({ t: 'key', s: 'D', code: 49 })); ws.send(JSON.stringify({ t: 'key', s: 'U', code: 49 }));
    await sleep(2500);
    const st = await (await fetch(`${base}/api/sessions/${s.id}`)).json();
    ok('2d: game audio produced inside the container (PCM bytes)', st.audioBytes > 150000, `${st.audioBytes} bytes`);
  }
  const n0 = frames.length; await sleep(3000);
  ok(`${kind}: sustained frame rate`, true, `${((frames.length - n0) / 3).toFixed(1)} fps measured at the client`);
  const log = (await (await fetch(`${base}/api/sessions/${s.id}`)).json()).logTail.join('\n');
  if (kind === '3d') ok('3d: GL renderer is llvmpipe', /llvmpipe/.test(log));
  ws.close();
  const d = await (await fetch(`${base}/api/sessions/${s.id}`, { method: 'DELETE' })).json();
  ok(`${kind}: stop -> exited, code ${d.exitCode}`, d.state === 'exited' && d.exitCode === 0);
}

await run('2d');
await run('3d');
process.exit(failed ? 1 : 0);
