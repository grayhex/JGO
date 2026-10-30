/**
 * Text input (docs/BRIDGE.md, patch 0010): the focused TextField / TextBox is announced to the client
 * (Bridge `A` + JGO `N`) and the typed text goes back as `E`. Needs the real KEmulator build.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';
import { TEXT_CONSTRAINT, type TextArea } from '../../packages/protocol/src/index.ts';
import { cleanup, fixtures, javaProcs, openStream, sleep, startApp, upload, waitFor, type TestEnv } from './helpers.ts';

const lab = (name: string) => path.join(fixtures, '../../labgames/build', name);
let env: TestEnv;
const json = async (r: Response) => (await r.json()) as any;

async function play(jar: string) {
  const up = await upload(env.base, jar);
  assert.ok([200, 201].includes(up.status), JSON.stringify(up.body));
  const r = await fetch(env.base + '/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ gameId: up.body.game.id, settings: {} }) });
  const s = await json(r);
  assert.equal(r.status, 201, JSON.stringify(s));
  const ws = await openStream(env.base, s.id);
  await waitFor(() => ws.frames.length > 0, 'first frame', 15000);
  const log = async () => ((await json(await fetch(`${env.base}/api/sessions/${s.id}`))).logTail as string[]).join('\n');
  const key = (code: number, hold = 80) => { ws.send({ t: 'key', s: 'D', code }); return sleep(hold).then(() => ws.send({ t: 'key', s: 'U', code })); };
  /** the latest text area the server announced (null = none) */
  const area = (): TextArea | null | undefined => (ws.events.filter((e) => e.t === 'text').at(-1) as { area: TextArea | null } | undefined)?.area;
  const done = async () => {
    ws.close();
    await fetch(`${env.base}/api/sessions/${s.id}`, { method: 'DELETE' });
    await waitFor(() => javaProcs().length === 0, 'cleanup', 8000);
  };
  return { s, ws, log, key, area, done };
}

describe('text input through the Bridge (E / A)', () => {
  before(async () => { env = await startApp({ MAX_SESSIONS: '1' }); });
  afterEach(async () => { await env.app.sessions.stopAll(); await waitFor(() => javaProcs().length === 0, 'cleanup', 8000); });
  after(async () => { await env.app.sessions.stopAll(); await env.stop(); cleanup(env); });

  it('a focused TextField is announced, typing reaches the MIDlet (itemStateChanged), maxSize and constraints are enforced', async () => {
    const g = await play(lab('kemtext.jar'));
    const a = await waitFor(() => g.area(), 'text area of the first field');
    assert.equal(a.kind, 'field');
    assert.equal(a.text, 'ab');
    assert.equal(a.maxSize, 8);
    assert.equal(a.constraints & TEXT_CONSTRAINT.MASK, TEXT_CONSTRAINT.ANY);
    assert.ok(a.w > 0 && a.h > 0, 'the area has a size');

    // longer than maxSize: shortened by the game, the client is told the final text
    g.ws.send({ t: 'text', text: 'Hello world' });
    await waitFor(async () => /TEXT_VALUES any=\[Hello wo\]/.test(await g.log()), 'MIDlet saw the shortened text');
    await waitFor(() => g.area()?.text === 'Hello wo', 'client gets the sanitized text back');

    // non-ASCII text and spaces survive the ASCII-only adapter
    g.ws.send({ t: 'text', text: 'Привет мир' });
    await waitFor(async () => /TEXT_VALUES any=\[Привет м\]/.test(await g.log()), 'Cyrillic text with a space');

    // DOWN: the numeric field takes only digits (and a leading minus)
    await g.key(-2);
    await waitFor(() => g.area()?.constraints !== undefined && (g.area()!.constraints & TEXT_CONSTRAINT.MASK) === TEXT_CONSTRAINT.NUMERIC, 'numeric field focused');
    g.ws.send({ t: 'text', text: '-a1b2-3' });
    await waitFor(async () => /num=\[-123\]/.test(await g.log()), 'numeric filter');

    // DOWN: the password field is flagged so the client masks it
    await g.key(-2);
    await waitFor(() => g.area() && (g.area()!.constraints & TEXT_CONSTRAINT.PASSWORD) !== 0, 'password field focused');
    g.ws.send({ t: 'text', text: 'secret' });
    await waitFor(async () => /pass=\[secret\]/.test(await g.log()), 'password text');
    assert.doesNotMatch(await g.log(), /Not implemented|Exception/);
    await g.done();
  });

  it('a TextBox is announced as a box and takes text; a late viewer is told the current area', async () => {
    const g = await play(lab('kemtext.jar'));
    await waitFor(() => g.area(), 'form text area');
    // the only command of the form is "Box": it sits on one of the soft keys
    const sk = await waitFor(() => g.ws.events.find((e) => e.t === 'softkeys' && /Box/.test(`${(e as any).left}|${(e as any).right}`)) as any, 'soft key labels');
    await g.key(/Box/.test(sk.left) ? -6 : -7);
    await waitFor(async () => /TEXT_BOX_SHOWN/.test(await g.log()), 'TextBox shown');
    const a = await waitFor(() => (g.area()?.kind === 'box' ? g.area() : null), 'box area');
    assert.equal(a.text, 'note');
    assert.equal(a.maxSize, 12);

    g.ws.send({ t: 'text', text: 'one two three four' });
    await waitFor(() => g.area()?.text === 'one two thre', 'TextBox keeps maxSize (12)');
    const sk2 = await waitFor(() => g.ws.events.filter((e) => e.t === 'softkeys').find((e) => /Done/.test(`${(e as any).left}|${(e as any).right}`)) as any, 'Done soft key');
    await g.key(/Done/.test(sk2.left) ? -6 : -7);
    await waitFor(async () => /TEXTBOX_VALUE \[one two thre\]/.test(await g.log()), 'MIDlet read the TextBox text');

    const late = await openStream(env.base, g.s.id);
    const ev: any = await waitFor(() => late.events.find((e) => e.t === 'text'), 'late viewer gets the area');
    assert.equal(ev.area.kind, 'box');
    late.close();
    await g.done();
  });

  it('typing while nothing is editable is ignored (the game keeps running)', async () => {
    const g = await play(lab('kemgame.jar'));
    assert.equal(g.area() ?? null, null);
    g.ws.send({ t: 'text', text: 'hello' });
    await sleep(800);
    assert.doesNotMatch(await g.log(), /Not implemented|Exception/);
    assert.equal((await json(await fetch(`${env.base}/api/sessions/${g.s.id}`))).state, 'running');
    await g.done();
  });
});
