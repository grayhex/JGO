// Run inside the Symbian container (no firmware). Real PulseAudio, real capture,
// and playback under a different HOME, exactly as per-game EKA2L1 instances run.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { audioEnvironment } from '/opt/mgo-symbian/audio.mjs';
const env = audioEnvironment(process.env);
execFileSync('pactl', ['info'], { env, stdio: 'ignore' });
mkdirSync('/tmp/mgo-audio-other-home', { recursive: true });
const capture = spawn('parec', ['--device=' + env.PULSE_SOURCE, '--format=s16le', '--rate=44100', '--channels=2', '--latency-msec=40'], { env, stdio: ['ignore','pipe','pipe'] });
const samples = []; let errors = '';
capture.stdout.on('data', chunk => samples.push(chunk)); capture.stderr.on('data', b => { errors += b; });
const tone = Buffer.alloc(44100 * 4);
for (let i = 0; i < 44100; i++) { const sample = Math.round(Math.sin(i * 2 * Math.PI * 440 / 44100) * 12000); tone.writeInt16LE(sample, i * 4); tone.writeInt16LE(sample, i * 4 + 2); }
let player;
try {
  await new Promise(r => setTimeout(r, 300));
  player = spawn('pacat', ['--playback', '--format=s16le', '--rate=44100', '--channels=2', '--latency-msec=40'], { env: { ...env, HOME: '/tmp/mgo-audio-other-home' }, stdio: ['pipe','ignore','pipe'] });
  player.stderr.on('data', b => { errors += b; }); player.stdin.on('error', () => undefined); player.stdin.end(tone);
  await new Promise((resolve, reject) => { player.on('error', reject); player.on('exit', code => code === 0 ? resolve() : reject(new Error(`playback failed: ${errors}`))); });
  await new Promise(r => setTimeout(r, 200));
  const pcm = Buffer.concat(samples); let peak = 0;
  for (let i = 0; i + 1 < pcm.length; i += 2) peak = Math.max(peak, Math.abs(pcm.readInt16LE(i)));
  assert.ok(pcm.length > 10000, `capture produced ${pcm.length} bytes: ${errors}`);
  assert.ok(peak > 1000, `only silence arrived (peak ${peak}): ${errors}`);
  console.log(`PASS real PulseAudio: isolated HOME → mgo_sink → monitor → PCM; ${pcm.length} bytes, peak ${peak}`);
} finally { player?.kill('SIGKILL'); capture.kill('SIGKILL'); }
