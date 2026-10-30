/**
 * MIDI SoundFont (Settings → Sound): the uploaded SF2 is stored once, every session start writes its path into the
 * game's property.txt (`SoundfontPath`), and the emulator really opens that file. Without strace the last part is skipped.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { cleanup, fixtures, javaProcs, openStream, startApp, upload, waitFor, type TestEnv } from './helpers.ts';

const lab = (name: string) => path.join(fixtures, '../../labgames/build', name);
const hasStrace = spawnSync('strace', ['-V']).status === 0;
let env: TestEnv;
let traceDir: string;
const json = async (r: Response) => (await r.json()) as any;

/** A file with a valid SF2 header (RIFF "sfbk") and no usable content: enough for the server, the emulator ignores its content. */
function fakeSf2(size = 64): Buffer {
  const b = Buffer.alloc(size);
  b.write('RIFF', 0, 'latin1');
  b.writeUInt32LE(size - 8, 4);
  b.write('sfbk', 8, 'latin1');
  return b;
}
const putSoundfont = (data: Buffer, name = 'bank.sf2') => {
  const fd = new FormData();
  fd.append('file', new Blob([data]), name);
  return fetch(env.base + '/api/settings/soundfont', { method: 'PUT', body: fd });
};
const traces = () => readdirSync(traceDir).map((f) => readFileSync(path.join(traceDir, f), 'utf8')).join('\n');
// KEmulator rewrites property.txt when it exits and then holds an empty `SoundfontPath=`: only a value counts
const hasBank = (file: string) => /^SoundfontPath=\S/m.test(readFileSync(file, 'utf8'));
const opensBank = () => /openat\([^)]*custom\.sf2/.test(traces());

async function playMidi(): Promise<{ userPath: string; log: () => Promise<string> }> {
  const up = await upload(env.base, lab('kemmidi.jar'));
  const r = await fetch(env.base + '/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ gameId: up.body.game.id, settings: {} }) });
  const s = await json(r);
  assert.equal(r.status, 201, JSON.stringify(s));
  const ws = await openStream(env.base, s.id);
  const log = async () => ((await json(await fetch(`${env.base}/api/sessions/${s.id}`))).logTail as string[]).join('\n');
  await waitFor(async () => /MIDI_RESULT/.test(await log()), 'the MIDlet played its note', 20000);
  ws.close();
  await fetch(`${env.base}/api/sessions/${s.id}`, { method: 'DELETE' });
  await waitFor(() => javaProcs().length === 0, 'cleanup', 8000);
  return { userPath: path.join(env.dataDir, 'saves', 'default', up.body.game.id), log };
}

describe('MIDI SoundFont setting', () => {
  before(async () => {
    traceDir = mkdtempSync(path.join(tmpdir(), 'jgo-sf-trace-'));
    env = await startApp({ MAX_SESSIONS: '1', ...(hasStrace ? { KEM_LAUNCH_WRAPPER: `strace -ff -qq -e trace=openat -o ${traceDir}/t` } : {}) });
  });
  after(async () => { await env.app.sessions.stopAll(); await env.stop(); cleanup(env); rmSync(traceDir, { recursive: true, force: true }); });

  it('rejects files that are not SoundFont 2 files, with a reason', async () => {
    assert.equal((await putSoundfont(fakeSf2(), 'bank.sf3')).status, 400);
    assert.equal((await putSoundfont(Buffer.from('not a soundfont at all'), 'bank.sf2')).status, 400);
    const cut = fakeSf2(64);
    cut.writeUInt32LE(5000, 4); // declares more than the file holds
    const r = await putSoundfont(cut);
    assert.equal(r.status, 400);
    assert.match((await json(r)).message ?? JSON.stringify(await r.text()), /incomplete|shorter/i);
    assert.equal((await json(await fetch(env.base + '/api/settings'))).soundfont, null);
  });

  it('without a SoundFont the emulator uses its built-in bank and property.txt stays free of SoundfontPath', async () => {
    const g = await playMidi();
    assert.match(await g.log(), /MIDI_RESULT ok/);
    const prop = path.join(g.userPath, 'property.txt');
    assert.ok(!existsSync(prop) || !hasBank(prop));
    if (hasStrace) assert.equal(opensBank(), false, 'no custom bank is opened');
  });

  it('an uploaded SoundFont is stored, listed, written to property.txt and opened by the emulator; removing it undoes all that', async () => {
    const put = await putSoundfont(fakeSf2(2048), 'My Bank.sf2');
    assert.equal(put.status, 200, await put.clone().text());
    const settings = await json(await fetch(env.base + '/api/settings'));
    assert.equal(settings.soundfont.name, 'My Bank.sf2');
    assert.equal(settings.soundfont.size, 2048);

    const g = await playMidi();
    assert.match(await g.log(), /MIDI_RESULT ok/, 'MIDI playback still works (an unusable bank must not break the game)');
    const prop = readFileSync(path.join(g.userPath, 'property.txt'), 'utf8');
    assert.match(prop, new RegExp(`^SoundfontPath=${path.join(env.dataDir, 'soundfont', 'custom.sf2').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
    if (hasStrace) assert.equal(opensBank(), true, 'the emulator opened the custom bank');

    const del = await fetch(env.base + '/api/settings/soundfont', { method: 'DELETE' });
    assert.equal(del.status, 200);
    assert.equal((await json(del)).soundfont, null);
    const g2 = await playMidi();
    assert.ok(!existsSync(path.join(g2.userPath, 'property.txt')) || !hasBank(path.join(g2.userPath, 'property.txt')));
  });
});
