import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { AgentClient, AgentError } from './agentClient.js';
import { Eka2l1Adapter } from './adapter.js';
import { ekaKeyName } from './keymap.js';
import { decodePng } from './png.js';
import type { FrameMsg } from '../emulator.js';
// @ts-expect-error plain ESM modules without types: the policy of the service and the fake emulator's PNG encoder
import { checkControl, safeName } from '../../../../symbian/agent/policy.mjs';
// @ts-expect-error see above
import { encodePng } from '../../../../tests/fixtures/fake-eka2l1/png.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const AGENT = path.join(root, 'symbian/agent/agent.mjs');
const FAKE = path.join(root, 'tests/fixtures/fake-eka2l1/fake-eka2l1.mjs');
const PCM = path.join(root, 'tests/fixtures/fake-eka2l1/pcm.mjs');

describe('no firmware, ROM or game in the repository', () => {
  it('tracks no Symbian/N-Gage firmware or game files, and the image does not copy any', () => {
    let files: string[];
    try { files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean); } catch { return; } // not a git checkout
    const bad = files.filter((f) => /\.(rom|rpkg|sis|sisx|n-gage|v\d{2}\.\d{2})$/i.test(f));
    assert.deepEqual(bad, []);
    const docker = readFileSync(path.join(root, 'symbian/Dockerfile'), 'utf8');
    assert.doesNotMatch(docker, /COPY[^\n]*\.(rom|rpkg|sis|n-gage)/i);
    assert.match(docker, /EKA2L1_COMMIT=[0-9a-f]{40}/, 'EKA2L1 is built from a pinned commit');
  });
});

describe('key mapping', () => {
  it('maps J2ME key codes to EKA2L1 key names and drops the unknown ones', () => {
    assert.equal(ekaKeyName(-1), 'up');
    assert.equal(ekaKeyName(-5), 'ok');
    assert.equal(ekaKeyName(-6), 'lsk');
    assert.equal(ekaKeyName(-7), 'rsk');
    assert.equal(ekaKeyName(42), 'star');
    assert.equal(ekaKeyName(35), 'hash');
    assert.equal(ekaKeyName(48), '0');
    assert.equal(ekaKeyName(57), '9');
    assert.equal(ekaKeyName(9999), null);
  });
});

describe('PNG decoder', () => {
  const w = 7, h = 5;
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) { rgba[i * 4] = (i * 37) & 255; rgba[i * 4 + 1] = (i * 91) & 255; rgba[i * 4 + 2] = (i * 13) & 255; rgba[i * 4 + 3] = 255; }
  for (const filter of [0, 1, 2, 3, 4]) {
    it(`decodes row filter ${filter}`, () => {
      const out = decodePng(encodePng(w, h, rgba, filter));
      assert.equal(out.width, w);
      assert.equal(out.height, h);
      assert.deepEqual(out.data, rgba);
    });
  }
  it('rejects garbage, a wrong signature and absurd sizes', () => {
    assert.throws(() => decodePng(Buffer.from('not a png at all')));
    const png = Buffer.from(encodePng(w, h, rgba, 0));
    const big = Buffer.from(png);
    big.writeUInt32BE(100000, 16); // IHDR width
    assert.throws(() => decodePng(big));
  });
});

describe('control policy (what a client may ask EKA2L1)', () => {
  const inputDir = '/data/run/abc/in';
  const ok = (method: string, pathname: string, body: unknown = null) => checkControl({ method, pathname, body, inputDir }) === null;
  it('allows what the adapter needs', () => {
    assert.ok(ok('GET', '/v1/status'));
    assert.ok(ok('GET', '/v1/screenshot'));
    assert.ok(ok('POST', '/v1/input/key', {}));
    assert.ok(ok('POST', '/v1/apps/0x2000A001/launch', {}));
    assert.ok(ok('POST', '/v1/devices/RM-84/boot', {}));
    assert.ok(ok('DELETE', '/v1/session'));
  });
  it('blocks host file access, configuration, card management and device install/delete', () => {
    assert.ok(!ok('GET', '/v1/files'));
    assert.ok(!ok('PUT', '/v1/files'));
    assert.ok(!ok('DELETE', '/v1/files'));
    assert.ok(!ok('GET', '/v1/config'));
    assert.ok(!ok('PATCH', '/v1/config'));
    assert.ok(!ok('PUT', '/v1/card'));
    assert.ok(!ok('POST', '/v1/devices', {}));
    assert.ok(!ok('DELETE', '/v1/devices/RM-84'));
    assert.ok(!ok('DELETE', '/v1/apps/0x2000A001'));
    assert.ok(!ok('GET', '/v2/anything'));
  });
  it('installs only from the instance upload directory, with a known type', () => {
    assert.ok(ok('POST', '/v1/apps', { path: `${inputDir}/game.sis`, type: 'sis' }));
    assert.ok(ok('POST', '/v1/apps', { path: `${inputDir}/card`, type: 'ngage' }));
    assert.ok(!ok('POST', '/v1/apps', { path: '/etc/passwd', type: 'sis' }));
    assert.ok(!ok('POST', '/v1/apps', { path: `${inputDir}/../../../etc/passwd`, type: 'sis' }));
    assert.ok(!ok('POST', '/v1/apps', { path: inputDir, type: 'sis' }));
    assert.ok(!ok('POST', '/v1/apps', { paths: [`${inputDir}/a.sis`, '/root/x.sis'], type: 'sis' }));
    assert.ok(!ok('POST', '/v1/apps', { path: `${inputDir}/a.sis`, type: 'host' }));
    assert.ok(checkControl({ method: 'POST', pathname: '/v1/apps', body: { path: `${inputDir}/a.sis` }, inputDir: null }));
  });
  it('accepts only plain file names for uploads', () => {
    assert.equal(safeName('Game (1).sis'), 'Game (1).sis');
    for (const bad of ['../x.sis', 'a/b.sis', '.hidden', 'a\\b', '', 'x'.repeat(200), 'a\0b']) assert.equal(safeName(bad), null, bad);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// The mgo-symbian agent end to end, with the FAKE EKA2L1 behind it. This checks MGO's side only: the agent's auth, upload, firmware,
// per-game saves, allow-list and the adapter (frames, sound, keys, touch). It says nothing about the real emulator.

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); });
    s.on('error', reject);
  });
}

describe('mgo-symbian agent with a fake EKA2L1', () => {
  let proc: ChildProcess;
  let data: string;
  let inputLog: string;
  let base: string;
  const token = 'test-token-0123456789abcdef';
  let agent: AgentClient;
  const keyA = 'a'.repeat(32);
  const keyB = 'b'.repeat(32);
  const keyC = 'c'.repeat(32);
  const keyD = 'd'.repeat(32);

  before(async () => {
    data = mkdtempSync(path.join(tmpdir(), 'mgo-symbian-'));
    inputLog = path.join(data, 'input.log');
    const port = await freePort();
    const control = await freePort();
    base = `http://127.0.0.1:${port}`;
    proc = spawn(process.execPath, [AGENT], {
      env: { PATH: process.env.PATH ?? '', AGENT_TOKEN: token, AGENT_PORT: String(port), AGENT_HOST: '127.0.0.1', CONTROL_PORT: String(control), DATA_DIR: data, EKA2L1_BIN: FAKE, AUDIO_CMD: `${process.execPath} ${PCM}`, FAKE_INPUT_LOG: inputLog, EKA2L1_ENV_PASSTHROUGH: 'FAKE_INPUT_LOG', MAX_PACKAGE_BYTES: String(1024 * 1024) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    proc.stdout!.on('data', (b) => (out += b));
    proc.stderr!.on('data', (b) => (out += b));
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`${base}/agent/ping`)).ok) break; } catch { /* not yet */ }
      await new Promise((r) => setTimeout(r, 100));
      if (i === 99) throw new Error('agent did not start: ' + out);
    }
    agent = new AgentClient({ baseUrl: base, token });
  });

  after(async () => {
    proc?.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 200));
    rmSync(data, { recursive: true, force: true });
  });

  it('answers /agent/ping without a token but wants one everywhere else', async () => {
    assert.equal((await fetch(`${base}/agent/ping`)).status, 200);
    assert.equal((await fetch(`${base}/agent/health`)).status, 401);
    assert.equal((await fetch(`${base}/agent/health`, { headers: { authorization: 'Bearer wrong-wrong-wrong-wrong' } })).status, 401);
    assert.equal((await fetch(`${base}/v1/status`)).status, 401);
    assert.equal((await fetch(`${base}/agent/audio`)).status, 401);
  });

  it('has no firmware at first and refuses to start a game (412)', async () => {
    const h = await agent.health();
    assert.equal(h.firmware.installed, false);
    await assert.rejects(agent.startInstance({ saveKey: keyA }), (e: unknown) => e instanceof AgentError && e.status === 412 && e.code === 'no_firmware');
  });

  it('rejects a bad save key', async () => {
    await assert.rejects(agent.startInstance({ saveKey: '../../etc' }), (e: unknown) => e instanceof AgentError && e.status === 400);
  });

  it('installs uploaded firmware through a job and keeps only the device list', async () => {
    const put = async (slot: string, name: string, bytes: Buffer) => fetch(`${base}/agent/firmware/${slot}?name=${encodeURIComponent(name)}`, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' }, body: new Uint8Array(bytes) });
    assert.equal((await put('rom', '../evil.rom', Buffer.from('x'))).status, 400);
    const up = await put('rom', 'RM-84.v04.50.rom', Buffer.from('fake rom bytes'));
    assert.equal(up.status, 200);
    const upr = await put('rpkg', 'RM-84.rpkg', Buffer.from('fake rpkg bytes'));
    assert.equal(upr.status, 200);
    const rom = ((await up.json()) as { file: string }).file;
    const rpkg = ((await upr.json()) as { file: string }).file;
    const start = await fetch(`${base}/agent/firmware/install`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ rom, rpkg }) });
    assert.equal(start.status, 202);
    const job = (await start.json()) as { id: string };
    let state = 'running';
    for (let i = 0; i < 60 && state === 'running'; i++) {
      await new Promise((r) => setTimeout(r, 500));
      state = ((await (await fetch(`${base}/agent/jobs/${job.id}`, { headers: { authorization: `Bearer ${token}` } })).json()) as { state: string }).state;
    }
    assert.equal(state, 'succeeded');
    const h = await agent.health();
    assert.equal(h.firmware.installed, true);
    assert.equal(h.firmware.devices[0]?.code, 'RM-84');
    assert.equal(h.instance.running, false, 'the maintenance instance is gone');
    assert.equal(existsSync(path.join(data, 'firmware-upload', rom)), false, 'the uploaded original is deleted after the install');
  });

  const sis = (name = 'Game.sis') => ({ name, bytes: Buffer.from('fake sis payload') });

  async function runAdapter(saveKey: string, platform: 'symbian' | 'ngage2' = 'symbian', file = 'Game.sis') {
    const pkgPath = path.join(data, file);
    writeFileSync(pkgPath, sis(file).bytes);
    const a = new Eka2l1Adapter({ agent, saveKey, platform, packagePath: pkgPath, fileName: file, frameEncoding: 'raw', fps: 30, statusPollMs: 300 });
    const frames: FrameMsg[] = [];
    const audio: Buffer[] = [];
    const logs: string[] = [];
    a.on('frame', (f) => frames.push(f));
    a.on('audio', (c) => audio.push(c));
    a.on('log', (l) => logs.push(l));
    await a.start();
    return { a, frames, audio, logs };
  }

  const until = async (cond: () => boolean, what: string, ms = 8000) => {
    const t0 = Date.now();
    while (!cond()) { if (Date.now() - t0 > ms) throw new Error('timeout waiting for ' + what); await new Promise((r) => setTimeout(r, 50)); }
  };

  it('starts a game: installs it, sends frames with their size and sound', async () => {
    const { a, frames, audio, logs } = await runAdapter(keyA);
    try {
      assert.equal(a.state, 'running');
      await until(() => frames.length >= 5, 'frames');
      const f = frames[0]!;
      assert.equal(f.width, 176);
      assert.equal(f.height, 208);
      assert.equal(f.data.length, 176 * 208 * 4);
      assert.ok(frames.at(-1)!.seq > f.seq);
      await until(() => audio.reduce((n, c) => n + c.length, 0) > 4000, 'sound');
      assert.ok(logs.some((l) => /uploading Game\.sis/.test(l)));
      const st = a.getStatus();
      assert.equal(st.state, 'running');
      assert.ok(st.frames >= 5);
    } finally {
      await a.stop();
    }
    assert.equal(a.state, 'exited');
    assert.equal((await agent.health()).instance.running, false);
  });

  it('delivers keys in order and touch with the pointer id; unknown keys and idle moves are dropped', async () => {
    writeFileSync(inputLog, '');
    const { a, frames } = await runAdapter(keyA);
    try {
      a.keyDown(-5); a.keyUp(-5);
      a.keyDown(9999); // no Symbian key
      a.pointerEvent(2, 'M', 5, 5); // move without a press: dropped
      a.pointerEvent(2, 'D', 40, 50); a.pointerEvent(2, 'M', 41, 51); a.pointerEvent(2, 'U', 41, 51);
      a.releaseAll();
      await until(() => readFileSync(inputLog, 'utf8').includes('release'), 'input');
      const lines = readFileSync(inputLog, 'utf8').trim().split('\n');
      assert.deepEqual(lines, ['key ok down', 'key ok up', 'touch down 40,50 id=2', 'touch move 41,51 id=2', 'touch up 41,51 id=2', 'release']);
      assert.ok(frames.length > 0);
    } finally {
      await a.stop();
    }
  });

  it('shows a held key in the picture (the fake turns its square yellow on "ok")', async () => {
    const { a, frames } = await runAdapter(keyA);
    try {
      const yellowAt = (f: FrameMsg) => { const d = f.data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] === 255 && d[i + 1] === 255 && d[i + 2] === 0) n++; return n; };
      a.keyDown(-5);
      await until(() => frames.some((f) => yellowAt(f) > 100), 'a yellow square');
      a.keyUp(-5);
      await until(() => yellowAt(frames.at(-1)!) === 0, 'the square to turn back');
    } finally {
      await a.stop();
    }
  });

  it('sends deflated frames when asked to', async () => {
    const pkgPath = path.join(data, 'Z.sis');
    writeFileSync(pkgPath, 'fake');
    const a = new Eka2l1Adapter({ agent, saveKey: keyA, platform: 'symbian', packagePath: pkgPath, fileName: 'Z.sis', frameEncoding: 'deflate', fps: 30 });
    const frames: FrameMsg[] = [];
    a.on('frame', (f) => frames.push(f));
    await a.start();
    try {
      await until(() => frames.length > 0, 'a frame');
      assert.equal(frames[0]!.enc, 1);
      assert.equal(inflateRawSync(frames[0]!.data).length, 176 * 208 * 4);
    } finally {
      await a.stop();
    }
  });

  it('remembers the installed application per game: the second start does not upload again', async () => {
    const first = await runAdapter(keyB);
    await first.a.stop();
    assert.ok(first.logs.some((l) => /uploading/.test(l)));
    const second = await runAdapter(keyB);
    try {
      assert.ok(second.logs.some((l) => /already installed/.test(l)), second.logs.join('\n'));
      assert.ok(!second.logs.some((l) => /uploading/.test(l)));
    } finally {
      await second.a.stop();
    }
  });

  it('keeps each game\'s drives apart (saves are per save key) and deletes them on request', async () => {
    // the fake keeps its application list on the E: drive, which the agent links to the per-game save directory
    const one = await runAdapter(keyC, 'symbian', 'One.sis');
    await one.a.stop();
    const two = await runAdapter(keyD, 'symbian', 'Two.sis');
    await two.a.stop();
    const apps = (k: string) => readFileSync(path.join(data, 'saves', k, 'drives_e', 'apps.json'), 'utf8');
    assert.match(apps(keyC), /One/);
    assert.doesNotMatch(apps(keyC), /Two/);
    assert.match(apps(keyD), /Two/);
    assert.doesNotMatch(apps(keyD), /One/);
    await agent.deleteSaves(keyC);
    assert.equal(existsSync(path.join(data, 'saves', keyC)), false);
    assert.equal(existsSync(path.join(data, 'saves', keyD, 'drives_e', 'apps.json')), true);
  });

  it('the per-instance data directory is removed when the game ends, the firmware base stays', async () => {
    const { a } = await runAdapter(keyB);
    assert.ok(readdirCount(path.join(data, 'run')) >= 1);
    await a.stop();
    await until(() => readdirCount(path.join(data, 'run')) === 0, 'the instance directory to go');
    assert.ok(existsSync(path.join(data, 'devices.json')));
  });

  it('allows one instance at a time (409)', async () => {
    const { a } = await runAdapter(keyA);
    try {
      await assert.rejects(agent.startInstance({ saveKey: keyB }), (e: unknown) => e instanceof AgentError && e.status === 409);
    } finally { await a.stop(); }
  });

  it('proxies the allowed routes and blocks the dangerous ones', async () => {
    const { a } = await runAdapter(keyA);
    try {
      const st = await agent.control<{ started: boolean }>('GET', '/v1/status');
      assert.equal(st.started, true);
      for (const [m, p] of [['GET', '/v1/files?path=/etc/passwd'], ['PUT', '/v1/files?path=/tmp/x'], ['GET', '/v1/config'], ['POST', '/v1/devices'], ['DELETE', '/v1/devices/RM-84']] as const) {
        await assert.rejects(agent.control(m, p, m === 'GET' ? undefined : {}), (e: unknown) => e instanceof AgentError && e.status === 403, `${m} ${p}`);
      }
      await assert.rejects(agent.control('POST', '/v1/apps', { path: '/etc/passwd', type: 'sis' }), (e: unknown) => e instanceof AgentError && e.status === 403);
    } finally { await a.stop(); }
  });

  it('refuses an oversized upload with 413 and removes what it wrote', async () => {
    const { a } = await runAdapter(keyA);
    try {
      const big = Buffer.alloc(1024 * 1024 + 10, 1);
      await assert.rejects(agent.upload('package', 'Big.sis', big, big.length), (e: unknown) => e instanceof AgentError && e.status === 413);
    } finally { await a.stop(); }
  });

  it('reports "not reachable" as a clear error when the service is down', async () => {
    const dead = new AgentClient({ baseUrl: 'http://127.0.0.1:1', token });
    await assert.rejects(dead.health(), (e: unknown) => e instanceof AgentError && e.code === 'unreachable');
  });
});

function readdirCount(dir: string): number {
  try { return readdirSync(dir).length; } catch { return 0; }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The REAL EKA2L1 binary (built from upstream master, see symbian/Dockerfile), without firmware. Only runs when EKA2L1_BIN points at it
// and Xvfb is installed. This checks what can be checked without a ROM: the process starts, its control API answers through the agent
// (which also has to keep the "No device installed" dialog from blocking it), and the allow-list holds.
const realBin = process.env.EKA2L1_BIN && existsSync(process.env.EKA2L1_BIN) && existsSync('/usr/bin/Xvfb') ? process.env.EKA2L1_BIN : null;
describe('agent with the real EKA2L1 (no firmware)', { skip: realBin ? false : 'set EKA2L1_BIN to a built eka2l1_qt (and install Xvfb) to run this' }, () => {
  let xvfb: ChildProcess, proc: ChildProcess, data: string, base: string, agent: AgentClient;
  const token = 'real-token-0123456789abcdef';
  before(async () => {
    data = mkdtempSync(path.join(tmpdir(), 'mgo-symbian-real-'));
    const rt = path.join(data, 'rt'); mkdirSync(rt, { mode: 0o700 });
    xvfb = spawn('Xvfb', [':96', '-screen', '0', '1024x768x24', '+extension', 'GLX', '-nolisten', 'tcp'], { stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 1500));
    const port = await freePort(), control = await freePort();
    base = `http://127.0.0.1:${port}`;
    proc = spawn(process.execPath, [AGENT], { env: { PATH: process.env.PATH ?? '', AGENT_TOKEN: token, AGENT_PORT: String(port), AGENT_HOST: '127.0.0.1', CONTROL_PORT: String(control), DATA_DIR: path.join(data, 'd'), EKA2L1_BIN: realBin!, DISPLAY: ':96', XDG_RUNTIME_DIR: rt, QT_QPA_PLATFORM: 'xcb' }, stdio: 'ignore' });
    for (let i = 0; i < 100; i++) { try { if ((await fetch(`${base}/agent/ping`)).ok) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 100)); }
    agent = new AgentClient({ baseUrl: base, token });
  });
  after(async () => {
    proc?.kill('SIGTERM'); xvfb?.kill('SIGKILL');
    await new Promise((r) => setTimeout(r, 6000));
    rmSync(data, { recursive: true, force: true });
  });
  it('starts, answers /v1/status, has no device, and the dangerous routes stay closed', async () => {
    await agent.startInstance({ saveKey: 'a'.repeat(32), maintenance: true });
    let st: { started?: boolean; device?: unknown; session?: { state?: string } } | null = null;
    for (let i = 0; i < 60 && !st?.started; i++) {
      try { st = await agent.control('GET', '/v1/status'); } catch { await new Promise((r) => setTimeout(r, 1000)); }
    }
    assert.equal(st?.started, true);
    assert.equal(st?.device, null, 'no firmware: no device');
    assert.equal(st?.session?.state, 'none');
    const dev = await agent.control<{ devices: unknown[] }>('GET', '/v1/devices');
    assert.deepEqual(dev.devices, []);
    await assert.rejects(agent.control('GET', '/v1/files?path=/etc/passwd'), (e: unknown) => e instanceof AgentError && e.status === 403);
    await agent.stopInstance();
  });
});
