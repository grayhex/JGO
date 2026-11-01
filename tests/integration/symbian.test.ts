// Symbian / N-Gage through the optional mgo-symbian service. The service is the real agent (symbian/agent/agent.mjs); the emulator
// behind it is the FAKE EKA2L1 in tests/fixtures/fake-eka2l1. So this proves MGO's side end to end (library, session, WebSocket
// protocol, firmware upload, saves); it says nothing about what the real EKA2L1 does with a real game or firmware.
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { request as httpRequest } from 'node:http';
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

async function postFirmware(base: string, slot: string, name: string, bytes: Buffer, bundle?: string) {
  const fd = new FormData();
  fd.append('file', new Blob([new Uint8Array(bytes)]), name);
  const r = await fetch(`${base}/api/symbian/firmware?slot=${slot}${bundle ? `&bundle=${bundle}` : ''}`, { method: 'POST', body: fd });
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
    agentData = mkdtempSync(path.join(tmpdir(), 'mgo-symbian-it-'));
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

  it('streams firmware to the service, installs it as a job, and never keeps a copy in MGO', async () => {
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
    // MGO's own data directory holds no firmware
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

  it('a Symbian 9 package is refused on Symbian 8.x firmware before anything is installed (the Worms World / N70 report)', async () => {
    const head = Buffer.alloc(24); head.writeUInt32LE(0x10201a7a, 0);
    const up = await uploadPkg(env.base, 'wormsworld.sisx', Buffer.concat([head, Buffer.from('FAKE:never_installed')]));
    assert.equal(up.status, 201, JSON.stringify(up.body));
    assert.equal(up.body.game.packageFormat, 'sis9');
    const r = await fetch(`${env.base}/api/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ gameId: up.body.game.id }) });
    const body = (await r.json()) as any;
    assert.equal(r.status, 422, JSON.stringify(body));
    assert.equal(body.error, 'incompatible_package');
    assert.match(body.message, /Symbian 9/);
    assert.match(body.message, /Nokia N70/);
    // nothing was uploaded to the service or started
    const st = (await (await fetch(`${env.base}/api/symbian/status`)).json()) as any;
    assert.equal(st.busy, false);
    const plan = (await (await fetch(`${env.base}/api/games/${up.body.game.id}/phone`)).json()) as any;
    assert.equal(plan.plan.code, 'incompatible_package');
    await fetch(`${env.base}/api/games/${up.body.game.id}?saves=1`, { method: 'DELETE' });
  });

  it('S60 and N-Gage games never inherit the J2ME default phone, and never start on a phone that cannot host them', async () => {
    // somebody made a Sony Ericsson the default phone for new Java games...
    const set = await fetch(`${env.base}/api/settings`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: { skinId: 'sony-ericsson-k790i', width: 240, height: 320, layout: 'sonyericsson' } }) });
    assert.equal(set.status, 200, await set.clone().text());
    const up = await uploadPkg(env.base, 'Phone Check.sis', Buffer.from('phone check'));
    const g = up.body.game;
    // ...a Symbian game does not get it: no skin pinned, the screen of a typical S60 phone, a neutral layout
    assert.equal(g.settings.skinId, undefined);
    assert.deepEqual([g.settings.width, g.settings.height, g.settings.layout], [176, 208, 'nokia']);
    // a stale or hand-made Sony Ericsson skin on the game is refused at the start, before anything runs
    const patched = await fetch(`${env.base}/api/games/${g.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings: { skinId: 'sony-ericsson-k790i' } }) });
    assert.equal(patched.status, 200);
    const r = await fetch(`${env.base}/api/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ gameId: g.id }) });
    const body = (await r.json()) as any;
    assert.equal(r.status, 412, JSON.stringify(body));
    assert.equal(body.error, 'incompatible_skin');
    assert.match(body.message, /Java ME phone is not a Symbian or N-Gage device/);
    assert.match(body.message, /Nokia N70/, 'it names a phone that fits the installed firmware');
    // with a Nokia that has a profile the same game starts at the size of that phone
    await fetch(`${env.base}/api/games/${g.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings: { skinId: 'nokia-n70' } }) });
    const ok = await fetch(`${env.base}/api/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ gameId: g.id }) });
    const s = (await ok.json()) as any;
    assert.equal(ok.status, 201, JSON.stringify(s));
    assert.deepEqual([s.width, s.height], [176, 208]);
    await fetch(`${env.base}/api/sessions/${s.id}`, { method: 'DELETE' });
    await waitFor(async () => !((await (await fetch(`${env.base}/api/symbian/status`)).json()) as any).busy, 'the service to be idle again', 8000);
    await fetch(`${env.base}/api/settings`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: { skinId: 'nokia-n95', width: 240, height: 320, layout: 'nokia' } }) });
    await fetch(`${env.base}/api/games/${g.id}?saves=1`, { method: 'DELETE' });
  });

  it('a game that cannot be started says why: the failure travels with the error, is kept in the session and ends up in the diagnostics', async () => {
    const up = await uploadPkg(env.base, 'Contra.sis', Buffer.from('FAKE:launch_fail FAKE:fonterror'));
    const r = await fetch(`${env.base}/api/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ gameId: up.body.game.id }) });
    const body = (await r.json()) as any;
    assert.equal(r.status, 500, JSON.stringify(body));
    assert.equal(body.error, 'start_failed');
    assert.match(body.message, /refused to start the application/);
    const f = body.details.failure;
    assert.equal(f.cause, 'launch_rejected');
    assert.equal(f.launch.httpStatus, 422);
    assert.equal(f.likelyIncompatibleGame, true);
    assert.match(f.uid, /^0x2000A/);
    // the failed session stays inspectable, with the reason in its status and in the report
    const sid = body.details.sessionId as string;
    const st = (await (await fetch(`${env.base}/api/sessions/${sid}`)).json()) as any;
    assert.equal(st.state, 'failed');
    assert.equal(st.failure.cause, 'launch_rejected');
    assert.match(st.exitDetail, /refused to start the application/);
    const rep = await (await fetch(`${env.base}/api/sessions/${sid}/diagnostics`)).text();
    assert.match(rep, /==== start failure ====/);
    assert.match(rep, /RESULT: launch_rejected at step "launch"/);
    assert.match(rep, /LAUNCH ANSWER: HTTP 422 launch_failed/);
    assert.match(rep, /INCOMPATIBILITY between this game and EKA2L1/);
    assert.match(rep, /FreeType failed to query face count/);
    assert.match(rep, /==== Symbian service ====/);
    assert.doesNotMatch(rep, new RegExp(TOKEN));
    await waitFor(async () => !((await (await fetch(`${env.base}/api/symbian/status`)).json()) as any).busy, 'the service to be idle again', 8000);
  });

  it('keeps the game\'s saves in the service and removes them with the game', async () => {
    const savesRoot = path.join(agentData, 'saves');
    const before = readdirSync(savesRoot).length;
    assert.equal(before, 2, 'the game that played and the one that failed to start each have a save directory');
    const d = await fetch(`${env.base}/api/games/${gameId}?saves=1`, { method: 'DELETE' });
    assert.equal(d.status, 204);
    await waitFor(() => readdirSync(savesRoot).length === before - 1, 'the service to drop the deleted game\'s saves only', 5000);
  });

  it('serializes uploads in a factory bundle, including filenames that differ only by case', async () => {
    const bundle = 'd'.repeat(32);
    const agentBase = env.app.cfg.symbianAgentUrl!;
    const headers = { authorization: `Bearer ${TOKEN}` };
    const upload = httpRequest(`${agentBase}/agent/firmware/fpsx?bundle=${bundle}&name=Core.fpsx`, { method: 'PUT', headers });
    const finished = new Promise<number>((resolve, reject) => {
      upload.on('response', response => { response.resume(); response.on('end', () => resolve(response.statusCode!)); });
      upload.on('error', reject);
    });
    try {
      upload.write('held upload');
      await waitFor(() => existsSync(path.join(agentData, 'firmware-upload', 'factory', bundle, 'Core.fpsx.part')), 'the first image upload', 5000);
      const conflict = await fetch(`${agentBase}/agent/firmware/fpsx?bundle=${bundle}&name=core.fpsx`, { method: 'PUT', headers, body: 'conflicting image' });
      assert.equal(conflict.status, 409, 'a concurrent case-alias cannot bypass the bundle lock');
      upload.end(' completed');
      assert.equal(await finished, 200);
      assert.equal((await fetch(`${env.base}/api/symbian/firmware/bundles/${bundle}`, { method: 'DELETE' })).status, 204);
    } finally { upload.destroy(); }
  });

  it('installs an original-named VPL/FPSX kit through MGO, without a pre-dumped ROM', async () => {
    const bundle = 'a'.repeat(32);
    const xml = '<VariantPackingList><Variant><VariantIdentification><Description>Factory synthetic</Description></VariantIdentification><FileList><File><FileType>Binary</FileType><FileSubType>Mcu</FileSubType><Name>core.fpsx</Name></File></FileList></Variant></VariantPackingList>';
    const up = await postFirmware(env.base, 'vpl', 'RM-596.vpl', Buffer.from(xml), bundle);
    assert.equal(up.status, 200, JSON.stringify(up.body)); assert.equal(up.body.file, 'RM-596.vpl');
    assert.equal((await postFirmware(env.base, 'fpsx', 'core.fpsx', Buffer.from('synthetic fake-only image'), bundle)).status, 200);
    const staging = path.join(agentData, 'firmware-upload', 'factory', bundle);
    assert.equal(readFileSync(path.join(staging, 'RM-596.vpl'), 'utf8'), xml);
    assert.equal((await postFirmware(env.base, 'fpsx', 'core.fpsx', Buffer.from('overwrite'), bundle)).status, 400);
    const install = await fetch(env.base + '/api/symbian/firmware/install', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ vpl: up.body.file, bundle, variant: 0 }) });
    assert.equal(install.status, 202);
    const job = await install.json() as any;
    const done = await waitFor(async () => { const j = await (await fetch(env.base + '/api/symbian/jobs/' + job.id)).json() as any; return j.state !== 'running' ? j : null; }, 'factory installation', 30000, 200);
    assert.equal(done.state, 'succeeded', JSON.stringify(done));
    assert.ok(!existsSync(staging), 'all uploaded kit images are cleaned after installation');
    assert.ok(((await (await fetch(env.base + '/api/symbian/status')).json()) as any).firmware.devices.some((d: any) => d.code === 'RM-596'));
    assert.equal(readdirSync(env.dataDir, { recursive: true }).some(f => /\.(vpl|fpsx)$/i.test(String(f))), false, 'MGO never retains firmware');
  });

  it('refuses incomplete kits, invalid variants, wrong bundle ids and mixed firmware formats', async () => {
    const call = (body: object) => fetch(env.base + '/api/symbian/firmware/install', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await call({ vpl: 'x.vpl' })).status, 400);
    assert.equal((await call({ vpl: 'x.vpl', bundle: '../escape' })).status, 400);
    assert.equal((await call({ vpl: 'x.vpl', bundle: 'a'.repeat(32), variant: -1 })).status, 400);
    assert.equal((await call({ vpl: 'x.vpl', bundle: 'a'.repeat(32), rom: 'x.rom' })).status, 400);
    assert.equal((await call({ rom: 'x.rom', variant: 1 })).status, 400);
    assert.equal((await postFirmware(env.base, 'fpsx', 'core.fpsx', Buffer.from('image'))).status, 400);
    const bundle = 'b'.repeat(32);
    const xml = '<VariantPackingList><Variant><VariantIdentification><Description>Missing image</Description></VariantIdentification><FileList><File><FileType>Binary</FileType><FileSubType>Mcu</FileSubType><Name>absent.fpsx</Name></File></FileList></Variant></VariantPackingList>';
    await postFirmware(env.base, 'vpl', 'RM-596.vpl', Buffer.from(xml), bundle);
    assert.equal((await call({ vpl: 'RM-596.vpl', bundle })).status, 400, 'a manifest alone is not a complete kit');
    await postFirmware(env.base, 'fpsx', 'other.fpsx', Buffer.from('synthetic image'), bundle);
    const install = await call({ vpl: 'RM-596.vpl', bundle });
    assert.equal(install.status, 202);
    const job = await install.json() as any;
    const done = await waitFor(async () => { const j = await (await fetch(env.base + '/api/symbian/jobs/' + job.id)).json() as any; return j.state !== 'running' ? j : null; }, 'missing-image failure', 30000, 200);
    assert.equal(done.state, 'failed'); assert.equal(done.errorCode, 'firmware_file_missing');
    assert.ok(!existsSync(path.join(agentData, 'firmware-upload', 'factory', bundle)));
    const unused = 'c'.repeat(32);
    await postFirmware(env.base, 'vpl', 'RM-596.vpl', Buffer.from(xml), unused);
    assert.equal((await fetch(env.base + '/api/symbian/firmware/bundles/' + unused, { method: 'DELETE' })).status, 204);
    assert.ok(!existsSync(path.join(agentData, 'firmware-upload', 'factory', unused)));
  });

});
