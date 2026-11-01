import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentClient, AgentError } from './agentClient.js';
import { Eka2l1Adapter } from './adapter.js';
import { DeviceChoiceError, pickDevice, type InstalledDevice } from './device.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const dev = (code: string): InstalledDevice => ({ code, manufacturer: 'Nokia', model: `Fake ${code}` });

describe('pickDevice: which firmware a game runs on', () => {
  const two = [dev('NEM-4'), dev('RM-84')];
  const throwsCode = (fn: () => unknown, code: string) => assert.throws(fn, (e: unknown) => e instanceof DeviceChoiceError && e.code === code);
  it('the game\'s own device wins over a default', () => {
    assert.equal(pickDevice({ requested: 'rm-84', defaults: { ngage: 'NEM-4' }, platform: 'ngage', devices: two }).code, 'RM-84');
  });
  it('the platform default comes next', () => {
    assert.equal(pickDevice({ requested: null, defaults: { ngage: 'NEM-4', symbian: 'RM-84' }, platform: 'ngage', devices: two }).code, 'NEM-4');
    assert.equal(pickDevice({ requested: undefined, defaults: { ngage: 'NEM-4', symbian: 'RM-84' }, platform: 'symbian', devices: two }).code, 'RM-84');
  });
  it('a single installed device is used when nothing is chosen', () => {
    assert.equal(pickDevice({ requested: null, defaults: {}, platform: 'ngage2', devices: [dev('NEM-4')] }).code, 'NEM-4');
  });
  it('several devices and no choice: refuses instead of taking the first', () => {
    throwsCode(() => pickDevice({ requested: null, defaults: {}, platform: 'ngage', devices: two }), 'device_required');
    throwsCode(() => pickDevice({ requested: null, defaults: { symbian: 'RM-84' }, platform: 'ngage', devices: two }), 'device_required');
  });
  it('a missing device (own or default) is an error, never a silent fallback', () => {
    throwsCode(() => pickDevice({ requested: 'RH-29', defaults: {}, platform: 'ngage', devices: two }), 'device_missing');
    throwsCode(() => pickDevice({ requested: null, defaults: { ngage: 'RH-29' }, platform: 'ngage', devices: [dev('NEM-4')] }), 'device_missing');
  });
  it('no firmware at all', () => {
    throwsCode(() => pickDevice({ requested: null, defaults: {}, platform: 'ngage', devices: [] }), 'no_firmware');
  });
});

const free = () => new Promise<number>((res, rej) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)); }); s.on('error', rej); });
const TOKEN = 'device-token-0123456789abcdef';

describe('several devices and the inbox, against the agent with a fake EKA2L1', () => {
  let proc: ChildProcess, data: string, inbox: string, base: string, agent: AgentClient;
  const key = 'e'.repeat(32);

  before(async () => {
    data = mkdtempSync(path.join(tmpdir(), 'jgo-dev-'));
    inbox = path.join(data, 'inbox-dir');
    mkdirSync(inbox);
    const port = await free();
    base = `http://127.0.0.1:${port}`;
    proc = spawn(process.execPath, [path.join(root, 'symbian/agent/agent.mjs')], {
      env: { PATH: process.env.PATH ?? '', AGENT_TOKEN: TOKEN, AGENT_PORT: String(port), AGENT_HOST: '127.0.0.1', CONTROL_PORT: String(await free()), DATA_DIR: path.join(data, 'd'), INBOX_DIR: inbox, EKA2L1_BIN: path.join(root, 'tests/fixtures/fake-eka2l1/fake-eka2l1.mjs'), AUDIO_CMD: `${process.execPath} ${path.join(root, 'tests/fixtures/fake-eka2l1/pcm.mjs')}` },
      stdio: 'ignore',
    });
    for (let i = 0; i < 100; i++) { try { if ((await fetch(`${base}/agent/ping`)).ok) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 100)); }
    agent = new AgentClient({ baseUrl: base, token: TOKEN });
  });
  after(async () => { proc?.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 300)); rmSync(data, { recursive: true, force: true }); });

  const jobDone = async (id: string) => { for (let i = 0; i < 80; i++) { const j = await agent.job(id); if (j.state !== 'running') return j; await new Promise((r) => setTimeout(r, 400)); } throw new Error('job timeout'); };
  const adapter = (over: { deviceCode?: string | null; platform?: 'ngage' | 'symbian' } = {}) => {
    const f = path.join(data, 'g.sis'); writeFileSync(f, 'fake sis');
    return new Eka2l1Adapter({ agent, saveKey: key, platform: over.platform ?? 'symbian', packagePath: f, fileName: 'g.sis', frameEncoding: 'raw', ...(over.deviceCode !== undefined ? { deviceCode: over.deviceCode } : {}) });
  };
  const upload = async (slot: string, name: string) => ((await (await fetch(`${base}/agent/firmware/${slot}?name=${name}`, { method: 'PUT', headers: { authorization: `Bearer ${TOKEN}` }, body: 'x' })).json()) as { file: string }).file;

  it('installs two different firmwares', async () => {
    for (const name of ['NEM-4.rom', 'RM-84.rom']) {
      const rom = await upload('rom', name);
      const j = await jobDone((await agent.installFirmware({ rom })).id);
      assert.equal(j.state, 'succeeded', j.error ?? '');
    }
    assert.deepEqual((await agent.health()).firmware.devices.map((d) => d.code).sort(), ['NEM-4', 'RM-84']);
  });

  it('refuses to start a game with no device chosen (409) and starts no process', async () => {
    await assert.rejects(adapter().start(), (e: unknown) => e instanceof AgentError && e.status === 409 && e.code === 'device_required');
    assert.equal((await agent.health()).instance.running, false);
  });

  it('boots the device the game is bound to', async () => {
    for (const code of ['NEM-4', 'RM-84']) {
      const a = adapter({ deviceCode: code });
      await a.start();
      try {
        const st = await agent.control<{ device: { code: string } }>('GET', '/v1/status');
        assert.equal(st.device.code, code);
      } finally { await a.stop(); }
    }
  });

  it('a device that is not installed is a 412, not a silent other firmware', async () => {
    await assert.rejects(adapter({ deviceCode: 'RH-29' }).start(), (e: unknown) => e instanceof AgentError && e.status === 412 && e.code === 'device_missing');
  });

  it('per-platform defaults pick the device, a game\'s own choice beats them, removing the device clears the default', async () => {
    await agent.setDefault('ngage', 'NEM-4');
    await agent.setDefault('symbian', 'RM-84');
    const h = await agent.health();
    assert.deepEqual(h.defaults, { ngage: 'NEM-4', symbian: 'RM-84' });
    const a = adapter({ platform: 'symbian' });
    await a.start();
    assert.equal((await agent.control<{ device: { code: string } }>('GET', '/v1/status')).device.code, 'RM-84');
    await a.stop();
    const b = adapter({ platform: 'symbian', deviceCode: 'NEM-4' });
    await b.start();
    assert.equal((await agent.control<{ device: { code: string } }>('GET', '/v1/status')).device.code, 'NEM-4');
    await b.stop();
    await assert.rejects(agent.setDefault('symbian', 'XX-1'), (e: unknown) => e instanceof AgentError && e.status === 404);
    const del = await agent.deleteDevice('RM-84');
    assert.equal((await jobDone(del.id)).state, 'succeeded');
    const after = await agent.health();
    assert.deepEqual(after.defaults, { ngage: 'NEM-4' }, 'the default of the removed device is gone');
    assert.deepEqual(after.firmware.devices.map((d) => d.code), ['NEM-4']);
  });

  it('firmware from the inbox folder: listed, installed without copying, and never deleted', async () => {
    writeFileSync(path.join(inbox, 'RH-29.rom'), 'fake rom from the inbox');
    writeFileSync(path.join(data, 'outside.rom'), 'secret');
    symlinkSync(path.join(data, 'outside.rom'), path.join(inbox, 'link.rom'));
    mkdirSync(path.join(inbox, 'subdir'));
    const h = await agent.health();
    assert.deepEqual(h.inbox?.map((f) => f.name), ['RH-29.rom'], 'only plain files: no links, no folders');
    await assert.rejects(agent.installFirmware({ rom: 'link.rom', source: 'inbox' }), (e: unknown) => e instanceof AgentError && e.status === 400);
    await assert.rejects(agent.installFirmware({ rom: '../outside.rom', source: 'inbox' }), (e: unknown) => e instanceof AgentError && e.status === 400);
    const j = await jobDone((await agent.installFirmware({ rom: 'RH-29.rom', source: 'inbox' })).id);
    assert.equal(j.state, 'succeeded', j.error ?? '');
    assert.ok((await agent.health()).firmware.devices.some((d) => d.code === 'RH-29'));
    assert.ok(existsSync(path.join(inbox, 'RH-29.rom')), 'the operator\'s file stays');
  });
});

// ---- N-Gage 1.0 card dumps: a zip with a wrapping folder and upper-case folder names must still become `<root>/system/apps` ----
import { crc32 } from 'node:zlib';
function makeZip(entries: Record<string, string>): Buffer {
  const files: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const data = Buffer.from(text), nm = Buffer.from(name), crc = crc32(data);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nm.length, 26);
    const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(data.length, 24); cd.writeUInt16LE(nm.length, 28); cd.writeUInt32LE(offset, 42);
    files.push(local, nm, data); central.push(cd, nm);
    offset += 30 + nm.length + data.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10); end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...files, cdBuf, end]);
}

describe('N-Gage 1.0 card upload', () => {
  let proc: ChildProcess, data: string, agent: AgentClient;
  before(async () => {
    data = mkdtempSync(path.join(tmpdir(), 'jgo-card-'));
    const port = await free();
    proc = spawn(process.execPath, [path.join(root, 'symbian/agent/agent.mjs')], { env: { PATH: process.env.PATH ?? '', AGENT_TOKEN: TOKEN, AGENT_PORT: String(port), AGENT_HOST: '127.0.0.1', CONTROL_PORT: String(await free()), DATA_DIR: data, EKA2L1_BIN: path.join(root, 'tests/fixtures/fake-eka2l1/fake-eka2l1.mjs') }, stdio: 'ignore' });
    const base = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 100; i++) { try { if ((await fetch(`${base}/agent/ping`)).ok) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 100)); }
    agent = new AgentClient({ baseUrl: base, token: TOKEN });
    const fw = await fetch(`${base}/agent/firmware/rom?name=RM-84.rom`, { method: 'PUT', headers: { authorization: `Bearer ${TOKEN}` }, body: 'x' });
    const job = await agent.installFirmware({ rom: ((await fw.json()) as { file: string }).file });
    for (let i = 0; i < 60 && (await agent.job(job.id)).state === 'running'; i++) await new Promise((r) => setTimeout(r, 400));
  });
  after(async () => { proc?.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 300)); rmSync(data, { recursive: true, force: true }); });

  const upload = async (zip: Buffer) => {
    await agent.startInstance({ saveKey: 'f'.repeat(32) });
    try { return await agent.upload('card', 'card.zip', zip, zip.length); } finally { await agent.stopInstance(); }
  };

  it('finds system/apps under a wrapping folder in any letter case, and installs it as a card', async () => {
    const zip = makeZip({ 'Space Impact/System/Apps/spaceimpact/spaceimpact.app': 'app', 'Space Impact/System/Apps/spaceimpact/data.bin': 'data' });
    const f = path.join(data, 'c.zip'); writeFileSync(f, zip);
    const a = new Eka2l1Adapter({ agent, saveKey: 'f'.repeat(32), platform: 'ngage', packagePath: f, fileName: 'Space Impact.zip', frameEncoding: 'raw' });
    await a.start(); // the fake rejects an `ngage` install whose folder has no lower-case system/apps
    try { assert.equal(a.state, 'running'); } finally { await a.stop(); }
  });

  it('refuses a zip without system/apps with a clear message', async () => {
    await assert.rejects(upload(makeZip({ 'readme.txt': 'hi' })), (e: unknown) => e instanceof AgentError && e.status === 422 && e.code === 'bad_card' && /system\/apps/.test(e.message));
  });

  it('refuses paths that leave the folder', async () => {
    await assert.rejects(upload(makeZip({ '../evil/system/apps/x': 'x' })), (e: unknown) => e instanceof AgentError && e.status === 422);
  });
});

// ---- a full volume must refuse a firmware before it leaves a half-written device behind ----
import http from 'node:http';
describe('free space guard', () => {
  let proc: ChildProcess, data: string, base: string, agent: AgentClient;
  before(async () => {
    data = mkdtempSync(path.join(tmpdir(), 'jgo-disk-'));
    const port = await free();
    base = `http://127.0.0.1:${port}`;
    proc = spawn(process.execPath, [path.join(root, 'symbian/agent/agent.mjs')], { env: { PATH: process.env.PATH ?? '', AGENT_TOKEN: TOKEN, AGENT_PORT: String(port), AGENT_HOST: '127.0.0.1', CONTROL_PORT: String(await free()), DATA_DIR: data, EKA2L1_BIN: path.join(root, 'tests/fixtures/fake-eka2l1/fake-eka2l1.mjs'), MAX_FIRMWARE_BYTES: String(1e15), INSTALL_SPACE_FACTOR: '1e12' }, stdio: 'ignore' });
    for (let i = 0; i < 100; i++) { try { if ((await fetch(`${base}/agent/ping`)).ok) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 100)); }
    agent = new AgentClient({ baseUrl: base, token: TOKEN });
  });
  after(async () => { proc?.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 300)); rmSync(data, { recursive: true, force: true }); });

  it('reports the free space of the volume', async () => {
    const h = await agent.health();
    assert.ok(h.disk && h.disk.total > 0 && h.disk.free > 0 && h.disk.free <= h.disk.total);
  });

  it('refuses an upload that cannot fit, before reading it (507)', async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const r = http.request(`${base}/agent/firmware/rom?name=huge.rom`, { method: 'PUT', headers: { authorization: `Bearer ${TOKEN}`, 'content-length': String(1e14) } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
      r.on('error', reject);
      r.flushHeaders();
    });
    assert.equal(status, 507);
  });

  it('refuses to install a firmware whose unpacking would not fit (507) and starts nothing', async () => {
    const up = await fetch(`${base}/agent/firmware/rom?name=RM-84.rom`, { method: 'PUT', headers: { authorization: `Bearer ${TOKEN}` }, body: 'x' });
    const rom = ((await up.json()) as { file: string }).file;
    await assert.rejects(agent.installFirmware({ rom }), (e: unknown) => e instanceof AgentError && e.status === 507 && e.code === 'insufficient_storage' && /free space/.test(e.message));
    assert.equal((await agent.health()).firmware.installed, false);
    assert.equal((await agent.health()).instance.running, false);
  });
});

// ---- the default compose file has no token to type in: the service creates the shared secret on a volume, MGO reads it from there ----
import { readFileSync as readFileSyncForToken } from 'node:fs';
import { resolveAgentToken } from './agentClient.js';
describe('shared secret in a file', () => {
  let proc: ChildProcess, data: string, base: string;
  before(async () => {
    data = mkdtempSync(path.join(tmpdir(), 'jgo-tok-'));
    const port = await free();
    base = `http://127.0.0.1:${port}`;
    proc = spawn(process.execPath, [path.join(root, 'symbian/agent/agent.mjs')], { env: { PATH: process.env.PATH ?? '', AGENT_TOKEN_FILE: path.join(data, 'secrets', 'symbian.token'), AGENT_PORT: String(port), AGENT_HOST: '127.0.0.1', CONTROL_PORT: String(await free()), DATA_DIR: path.join(data, 'd'), EKA2L1_BIN: path.join(root, 'tests/fixtures/fake-eka2l1/fake-eka2l1.mjs') }, stdio: 'ignore' });
    for (let i = 0; i < 100; i++) { try { if ((await fetch(`${base}/agent/ping`)).ok) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 100)); }
  });
  after(async () => { proc?.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 300)); rmSync(data, { recursive: true, force: true }); });

  it('the service creates a strong token on its first start, and MGO reads it lazily (also when the file appears later)', async () => {
    const file = path.join(data, 'secrets', 'symbian.token');
    const token = readFileSyncForToken(file, 'utf8').trim();
    assert.match(token, /^[0-9a-f]{48}$/);
    assert.equal((await fetch(`${base}/agent/health`)).status, 401);
    assert.equal((await fetch(`${base}/agent/health`, { headers: { authorization: `Bearer ${token}` } })).status, 200);
    const cfg = { symbianAgentUrl: base, symbianAgentToken: null, symbianAgentTokenFile: file };
    assert.equal(resolveAgentToken(cfg), token);
    assert.equal(resolveAgentToken({ ...cfg, symbianAgentTokenFile: path.join(data, 'nope') }), null, 'a missing file is "no token yet", not an error');
    assert.equal(resolveAgentToken({ ...cfg, symbianAgentToken: 'explicit-token-0123456789' }), 'explicit-token-0123456789', 'an explicit token wins');
    const h = await new AgentClient({ baseUrl: base, token: () => resolveAgentToken(cfg) }).health();
    assert.equal(h.ok, true);
  });
});
