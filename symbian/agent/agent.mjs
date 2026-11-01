#!/usr/bin/env node
// mgo-symbian agent: the only thing MGO talks to in the Symbian container. It starts and stops EKA2L1 (one at a time), gives every
// game its own data directory, takes uploads, captures the sound, and passes an allow-list of EKA2L1's /v1 control API through.
// No dependencies: Node 22 only. Configuration is by environment (see symbian/README.md).
import { spawn, execFile } from 'node:child_process';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { statfsSync, createReadStream, createWriteStream, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, renameSync, statSync, symlinkSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { checkControl, safeName, SAVE_KEY } from './policy.mjs';
import { factoryDirectory, factoryUploadPath, factoryInstallFiles } from './factory.mjs';

const run = promisify(execFile);
const env = process.env;
/**
 * The shared secret between MGO and this service. Either AGENT_TOKEN, or AGENT_TOKEN_FILE: a file on a volume both containers mount;
 * it is created here on the first start, so the default compose file needs no token to be typed in.
 */
function loadToken() {
  if (env.AGENT_TOKEN) return env.AGENT_TOKEN;
  const f = env.AGENT_TOKEN_FILE;
  if (!f) return '';
  try { const t = readFileSync(f, 'utf8').trim(); if (t.length >= 16) return t; } catch { /* not there yet */ }
  const t = randomBytes(24).toString('hex');
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, t + '\n', { mode: 0o644 }); // readable by the app container (another uid); the volume is shared with that container only
  return t;
}
const TOKEN = loadToken();
const PORT = Number(env.AGENT_PORT ?? 8766);
const HOST = env.AGENT_HOST ?? '0.0.0.0';
const CONTROL_PORT = Number(env.CONTROL_PORT ?? 8765);
const EKA_BIN = env.EKA2L1_BIN ?? '/opt/eka2l1/eka2l1_qt';
const EKA_ARGS = (env.EKA2L1_ARGS ?? '').split(' ').filter(Boolean);
const DATA = path.resolve(env.DATA_DIR ?? '/data');
const MAX_FIRMWARE = Number(env.MAX_FIRMWARE_BYTES ?? 2 * 1024 ** 3);
const MAX_PACKAGE = Number(env.MAX_PACKAGE_BYTES ?? 512 * 1024 ** 2);
const MAX_INSTANCE_MS = Number(env.MAX_INSTANCE_SECONDS ?? 7200) * 1000;
const AUDIO_CMD = (env.AUDIO_CMD ?? 'parec --device=jgo_sink.monitor --format=s16le --rate=44100 --channels=2 --latency-msec=40').split(' ').filter(Boolean);
const VERSION_FILE = env.EKA2L1_VERSION_FILE ?? '/opt/eka2l1/VERSION';
const PRIVATE_RUN = path.join(DATA, 'run');
const BASE = path.join(DATA, 'base');
const SAVES = path.join(DATA, 'saves');
const FIRMWARE_IN = path.join(DATA, 'firmware-upload');
const DEVICES_FILE = path.join(DATA, 'devices.json');
const DEFAULTS_FILE = path.join(DATA, 'device-defaults.json');
// A folder the operator mounts read-only (compose: SYMBIAN_INBOX): firmware that is too big for the browser / reverse proxy path.
const INBOX = path.resolve(env.INBOX_DIR ?? '/inbox');
// Parts of EKA2L1's data directory (XDG_DATA_HOME/EKA2L1) that an instance shares with the base read-only (hardlinks) and the
// drives that belong to the game and persist as its saves. UNVERIFIED layout: see docs/SYMBIAN.md.
const SHARED = (env.INSTANCE_SHARED_DIRS ?? 'roms,drives/z').split(',').filter(Boolean);
// Names of extra environment variables passed on to EKA2L1 (e.g. MESA_*, QT_* debugging); everything else is cleared.
const PASS_ENV = (env.EKA2L1_ENV_PASSTHROUGH ?? '').split(',').filter((n) => /^[A-Z][A-Z0-9_]{0,63}$/.test(n));
const PERSIST = (env.INSTANCE_PERSIST_DIRS ?? 'drives/c,drives/e').split(',').filter(Boolean);

if (!TOKEN || TOKEN.length < 16) { console.error('AGENT_TOKEN (at least 16 characters) or AGENT_TOKEN_FILE is required'); process.exit(1); }
for (const d of [DATA, PRIVATE_RUN, BASE, SAVES, FIRMWARE_IN]) mkdirSync(d, { recursive: true, mode: 0o700 });

const ring = [];
const log = (...a) => { const line = [new Date().toISOString(), ...a].join(' '); console.log(line); ring.push(line.slice(0, 500)); if (ring.length > 300) ring.shift(); };
const json = (res, status, body, headers = {}) => { const s = JSON.stringify(body); res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(s), ...headers }); res.end(s); };
const err = (res, status, code, message) => json(res, status, { error: { code, message } });
const sameToken = (given) => { const a = Buffer.from(String(given ?? '')), b = Buffer.from(TOKEN); return a.length === b.length && timingSafeEqual(a, b); };

// ------------------------------------------------------------------ devices cache
function readDevices() { try { return JSON.parse(readFileSync(DEVICES_FILE, 'utf8')); } catch { return []; } }
function writeDevices(list) {
  writeFileSync(DEVICES_FILE + '.tmp', JSON.stringify(list)); renameSync(DEVICES_FILE + '.tmp', DEVICES_FILE);
  // a default that points at a device which is gone would silently send a game to another firmware: drop it
  const d = readDefaults(), codes = new Set(list.map((x) => String(x.code).toLowerCase()));
  const kept = Object.fromEntries(Object.entries(d).filter(([, c]) => codes.has(String(c).toLowerCase())));
  if (Object.keys(kept).length !== Object.keys(d).length) writeDefaults(kept);
}
const PLATFORMS = new Set(['symbian', 'ngage', 'ngage2']);
// Disk: installing a firmware unpacks it next to the original (ROM, drive Z:), and a full volume leaves a half-written device behind.
// The factor is an ESTIMATE of how much space an installation needs relative to its input (not measured with a real firmware); change with INSTALL_SPACE_FACTOR.
const INSTALL_SPACE_FACTOR = Number(env.INSTALL_SPACE_FACTOR ?? 2);
const SPACE_MARGIN = 512 * 1024 ** 2;
function diskInfo() { try { const s = statfsSync(DATA); return { free: Number(s.bavail) * Number(s.bsize), total: Number(s.blocks) * Number(s.bsize) }; } catch { return null; } }
const gb = (n) => `${(n / 1024 ** 3).toFixed(1)} GB`;
/** @returns null when there is room, otherwise a message */
function needSpace(bytes) {
  const d = diskInfo();
  if (!d) return null;
  return d.free < bytes + SPACE_MARGIN ? `not enough free space in the service volume: ${gb(bytes + SPACE_MARGIN)} needed, ${gb(d.free)} free of ${gb(d.total)}` : null;
}
function treeSize(p) {
  try {
    const st = lstatSync(p);
    if (st.isFile()) return st.size;
    if (!st.isDirectory()) return 0;
    return readdirSync(p).reduce((n, name) => n + treeSize(path.join(p, name)), 0);
  } catch { return 0; }
}
function readDefaults() { try { const j = JSON.parse(readFileSync(DEFAULTS_FILE, 'utf8')); return j && typeof j === 'object' ? j : {}; } catch { return {}; } }
function writeDefaults(d) { writeFileSync(DEFAULTS_FILE + '.tmp', JSON.stringify(d)); renameSync(DEFAULTS_FILE + '.tmp', DEFAULTS_FILE); }
/** Plain files directly in the inbox (no links, no sub-folders), names that are safe to show and to pass on. */
function listInbox() {
  const out = [];
  try {
    for (const name of readdirSync(INBOX)) {
      if (!safeName(name) || out.length >= 200) continue;
      try { const st = lstatSync(path.join(INBOX, name)); if (st.isFile()) out.push({ name, size: st.size }); } catch { /* vanished */ }
    }
  } catch { /* no inbox mounted */ }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// ------------------------------------------------------------------ the one EKA2L1 instance
/** @type {null | { id: string, saveKey: string | null, maintenance: boolean, proc: import('node:child_process').ChildProcess, dir: string, since: number, log: string[], timer: NodeJS.Timeout }} */
let instance = null;
let starting = false;

async function copyTree(from, to, link) {
  mkdirSync(path.dirname(to), { recursive: true });
  await run('cp', [link ? '-al' : '-a', '--', from, to]);
}

/** Builds the data directory of an instance: firmware shared (hardlinks, never written), the game's own drives linked in, the rest copied. */
async function prepareInstance(id, saveKey) {
  const dir = path.join(PRIVATE_RUN, id);
  const xdg = path.join(dir, 'xdg');
  const target = path.join(xdg, 'EKA2L1');
  mkdirSync(path.join(dir, 'home'), { recursive: true });
  mkdirSync(path.join(dir, 'in'), { recursive: true });
  const src = path.join(BASE, 'EKA2L1');
  mkdirSync(target, { recursive: true });
  if (existsSync(src)) {
    const skip = new Set([...SHARED, ...PERSIST].map((p) => p.split('/')[0]));
    for (const name of readdirSync(src)) if (!skip.has(name)) await copyTree(path.join(src, name), path.join(target, name), false);
    for (const rel of SHARED) if (existsSync(path.join(src, rel))) await copyTree(path.join(src, rel), path.join(target, rel), true);
    // drives/ may hold more than c, e, z (d, f...): copy those that are neither shared nor persistent
    if (existsSync(path.join(src, 'drives'))) {
      for (const name of readdirSync(path.join(src, 'drives'))) {
        const rel = `drives/${name}`;
        if (!SHARED.includes(rel) && !PERSIST.includes(rel)) await copyTree(path.join(src, rel), path.join(target, rel), false);
      }
    }
  }
  const saveDir = path.join(SAVES, saveKey);
  mkdirSync(saveDir, { recursive: true, mode: 0o700 });
  for (const rel of PERSIST) {
    const real = path.join(saveDir, rel.replace(/\//g, '_'));
    mkdirSync(real, { recursive: true });
    const link = path.join(target, rel);
    mkdirSync(path.dirname(link), { recursive: true });
    rmSync(link, { recursive: true, force: true });
    symlinkSync(real, link);
  }
  return { dir, xdg };
}

function killInstance(inst) {
  clearTimeout(inst.timer);
  try { process.kill(-inst.proc.pid, 'SIGTERM'); } catch { /* gone */ }
  const t = setTimeout(() => { try { process.kill(-inst.proc.pid, 'SIGKILL'); } catch { /* gone */ } }, 4000);
  t.unref();
}

const LAST_RUN = path.join(DATA, 'last-run.json');
function tailFile(f, n) { try { return readFileSync(f, 'utf8').split('\n').filter(Boolean).slice(-n).map((l) => l.slice(0, 600)); } catch { return []; } }
function emulatorLogFile(inst) { return inst.maintenance ? path.join(BASE, 'EKA2L1', 'EKA2L1.log') : path.join(inst.dir, 'xdg', 'EKA2L1', 'EKA2L1.log'); }
/** The per-run directory is deleted when the instance ends; what the emulator said is kept for the next diagnostics request. */
function snapshotLogs(inst) {
  try {
    writeFileSync(LAST_RUN, JSON.stringify({ savedAt: new Date().toISOString(), maintenance: inst.maintenance, saveKey: inst.saveKey, output: inst.log.slice(-120), eka2l1Log: tailFile(emulatorLogFile(inst), 300) }), { mode: 0o600 });
  } catch { /* diagnostics are best effort */ }
}

async function stopInstance() {
  const inst = instance;
  if (!inst) return;
  instance = null;
  snapshotLogs(inst);
  killInstance(inst);
  await new Promise((r) => { if (inst.proc.exitCode !== null) return r(); inst.proc.once('exit', r); setTimeout(r, 5000).unref(); });
  rmSync(inst.dir, { recursive: true, force: true }); // the per-run copy goes; saves and the base stay
  log('instance stopped', inst.id);
}

/**
 * Verified against the real EKA2L1 (master e04eb03): with no device installed the Qt frontend opens a MODAL "No device installed"
 * dialog BEFORE it starts the control API, so a fresh data directory never answers on the control port. That dialog is
 * suppressed by this QSettings key (it is the dialog's own "Don't show this again").
 */
function writeQtSettings(home) {
  const d = path.join(home, '.config', 'EKA2L1');
  mkdirSync(d, { recursive: true });
  writeFileSync(path.join(d, 'EKA2L1.conf'), '[General]\ndisableNoDeviceInstallNotify=true\n');
}

async function startInstance({ saveKey, maintenance }) {
  if (instance || starting) throw Object.assign(new Error('an emulator instance is already running'), { status: 409, code: 'busy' });
  starting = true;
  try {
    const id = randomBytes(6).toString('hex');
    let dir, xdg;
    if (maintenance) {
      dir = path.join(PRIVATE_RUN, `maint-${id}`);
      xdg = BASE;
      mkdirSync(path.join(dir, 'home'), { recursive: true });
      mkdirSync(path.join(dir, 'in'), { recursive: true });
      mkdirSync(path.join(BASE, 'EKA2L1'), { recursive: true });
    } else {
      ({ dir, xdg } = await prepareInstance(id, saveKey));
    }
    writeQtSettings(path.join(dir, 'home'));
    const proc = spawn(EKA_BIN, ['--debug-control-port', String(CONTROL_PORT), ...EKA_ARGS], {
      detached: true,
      cwd: path.dirname(EKA_BIN),
      env: {
        PATH: env.PATH, LANG: 'C.UTF-8', HOME: path.join(dir, 'home'), XDG_DATA_HOME: xdg, XDG_CONFIG_HOME: path.join(dir, 'home', '.config'), XDG_CACHE_HOME: path.join(dir, 'home', '.cache'),
        DISPLAY: env.DISPLAY ?? ':99', LIBGL_ALWAYS_SOFTWARE: '1', QT_QPA_PLATFORM: env.QT_QPA_PLATFORM ?? 'xcb', PULSE_SERVER: env.PULSE_SERVER ?? '', PULSE_RUNTIME_PATH: env.PULSE_RUNTIME_PATH ?? '',
        QT_QUICK_BACKEND: 'software', XDG_RUNTIME_DIR: env.XDG_RUNTIME_DIR ?? '',
        ...Object.fromEntries(PASS_ENV.filter((n) => env[n] !== undefined).map((n) => [n, env[n]])),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const lines = [];
    const take = (b) => { for (const l of b.toString('utf8').split('\n')) if (l) { lines.push(l.slice(0, 400)); if (lines.length > 300) lines.shift(); } };
    proc.stdout.on('data', take); proc.stderr.on('data', take);
    const inst = { id, saveKey: saveKey ?? null, maintenance: !!maintenance, proc, dir, since: Date.now(), log: lines, timer: setTimeout(() => { log('instance time limit'); void stopInstance(); }, MAX_INSTANCE_MS) };
    inst.timer.unref();
    proc.on('exit', (code, sig) => { log('EKA2L1 exited', code, sig); if (instance === inst) { instance = null; clearTimeout(inst.timer); snapshotLogs(inst); rmSync(inst.dir, { recursive: true, force: true }); } });
    instance = inst;
    log('instance started', id, maintenance ? '(maintenance)' : saveKey);
    return inst;
  } finally {
    starting = false;
  }
}

// ------------------------------------------------------------------ talking to EKA2L1 (loopback)
function control(method, urlPath, body, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({ host: '127.0.0.1', port: CONTROL_PORT, method, path: urlPath, timeout: timeoutMs, headers: data ? { 'content-type': 'application/json', 'content-length': data.length } : {} }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); let j = null; try { j = JSON.parse(text); } catch { /* not JSON */ } resolve({ status: res.statusCode, body: j, text }); });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// ------------------------------------------------------------------ jobs (firmware install)
const jobs = new Map();
const factoryUploads = new Set();
const installingBundles = new Set();
function newJob(kind) { const id = randomBytes(6).toString('hex'); const j = { id, kind, state: 'running', progress: 0, error: null, started: Date.now() }; jobs.set(id, j); if (jobs.size > 20) jobs.delete(jobs.keys().next().value); return j; }

async function waitControl(timeoutMs = 60000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    try { const r = await control('GET', '/v1/status', undefined, 3000); if (r.status === 200 && r.body?.started) return; } catch { /* not up yet */ }
    if (!instance || instance.proc.exitCode !== null) throw new Error('EKA2L1 exited while starting: ' + (instance?.log.slice(-5).join(' | ') ?? ''));
    if (Date.now() > end) throw new Error('EKA2L1 did not answer within ' + timeoutMs / 1000 + ' s');
    await new Promise((r) => setTimeout(r, 400));
  }
}

async function installFirmware(job, files, { keep = false, bundleDir = null, variant } = {}) {
  let completed = 'succeeded';
  try {
    await stopInstance();
    await startInstance({ saveKey: null, maintenance: true });
    await waitControl(90000);
    if (files.vpl) {
      const caps = await control('GET', '/v1/capabilities', undefined, 10000);
      if (!caps.body?.firmwareFormats?.includes('vpl')) throw Object.assign(new Error('This EKA2L1 build does not support factory VPL installation through its Control API. Rebuild mgo-symbian with the MGO VPL patch; no ROM dump is required.'), { code: 'vpl_not_supported' });
    }
    const body = { boot: false, ...(files.vpl ? { vpl: files.vpl, ...(variant !== undefined ? { variant } : {}) } : files.archive ? { archive: files.archive } : { rom: files.rom, ...(files.rpkg ? { rpkg: files.rpkg } : {}) }) };
    const start = await control('POST', '/v1/devices?async=1', body, 30000);
    if (start.status !== 202 && start.status !== 200) throw Object.assign(new Error(start.body?.error?.message ?? `install request failed (HTTP ${start.status})`), { code: start.body?.error?.code });
    if (start.status === 202) {
      const jid = start.body.id;
      for (;;) {
        await new Promise((r) => setTimeout(r, 2000));
        const j = await control('GET', `/v1/jobs/${jid}`, undefined, 10000);
        job.progress = j.body?.progress ?? job.progress;
        if (j.body?.state === 'succeeded') break;
        if (j.body?.state === 'failed') throw Object.assign(new Error(j.body?.error?.message ?? 'the emulator could not install that firmware'), { code: j.body?.error?.code });
        if (Date.now() - job.started > 45 * 60_000) throw new Error('installing the firmware took more than 45 minutes');
      }
    }
    const list = await control('GET', '/v1/devices', undefined, 10000);
    writeDevices((list.body?.devices ?? []).map((d) => ({ code: d.code, manufacturer: d.manufacturer, model: d.model })));
    job.progress = 1;
  } catch (e) {
    completed = 'failed'; job.error = String(e.message ?? e).slice(0, 400); job.errorCode = e.code ?? null; log('firmware job failed:', job.kind, job.errorCode ?? '', job.error); // kept in the service log for the diagnostics report
  } finally {
    try {
      await stopInstance();
      if (!keep && bundleDir) rmSync(bundleDir, { recursive: true, force: true });
      else if (!keep) for (const f of Object.values(files)) rmSync(f, { force: true });
    } catch (e) {
      completed = 'failed'; job.error ??= String(e.message ?? e).slice(0, 400); job.errorCode ??= 'cleanup_failed';
    } finally {
      if (bundleDir) installingBundles.delete(bundleDir);
      // A completed job means its instance and staged files are gone: the UI
      // can safely refresh readiness or retry without racing final cleanup.
      job.state = completed;
    }
  }
}

// ------------------------------------------------------------------ HTTP
async function readJson(req, max = 64 * 1024) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > max) throw Object.assign(new Error('body too large'), { status: 413, code: 'too_large' }); chunks.push(c); }
  if (!n) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('invalid JSON'), { status: 400, code: 'bad_request' }); }
}

/** Streams the request body to a file, refusing more than `max` bytes. The file is only moved into place when it is complete. */
async function saveUpload(req, dest, max) {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > max) throw Object.assign(new Error('file too large'), { status: 413, code: 'too_large' });
  const noRoom = needSpace(declared);
  if (noRoom) throw Object.assign(new Error(noRoom), { status: 507, code: 'insufficient_storage' });
  mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
  const tmp = dest + '.part';
  let n = 0;
  let checked = 0;
  const limiter = async function* (src) {
    for await (const c of src) {
      n += c.length;
      if (n > max) throw Object.assign(new Error('file too large'), { status: 413, code: 'too_large' });
      if (n - checked >= 128 * 1024 ** 2) { checked = n; const noRoom2 = needSpace(0); if (noRoom2) throw Object.assign(new Error(noRoom2), { status: 507, code: 'insufficient_storage' }); } // a body of unknown length
      yield c;
    }
  };
  try { await pipeline(req, limiter, createWriteStream(tmp, { mode: 0o600 })); } catch (e) { rmSync(tmp, { force: true }); throw e; }
  renameSync(tmp, dest);
  return n;
}

async function extractCard(zip, outDir) {
  // list first: a game card is a few thousand files at most; refuse zip bombs and anything with a path that leaves the directory
  const { stdout } = await run('unzip', ['-Z1', '--', zip], { maxBuffer: 16 * 1024 * 1024 });
  const names = stdout.split('\n').filter(Boolean);
  if (names.length === 0 || names.length > 20000) throw Object.assign(new Error('the archive has no files or too many'), { status: 422, code: 'bad_card' });
  if (names.some((n) => n.startsWith('/') || n.split('/').includes('..') || n.includes('\0'))) throw Object.assign(new Error('the archive contains unsafe paths'), { status: 422, code: 'bad_card' });
  const { stdout: info } = await run('unzip', ['-Zt', '--', zip]);
  const total = Number(/(\d+) bytes uncompressed/.exec(info)?.[1] ?? 0);
  if (total > 4 * 1024 ** 3) throw Object.assign(new Error('the archive unpacks to more than 4 GB'), { status: 422, code: 'bad_card' });
  mkdirSync(outDir, { recursive: true });
  await run('unzip', ['-q', '-o', '-d', outDir, '--', zip], { timeout: 10 * 60_000 });
  const root = findCardRoot(outDir);
  if (!root) throw Object.assign(new Error('no system/apps folder in the archive: an N-Gage 1.0 game card dump has one (a wrapping folder is fine)'), { status: 422, code: 'bad_card' });
  return root;
}

const childNamed = (dir, re) => { try { return readdirSync(dir).find((n) => re.test(n) && statSync(path.join(dir, n)).isDirectory()) ?? null; } catch { return null; } };
/** The folder that holds `system/apps` (any case, up to three levels down, so a zip with a wrapping folder works); renamed to lower case, as EKA2L1 looks for it. */
function findCardRoot(top) {
  const queue = [[top, 0]];
  while (queue.length) {
    const [dir, depth] = queue.shift();
    const sys = childNamed(dir, /^system$/i);
    if (sys) {
      const apps = childNamed(path.join(dir, sys), /^apps$/i);
      if (apps) {
        if (sys !== 'system') renameSync(path.join(dir, sys), path.join(dir, 'system'));
        if (apps !== 'apps') renameSync(path.join(dir, 'system', apps), path.join(dir, 'system', 'apps'));
        return dir;
      }
    }
    if (depth < 3) { try { for (const n of readdirSync(dir)) { const f = path.join(dir, n); if (statSync(f).isDirectory()) queue.push([f, depth + 1]); } } catch { /* unreadable */ } }
  }
  return null;
}

function proxy(req, res, pathname, search, bodyBuf) {
  const headers = {};
  if (bodyBuf?.length) { headers['content-type'] = 'application/json'; headers['content-length'] = bodyBuf.length; }
  const up = http.request({ host: '127.0.0.1', port: CONTROL_PORT, method: req.method, path: pathname + search, headers, timeout: 10 * 60_000 }, (r) => {
    const h = {};
    for (const k of ['content-type', 'content-length', 'x-frame-count', 'x-job-id', 'x-log-offset']) if (r.headers[k]) h[k] = r.headers[k];
    res.writeHead(r.statusCode ?? 502, h);
    r.pipe(res);
  });
  up.on('timeout', () => up.destroy(new Error('timeout')));
  up.on('error', () => { if (!res.headersSent) err(res, 502, 'emulator_unreachable', 'the emulator does not answer'); else res.destroy(); });
  if (bodyBuf?.length) up.write(bodyBuf);
  up.end();
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://x');
    const p = url.pathname;
    if (req.method === 'GET' && p === '/agent/ping') return json(res, 200, { ok: true }); // no secrets: for the container health check
    if (!sameToken((req.headers.authorization ?? '').replace(/^Bearer /i, ''))) return err(res, 401, 'unauthorized', 'a valid token is required');

    if (req.method === 'GET' && p === '/agent/health') {
      const devices = readDevices();
      let emulator = null; try { emulator = readFileSync(VERSION_FILE, 'utf8').trim(); } catch { /* not built from source */ }
      return json(res, 200, { ok: true, emulator, firmware: { installed: devices.length > 0, devices }, defaults: readDefaults(), inbox: listInbox(), disk: diskInfo(), instance: { running: !!instance, saveKey: instance?.saveKey ?? null, since: instance?.since ?? null }, audio: true });
    }
    if (req.method === 'GET' && p === '/agent/log') {
      if (instance) return json(res, 200, { live: true, agent: ring.slice(-120), output: instance.log.slice(-120), eka2l1Log: tailFile(emulatorLogFile(instance), 300) });
      let last = null; try { last = JSON.parse(readFileSync(LAST_RUN, 'utf8')); } catch { /* none yet */ }
      return json(res, 200, { live: false, agent: ring.slice(-120), output: last?.output ?? [], eka2l1Log: last?.eka2l1Log ?? [], lastRun: last ? { savedAt: last.savedAt, maintenance: last.maintenance } : null });
    }
    if (req.method === 'POST' && p === '/agent/instance') {
      const b = await readJson(req);
      if (!b.maintenance && !SAVE_KEY.test(b.saveKey ?? '')) return err(res, 400, 'bad_request', 'saveKey must be 32 hex characters');
      if (!b.maintenance && readDevices().length === 0) return err(res, 412, 'no_firmware', 'no device is installed');
      const inst = await startInstance({ saveKey: b.saveKey, maintenance: !!b.maintenance });
      let app = null;
      try { app = JSON.parse(readFileSync(path.join(SAVES, inst.saveKey ?? '-', 'jgo-app.json'), 'utf8')); } catch { /* first run */ }
      return json(res, 200, { id: inst.id, app });
    }
    if (req.method === 'DELETE' && p === '/agent/instance') { await stopInstance(); return json(res, 200, { ok: true }); }

    let m;
    if (req.method === 'PUT' && (m = /^\/agent\/upload\/(package|card)$/.exec(p))) {
      if (!instance || instance.maintenance) return err(res, 409, 'no_instance', 'start an instance first');
      const name = safeName(url.searchParams.get('name'));
      if (!name) return err(res, 400, 'bad_request', 'invalid file name');
      if (m[1] === 'package' && !/\.(sisx?|n-gage)$/i.test(name)) return err(res, 400, 'bad_request', 'a package is .sis, .sisx or .n-gage');
      const dest = path.join(instance.dir, 'in', m[1] === 'card' ? 'card.zip' : name);
      await saveUpload(req, dest, MAX_PACKAGE);
      if (m[1] === 'card') {
        try { return json(res, 200, { path: await extractCard(dest, path.join(instance.dir, 'in', 'card')) }); } finally { rmSync(dest, { force: true }); }
      }
      return json(res, 200, { path: dest });
    }
    if (req.method === 'PUT' && (m = /^\/agent\/firmware\/(rom|rpkg|archive|vpl|fpsx)$/.exec(p))) {
      const name = safeName(url.searchParams.get('name'));
      if (!name) return err(res, 400, 'bad_request', 'invalid file name');
      if (m[1] === 'vpl' || m[1] === 'fpsx') {
        if (name !== url.searchParams.get('name')) return err(res, 400, 'bad_request', 'factory filenames must be preserved exactly');
        const bundle = url.searchParams.get('bundle');
        const dest = factoryUploadPath(FIRMWARE_IN, bundle, name, m[1]);
        const dir = path.dirname(dest);
        if (installingBundles.has(dir) || [...factoryUploads].some(f => path.dirname(f) === dir)) return err(res, 409, 'busy', 'this factory bundle is being uploaded or installed');
        factoryUploads.add(dest);
        try { await saveUpload(req, dest, m[1] === 'vpl' ? Math.min(MAX_FIRMWARE, 4 * 1024 * 1024) : MAX_FIRMWARE); }
        finally { factoryUploads.delete(dest); }
        return json(res, 200, { file: name, bundle });
      }
      const dest = path.join(FIRMWARE_IN, `${m[1]}-${createHash('sha256').update(name).digest('hex').slice(0, 8)}-${name}`);
      await saveUpload(req, dest, MAX_FIRMWARE);
      return json(res, 200, { file: path.basename(dest) });
    }
    if (req.method === 'POST' && p === '/agent/firmware/install') {
      const b = await readJson(req);
      if ([b.rom, b.archive, b.vpl].filter(Boolean).length !== 1 || (b.rpkg && !b.rom)) return err(res, 400, 'bad_request', 'choose exactly one firmware format');
      if (b.vpl) {
        if ([...jobs.values()].some(j => j.state === 'running')) return err(res, 409, 'busy', 'a firmware installation is already running');
        const factory = factoryInstallFiles(FIRMWARE_IN, INBOX, b);
        if (factory.bundleDir && [...factoryUploads].some(f => path.dirname(f) === factory.bundleDir)) return err(res, 409, 'busy', 'finish uploading all factory images first');
        const roomVpl = needSpace(Math.round((factory.bundleDir ? treeSize(factory.bundleDir) : listInbox().reduce((n, f) => n + f.size, 0)) * INSTALL_SPACE_FACTOR));
        if (roomVpl) return err(res, 507, 'insufficient_storage', roomVpl);
        if (factory.bundleDir) installingBundles.add(factory.bundleDir);
        const job = newJob('install_device');
        void installFirmware(job, factory.files, factory);
        return json(res, 202, job);
      }
      const fromInbox = b.source === 'inbox';
      const dir = fromInbox ? INBOX : FIRMWARE_IN;
      const pick = (k) => {
        if (!b[k]) return null;
        const n = path.basename(String(b[k]));
        const f = path.join(dir, n);
        if (fromInbox) { // only plain files of the inbox itself: never a link out of it
          try { return safeName(n) && lstatSync(f).isFile() ? f : null; } catch { return null; }
        }
        return f;
      };
      const files = { ...(pick('archive') ? { archive: pick('archive') } : { rom: pick('rom'), ...(pick('rpkg') ? { rpkg: pick('rpkg') } : {}) }) };
      if (Object.values(files).some((f) => !f || !existsSync(f))) return err(res, 400, 'bad_request', fromInbox ? 'those files are not in the inbox folder' : 'upload the firmware files first (rom, and rpkg or an archive)');
      if (!files.archive && !files.rom) return err(res, 400, 'bad_request', 'a ROM or an archive is required');
      if ([...jobs.values()].some((j) => j.state === 'running')) return err(res, 409, 'busy', 'a firmware installation is already running');
      const roomPlain = needSpace(Math.round(Object.values(files).reduce((n, f) => n + treeSize(f), 0) * INSTALL_SPACE_FACTOR));
      if (roomPlain) return err(res, 507, 'insufficient_storage', roomPlain);
      const job = newJob('install_device');
      void installFirmware(job, files, { keep: fromInbox });
      return json(res, 202, job);
    }
    if (req.method === 'DELETE' && (m = /^\/agent\/firmware\/bundles\/([a-f0-9]{32})$/.exec(p))) {
      const dir = factoryDirectory(FIRMWARE_IN, m[1]);
      if (installingBundles.has(dir) || [...factoryUploads].some(f => path.dirname(f) === dir)) return err(res, 409, 'busy', 'this factory bundle is in use');
      rmSync(dir, { recursive: true, force: true });
      return json(res, 200, { ok: true });
    }
    if (req.method === 'PUT' && p === '/agent/defaults') {
      const b = await readJson(req);
      if (!PLATFORMS.has(b.platform)) return err(res, 400, 'bad_request', 'platform must be symbian, ngage or ngage2');
      const d = readDefaults();
      if (b.code === null) delete d[b.platform];
      else {
        const dev = readDevices().find((x) => String(x.code).toLowerCase() === String(b.code).toLowerCase());
        if (!dev) return err(res, 404, 'not_found', 'no such device');
        d[b.platform] = dev.code;
      }
      writeDefaults(d);
      return json(res, 200, { defaults: d });
    }
    if (req.method === 'GET' && (m = /^\/agent\/jobs\/([a-f0-9]{12})$/.exec(p))) { const j = jobs.get(m[1]); return j ? json(res, 200, j) : err(res, 404, 'not_found', 'no such job'); }
    if (req.method === 'PUT' && (m = /^\/agent\/saves\/([0-9a-f]{32})\/app$/.exec(p))) {
      const b = await readJson(req);
      if (!/^0x[0-9A-Fa-f]{1,8}$/.test(b.uid ?? '')) return err(res, 400, 'bad_request', 'uid must look like 0x1000ABCD');
      mkdirSync(path.join(SAVES, m[1]), { recursive: true, mode: 0o700 });
      writeFileSync(path.join(SAVES, m[1], 'jgo-app.json'), JSON.stringify({ uid: b.uid }));
      return json(res, 200, { ok: true });
    }
    if (req.method === 'DELETE' && (m = /^\/agent\/saves\/([0-9a-f]{32})$/.exec(p))) {
      if (instance?.saveKey === m[1]) return err(res, 409, 'busy', 'the game is running');
      rmSync(path.join(SAVES, m[1]), { recursive: true, force: true });
      return json(res, 200, { ok: true });
    }
    if (req.method === 'DELETE' && (m = /^\/agent\/firmware\/([A-Za-z0-9._-]{1,32})$/.exec(p))) {
      // removing a device is a maintenance run: the emulator deletes it from its base directory
      if (instance) return err(res, 409, 'busy', 'stop the running game first');
      const job = newJob('delete_device');
      void (async () => {
        try {
          await startInstance({ saveKey: null, maintenance: true });
          await waitControl(90000);
          const cur = await control('GET', '/v1/devices', undefined, 10000);
          const others = (cur.body?.devices ?? []).filter((d) => String(d.code).toLowerCase() !== m[1].toLowerCase());
          if (others.length && cur.body?.current?.code?.toLowerCase() === m[1].toLowerCase()) await control('POST', `/v1/devices/${encodeURIComponent(others[0].code)}/boot`, {}, 5 * 60_000);
          const r = await control('DELETE', `/v1/devices/${encodeURIComponent(m[1])}`, undefined, 120000);
          if (r.status !== 200) throw new Error(r.body?.error?.message ?? `HTTP ${r.status}`);
          const list = await control('GET', '/v1/devices', undefined, 10000);
          writeDevices((list.body?.devices ?? []).map((d) => ({ code: d.code, manufacturer: d.manufacturer, model: d.model })));
          job.state = 'succeeded';
        } catch (e) { job.state = 'failed'; job.error = String(e.message ?? e).slice(0, 400); log('device removal failed:', job.error); } finally { await stopInstance(); }
      })();
      return json(res, 202, job);
    }
    if (req.method === 'GET' && p === '/agent/audio') {
      if (!instance) return err(res, 409, 'no_instance', 'no instance is running');
      const cmd = spawn(AUDIO_CMD[0], AUDIO_CMD.slice(1), { stdio: ['ignore', 'pipe', 'ignore'], env: { PATH: env.PATH, PULSE_SERVER: env.PULSE_SERVER ?? '', PULSE_RUNTIME_PATH: env.PULSE_RUNTIME_PATH ?? '', XDG_RUNTIME_DIR: env.XDG_RUNTIME_DIR ?? '' } });
      let started = false;
      cmd.on('error', () => { if (!started && !res.headersSent) err(res, 503, 'no_audio', 'sound capture is not available'); else res.destroy(); });
      cmd.stdout.once('data', () => { started = true; });
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' });
      cmd.stdout.pipe(res);
      const stop = () => { try { cmd.kill('SIGKILL'); } catch { /* gone */ } };
      res.on('close', stop); req.on('aborted', stop); cmd.on('exit', () => res.end());
      return;
    }
    if (p === '/v1' || p.startsWith('/v1/')) {
      if (!instance) return err(res, 409, 'no_instance', 'no instance is running');
      let bodyBuf = null, body = null;
      if (req.method === 'POST' || req.method === 'PUT') { body = await readJson(req); bodyBuf = Buffer.from(JSON.stringify(body)); }
      const verdict = checkControl({ method: req.method ?? 'GET', pathname: p, body, inputDir: instance.maintenance ? null : path.join(instance.dir, 'in') });
      if (verdict) return err(res, verdict.status, verdict.code, verdict.message);
      return proxy(req, res, p, url.search, bodyBuf);
    }
    return err(res, 404, 'not_found', 'unknown route');
  } catch (e) {
    if (res.headersSent) return res.destroy();
    err(res, e.status ?? 500, e.code ?? 'error', String(e.message ?? e).slice(0, 300));
  }
});
server.requestTimeout = 0; server.headersTimeout = 20000; server.keepAliveTimeout = 5000;
server.listen(PORT, HOST, () => log(`mgo-symbian agent on ${HOST}:${PORT}`));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, async () => { await stopInstance(); process.exit(0); });
