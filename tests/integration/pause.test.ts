/**
 * Suspend / resume (docs/BRIDGE.md, patch 0012): `pause` stops the game (hideNotify, pauseApp, no frames),
 * resuming calls startApp and showNotify again; a hidden page suspends the game when nobody else is watching.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';
import { cleanup, fixtures, javaProcs, openStream, sleep, startApp, upload, waitFor, type TestEnv } from './helpers.ts';

const lab = (name: string) => path.join(fixtures, '../../labgames/build', name);
let env: TestEnv;
const json = async (r: Response) => (await r.json()) as any;

async function play() {
  const up = await upload(env.base, lab('kemgame.jar'));
  const r = await fetch(env.base + '/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ gameId: up.body.game.id, settings: {} }) });
  const s = await json(r);
  assert.equal(r.status, 201, JSON.stringify(s));
  const ws = await openStream(env.base, s.id);
  await waitFor(() => ws.frames.length > 5, 'game is drawing', 15000);
  const status = async () => json(await fetch(`${env.base}/api/sessions/${s.id}`));
  const log = async () => ((await status()).logTail as string[]).join('\n');
  const paused = (w = ws) => (w.events.filter((e) => e.t === 'paused').at(-1) as { on: boolean; reason: string } | undefined);
  const done = async () => {
    ws.close();
    await fetch(`${env.base}/api/sessions/${s.id}`, { method: 'DELETE' });
    await waitFor(() => javaProcs().length === 0, 'cleanup', 8000);
  };
  return { s, ws, status, log, paused, done };
}

describe('suspend / resume (S)', () => {
  before(async () => { env = await startApp({ MAX_SESSIONS: '1' }); });
  afterEach(async () => { await env.app.sessions.stopAll(); await waitFor(() => javaProcs().length === 0, 'cleanup', 8000); });
  after(async () => { await env.app.sessions.stopAll(); await env.stop(); cleanup(env); });

  it('pause stops frames and calls hideNotify/pauseApp; resume calls startApp/showNotify and frames flow again', async () => {
    const g = await play();
    g.ws.send({ t: 'pause', on: true });
    await waitFor(async () => /LIFECYCLE pauseApp/.test(await g.log()), 'pauseApp called');
    assert.match(await g.log(), /LIFECYCLE hideNotify/);
    await waitFor(() => g.paused()?.on === true, 'paused event');
    assert.equal(g.paused()!.reason, 'manual');
    assert.equal((await g.status()).paused, true);

    await sleep(300); // a frame that was already in flight
    const n = g.ws.frames.length;
    await sleep(1200);
    assert.equal(g.ws.frames.length, n, 'no frames while suspended');

    g.ws.send({ t: 'pause', on: false });
    await waitFor(async () => /LIFECYCLE startApp 2/.test(await g.log()), 'startApp called again');
    assert.match(await g.log(), /LIFECYCLE showNotify/);
    await waitFor(() => g.ws.frames.length > n + 5, 'frames flow again');
    assert.equal(g.paused()!.on, false);
    assert.equal((await g.status()).paused, false);
    await g.done();
  });

  it('input is dropped while suspended instead of firing on resume', async () => {
    const g = await play();
    g.ws.send({ t: 'pause', on: true });
    await waitFor(() => g.paused()?.on === true, 'paused');
    for (let i = 0; i < 3; i++) { g.ws.send({ t: 'key', s: 'D', code: -5 }); await sleep(60); g.ws.send({ t: 'key', s: 'U', code: -5 }); }
    g.ws.send({ t: 'pause', on: false });
    await waitFor(() => g.paused()?.on === false, 'resumed');
    await sleep(1000);
    assert.doesNotMatch(await g.log(), /GAME_FIRE/);
    await g.done();
  });

  it('a hidden page suspends the game only when no viewer can see it', async () => {
    const g = await play();
    const second = await openStream(env.base, g.s.id);
    g.ws.send({ t: 'visibility', visible: false });
    await sleep(600);
    assert.notEqual(g.paused()?.on, true, 'another viewer still sees the game');
    second.send({ t: 'visibility', visible: false });
    await waitFor(() => g.paused()?.on === true, 'suspended: nobody sees it');
    assert.equal(g.paused()!.reason, 'hidden');
    // a viewer connecting while it is suspended is told, and being visible resumes the game
    const late = await openStream(env.base, g.s.id);
    await waitFor(() => late.events.some((e) => e.t === 'paused'), 'late viewer is told');
    await waitFor(() => g.paused()?.on === false, 'a new visible viewer resumes the game');
    second.close();
    late.close();
    await g.done();
  });

  it('suspending a game that is showing a Form (not a Canvas) neither crashes nor restarts the MIDlet', async () => {
    const up = await upload(env.base, lab('kemscreens-form.jar'));
    const r = await fetch(env.base + '/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ gameId: up.body.game.id, settings: {} }) });
    const s = await json(r);
    const ws = await openStream(env.base, s.id);
    await waitFor(() => ws.frames.length > 0, 'first frame', 15000);
    ws.send({ t: 'pause', on: true });
    await sleep(600);
    ws.send({ t: 'pause', on: false });
    await sleep(800);
    const log = ((await json(await fetch(`${env.base}/api/sessions/${s.id}`))).logTail as string[]).join('\n');
    assert.equal((log.match(/SCREEN_SHOWN form/g) ?? []).length, 1, 'startApp ran once');
    assert.doesNotMatch(log, /Exception/);
    ws.close();
    await fetch(`${env.base}/api/sessions/${s.id}`, { method: 'DELETE' });
  });
});
