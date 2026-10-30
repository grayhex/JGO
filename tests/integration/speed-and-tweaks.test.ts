/**
 * Game speed (Bridge "Y", patch 0013) and the per-game emulation options (midlets.ini keys). Each option is checked by
 * what the game itself observes, never by the file it was written to.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';
import { cleanup, fixtures, javaProcs, openStream, sleep, startApp, upload, waitFor, type TestEnv } from './helpers.ts';

const lab = (name: string) => path.join(fixtures, '../../labgames/build', name);
let env: TestEnv;
const json = async (r: Response) => (await r.json()) as any;

async function play(jar: string, settings: object = {}) {
  const up = await upload(env.base, jar);
  const r = await fetch(env.base + '/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ gameId: up.body.game.id, settings }) });
  const s = await json(r);
  assert.equal(r.status, 201, JSON.stringify(s));
  const ws = await openStream(env.base, s.id);
  await waitFor(() => ws.frames.length > 0, 'first frame', 15000);
  const status = async () => json(await fetch(`${env.base}/api/sessions/${s.id}`));
  const log = async () => ((await status()).logTail as string[]).join('\n');
  const done = async () => {
    ws.close();
    await fetch(`${env.base}/api/sessions/${s.id}`, { method: 'DELETE' });
    await waitFor(() => javaProcs().length === 0, 'cleanup', 8000);
  };
  return { s, ws, status, log, done };
}

/** How fast the game's clock runs compared with the real one, from the last two GAME_CLOCK lines. */
async function clockRatio(g: Awaited<ReturnType<typeof play>>): Promise<number> {
  const clocks = async () => [...(await g.log()).matchAll(/GAME_CLOCK frame=(\d+) game_ms=(\d+) real_ms=(\d+)/g)].map((m) => ({ frame: +m[1]!, game: +m[2]!, real: +m[3]! }));
  const first = await waitFor(async () => (await clocks()).at(-1), 'a clock line');
  const last = await waitFor(async () => { const c = await clocks(); const l = c.at(-1)!; return l.real - first.real >= 2000 ? l : null; }, 'two seconds of clock lines', 20000);
  return (last.game - first.game) / (last.real - first.real);
}

describe('game speed (Y)', () => {
  before(async () => { env = await startApp({ MAX_SESSIONS: '1' }); });
  afterEach(async () => { await env.app.sessions.stopAll(); await waitFor(() => javaProcs().length === 0, 'cleanup', 8000); });
  after(async () => { await env.app.sessions.stopAll(); await env.stop(); cleanup(env); });

  it('the game clock and its Thread.sleep loops follow the speed modifier; late viewers are told', async () => {
    const g = await play(lab('kemgame.jar'));
    const normal = await clockRatio(g);
    assert.ok(normal > 0.9 && normal < 1.1, `normal speed: game clock runs at ${normal.toFixed(2)}x`);

    g.ws.send({ t: 'speed', modifier: -50 });
    await waitFor(() => g.ws.events.some((e) => e.t === 'speed' && (e as any).modifier === -50), 'speed event');
    await sleep(500);
    const slow = await clockRatio(g);
    assert.ok(slow > 0.4 && slow < 0.6, `half speed: game clock runs at ${slow.toFixed(2)}x`);
    assert.equal((await g.status()).speed, -50);

    g.ws.send({ t: 'speed', modifier: 2 });
    await sleep(500);
    const fast = await clockRatio(g);
    assert.ok(fast > 1.8 && fast < 2.2, `double speed: game clock runs at ${fast.toFixed(2)}x`);

    const late = await openStream(env.base, g.s.id);
    const ev: any = await waitFor(() => late.events.find((e) => e.t === 'speed'), 'late viewer is told the speed');
    assert.equal(ev.modifier, 2);
    late.close();

    // 0 would stop time and divide by zero, out-of-range values are not KEmulator's: refused without any effect
    for (const bad of [0, 101, -101, 1.5, 'x']) g.ws.send({ t: 'speed', modifier: bad as number });
    await sleep(500);
    assert.equal((await g.status()).speed, 2);
    assert.doesNotMatch(await g.log(), /Exception/);
    await g.done();
  });
});

describe('per-game emulation options', () => {
  before(async () => { env = await startApp({ MAX_SESSIONS: '1' }); });
  afterEach(async () => { await env.app.sessions.stopAll(); await waitFor(() => javaProcs().length === 0, 'cleanup', 8000); });
  after(async () => { await env.app.sessions.stopAll(); await env.stop(); cleanup(env); });

  it('locale, pointer events and font sizes are what the game reads; defaults are untouched', async () => {
    const plain = await play(lab('kemprops.jar'));
    await waitFor(async () => /PROPS /.test(await plain.log()), 'properties line');
    assert.match(await plain.log(), /PROPS locale=en-US pointer=true fonts=\d+\/\d+\/\d+/);
    const defaults = (await plain.log()).match(/fonts=(\d+)\/(\d+)\/(\d+)/)!.slice(1).map(Number);
    await plain.done();

    const g = await play(lab('kemprops.jar'), { emulation: { locale: 'ru-RU', pointerEvents: false, fontSizes: { small: 20, medium: 30, large: 40 } } });
    await waitFor(async () => /PROPS /.test(await g.log()), 'properties line');
    const log = await g.log();
    assert.match(log, /PROPS locale=ru-RU pointer=false/);
    const fonts = log.match(/fonts=(\d+)\/(\d+)\/(\d+)/)!.slice(1).map(Number);
    assert.ok(fonts[0]! < fonts[1]! && fonts[1]! < fonts[2]!, `three distinct sizes: ${fonts}`);
    assert.ok(fonts[0]! > defaults[0]!, `larger than the defaults ${defaults}: ${fonts}`);
    await g.done();
  });

  it('frameRate limits the drawing loop', async () => {
    const rate = async (fps: number) => {
      const g = await play(lab('kemgame.jar'), { emulation: { frameRate: fps } });
      await sleep(1500);
      const from = g.ws.frames.length;
      await sleep(3000);
      const measured = (g.ws.frames.length - from) / 3;
      await g.done();
      return measured;
    };
    const low = await rate(8);
    const high = await rate(60);
    assert.ok(low > 5 && low < 11, `8 fps limit gives ${low.toFixed(1)} fps`);
    assert.ok(high > low * 2.2, `60 fps limit (${high.toFixed(1)}) is far above the 8 fps limit (${low.toFixed(1)})`);
  });

  it('startAppOnResume=false: suspending and resuming only hide and show the Canvas, pauseApp/startApp are not called', async () => {
    const g = await play(lab('kemgame.jar'), { emulation: { startAppOnResume: false } });
    g.ws.send({ t: 'pause', on: true });
    await waitFor(async () => /LIFECYCLE hideNotify/.test(await g.log()), 'hideNotify');
    g.ws.send({ t: 'pause', on: false });
    await waitFor(async () => /LIFECYCLE showNotify/.test(await g.log()), 'showNotify after the resume');
    await sleep(500);
    const log = await g.log();
    assert.doesNotMatch(log, /LIFECYCLE pauseApp/);
    assert.doesNotMatch(log, /LIFECYCLE startApp 2/);
    await g.done();
  });

  it('invalid options are refused with a reason; unknown ones are not silently dropped', async () => {
    const up = await upload(env.base, lab('kemprops.jar'));
    const patch = async (emulation: unknown) => fetch(`${env.base}/api/games/${up.body.game.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings: { emulation } }) });
    for (const bad of [{ frameRate: 0 }, { frameRate: 500 }, { locale: 'en US' }, { fontSizes: { small: 1, medium: 14, large: 16 } }, { pointerEvents: 'yes' }, { nonsense: true }, []]) {
      const r = await patch(bad);
      assert.equal(r.status, 400, JSON.stringify(bad));
    }
    const ok = await patch({ frameRate: 25, locale: 'de-DE' });
    assert.equal(ok.status, 200);
    assert.deepEqual((await json(ok)).settings.emulation, { frameRate: 25, locale: 'de-DE' });
    const reset = await patch(null);
    assert.equal((await json(reset)).settings.emulation, undefined);
  });
});
