/** The diagnostics report of a session: settings, emulator log and live JVM data. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { cleanup, fixtures, javaProcs, openStream, startApp, upload, waitFor, type TestEnv } from './helpers.ts';

let env: TestEnv;
before(async () => { env = await startApp({ MAX_SESSIONS: '1' }); });
after(async () => { await env.app.sessions.stopAll(); await env.stop(); cleanup(env); });

describe('session diagnostics', () => {
  it('a running session reports its settings, log and JVM heap and threads; a stopped one says why there is no JVM data', async () => {
    const up = await upload(env.base, path.join(fixtures, '../../labgames/build/kemgame.jar'));
    const r = await fetch(env.base + '/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ gameId: up.body.game.id, settings: {} }) });
    const s = (await r.json()) as any;
    const ws = await openStream(env.base, s.id);
    await waitFor(() => ws.frames.length > 3, 'game drawing');

    const res = await fetch(`${env.base}/api/sessions/${s.id}/diagnostics`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/plain/);
    assert.match(res.headers.get('content-disposition') ?? '', /attachment; filename="jgo-diagnostics-/);
    const text = await res.text();
    assert.match(text, /==== session ====/);
    assert.match(text, /"state": "running"/);
    assert.match(text, /LIFECYCLE startApp 1/, 'the emulator log is included');
    assert.match(text, /Full thread dump/, 'live JVM threads (jcmd)');
    assert.match(text, /GC heap|garbage-first|Serial|def new generation/i, 'JVM heap info');
    assert.doesNotMatch(text, /unavailable:/, 'every JVM query worked');

    ws.close();
    await fetch(`${env.base}/api/sessions/${s.id}`, { method: 'DELETE' });
    await waitFor(() => javaProcs().length === 0, 'cleanup', 8000);
    const after = await (await fetch(`${env.base}/api/sessions/${s.id}/diagnostics`)).text();
    assert.match(after, /no live JVM data/);
    assert.equal((await fetch(`${env.base}/api/sessions/nonexistent/diagnostics`)).status, 404);
  });
});
