// Drives a RUNNING native JGO (systemd, token auth) from outside: 2D picture, M3G picture on llvmpipe, game audio, RMS.
// Usage: BASE=http://IP:8080 TOKEN=... node tests/lxc/smoke.mjs <auth|2d|3d|audio|launches> [fixture.jar]
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const base = process.env.BASE ?? 'http://127.0.0.1:8080';
const token = process.env.TOKEN ?? '';
const fixtures = {
  kemtest: path.join(root, 'tests/fixtures/testmidlet/build/kemtest.jar'),
  kemtest3d: path.join(root, 'tests/fixtures/testmidlet3d/build/kemtest3d.jar'),
};
let failed = 0;
const ok = (n, c, x = '') => {
  console.log(`${c ? '✔' : '✖'} ${n}${x ? ' — ' + x : ''}`);
  if (!c) failed++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const headers = (extra = {}) => ({ ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra });
const api = (p, init = {}) => fetch(base + p, { ...init, headers: headers(init.headers) });
const post = (p, body) => api(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function upload(name) {
  const fd = new FormData();
  fd.append('jar', new Blob([readFileSync(fixtures[name])]), 'g.jar');
  const r = await api('/api/games', { method: 'POST', body: fd });
  const j = await r.json();
  if (!j.game) throw new Error(`upload failed: ${r.status} ${JSON.stringify(j)}`);
  return j.game;
}

async function start(game) {
  const r = await post('/api/sessions', { gameId: game.id });
  const s = await r.json();
  if (r.status !== 201) throw new Error(`session: ${r.status} ${JSON.stringify(s)}`);
  const ws = new WebSocket(base.replace('http', 'ws') + `/api/sessions/${s.id}/stream`, { headers: headers() });
  ws.binaryType = 'arraybuffer';
  const frames = [];
  ws.on('message', (data, isBinary) => {
    if (!isBinary) return;
    const u = new Uint8Array(data);
    if (u[0] !== 1) return;
    frames.push(u[5] === 1 ? new Uint8Array(inflateRawSync(u.subarray(14))) : u.subarray(14));
  });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  return { id: s.id, ws, frames };
}

async function stop(s) {
  s.ws.close();
  const d = await (await api(`/api/sessions/${s.id}`, { method: 'DELETE' })).json();
  return d;
}

async function waitFrames(s, n, ms = 30000) {
  const t0 = Date.now();
  while (s.frames.length < n && Date.now() - t0 < ms) await sleep(100);
  return s.frames.length;
}

const cmd = process.argv[2];
if (cmd === 'auth') {
  const noTok = await fetch(base + '/api/games');
  ok('API without a token is rejected', noTok.status === 401, `HTTP ${noTok.status}`);
  const bad = await fetch(base + '/api/games', { headers: { authorization: 'Bearer wrong-wrong-wrong-wrong' } });
  ok('API with a wrong token is rejected', bad.status === 401, `HTTP ${bad.status}`);
  const good = await api('/api/games');
  ok('API with the token works', good.status === 200, `HTTP ${good.status}`);
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
  ok('web login with the token sets a session cookie', login.status === 200 && /j2me_auth=/.test(login.headers.get('set-cookie') ?? ''));
  const html = await fetch(base + '/');
  ok('web UI is served', html.status === 200 && /<div id="root">/.test(await html.text()));
  const h = await (await fetch(base + '/api/health')).json();
  ok('health is public and says ok, without leaking the data dir', h.ok === true && h.dataDir === '' && h.auth === 'token', `version ${h.version}`);
} else if (cmd === '2d' || cmd === 'audio') {
  const g = await upload('kemtest');
  const s = await start(g);
  ok('2d: frames from the native service', (await waitFrames(s, 5)) >= 5, `${s.frames.length} frames`);
  const f = s.frames.at(-1);
  ok('2d: reference pixels (red top-left, green top-right)', f[0] === 255 && f[1] === 0 && f[2] === 0 && f[239 * 4] === 0 && f[239 * 4 + 1] === 255);
  if (cmd === 'audio') {
    s.ws.send(JSON.stringify({ t: 'audio', on: true }));
    s.ws.send(JSON.stringify({ t: 'key', s: 'D', code: 49 }));
    s.ws.send(JSON.stringify({ t: 'key', s: 'U', code: 49 }));
    await sleep(2500);
    const st = await (await api(`/api/sessions/${s.id}`)).json();
    ok('audio: PCM from the game reaches the server', st.audioBytes > 150000, `${st.audioBytes} bytes`);
  }
  const d = await stop(s);
  ok('2d: clean stop', d.state === 'exited' && d.exitCode === 0, `${d.state} ${d.exitCode}`);
} else if (cmd === '3d') {
  const g = await upload('kemtest3d');
  const s = await start(g);
  ok('3d: frames', (await waitFrames(s, 5)) >= 5, `${s.frames.length} frames`);
  let r = 0, gg = 0, b = 0;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline && !(r > 15 && gg > 15 && b > 15)) {
    const px = s.frames.at(-1);
    r = gg = b = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i] > 200 && px[i + 1] < 60 && px[i + 2] < 60) r++;
      if (px[i + 1] > 200 && px[i] < 60 && px[i + 2] < 60) gg++;
      if (px[i + 2] > 200 && px[i] < 60 && px[i + 1] < 60) b++;
    }
    await sleep(150);
  }
  ok('3d: M3G triangle with R/G/B vertex colours', r > 15 && gg > 15 && b > 15, `r=${r} g=${gg} b=${b}`);
  const log = (await (await api(`/api/sessions/${s.id}`)).json()).logTail.join('\n');
  ok('3d: rendered by Mesa llvmpipe (software GL)', /llvmpipe/.test(log));
  const d = await stop(s);
  ok('3d: clean stop', d.state === 'exited' && d.exitCode === 0, `${d.state} ${d.exitCode}`);
} else if (cmd === 'hold') {
  const g = await upload('kemtest');
  const s = await start(g);
  await waitFrames(s, 5);
  console.log(`HOLD ${s.id}`);
  await sleep(Number(process.argv[3] ?? 30) * 1000);
  await stop(s);
} else if (cmd === 'launches') {
  const g = await upload('kemtest');
  const s = await start(g);
  let n = 0;
  const t0 = Date.now();
  while (!n && Date.now() - t0 < 30000) {
    const m = /LAUNCHES (\d+)/.exec((await (await api(`/api/sessions/${s.id}`)).json()).logTail.join('\n'));
    n = m ? Number(m[1]) : 0;
    if (!n) await sleep(200);
  }
  await stop(s);
  console.log(`LAUNCHES=${n}`);
  if (!n) failed++;
} else {
  console.error('usage: smoke.mjs <auth|2d|3d|audio|launches>');
  process.exit(2);
}
process.exit(failed ? 1 : 0);
