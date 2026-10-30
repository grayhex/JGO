import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { cleanup, javaProcs, jar1, openStream, sleep, startApp, upload, waitFor, type TestEnv } from './helpers.ts';

/** Dominant frequency of mono-mixed s16le stereo PCM via zero-crossing count + RMS. */
function analyse(chunks: Buffer[]): { rms: number; hz: number; seconds: number } {
  const pcm = Buffer.concat(chunks);
  const frames = Math.floor(pcm.length / 4);
  let sum = 0, crossings = 0, prev = 0;
  for (let i = 0; i < frames; i++) {
    const v = (pcm.readInt16LE(i * 4) + pcm.readInt16LE(i * 4 + 2)) / 2;
    sum += v * v;
    if ((prev < 0 && v >= 0) || (prev >= 0 && v < 0)) crossings++;
    prev = v;
  }
  const seconds = frames / 44100;
  return { rms: Math.sqrt(sum / Math.max(1, frames)), hz: crossings / 2 / Math.max(seconds, 1e-9), seconds };
}

describe('audio: MIDlet -> Java Sound (virtual device) -> adapter -> WebSocket PCM', () => {
  let env: TestEnv;
  before(async () => { env = await startApp(); });
  after(async () => { await env.app.sessions.stopAll(); await env.stop(); cleanup(env); });

  const session = async () => {
    const up = await upload(env.base, jar1);
    const r = await fetch(env.base + '/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ gameId: up.body.game.id }) });
    return (await r.json()) as any;
  };

  it('WAV clip (440 Hz sine) arrives as PCM with the right pitch and duration; nothing is sent while silent', async () => {
    const s = await session();
    const ws = await openStream(env.base, s.id);
    ws.send({ t: 'audio', on: true });
    await waitFor(() => ws.frames.length > 3, 'frames');
    await sleep(500);
    assert.equal(ws.audio.length, 0, 'no audio traffic before the game makes a sound');
    ws.send({ t: 'key', s: 'D', code: 49 }); // "1" -> plays the WAV
    ws.send({ t: 'key', s: 'U', code: 49 });
    await waitFor(() => ws.audio.reduce((n, b) => n + b.length, 0) > 44100 * 4 * 0.9, '~1 s of PCM', 8000);
    await sleep(500);
    const a = analyse(ws.audio);
    console.log(`      wav: ${a.seconds.toFixed(2)} s of PCM, ${a.hz.toFixed(0)} Hz, rms ${a.rms.toFixed(0)}`);
    assert.ok(a.rms > 1000, 'audible level');
    assert.ok(Math.abs(a.hz - 440) < 25, `pitch ~440 Hz, got ${a.hz}`);
    assert.ok(a.seconds > 0.9 && a.seconds < 1.5, `duration ~1 s, got ${a.seconds}`);
    const st = (await (await fetch(`${env.base}/api/sessions/${s.id}`)).json()) as any;
    assert.match(st.logTail.join('\n'), /AUDIO_WAV_STARTED/);
    assert.ok(st.audioBytes > 150000);
    ws.close();
    await fetch(`${env.base}/api/sessions/${s.id}`, { method: 'DELETE' });
    await waitFor(() => javaProcs().length === 0, 'cleanup', 8000);
  });

  it('MIDI tone (Manager.playTone via the Gervill synthesizer) produces ~A4 audio', async () => {
    const s = await session();
    const ws = await openStream(env.base, s.id);
    ws.send({ t: 'audio', on: true });
    await waitFor(() => ws.frames.length > 3, 'frames');
    ws.send({ t: 'key', s: 'D', code: 50 }); // "2" -> playTone(69 = A4, 1000 ms)
    ws.send({ t: 'key', s: 'U', code: 50 });
    await waitFor(() => ws.audio.reduce((n, b) => n + b.length, 0) > 44100 * 4 * 0.5, 'MIDI synth output', 15000);
    await sleep(1500);
    const a = analyse(ws.audio);
    console.log(`      midi tone: ${a.seconds.toFixed(2)} s of PCM, ~${a.hz.toFixed(0)} Hz (zero-crossing estimate), rms ${a.rms.toFixed(0)}`);
    const st = (await (await fetch(`${env.base}/api/sessions/${s.id}`)).json()) as any;
    assert.doesNotMatch(st.logTail.join('\n'), /AUDIO_FAILED/);
    assert.ok(a.rms > 300, 'audible level');
    assert.ok(a.hz > 300 && a.hz < 700, `pitch in the A4 neighbourhood, got ${a.hz}`);
    ws.close();
    await fetch(`${env.base}/api/sessions/${s.id}`, { method: 'DELETE' });
    await waitFor(() => javaProcs().length === 0, 'cleanup', 8000);
  });
});
