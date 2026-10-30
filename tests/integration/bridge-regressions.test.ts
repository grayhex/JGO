/**
 * Regression tests for Bridge/emulator problems found by the compatibility lab (see docs/BRIDGE.md).
 * Each test fails on the stock KEmulator v2.22 Bridge build and passes with runtime/patches.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';
import { frameStats } from '../../apps/api/src/lab/frames.ts';
import { cleanup, fixtures, javaProcs, jar1, openStream, sleep, startApp, upload, waitFor, type Stream, type TestEnv } from './helpers.ts';

const lab = (name: string) => path.join(fixtures, '../../labgames/build', name);
let env: TestEnv;
const json = async (r: Response) => (await r.json()) as any;

async function play(jar: string, settings: object = {}) {
  const up = await upload(env.base, jar);
  assert.ok([200, 201].includes(up.status), JSON.stringify(up.body));
  const r = await fetch(env.base + '/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ gameId: up.body.game.id, settings }) });
  const s = await json(r);
  assert.equal(r.status, 201, JSON.stringify(s));
  const ws = await openStream(env.base, s.id);
  await waitFor(() => ws.frames.length > 0, 'first frame', 15000); // static screens (lists, forms) paint once
  const status = async () => json(await fetch(`${env.base}/api/sessions/${s.id}`));
  const log = async () => (await status()).logTail.join('\n') as string;
  const key = (code: number, hold = 80) => { ws.send({ t: 'key', s: 'D', code }); return sleep(hold).then(() => ws.send({ t: 'key', s: 'U', code })); };
  const last = (ws: Stream) => frameStats(ws.frames.at(-1)!.pixels);
  const done = async () => {
    ws.close();
    await fetch(`${env.base}/api/sessions/${s.id}`, { method: 'DELETE' });
    await waitFor(() => javaProcs().length === 0, 'cleanup', 8000);
  };
  return { s, ws, status, log, key, last: () => last(ws), done };
}

describe('Bridge regressions found by the compatibility lab', () => {
  before(async () => { env = await startApp({ MAX_SESSIONS: '1', PERMISSION_TIMEOUT_SECONDS: '2' }); });
  // a failing assertion must not leave a session behind and cascade into the next test
  afterEach(async () => { await env.app.sessions.stopAll(); await waitFor(() => javaProcs().length === 0, 'cleanup', 8000); });
  after(async () => { await env.app.sessions.stopAll(); await env.stop(); cleanup(env); });

  it('List screens construct, render into the framebuffer and handle d-pad + fire (were: NPE on SWT display, no frame ever)', async () => {
    const g = await play(lab('kemscreens-list.jar'), { device: '240x320-common-full-screen' });
    const log0 = await g.log();
    assert.match(log0, /SCREEN_SHOWN list/);
    assert.doesNotMatch(log0, /SCREEN_FAILED/);
    const before = g.ws.frames.at(-1)!;
    const st = g.last();
    assert.ok(st.dominantShare < 0.97 && st.colors >= 4, `list is drawn (dominant ${st.dominantShare}, colors ${st.colors})`);
    await g.key(-2); // DOWN moves the highlight
    const moved = await waitFor(() => g.ws.frames.find((f) => f.at > Date.now() - 600 && frameStats(f.pixels).hash !== frameStats(before.pixels).hash), 'highlight moved');
    assert.ok(moved);
    await g.key(-5); // FIRE on an IMPLICIT list = select command
    await waitFor(async () => /COMMAND_ACTION OK/.test(await g.log()), 'select command delivered to the MIDlet');
    await g.done();
  });

  it('TextBox screens construct and show their text (were: NPE in the constructor)', async () => {
    const g = await play(lab('kemscreens-textbox.jar'));
    const log = await g.log();
    assert.match(log, /SCREEN_SHOWN textbox/);
    assert.doesNotMatch(log, /SCREEN_FAILED/);
    const st = g.last();
    assert.ok(st.dominantShare < 0.999 && st.colors >= 2, `text is drawn (dominant ${st.dominantShare}, colors ${st.colors})`);
    // each soft key invokes one of the two commands; together they must reach the MIDlet
    await g.key(-6);
    await g.key(-7);
    await waitFor(async () => { const l = await g.log(); return /COMMAND_ACTION OK/.test(l) || /COMMAND_ACTION Back/.test(l); }, 'command on a TextBox');
    await g.done();
  });

  it('Form and Alert render without errors', async () => {
    for (const name of ['kemscreens-form.jar', 'kemscreens-alert.jar']) {
      const g = await play(lab(name));
      const log = await g.log();
      assert.match(log, /SCREEN_SHOWN/, name);
      assert.doesNotMatch(log, /SCREEN_FAILED|Exception/, name);
      assert.ok(g.last().litShare > 0.05, `${name} is not black`);
      await g.done();
    }
  });

  it('a MIDlet without an icon does not log an NPE on every launch (was: ImageAWT(null) in setWindowIcon)', async () => {
    const g = await play(jar1);
    const log = await g.log();
    assert.doesNotMatch(log, /"buf" is null/);
    assert.doesNotMatch(log, /IOException: java\.lang\.NullPointerException/);
    await g.done();
  });

  it('no gamepad-probing stack trace in the Bridge runtime (was: jinput scanning a missing /dev/input)', async () => {
    const g = await play(jar1);
    const log = await g.log();
    assert.doesNotMatch(log, /net\.java\.games\.input|LinuxEnvironmentPlugin|"a" is null/);
    await g.done();
  });

  it('soft keys, command menu and commands round-trip (C / M packets, C input)', async () => {
    const g = await play(lab('kemscreens-canvascmd.jar'));
    // labels settle in steps ('' / '' -> 'Menu' / '' -> 'Menu' / 'Back'): wait for the final state
    const sk: any = await waitFor(() => g.ws.events.find((e) => e.t === 'softkeys' && /Back/.test(`${(e as any).left}|${(e as any).right}`)), 'soft key labels incl. Back');
    const keyOf = (label: RegExp) => (label.test(sk.left) ? -6 : label.test(sk.right) ? -7 : 0);
    const back = keyOf(/Back/i);
    assert.ok(back, `a soft key is labelled Back: ${JSON.stringify(sk)}`);
    const menuKey = back === -6 ? -7 : -6; // the other one opens the command menu
    await g.key(back);
    await waitFor(async () => /COMMAND_ACTION Back/.test(await g.log()), 'Back soft key delivered');
    await g.key(menuKey);
    const menu: any = await waitFor(() => g.ws.events.find((e) => e.t === 'menu'), 'menu event');
    const optA = menu.items.find((i: any) => /Option A/.test(i.text));
    assert.ok(optA, JSON.stringify(menu.items));
    g.ws.send({ t: 'cmd', id: optA.id });
    await waitFor(async () => /COMMAND_ACTION Option A/.test(await g.log()), 'menu command delivered');
    await g.done();
  });

  it('pointer events reach the MIDlet (T packets)', async () => {
    const g = await play(jar1);
    g.ws.send({ t: 'pointer', id: 0, s: 'D', x: 100, y: 120 });
    g.ws.send({ t: 'pointer', id: 0, s: 'U', x: 100, y: 120 });
    await waitFor(async () => /POINTER_DOWN 100,120/.test(await g.log()) && /POINTER_UP 100,120/.test(await g.log()), 'pointer down/up');
    await g.done();
  });

  it('vibration is forwarded (V packet)', async () => {
    const g = await play(lab('kemnet.jar'));
    await g.key(49);
    await waitFor(() => g.ws.events.find((e) => e.t === 'vibrate'), 'vibrate event');
    await g.done();
  });

  it('platformRequest: permission prompt -> allowed -> U packet reaches the client; never launches a browser on the host', async () => {
    const g = await play(lab('kemnet.jar'));
    await g.key(50);
    const p: any = await waitFor(() => g.ws.events.find((e) => e.t === 'permission'), 'permission prompt');
    assert.match(p.message, /example\.invalid/);
    g.ws.send({ t: 'perm', id: p.id, allow: true });
    const u: any = await waitFor(() => g.ws.events.find((e) => e.t === 'url'), 'url event (was: ConnectionNotFoundException + xdg-open on the server)');
    assert.match(u.url, /^http:\/\/example\.invalid\//);
    await waitFor(async () => /PLATFORM_REQUEST false/.test(await g.log()), 'platformRequest returned normally');
    assert.doesNotMatch(await g.log(), /PLATFORM_REQUEST_FAILED/);
    await g.done();
  });

  it('an unanswered permission prompt is denied after the timeout instead of freezing the game (was: wait() forever)', async () => {
    const g = await play(lab('kemnet.jar'));
    await g.key(50);
    await waitFor(() => g.ws.events.find((e) => e.t === 'permission'), 'permission prompt');
    // nobody answers; PERMISSION_TIMEOUT_SECONDS=2 in this suite
    await waitFor(async () => /permission denied \(no answer/.test(await g.log()), 'server-side denial', 8000);
    await waitFor(async () => /PLATFORM_REQUEST_FAILED .*SecurityException/.test(await g.log()), 'the MIDlet gets a SecurityException and keeps running');
    await g.key(49); // still responsive afterwards
    await waitFor(() => g.ws.events.find((e) => e.t === 'vibrate'), 'game still alive');
    await g.done();
  });

  it('Mascot Capsule v3 immediate-mode rendering produces a picture (OpenGL, needs a display)', { skip: !process.env.KEM_DISPLAY }, async () => {
    const g = await play(lab('kemmascot.jar'));
    const st = await waitFor(() => { const s = g.last(); return s.colors > 6 ? s : null; }, 'drawn triangle');
    assert.ok(st);
    assert.doesNotMatch(await g.log(), /MASCOT_FAILED/);
    await g.done();
  });
});
