/**
 * Background music the way games do it. Many restart a track from the END_OF_MEDIA listener (setMediaTime(0) + start()), which
 * runs on the player's own thread; the player thread's cleanup used to wipe the NEW thread that start() had just created, so the
 * music played one more time and then never again ("Die Hard stops after a minute" = the length of its first track).
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { cleanup, fixtures, javaProcs, openStream, sleep, startApp, upload, waitFor, type TestEnv } from './helpers.ts';

let env: TestEnv;
before(async () => { env = await startApp({ MAX_SESSIONS: '1' }); });
after(async () => { await env.app.sessions.stopAll(); await env.stop(); cleanup(env); });

async function play(mode: 'loop' | 'restart', seconds: number) {
  const up = await upload(env.base, path.join(fixtures, `../../labgames/build/kemmusic-${mode}.jar`));
  const r = await fetch(env.base + '/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ gameId: up.body.game.id, settings: {} }) });
  const s = (await r.json()) as any;
  const ws = await openStream(env.base, s.id);
  ws.send({ t: 'audio', on: true });
  await sleep(seconds * 1000);
  const st = (await (await fetch(`${env.base}/api/sessions/${s.id}`)).json()) as any;
  const bytes = ws.audio.reduce((n, c) => n + c.length, 0);
  ws.close();
  await fetch(`${env.base}/api/sessions/${s.id}`, { method: 'DELETE' });
  await waitFor(() => javaProcs().length === 0, 'cleanup', 8000);
  return { bytes, ends: ((st.logTail as string[]).join('\n').match(/MUSIC_END_OF_MEDIA/g) ?? []).length, log: (st.logTail as string[]).join('\n') };
}

describe('background music keeps playing', () => {
  it('a track restarted from END_OF_MEDIA plays on and on (was: one repeat, then silence)', async () => {
    const r = await play('restart', 10);
    assert.doesNotMatch(r.log, /MUSIC_FAILED|MUSIC_RESTART_FAILED/);
    assert.ok(r.ends >= 6, `restarted ${r.ends} times in 10 s`);
    // 44.1 kHz stereo 16-bit = 176400 bytes/s: well over 8 s of sound reached the client
    assert.ok(r.bytes > 8 * 176400, `${(r.bytes / 176400).toFixed(1)} s of audio`);
  });

  it('a track looped with setLoopCount(-1) plays on', async () => {
    const r = await play('loop', 10);
    assert.ok(r.bytes > 8 * 176400, `${(r.bytes / 176400).toFixed(1)} s of audio`);
  });
});
