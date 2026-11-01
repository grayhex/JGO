import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentClient } from './agentClient.js';
import { Eka2l1Adapter } from './adapter.js';
import { classifyLog, hintsFor } from './failure.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const TOKEN = 'failure-token-0123456789abcdef';
const free = () => new Promise<number>((res, rej) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)); }); s.on('error', rej); });

describe('classifyLog and hintsFor', () => {
  const log = [
    '[eka2l1] emulator: I /src/src/emu/kernel/src/chunk.cpp:157 [Kernel]: Chunk created: x',
    '[eka2l1] emulator: T /src/src/emu/services/src/fbs/impls/font.cpp:1257 [Service.Fbs]: Found font folder: Z:\\System\\Fonts\\',
    '[eka2l1] emulator: E /src/src/emu/services/src/fbs/adapter/freetype_font_adapter.cpp:137 [Service.Fbs]: FreeType failed to query face count from memory, error: unknown file format',
    '[eka2l1] EKA2L1.log: E /src/src/emu/services/src/fbs/adapter/freetype_font_adapter.cpp:137 [Service.Fbs]: FreeType failed to query face count from memory, error: unknown file format',
    'E /src/src/emu/kernel/src/thread.cpp:1 [Kernel]: panic KERN-EXEC/3',
  ];
  it('keeps the error lines and the font lines, once each, and drops the chatter', () => {
    const c = classifyLog(log);
    assert.equal(c.errors.length, 2, JSON.stringify(c.errors));
    assert.ok(c.errors.some((l) => /panic KERN-EXEC\/3/.test(l)));
    assert.equal(c.fonts.length, 2);
    assert.ok(!c.errors.some((l) => /Chunk created/.test(l)));
  });
  const base = { message: 'm', platform: 'symbian', firmwareOs: 'Symbian 8.1a / S60 2nd Edition FP3', launchCode: null, lastExit: null, fonts: [], errors: [], screenshotErrors: [] };
  it('blames the game only when the facts say the application failed, never for a missing picture alone', () => {
    assert.equal(hintsFor({ ...base, cause: 'launch_rejected' }).likelyIncompatibleGame, true);
    assert.equal(hintsFor({ ...base, cause: 'app_crashed', lastExit: { fatal: 'KERN-EXEC/3' } }).likelyIncompatibleGame, true);
    assert.match(hintsFor({ ...base, cause: 'app_crashed', lastExit: { fatal: 'KERN-EXEC/3' } }).hints.join(' '), /KERN-EXEC\/3/);
    assert.equal(hintsFor({ ...base, cause: 'no_picture' }).likelyIncompatibleGame, false);
    assert.equal(hintsFor({ ...base, cause: 'service' }).likelyIncompatibleGame, false);
  });
  it('explains the FreeType line as a probe, not as the cause, and says what is not known', () => {
    const h = hintsFor({ ...base, cause: 'launch_rejected', fonts: ['E /x [Service.Fbs]: FreeType failed to query face count from memory, error: unknown file format'] }).hints.join('\n');
    assert.match(h, /GDR reader/);
    assert.match(h, /alone does not mean failure/);
    assert.match(h, /EKA1/);
  });
});

describe('a Symbian start that fails says exactly why (agent + fake EKA2L1)', () => {
  let proc: ChildProcess, data: string, agent: AgentClient;
  before(async () => {
    data = mkdtempSync(path.join(tmpdir(), 'jgo-fail-'));
    const port = await free();
    const base = `http://127.0.0.1:${port}`;
    proc = spawn(process.execPath, [path.join(root, 'symbian/agent/agent.mjs')], { env: { PATH: process.env.PATH ?? '', AGENT_TOKEN: TOKEN, AGENT_PORT: String(port), AGENT_HOST: '127.0.0.1', CONTROL_PORT: String(await free()), DATA_DIR: data, EKA2L1_BIN: path.join(root, 'tests/fixtures/fake-eka2l1/fake-eka2l1.mjs'), AUDIO_CMD: `${process.execPath} ${path.join(root, 'tests/fixtures/fake-eka2l1/pcm.mjs')}` }, stdio: 'ignore' });
    for (let i = 0; i < 100; i++) { try { if ((await fetch(`${base}/agent/ping`)).ok) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 100)); }
    agent = new AgentClient({ baseUrl: base, token: TOKEN });
    const up = await fetch(`${base}/agent/firmware/rom?name=RM-84.rom`, { method: 'PUT', headers: { authorization: `Bearer ${TOKEN}` }, body: 'x' });
    const job = await agent.installFirmware({ rom: ((await up.json()) as { file: string }).file });
    for (let i = 0; i < 60 && (await agent.job(job.id)).state === 'running'; i++) await new Promise((r) => setTimeout(r, 400));
  });
  after(async () => { proc?.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 300)); rmSync(data, { recursive: true, force: true }); });

  let n = 0;
  const run = async (marker: string, over: { pictureTimeoutMs?: number } = {}) => {
    const f = path.join(data, `g${++n}.sis`); writeFileSync(f, marker);
    const a = new Eka2l1Adapter({ agent, saveKey: String(n).padStart(32, '0'), platform: 'symbian', packagePath: f, fileName: `Contra${n}.sis`, frameEncoding: 'raw', pictureTimeoutMs: 4000, ...over });
    const logs: string[] = [];
    a.on('log', (l) => logs.push(l));
    await assert.rejects(a.start());
    assert.equal(a.state, 'exited');
    return { failure: a.getFailure()!, logs, exit: a.getStatus().exit };
  };

  it('launch refused (422 launch_failed): the answer, the UID, the application and a game-compatibility verdict', async () => {
    const { failure: f, logs, exit } = await run('FAKE:launch_fail');
    assert.equal(f.cause, 'launch_rejected');
    assert.equal(f.stage, 'launch');
    assert.match(f.uid ?? '', /^0x2000A/);
    assert.match(f.appName ?? '', /Contra/);
    assert.equal(f.launch?.httpStatus, 422);
    assert.equal(f.launch?.code, 'launch_failed');
    assert.equal(f.likelyIncompatibleGame, true);
    assert.equal(f.firmware?.code, 'RM-84');
    assert.match(f.firmware?.os ?? '', /8\.1a/);
    assert.ok(f.emulatorErrors.some((l) => /unable to spawn process/.test(l)), JSON.stringify(f.emulatorErrors));
    assert.match(f.hints.join(' '), /EKA1/);
    assert.match(exit?.detail ?? '', /refused to start the application/);
    assert.ok(logs.some((l) => /START FAILED at "launch"/.test(l)));
  });

  it('a crash on start is reported at once with its Symbian panic, not after a minute', async () => {
    const t0 = Date.now();
    const { failure: f } = await run('FAKE:crash=KERN-EXEC/3', { pictureTimeoutMs: 20_000 });
    assert.ok(Date.now() - t0 < 10_000, 'ended by the crash, not by the timeout');
    assert.equal(f.cause, 'app_crashed');
    assert.match(f.message, /KERN-EXEC\/3/);
    assert.ok(f.timeline.some((t) => t.state === 'crashed' && /KERN-EXEC\/3/.test(JSON.stringify(t.lastExit))));
    assert.equal(f.likelyIncompatibleGame, true);
  });

  it('an application that ends by itself is reported as exited', async () => {
    const { failure: f } = await run('FAKE:exit', { pictureTimeoutMs: 20_000 });
    assert.equal(f.cause, 'app_exited');
    assert.equal(f.likelyIncompatibleGame, true);
  });

  it('a running application with no screen: a no_picture timeout with the screenshot answers, and no blame on the game', async () => {
    const { failure: f } = await run('FAKE:no_screen');
    assert.equal(f.cause, 'no_picture');
    assert.equal(f.stage, 'first_frame');
    assert.equal(f.likelyIncompatibleGame, false);
    assert.ok(f.screenshots.some((s) => s.result === 'no_screen' && s.httpStatus === 409), JSON.stringify(f.screenshots));
    assert.ok(f.timeline.some((t) => t.state === 'running'));
  });

  it('a screenshot that errors is a screenshot_error with the HTTP answer, not "no picture"', async () => {
    const { failure: f } = await run('FAKE:shot_error');
    assert.equal(f.cause, 'screenshot_error');
    assert.ok(f.screenshots.some((s) => s.result === 'error' && s.httpStatus === 500));
    assert.match(f.hints.join(' '), /HTTP 500/);
  });

  it('the FreeType line of the log is kept and explained, and is not mistaken for the cause', async () => {
    const { failure: f } = await run('FAKE:fonterror\nFAKE:launch_fail');
    assert.ok(f.fontNotes.some((l) => /FreeType failed to query face count/.test(l)));
    assert.match(f.hints.join(' '), /Font note/);
    assert.equal(f.cause, 'launch_rejected', 'the cause is the refused launch, not the font probe');
  });

  it('a good game still starts (no failure recorded)', async () => {
    const f = path.join(data, 'ok.sis'); writeFileSync(f, 'plain');
    const a = new Eka2l1Adapter({ agent, saveKey: 'a'.repeat(32), platform: 'symbian', packagePath: f, fileName: 'Ok.sis', frameEncoding: 'raw' });
    await a.start();
    try { assert.equal(a.getFailure(), null); assert.equal(a.state, 'running'); } finally { await a.stop(); }
  });
});
