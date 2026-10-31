/**
 * In a container the SWT native library cannot be loaded (no GTK, no writable home). Decoding an image through SWT then
 * threw NoClassDefFoundError, an Error that is not caught as Exception, and the MIDlet died at its icon. Simulated here by
 * giving the JVM a home directory that does not exist, so SWT cannot unpack its library.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { cleanup, fixtures, javaProcs, openStream, startApp, upload, waitFor, type TestEnv } from './helpers.ts';

describe('images without SWT natives', () => {
  let env: TestEnv;
  before(async () => { env = await startApp({ MAX_SESSIONS: '1', KEM_JVM_ARGS: '-Duser.home=/nonexistent -Dswt.library.path=/nonexistent' }); });
  after(async () => { await env.app.sessions.stopAll(); await env.stop(); cleanup(env); });

  it('a game with an icon and PNG resources starts and draws (was: NoClassDefFoundError at the window icon, the game exited at once)', async () => {
    const up = await upload(env.base, path.join(fixtures, '../../labgames/build/kemicon.jar'));
    const r = await fetch(env.base + '/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ gameId: up.body.game.id, settings: {} }) });
    const s = (await r.json()) as any;
    assert.equal(r.status, 201, JSON.stringify(s));
    const ws = await openStream(env.base, s.id);
    await waitFor(() => ws.frames.length > 0, 'a frame', 20000);
    const st = (await (await fetch(`${env.base}/api/sessions/${s.id}`)).json()) as any;
    const log = st.logTail.join('\n');
    assert.equal(st.state, 'running');
    assert.match(log, /IMAGE_LOADED 16x16/, 'a PNG resource was decoded');
    assert.doesNotMatch(log, /NoClassDefFoundError|UnsatisfiedLinkError/);
    const ev = ws.events.find((e) => e.t === 'state' && (e as any).state === 'exited');
    assert.equal(ev, undefined, 'the game did not exit');
    ws.close();
    await fetch(`${env.base}/api/sessions/${s.id}`, { method: 'DELETE' });
    await waitFor(() => javaProcs().length === 0, 'cleanup', 8000);
  });
});
