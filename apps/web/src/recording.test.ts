import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Recorder, Replayer, parseRecording } from './recording';

const meta = { gameId: 'g1', gameName: 'Game', width: 240, height: 320 };

describe('Recorder', () => {
  it('keeps only input, stamped relative to the start', () => {
    const r = new Recorder();
    r.push({ t: 'key', s: 'D', code: 53 }, 5);
    r.start(1000);
    r.push({ t: 'key', s: 'D', code: 53 }, 1010);
    r.push({ t: 'audio', on: true }, 1020);
    r.push({ t: 'visibility', visible: false }, 1021);
    r.push({ t: 'pointer', id: 0, s: 'D', x: 5, y: 6 }, 1100);
    const rec = r.stop(meta, 1200);
    assert.deepEqual(rec.events.map((e) => [e.at, e.ev.t]), [[10, 'key'], [100, 'pointer']]);
    assert.equal(rec.durationMs, 200);
    assert.equal(r.active, false);
  });
});

describe('Replayer', () => {
  it('sends events in order with their timing and then reports completion', async () => {
    const rec = new Recorder();
    rec.start(0);
    for (const at of [0, 40, 80]) rec.push({ t: 'key', s: 'D', code: at }, at);
    const recording = rec.stop(meta, 100);
    const got: [number, number][] = [];
    const t0 = performance.now();
    await new Promise<void>((done) => new Replayer().play(recording, (ev) => got.push([Math.round(performance.now() - t0), (ev as { code: number }).code]), done));
    assert.deepEqual(got.map((g) => g[1]), [0, 40, 80]);
    for (const [at, code] of got) assert.ok(Math.abs(at - code) <= 25, `event ${code} sent at ${at} ms`);
  });

  it('stop() cancels what is left and releases every key', async () => {
    const rec = new Recorder();
    rec.start(0);
    rec.push({ t: 'key', s: 'D', code: 1 }, 0);
    rec.push({ t: 'key', s: 'U', code: 1 }, 500);
    const sent: string[] = [];
    const p = new Replayer();
    p.play(rec.stop(meta, 600), (ev) => sent.push(ev.t === 'key' ? `${ev.s}${ev.code}` : ev.t), () => sent.push('done'));
    p.stop((ev) => sent.push(ev.t));
    await new Promise((r) => setTimeout(r, 600));
    assert.deepEqual(sent, ['D1', 'release-all']);
  });
});

describe('parseRecording', () => {
  const good = JSON.stringify({ format: 'jgo-input-recording', version: 1, ...meta, durationMs: 50, events: [{ at: 1, ev: { t: 'key', s: 'D', code: 49 } }, { at: 9, ev: { t: 'key', s: 'U', code: 49 } }] });
  it('accepts a good file', () => assert.equal(parseRecording(good, 'g1').events.length, 2));
  it('rejects other games, other formats and damaged files with a reason', () => {
    assert.throws(() => parseRecording(good, 'other'), /another game/);
    assert.throws(() => parseRecording('{', 'g1'), /not a recording/);
    assert.throws(() => parseRecording('{"format":"x"}', 'g1'), /not a recording/);
    assert.throws(() => parseRecording(good.replace('"at":9', '"at":0'), 'g1'), /damaged/); // time goes backwards
    assert.throws(() => parseRecording(good.replace('"t":"key"', '"t":"perm"'), 'g1'), /damaged/); // not input
  });
});
