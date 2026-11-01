// Symbian / N-Gage through the optional jgo-symbian service. The service is the real agent (symbian/agent/agent.mjs); the emulator
// behind it is the FAKE EKA2L1 in tests/fixtures/fake-eka2l1. So this proves JGO's side end to end (library, session, WebSocket
// protocol, firmware upload, saves); it says nothing about what the real EKA2L1 does with a real game or firmware.
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { cleanup, openStream, root, sleep, startApp, waitFor, type TestEnv } from './helpers.ts';

const AGENT = path.join(root, 'symbian/agent/agent.mjs');
const FAKE = path.join(root, 'tests/fixtures/fake-eka2l1/fake-eka2l1.mjs');
const PCM = path.join(root, 'tests/fixtures/fake-eka2l1/pcm.mjs');
const TOKEN = 'integration-token-0123456789';

const free = () => new Promise<number>((res, rej) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)); }); s.on('error', rej); });

async function uploadPkg(base: string, name: string, bytes: Buffer, platform?: string) {
  const fd = new FormData();
  if (platform) fd.append('platform', platform);
  fd.append('file', new Blob([new Uint8Array(bytes)]), name);
  const r = await fetch(`${base}/api/games`, { method: 'POST', body: fd });
  return { status: r.status, body: (await r.json()) as any };
}

async function postFirmware(base: string, slot: string, name: string, bytes: Buffer) {
  const fd = new FormData();
  fd.append('file', new Blob([new Uint8Array(bytes)]), name);
  const r = await fetch(`${base}/api/symbian/firmware?slot=${slot}`, { method: 'POST', body: fd });
  return { status: r.status, body: (await r.json()) as any };
}

describe('Symbian service not configured', () => {
  let env: TestEnv;
  before(async () => { env = await startApp(); });
  after(async () => { await env.stop(); cleanup(env); });

  it('still accepts Symbian games into the library, with their platform', async () => {
    const up = await uploadPkg(env.base, 'Some Game.sis', Buffer.from('sis bytes 1'));
    assert.equal(up.status, 201, JSON.stringify(up.body));
    assert.equal(up.body.game.platform, 'symbian');
    const n2 = await uploadPkg(env.base, 'Pocket Kingdom.n-gage', Buffer.from('ngage bytes'));
    assert.equal(n2.body.game.platform, 'ngage2');
    const card = await uploadPkg(env.base, 'Tony Hawk.zip', Buffer.from('PK\x03\x04card'), 'ngage');
    assert.equal(card.status, 201, JSON.stringify(card.body));
    assert.equal(card.body.game.platform, 'ngage');
    const list = (await (await fetch(`${env.base}/api/games`)).json()) as any[];
    assert.deepEqual(list.map((g) => g.platform).sort(), ['ngage', 'ngage2', 'symbian']);
  });

  it('rejects what is not a game package', async () => {
    assert.equal((await uploadPkg(env.base, 'x.zip', Buffer.from('not a zip'))).status, 400); // no PK magic
    assert.equal((await uploadPkg(env.base, 'x.sis', Buffer.from('a'), 'bogus')).status, 400);
    assert.equal((await uploadPkg(env.base, 'game.sis', Buffer.from('b'), 'ngage')).status, 400); // platform contradicts the extension
  });

  it('answers a session request with a clear 503 instead of failing somewhere inside', async () => {
    const list = (await (await fetch(`${env.base}/api/games`)).json()) as any[];
    const r = await fetch(`${env.base}/api/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ gameId: list[0].id }) });
    assert.equal(r.status, 503);
    assert.equal(((await r.json()) as any).error, 'symbian_unavailable');
  });

  it('has no Java analysis for them (a clean 404, not a server error)', async () => {
    const list = (await (await fetch(`${env.base}/api/games`)).json()) as any[];
    const r = await fetch(`${env.base}/api/games/${list[0].id}/analysis`);
    assert.equal(r.status, 404);
    assert.equal(((await r.json()) as any).error, 'not_applicable');
  });

  it('reports the service as not configured', async () => {
    const st = (await (await fetch(`${env.base}/api/symbian/status`)).json()) as any;
    assert.equal(st.configured, false);
    assert.equal(st.reachable, false);
    assert.equal(st.experimental, true);
    assert.equal((await postFirmware(env.base, 'rom', 'a.rom', Buffer.from('x'))).status, 503);
  });
});

describe('Symbian service (real agent, fake EKA2L1)', () => {
  let env: TestEnv;
  let agent: ChildProcess;
  let agentData: string;

  before(async () => {
    agentData = mkdtempSync(path.join(tmpdir(), 'jgo-symbian-it-'));
    const port = await free();
    agent = spawn(process.execPath, [AGENT], {
      env: { PATH: process.env.PATH ?? '', AGENT_TOKEN: TOKEN, AGENT_PORT: String(port), AGENT_HOST: '127.0.0.1', CONTROL_PORT: String(await free()), DATA_DIR: agentData, EKA2L1_BIN: FAKE, AUDIO_CMD: `${process.execPath} ${PCM}`, MAX_FIRMWARE_BYTES: String(64 * 1024) },
      stdio: 'ignore',
    });
    await waitFor(async () => { try { return (await fetch(`http://127.0.0.1:${port}/agent/ping`)).ok; } catch { return false; } }, 'agent', 10000);
    env = await startApp({ SYMBIAN_AGENT_URL: `http://127.0.0.1:${port}`, SYMBIAN_AGENT_TOKEN: TOKEN });
  });
  after(async () => {
    await env.app.sessions.stopAll();
    await env.stop();
    cleanup(env);
    agent.kill('SIGTERM');
    await sleep(200);
    rmSync(agentData, { recursive: true, force: true });
  });

  let gameId = '';

  it('reports the service reachable, without firmware', async () => {
    const st = (await (await fetch(`${env.base}/api/symbian/status`)).json()) as any;
    assert.equal(st.configured, true);
    assert.equal(st.reachable, true, st.message);
    assert.equal(st.firmware.installed, false);
  });

  it('refuses to start a game before the user has added firmware (412)', async () => {
    const up = await uploadPkg(env.base, 'Racer.sis', Buffer.from('racer'));
    gameId = up.body.game.id;
    const r = await fetch(`${env.base}/api/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ gameId }) });
    assert.equal(r.status, 412);
    assert.equal(((await r.json()) as any).error, 'no_firmware');
  });

  it('validates firmware uploads (slot, name) and passes the size limit of the service through', async () => {
    assert.equal((await postFirmware(env.base, 'nope', 'a.rom', Buffer.from('x'))).status, 400);
    assert.equal((await postFirmware(env.base, 'rpkg', 'a.rom', Buffer.from('x'))).status, 400);
    assert.equal((await postFirmware(env.base, 'archive', 'a.exe', Buffer.from('x'))).status, 400);
  });

  it('streams firmware to the service, installs it as a job, and never keeps a copy in JGO', async () => {
    const rom = await postFirmware(env.base, 'rom', 'RM-84.rom', Buffer.from('fake rom'));
    assert.equal(rom.status, 200, JSON.stringify(rom.body));
    const rpkg = await postFirmware(env.base, 'rpkg', 'RM-84.rpkg', Buffer.from('fake rpkg'));
    assert.equal(rpkg.status, 200);
    const start = await fetch(`${env.base}/api/symbian/firmware/install`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rom: rom.body.file, rpkg: rpkg.body.file }) });
    assert.equal(start.status, 202);
    const job = (await start.json()) as any;
    const done = await waitFor(async () => { const j = (await (await fetch(`${env.base}/api/symbian/jobs/${job.id}`)).json()) as any; return j.state !== 'running' ? j : null; }, 'install job', 30000, 400);
    assert.equal(done.state, 'succeeded', JSON.stringify(done));
    const st = (await (await fetch(`${env.base}/api/symbian/status`)).json()) as any;
    assert.equal(st.firmware.installed, true);
    assert.equal(st.firmware.devices[0].code, 'RM-84');
    // JGO's own data directory holds no firmware
    const all: string[] = [];
    const walk = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else all.push(p); } };
    walk(env.dataDir);
    assert.ok(!all.some((f) => /\.(rom|rpkg)$/i.test(f)), all.join('\n'));
  });

  it('binds a game to a device: validates the code, rejects a device that is not installed at start, accepts the installed one', async () => {
    const patch = (settings: object) => fetch(`${env.base}/api/games/${gameId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings }) });
    assert.equal((await patch({ symbianDevice: '../etc' })).status, 400);
    const ok = await patch({ symbianDevice: 'XX-1' });
    assert.equal(ok.status, 200, await ok.clone().text());
    assert.equal(((await ok.json()) as any).settings.symbianDevice, 'XX-1');
    const start = await fetch(`${env.base}/api/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ gameId }) });
    assert.equal(start.status, 412);
    assert.equal(((await start.json()) as any).error, 'device_missing');
    assert.equal(((await (await patch({ symbianDevice: 'RM-84' })).json()) as any).settings.symbianDevice, 'RM-84');
    assert.equal(((await (await patch({ symbianDevice: null })).json()) as any).settings.symbianDevice, undefined, 'null clears it');
  });

  it('sets a platform default through the API and rejects an unknown device', async () => {
    const put = (body: object) => fetch(`${env.base}/api/symbian/defaults`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await put({ platform: 'ngage', code: 'NOPE-1' })).status, 404);
    assert.equal((await put({ platform: 'wp7', code: 'RM-84' })).status, 400);
    assert.equal((await put({ platform: 'ngage', code: 'RM-84' })).status, 200);
    assert.deepEqual(((await (await fetch(`${env.base}/api/symbian/status`)).json()) as any).defaults, { ngage: 'RM-84' });
    assert.equal((await put({ platform: 'ngage', code: null })).status, 200);
  });

  it('rejects a firmware file over the service limit with 413', async () => {
    const big = await postFirmware(env.base, 'rom', 'big.rom', Buffer.alloc(80 * 1024, 1));
    assert.equal(big.status, 413, JSON.stringify(big.body));
  });

  it('plays a Symbian game: frames of the game\'s own size, sound, keys, then a clean stop', async () => {
    const r = await fetch(`${env.base}/api/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ gameId }) });
    const s = (await r.json()) as any;
    assert.equal(r.status, 201, JSON.stringify(s));
    assert.equal(s.backend, 'eka2l1');
    const ws = await openStream(env.base, s.id);
    try {
      ws.send({ t: 'audio', on: true });
      const f = await waitFor(() => ws.frames.at(-1), 'a frame', 15000);
      assert.equal(f.w, 176);
      assert.equal(f.h, 208);
      assert.equal(f.pixels.length, 176 * 208 * 4);
      await waitFor(() => ws.audio.reduce((n, c) => n + c.length, 0) > 4000, 'sound', 8000);
      // "ok" turns the fake's square yellow
      const yellow = (fr: typeof f) => { let n = 0; for (let i = 0; i < fr.pixels.length; i += 4) if (fr.pixels[i] === 255 && fr.pixels[i + 1] === 255 && fr.pixels[i + 2] === 0) n++; return n; };
      ws.send({ t: 'key', s: 'D', code: -5 });
      await waitFor(() => ws.frames.some((fr) => fr.at > Date.now() - 3000 && yellow(fr) > 100), 'the picture to react to the key', 8000);
      ws.send({ t: 'key', s: 'U', code: -5 });
      const st = (await (await fetch(`${env.base}/api/sessions/${s.id}`)).json()) as any;
      assert.equal(st.backend, 'eka2l1');
      assert.equal(st.width, 176);
      assert.equal(st.height, 208);
    } finally {
      ws.close();
    }
    const del = await fetch(`${env.base}/api/sessions/${s.id}`, { method: 'DELETE' });
    assert.ok(del.status === 200 || del.status === 204);
    await waitFor(async () => !((await (await fetch(`${env.base}/api/symbian/status`)).json()) as any).busy, 'the service to become idle', 8000);
  });

  it('offers a diagnostics report with the service log and the emulator\'s last words', async () => {
    const r = await fetch(`${env.base}/api/symbian/diagnostics`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-disposition') ?? '', /attachment/);
    const t = await r.text();
    assert.match(t, /service: reachable/);
    assert.match(t, /devices: Nokia Fake RM-84 \(RM-84\)/);
    assert.match(t, /--- service log/);
    assert.match(t, /instance started/, 'the agent log tells what happened');
    assert.doesNotMatch(t, new RegExp(TOKEN), 'the token never appears in a report');
  });

  it('keeps the game\'s saves in the service and removes them with the game', async () => {
    const savesRoot = path.join(agentData, 'saves');
    assert.equal(readdirSync(savesRoot).length, 1, 'one game has played, one save directory');
    const d = await fetch(`${env.base}/api/games/${gameId}?saves=1`, { method: 'DELETE' });
    assert.equal(d.status, 204);
    await waitFor(() => !existsSync(savesRoot) || readdirSync(savesRoot).length === 0, 'the service to drop the saves', 5000);
  });
});
