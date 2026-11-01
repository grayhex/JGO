#!/usr/bin/env node
// FAKE EKA2L1 for tests. It speaks the part of EKA2L1's /v1 control API that was read from the source code
// (src/emu/control/src/{service,native}.cpp, October 2026) and draws a test picture. It proves MGO's side of the integration
// (the adapter, the agent, the WebSocket stream); it says NOTHING about what the real emulator does with a real game.
import http from 'node:http';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { encodePng } from './png.mjs';

const portArg = process.argv.indexOf('--debug-control-port');
const PORT = Number(process.argv[portArg + 1]);
const data = path.join(process.env.XDG_DATA_HOME ?? '/tmp', 'EKA2L1');
mkdirSync(path.join(data, 'drives', 'c'), { recursive: true });
mkdirSync(path.join(data, 'drives', 'e'), { recursive: true });
mkdirSync(path.join(data, 'drives', 'z'), { recursive: true });
mkdirSync(path.join(data, 'roms'), { recursive: true });
const devicesFile = path.join(data, 'devices.json');
const appsFile = path.join(data, 'drives', 'e', 'apps.json');
const inputLog = process.env.FAKE_INPUT_LOG ?? '';
const W = 176, H = 208;
const KEYS = new Set(['lsk', 'rsk', 'ok', 'up', 'down', 'left', 'right', 'clear', 'star', 'hash', 'call', 'end', ...'0123456789'.split('')]);

const readJson = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
let devices = readJson(devicesFile, []);
let current = devices.length ? devices[0].code : null;
let apps = readJson(appsFile, []);
let session = { state: 'none', screenVisible: false };
let frames = 0, paused = false, held = new Set(), pointers = new Map();
const jobs = new Map();
const json = (res, status, body, headers = {}) => { const s = JSON.stringify(body) + '\n'; res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(s); };
const error = (res, status, code, message) => json(res, status, { error: { code, message } });
setInterval(() => { if (session.state === 'running' && !paused) frames++; }, 50);

function picture() {
  const rgba = Buffer.alloc(W * H * 4);
  const yellow = held.has('5') || held.has('ok');
  const x0 = (frames * 3) % (W - 20), y0 = 80;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4;
    rgba[o] = x; rgba[o + 1] = y; rgba[o + 2] = 120; rgba[o + 3] = 255;
    if (x >= x0 && x < x0 + 20 && y >= y0 && y < y0 + 20) { rgba[o] = 255; rgba[o + 1] = yellow ? 255 : 0; rgba[o + 2] = 0; }
  }
  for (const [, p] of pointers) for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const x = p.x + dx, y = p.y + dy; if (x >= 0 && y >= 0 && x < W && y < H) { const o = (y * W + x) * 4; rgba[o] = 255; rgba[o + 1] = 255; rgba[o + 2] = 255; } }
  return encodePng(W, H, rgba, frames % 5);
}

const server = http.createServer(async (req, res) => {
  if (req.headers.origin) return error(res, 403, 'forbidden', 'browser origins are not accepted');
  const url = new URL(req.url, 'http://x');
  const p = url.pathname.split('/').filter(Boolean);
  let body = {};
  if (req.method !== 'GET') { const chunks = []; for await (const c of req) chunks.push(c); try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { return error(res, 400, 'bad_request', 'body must be a JSON object'); } }
  const is = (...x) => p.length === x.length && x.every((s, i) => s === '*' || s === p[i]);
  if (p[0] !== 'v1') return error(res, 404, 'not_found', 'unknown API version');
  if (is('v1') && req.method === 'GET') return json(res, 200, { api: 1, endpoints: [] });
  if (is('v1', 'capabilities')) return json(res, 200, { platform: 'fake', firmwareFormats: process.env.FAKE_VPL_SUPPORTED === '0' ? ['rom','rpkg','archive'] : ['rom','rpkg','archive','vpl'], hostScreenshot: false, accelerometer: false, touchSpaces: ['guest', 'normalized'] });
  if (is('v1', 'status')) return json(res, 200, { api: 1, started: true, busy: false, device: devices.find((d) => d.code === current) ? { ...devices.find((d) => d.code === current), current: true } : null, session, frames, screen: session.state === 'running' ? { width: W, height: H, mode: 0, current: 0, modes: [0] } : null });
  if (is('v1', 'devices') && req.method === 'GET') return json(res, 200, { devices: devices.map((d, index) => ({ index, ...d, name: d.model, current: d.code === current })), current: devices.find((d) => d.code === current) ?? null });
  if (is('v1', 'devices') && req.method === 'POST') {
    if (!body.rom && !body.archive && !body.vpl) return error(res, 400, 'bad_request', 'rom is required');
    for (const f of [body.rom, body.rpkg, body.archive, body.vpl].filter(Boolean)) if (!existsSync(f)) return error(res, 404, 'not_found', 'firmware file not found');
    // Deliberately tiny FAKE fixture parser, not an implementation of Nokia VPL/FPSX.
    // The production path calls EKA2L1's real desktop install_firmware routine.
    if (body.vpl) {
      const xml = readFileSync(body.vpl, 'utf8');
      const variants = [...xml.matchAll(/<Variant>([\s\S]*?)<\/Variant>/g)].map(m => m[1]);
      if (!variants.length) return error(res, 422, 'vpl_invalid', 'invalid VPL manifest');
      if (variants.length > 1 && body.variant === undefined) return error(res, 409, 'variant_required', 'choose a VPL variant');
      const selected = variants[body.variant ?? 0];
      if (!selected) return error(res, 400, 'bad_request', 'variant is outside the VPL variant list');
      for (const [,name] of selected.matchAll(/<Name>(.*?)<\/Name>/g)) {
        if (/[\\/]/.test(name) || name.includes('..') || !existsSync(path.join(path.dirname(body.vpl), name))) return error(res, 422, 'firmware_file_missing', 'a referenced FPSX image is missing');
      }
    }
    const id = Math.random().toString(16).slice(2, 10);
    jobs.set(id, { id, kind: 'install_device', state: 'running', progress: 0 });
    setTimeout(() => {
      // the device code comes from the firmware file name (RM-84.rom, RH-29.rom ...) so tests can install several different devices
      const code = /([A-Z]{2,3}-\d+)/.exec(path.basename(body.vpl ?? body.archive ?? body.rom))?.[1] ?? 'RM-84';
      if (!devices.find((d) => d.code === code)) devices.push({ code, manufacturer: 'Nokia', model: `Fake ${code}` });
      writeFileSync(devicesFile, JSON.stringify(devices));
      writeFileSync(path.join(data, 'roms', `${code}.rom`), 'fake rom');
      writeFileSync(path.join(data, 'drives', 'z', 'system.txt'), 'fake z drive');
      current = current ?? 'RM-84';
      jobs.set(id, { id, kind: 'install_device', state: 'succeeded', progress: 1 });
    }, 300);
    return json(res, url.searchParams.get('async') === '1' ? 202 : 200, jobs.get(id));
  }
  if (is('v1', 'jobs', '*')) { const j = jobs.get(p[2]); return j ? json(res, 200, j) : error(res, 404, 'not_found', 'no such job'); }
  if (is('v1', 'devices', '*', 'boot') && req.method === 'POST') { const d = devices.find((x) => x.code.toLowerCase() === p[2].toLowerCase()); if (!d) return error(res, 404, 'not_found', 'no such device'); current = d.code; return json(res, 200, { devices, current: d }); }
  if (is('v1', 'devices', '*') && req.method === 'DELETE') { devices = devices.filter((d) => d.code.toLowerCase() !== p[2].toLowerCase()); writeFileSync(devicesFile, JSON.stringify(devices)); if (!devices.find((d) => d.code === current)) current = devices[0]?.code ?? null; return json(res, 200, { devices, current: null }); }
  if (is('v1', 'apps') && req.method === 'GET') return json(res, 200, { apps });
  if (is('v1', 'apps') && req.method === 'POST') {
    if (!current) return error(res, 409, 'no_device', 'no device is booted');
    const paths = body.paths ?? [body.path];
    const added = [];
    for (const f of paths) {
      if (!f || !existsSync(f)) return error(res, 404, 'not_found', 'install path not found');
      const ext = path.extname(f).toLowerCase();
      const type = body.type ?? (ext === '.sis' || ext === '.sisx' ? 'sis' : ext === '.n-gage' ? 'ngage2' : 'ngage');
      if (!['sis', 'ngage', 'ngage2'].includes(type)) return error(res, 400, 'bad_request', 'unknown install type');
      if (type === 'ngage' && !(statSync(f).isDirectory() && existsSync(path.join(f, 'system', 'apps')))) return error(res, 500, 'install_failed', 'app installation failed');
      const uid = '0x2000' + (0xa000 + apps.length + 1).toString(16).toUpperCase();
      // test hook: how this FAKE package behaves is written in its bytes ("FAKE:launch_fail", "FAKE:crash=KERN-EXEC/3", "FAKE:exit", "FAKE:no_screen", "FAKE:shot_error", "FAKE:fonterror")
      let text = ''; try { text = statSync(f).isFile() ? readFileSync(f, 'utf8').slice(0, 4096) : ''; } catch { /* a card directory */ }
      const marks = [...text.matchAll(/FAKE:([A-Za-z_]+)(?:=(\S+))?/g)];
      const app = { uid, name: path.basename(f).replace(/\.[^.]+$/, ''), system: false, ...(marks.length ? { modes: marks.map((m) => m[1]), arg: marks.find((m) => m[2])?.[2] ?? null } : {}) };
      apps.push(app); added.push(app);
    }
    writeFileSync(appsFile, JSON.stringify(apps));
    return json(res, 200, { results: paths.map((f) => ({ path: f, type: body.type ?? 'sis', ok: true })), added });
  }
  if (p[0] === 'v1' && p[1] === 'apps' && p[3] === 'launch' && req.method === 'POST') {
    if (!apps.find((a) => a.uid.toLowerCase() === p[2].toLowerCase())) return error(res, 404, 'not_found', 'app is not installed');
    const app = apps.find((a) => a.uid.toLowerCase() === p[2].toLowerCase());
    const logFile = path.join(data, 'EKA2L1.log');
    appendFileSync(logFile, `I /src/src/emu/services/src/applist/applist.cpp:510 [Service.Applist]: Loading app registries\n`);
    if (app.modes?.includes('fonterror')) appendFileSync(logFile, `E /src/src/emu/services/src/fbs/adapter/freetype_font_adapter.cpp:137 [Service.Fbs]: FreeType failed to query face count from memory, error: unknown file format\n`);
    if (app.modes?.includes('launch_fail')) { session = { state: 'launch_failed', uid: p[2], screenVisible: false }; appendFileSync(logFile, `E /src/src/emu/kernel/src/process.cpp:1 [Kernel]: unable to spawn process for ${app.name}\n`); return error(res, 422, 'launch_failed', 'app launch failed'); }
    session = { state: 'launching', uid: p[2], screenVisible: false };
    const finishLaunch = () => {
      // E2E can hold startup until a viewer has connected in `starting` state.
      if (process.env.FAKE_LAUNCH_GATE && !existsSync(process.env.FAKE_LAUNCH_GATE)) { setTimeout(finishLaunch, 25); return; }
      if (app.modes?.includes('crash')) { session = { state: 'crashed', uid: p[2], name: app.name, screenVisible: false, lastExit: { uid: p[2], fatal: app.arg ?? 'KERN-EXEC/3' } }; appendFileSync(logFile, `E /src/src/emu/kernel/src/thread.cpp:1 [Kernel]: panic ${app.arg ?? 'KERN-EXEC/3'}\n`); return; }
      if (app.modes?.includes('exit')) { session = { state: 'exited', uid: p[2], name: app.name, screenVisible: false, lastExit: { uid: p[2], fatal: null } }; return; }
      session = { state: 'running', uid: p[2], name: app.name, screenVisible: !app.modes?.includes('no_screen') };
    };
    setTimeout(finishLaunch, 200);
    return json(res, 200, session);
  }
  if (is('v1', 'session') && req.method === 'GET') return json(res, 200, session);
  if (is('v1', 'session') && req.method === 'DELETE') { held.clear(); pointers.clear(); session = { state: 'closed', screenVisible: false }; return json(res, 200, session); }
  if (is('v1', 'screenshot')) {
    const cur = apps.find((a) => a.uid.toLowerCase() === String(session.uid ?? '').toLowerCase());
    if (cur?.modes?.includes('shot_error')) return error(res, 500, 'internal', 'cannot read the guest surface');
    if (!(session.state === 'running' && session.screenVisible)) return error(res, 409, 'no_screen', 'no screen');
    const png = picture();
    res.writeHead(200, { 'content-type': 'image/png', 'content-length': png.length, 'x-frame-count': String(frames) });
    return res.end(png);
  }
  if (is('v1', 'input', 'key')) {
    const k = String(body.key ?? '');
    if (!KEYS.has(k)) return error(res, 400, 'bad_request', `unknown key ${k}`);
    if (session.state !== 'running') return error(res, 409, 'no_session', 'no running session');
    if (body.action === 'down') held.add(k); else if (body.action === 'up') held.delete(k);
    if (inputLog) appendFileSync(inputLog, `key ${k} ${body.action}\n`);
    return json(res, 200, { heldKeys: [...held] });
  }
  if (is('v1', 'input', 'touch')) {
    if (session.state !== 'running') return error(res, 409, 'no_session', 'no running session');
    if (typeof body.x !== 'number' || typeof body.y !== 'number') return error(res, 400, 'bad_request', 'x and y are required');
    if (body.action === 'up') pointers.delete(body.id ?? 0); else pointers.set(body.id ?? 0, { x: Math.round(body.x), y: Math.round(body.y) });
    if (inputLog) appendFileSync(inputLog, `touch ${body.action} ${body.x},${body.y} id=${body.id ?? 0}\n`);
    return json(res, 200, {});
  }
  if (is('v1', 'input', 'release')) { held.clear(); pointers.clear(); if (inputLog) appendFileSync(inputLog, 'release\n'); return json(res, 200, {}); }
  if (is('v1', 'emulator', 'pause')) { paused = true; return json(res, 200, { paused }); }
  if (is('v1', 'emulator', 'resume')) { paused = false; return json(res, 200, { paused }); }
  if (is('v1', 'files') || is('v1', 'config') || is('v1', 'card')) return json(res, 200, { reached: 'the fake: this route must have been blocked by the agent' });
  return error(res, 404, 'not_found', 'unknown route');
});
server.listen(PORT, '127.0.0.1');
process.on('SIGTERM', () => process.exit(0));
