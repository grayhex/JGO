import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { zipSync, strToU8 } from 'fflate';
import { countColor, dirEntries, javaProcs, jar1, jar2, killJava, openStream, pixel, sleep, startApp, upload, waitFor, type TestEnv, cleanup } from './helpers.ts';

let env: TestEnv;
let gameId: string;

const api = (p: string, init?: RequestInit) => fetch(env.base + p, init);
const json = async (r: Response) => (await r.json()) as any;

async function startSession(settings?: object) {
  const r = await api('/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ gameId, settings }) });
  return { status: r.status, body: await json(r) };
}
async function stopSession(id: string) {
  const r = await api(`/api/sessions/${id}`, { method: 'DELETE' });
  return json(r);
}
async function expectClean() {
  await waitFor(() => javaProcs().length === 0, 'no leftover java/adapter processes', 8000);
  await waitFor(() => dirEntries(env.runDir).length === 0, 'bridge run dir cleaned', 5000);
}

describe('J2ME Web API against a real KEmulator (Bridge)', () => {
  before(async () => {
    env = await startApp();
  });
  after(async () => {
    killJava();
    await env.stop();
    cleanup(env);
  });

  it('health reports the pinned emulator', async () => {
    const h = await json(await api('/api/health'));
    assert.equal(h.ok, true);
    assert.equal(h.kemulator.commit, '9ec1005af5448bca63a420e1dfa884ef53842d0f');
    assert.match(h.java.version, /^2\d/);
  });

  it('uploads a JAR, extracts metadata, de-duplicates', async () => {
    const r = await upload(env.base, jar1);
    assert.equal(r.status, 201);
    const g = r.body.game;
    gameId = g.id;
    assert.equal(g.name, 'KemTest');
    assert.equal(g.vendor, 'j2me-web');
    assert.equal(g.version, '1.0.0');
    assert.equal(g.midlets[0].className, 'kemtest.KemTest');
    assert.equal(g.classVersion, 48);
    const again = await upload(env.base, jar1);
    assert.equal(again.status, 200);
    assert.equal(again.body.duplicate, true);
    assert.equal((await json(await api('/api/games'))).length, 1);
  });

  it('rejects hostile / broken uploads', async () => {
    assert.equal((await upload(env.base, Buffer.from('not a zip at all, definitely'))).body.error, 'not_a_jar');
    const evil = Buffer.from(zipSync({ '../../etc/passwd': strToU8('x'), 'META-INF/MANIFEST.MF': strToU8('MIDlet-Name: x\n') }));
    assert.equal((await upload(env.base, evil)).body.error, 'unsafe_entry');
    const nomf = Buffer.from(zipSync({ 'a.txt': strToU8('x') }));
    assert.equal((await upload(env.base, nomf)).body.error, 'no_manifest');
    const fd = new FormData();
    fd.append('jad', new Blob([strToU8('MIDlet-Name: x\n')]), 'x.jad');
    const jadOnly = await api('/api/games', { method: 'POST', body: fd });
    assert.equal((await json(jadOnly)).error, 'jad_only');
    assert.equal((await api('/api/games/zzzz')).status, 404);
  });

  it('streams real frames: pixels are RGBA and the reference blocks are where the MIDlet drew them', async () => {
    const s = await startSession();
    assert.equal(s.status, 201, JSON.stringify(s.body));
    const ws = await openStream(env.base, s.body.id);
    const f = await waitFor(() => ws.frames.at(-1), 'a frame');
    assert.equal(f.w, 240);
    assert.equal(f.h, 320);
    assert.equal(f.pixels.length, 240 * 320 * 4);
    assert.equal(pixel(f, 0, 0), 'ff0000'); // red block top-left
    assert.equal(pixel(f, 239, 0), '00ff00'); // green top-right
    assert.equal(ws.events[0]!.t, 'hello');
    await waitFor(() => ws.frames.length >= 30, '30 frames');
    ws.close();
    await stopSession(s.body.id);
    await expectClean();
  });

  it('keyboard input reaches the MIDlet (key down/up, hold shows in the picture)', async () => {
    const s = await startSession();
    const id = s.body.id;
    const ws = await openStream(env.base, id);
    await waitFor(() => ws.frames.length > 5, 'frames');
    assert.equal(countColor(ws.frames.at(-1)!, 'ffff00'), 0, 'square is blue while idle');
    const t0 = Date.now();
    ws.send({ t: 'key', s: 'D', code: 53 });
    const lit = await waitFor(() => ws.frames.find((f) => f.at > t0 && countColor(f, 'ffff00') > 100), 'yellow square while key held');
    const latency = lit.at - t0;
    console.log(`      key->frame latency (localhost, 30fps game): ${latency} ms`);
    ws.send({ t: 'key', s: 'U', code: 53 });
    const t1 = Date.now();
    await waitFor(() => ws.frames.find((f) => f.at > t1 + 100 && countColor(f, 'ffff00') === 0), 'square back to idle colour');
    const log = (await json(await api(`/api/sessions/${id}`))).logTail.join('\n');
    assert.match(log, /KEY_DOWN 53/);
    assert.match(log, /KEY_UP 53/);
    // D-pad: Nokia layout code -1 (UP) maps to a game action in the canvas
    ws.send({ t: 'key', s: 'D', code: -1 });
    await sleep(100);
    ws.send({ t: 'key', s: 'U', code: -1 });
    await waitFor(async () => /KEY_DOWN -1/.test((await json(await api(`/api/sessions/${id}`))).logTail.join('\n')), 'UP key logged');
    ws.close();
    await stopSession(id);
    await expectClean();
  });

  it('a dropped connection releases held keys; reconnect gets the current frame at once', async () => {
    const s = await startSession();
    const id = s.body.id;
    let ws = await openStream(env.base, id);
    await waitFor(() => ws.frames.length > 5, 'frames');
    ws.send({ t: 'key', s: 'D', code: 54 });
    await waitFor(async () => /KEY_DOWN 54/.test((await json(await api(`/api/sessions/${id}`))).logTail.join('\n')), 'key 54 down');
    ws.close(); // no key-up sent: simulates a network drop
    await waitFor(async () => /KEY_UP 54/.test((await json(await api(`/api/sessions/${id}`))).logTail.join('\n')), 'server released the stuck key');
    const t0 = Date.now();
    ws = await openStream(env.base, id);
    const f = await waitFor(() => ws.frames[0], 'cached frame on reconnect', 2000, 5);
    console.log(`      reconnect -> first frame: ${f.at - t0} ms`);
    assert.equal(ws.events[0]!.t, 'hello');
    ws.close();
    await stopSession(id);
    await expectClean();
  });

  it('diagnoses a missing API from the emulator log', async () => {
    const s = await startSession();
    const ws = await openStream(env.base, s.body.id);
    await waitFor(() => ws.frames.length > 3, 'frames');
    ws.send({ t: 'key', s: 'D', code: 51 }); // "3": the MIDlet loads a class that does not exist
    ws.send({ t: 'key', s: 'U', code: 51 });
    const st = await waitFor(async () => {
      const x = await json(await api(`/api/sessions/${s.body.id}`));
      return x.diagnostics.length ? x : null;
    }, 'a diagnostic');
    assert.match(st.diagnostics[0], /Missing class com\.vendor\.MissingApi/);
    assert.ok(ws.events.some((e) => e.t === 'log' && /Missing class/.test((e as any).line)), 'pushed to the client too');
    ws.close();
    await stopSession(s.body.id);
    await expectClean();
  });

  it('enforces the session limit', async () => {
    const a = await startSession();
    assert.equal(a.status, 201);
    const b = await startSession();
    assert.equal(b.status, 429);
    assert.equal(b.body.error, 'session_limit');
    await stopSession(a.body.id);
    await expectClean();
  });

  it('applies the requested screen size', async () => {
    const s = await startSession({ width: 176, height: 220 });
    const ws = await openStream(env.base, s.body.id);
    const f = await waitFor(() => ws.frames.at(-1), 'frame');
    assert.deepEqual([f.w, f.h, f.pixels.length], [176, 220, 176 * 220 * 4]);
    assert.equal(pixel(f, 0, 0), 'ff0000');
    ws.close();
    await stopSession(s.body.id);
    await expectClean();
  });

  it('rejects out-of-range settings', async () => {
    const s = await startSession({ width: 99999 });
    assert.equal(s.status, 400);
    assert.equal(s.body.error, 'bad_settings');
  });

  it('survives an emulator crash (kill -9 of the JVM): state=failed, nothing left behind', async () => {
    const s = await startSession();
    const id = s.body.id;
    const ws = await openStream(env.base, id);
    await waitFor(() => ws.frames.length > 3, 'frames');
    killJava();
    const st = await waitFor(async () => {
      const x = await json(await api(`/api/sessions/${id}`));
      return x.state === 'failed' || x.state === 'exited' ? x : null;
    }, 'session to notice the crash');
    assert.equal(st.state, 'failed');
    assert.ok(ws.events.some((e) => e.t === 'state' && e.state === 'failed'), 'client was told');
    await expectClean();
    // and a fresh session still works
    const s2 = await startSession();
    assert.equal(s2.status, 201);
    await stopSession(s2.body.id);
    await expectClean();
  });

  it('runs several games one after another', async () => {
    const r2 = await upload(env.base, jar2);
    assert.equal(r2.status, 201);
    assert.equal(r2.body.game.name, 'KemTest2');
    assert.equal(r2.body.game.groupKey === (await json(await api(`/api/games/${gameId}`))).groupKey, false);
    for (const id of [gameId, r2.body.game.id, gameId]) {
      const r = await api('/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ gameId: id }) });
      const body = await json(r);
      assert.equal(r.status, 201, JSON.stringify(body));
      const ws = await openStream(env.base, body.id);
      await waitFor(() => ws.frames.length > 5, 'frames from ' + id);
      ws.close();
      await stopSession(body.id);
      await expectClean();
    }
  });

  it('RMS data persists across sessions and across a backend restart, isolated per game', async () => {
    const launches = async (id: string) => {
      const r = await api('/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ gameId: id }) });
      const b = await json(r);
      assert.equal(r.status, 201, JSON.stringify(b));
      const n = await waitFor(async () => {
        const m = /LAUNCHES (\d+)/.exec((await json(await api(`/api/sessions/${b.id}`))).logTail.join('\n'));
        return m ? Number(m[1]) : 0;
      }, 'LAUNCHES line');
      await stopSession(b.id);
      await expectClean();
      return n;
    };
    const games = await json(await api('/api/games'));
    const other = games.find((g: any) => g.id !== gameId).id;
    const a1 = await launches(gameId); // third+ launch of game 1 so far (previous tests started it)
    const a2 = await launches(gameId);
    assert.equal(a2, a1 + 1, 'counter persists across sessions');
    const b1 = await launches(other);
    assert.ok(b1 < a2, 'other game has its own RMS (count is independent)');
    // restart the backend on the same data dir
    await env.stop();
    env = await startApp({}, env.dataDir);
    const a3 = await launches(gameId);
    assert.equal(a3, a2 + 1, 'counter persists across a backend restart');
  });

  it('DELETE of a missing session is a clean 404; graceful shutdown stops running sessions', async () => {
    assert.equal((await api('/api/sessions/deadbeef', { method: 'DELETE' })).status, 404);
    const s = await startSession();
    assert.equal(s.status, 201);
    await env.app.sessions.stopAll();
    await expectClean();
  });
});

describe('auth + host checks', () => {
  it('refuses to listen publicly without a token', async () => {
    await assert.rejects(() => startApp({ HOST: '0.0.0.0' }), /AUTH_TOKEN/);
  });

  it('requires a token when configured; cookie login; rejects cross-origin and foreign Host', async () => {
    const e = await startApp({ AUTH_TOKEN: 'correct-horse-battery-staple' });
    try {
      assert.equal((await fetch(e.base + '/api/games')).status, 401);
      assert.equal((await fetch(e.base + '/api/games', { headers: { authorization: 'Bearer nope' } })).status, 401);
      assert.equal((await fetch(e.base + '/api/games', { headers: { authorization: 'Bearer correct-horse-battery-staple' } })).status, 200);
      const login = await fetch(e.base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'correct-horse-battery-staple' }) });
      assert.equal(login.status, 200);
      const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
      assert.match(login.headers.get('set-cookie')!, /HttpOnly; SameSite=Strict/);
      assert.equal((await fetch(e.base + '/api/games', { headers: { cookie } })).status, 200);
      assert.equal((await fetch(e.base + '/api/games', { headers: { cookie, origin: 'https://evil.example' } })).status, 403);
      assert.equal((await fetch(e.base + '/api/health')).status, 200);
    } finally {
      await e.stop();
      cleanup(e);
    }
  });

  it('unauthenticated loopback mode rejects a rebinding Host header and cross-origin POSTs', async () => {
    const e = await startApp();
    try {
      const u = new URL(e.base);
      const raw = await new Promise<number>((res) => {
        import('node:http').then(({ request }) => {
          const rq = request({ host: u.hostname, port: u.port, path: '/api/games', headers: { host: 'evil.example:8080' } }, (r) => res(r.statusCode ?? 0));
          rq.end();
        });
      });
      assert.equal(raw, 403);
      const r = await fetch(e.base + '/api/games', { headers: { origin: 'https://evil.example' } });
      assert.equal(r.status, 403);
    } finally {
      await e.stop();
      cleanup(e);
    }
  });
});
