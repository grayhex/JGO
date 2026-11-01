#!/usr/bin/env node
// Stand-in for `parec` in tests: a quiet 440 Hz tone as s16le / 44.1 kHz / stereo, at real-time pace.
const RATE = 44100;
let t = 0;
const tick = () => {
  const frames = 441; // 10 ms
  const buf = Buffer.alloc(frames * 4);
  for (let i = 0; i < frames; i++, t++) { const v = Math.round(Math.sin((2 * Math.PI * 440 * t) / RATE) * 8000); buf.writeInt16LE(v, i * 4); buf.writeInt16LE(v, i * 4 + 2); }
  if (!process.stdout.write(buf)) process.stdout.once('drain', () => {});
};
setInterval(tick, 10);
process.stdout.on('error', () => process.exit(0));
