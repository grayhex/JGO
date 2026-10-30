import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { cleanup, javaProcs, jar1, openStream, sleep, startApp, upload, waitFor, type TestEnv } from './helpers.ts';

let env: TestEnv;
let gameId: string;
const api = (p: string, init?: RequestInit) => fetch(env.base + p, init);
const json = async (r: Response) => (await r.json()) as any;
const post = (p: string, body: unknown) => api(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function run(settings: object) {
  const r = await post('/api/sessions', { gameId, settings });
  const s = await json(r);
  assert.equal(r.status, 201, JSON.stringify(s));
  const ws = await openStream(env.base, s.id);
  await waitFor(() => ws.frames.length > 3, 'frames');
  const log = async () => (await json(await api(`/api/sessions/${s.id}`))).logTail.join('\n') as string;
  const done = async () => {
    ws.close();
    await api(`/api/sessions/${s.id}`, { method: 'DELETE' });
    await waitFor(() => javaProcs().length === 0, 'cleanup', 8000);
  };
  return { s, ws, log, done };
}

describe('device presets (KEmulator presets.xml -> midlets.ini -> emulator)', () => {
  before(async () => {
    env = await startApp();
    gameId = (await upload(env.base, jar1)).body.game.id;
  });
  after(async () => { await env.app.sessions.stopAll(); await env.stop(); cleanup(env); });

  it('GET /api/devices lists the 59 presets of the pinned emulator', async () => {
    const d = await json(await api('/api/devices'));
    assert.equal(d.presets.length, 59);
    assert.equal(d.defaultName, '240x320 (COMMON - full screen)');
    const n70 = d.presets.find((p: any) => p.id === '176x208-nokia-full-screen');
    assert.deepEqual([n70.model, n70.width, n70.height, n70.layout, n70.platform], ['Nokia N70', 176, 208, 'nokia', 'NokiaN70']);
  });

  it('a Nokia preset sets the screen size and microedition.platform seen by the game', async () => {
    const { s, ws, log, done } = await run({ device: '176x208-nokia-full-screen' });
    assert.equal(s.width, 176);
    assert.equal(s.height, 208);
    const f = await waitFor(() => ws.frames.at(-1), 'frame');
    assert.deepEqual([f.w, f.h], [176, 208]);
    await waitFor(async () => /PLATFORM NokiaN70/.test(await log()), 'platform property');
    await done();
  });

  it('without a preset the emulator default platform string is untouched', async () => {
    const { log, done } = await run({});
    await waitFor(async () => /PLATFORM Nokia6700c/.test(await log()), 'default platform');
    await done();
  });

  it('the Siemens preset maps Siemens key codes to game actions (-26 is FIRE only there)', async () => {
    const siemens = await run({ device: '132x176-siemens-full-screen' });
    assert.equal(siemens.s.width, 132);
    siemens.ws.send({ t: 'key', s: 'D', code: -26 });
    siemens.ws.send({ t: 'key', s: 'U', code: -26 });
    await waitFor(async () => /ACTION -26 8\b/.test(await siemens.log()), 'FIRE (8) for -26 under the Siemens preset');
    siemens.ws.send({ t: 'key', s: 'D', code: -59 }); // Siemens UP
    siemens.ws.send({ t: 'key', s: 'U', code: -59 });
    await waitFor(async () => /ACTION -59 1\b/.test(await siemens.log()), 'UP (1) for -59');
    await siemens.done();

    const nokia = await run({ device: '240x320-common-full-screen' });
    nokia.ws.send({ t: 'key', s: 'D', code: -26 });
    nokia.ws.send({ t: 'key', s: 'U', code: -26 });
    await waitFor(async () => /ACTION -26 0\b/.test(await nokia.log()), 'no action for -26 under Nokia');
    nokia.ws.send({ t: 'key', s: 'D', code: -5 });
    nokia.ws.send({ t: 'key', s: 'U', code: -5 });
    await waitFor(async () => /ACTION -5 8\b/.test(await nokia.log()), 'FIRE for -5 under Nokia');
    await nokia.done();
  });

  it('the Motorola V300 preset (positive key codes) works', async () => {
    const m = await run({ device: '176x204-motorola-v300' });
    m.ws.send({ t: 'key', s: 'D', code: 8 }); // V300 fire is +8 ... which is also digit-less keycode
    m.ws.send({ t: 'key', s: 'U', code: 8 });
    await waitFor(async () => /ACTION 8 8\b/.test(await m.log()), 'FIRE for key 8 under Motorola V300');
    await m.done();
  });

  it('a layout chosen without a preset still configures the emulator key mapping', async () => {
    const m = await run({ layout: 'siemens' });
    m.ws.send({ t: 'key', s: 'D', code: -26 });
    m.ws.send({ t: 'key', s: 'U', code: -26 });
    await waitFor(async () => /ACTION -26 8\b/.test(await m.log()), 'FIRE via layout only');
    await m.done();
  });

  it('PATCH with a device fills size and layout; an explicit width wins; unknown device is rejected', async () => {
    const g = await json(await api(`/api/games/${gameId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings: { device: '132x176-siemens-full-screen' } }) }));
    assert.deepEqual([g.settings.width, g.settings.height, g.settings.layout, g.settings.device], [132, 176, 'siemens', '132x176-siemens-full-screen']);
    const g2 = await json(await api(`/api/games/${gameId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings: { device: '176x208-nokia-full-screen', width: 200 } }) }));
    assert.deepEqual([g2.settings.width, g2.settings.height, g2.settings.layout], [200, 208, 'nokia']);
    const bad = await post('/api/sessions', { gameId, settings: { device: 'no-such-phone' } });
    assert.equal(bad.status, 400);
    assert.equal((await json(bad)).error, 'unknown_device');
    const worse = await post('/api/sessions', { gameId, settings: { device: '../../etc' } });
    assert.equal(worse.status, 400);
    // a saved device is kept when later sessions do not mention it, and the saved size is not overwritten
    const s = await json(await post('/api/sessions', { gameId }));
    assert.deepEqual([s.width, s.height], [200, 208]);
    await api(`/api/sessions/${s.id}`, { method: 'DELETE' });
    await waitFor(() => javaProcs().length === 0, 'cleanup', 8000);
    void sleep;
  });
});
