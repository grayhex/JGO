// Runtime probes behind docs/EMULATOR_FEATURE_MATRIX.md: drives the real KEmulator through the Rust adapter and
// records what actually crosses the Bridge. Every number in the matrix that says "run" comes from here.
//
//   npm run build && bash tools/fixtures... (see docs) && bash tools/audit/build.sh
//   node tools/audit/probe.mjs [scenario ...]        scenarios: inputs packets textfield media apis soundfont
//
// Writes tools/audit/results.json. Needs the built API (apps/api/dist), the adapter, KEmulator.jar and the fixtures.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { KEmulatorAdapter } = await import(pathToFileURL(path.join(root, 'apps/api/dist/kemulator/adapter.js')).href);
const kemDir = path.join(root, 'runtime/build/kemulator');
const adapterBin = path.join(root, 'bridge/kemulator-adapter/target/release/kem-adapter');
const lab = (n) => path.join(root, 'tests/fixtures/labgames/build', n);
const audit = (n) => path.join(root, 'tools/audit/build', n);
const kemtest = path.join(root, 'tests/fixtures/testmidlet/build/kemtest.jar');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const only = process.argv.slice(2);
const results = { generatedAt: new Date().toISOString(), kemulator: readFileSync(path.join(kemDir, 'KEM_COMMIT'), 'utf8').trim() };

/** One emulator session; collects every statepipe packet, log line, frame and PCM chunk. */
async function session(jar, { w = 240, h = 320, userFiles = {}, wrapper = [], settle = 2500 } = {}) {
  const work = mkdtempSync(path.join('/dev/shm', 'kem-audit-'));
  const user = mkdtempSync(path.join(tmpdir(), 'kem-audit-user-'));
  for (const [name, text] of Object.entries(userFiles)) writeFileSync(path.join(user, name), text);
  const a = new KEmulatorAdapter({ adapterBin, javaBin: 'java', kemDir, bridgeDir: work, jarPath: jar, userPath: user, width: w, height: h, heapMb: 256, frameEncoding: 'raw', cpuSeconds: 0, display: '', jvmExtraArgs: [], launchWrapper: wrapper });
  const s = { a, packets: [], logs: [], frames: [], pcm: [], t0: Date.now() };
  const at = () => Date.now() - s.t0;
  a.on('state', (type, body) => s.packets.push({ at: at(), type, body }));
  a.on('log', (l) => s.logs.push({ at: at(), line: l }));
  a.on('frame', (f) => s.frames.push({ at: at(), seq: f.seq, data: f.data }));
  a.on('audio', (b) => s.pcm.push({ at: at(), b }));
  await a.start();
  await sleep(settle);
  s.input = (line) => a.input(line);
  s.stop = async () => { await a.stop(); rmSync(work, { recursive: true, force: true }); rmSync(user, { recursive: true, force: true }); };
  s.text = () => s.logs.map((l) => l.line).join('\n');
  s.user = user;
  return s;
}

function pcmStats(chunks) {
  const pcm = Buffer.concat(chunks.map((c) => c.b));
  const n = Math.floor(pcm.length / 4);
  let sum = 0;
  let crossings = 0;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const v = (pcm.readInt16LE(i * 4) + pcm.readInt16LE(i * 4 + 2)) / 2;
    sum += v * v;
    if ((prev < 0 && v >= 0) || (prev >= 0 && v < 0)) crossings++;
    prev = v;
  }
  const seconds = n / 44100;
  return { seconds: +seconds.toFixed(2), rms: Math.round(Math.sqrt(sum / Math.max(1, n))), hz: seconds ? Math.round(crossings / 2 / seconds) : 0 };
}

const scenarios = {
  // ---- inbound packets: K T C P X E I and malformed input ---------------------------------------------------------
  async inputs() {
    const s = await session(kemtest);
    const out = {};
    const before = s.logs.length;
    const probe = async (name, line) => {
      const mark = s.logs.length;
      const frames = s.frames.length;
      s.input(line);
      await sleep(700);
      out[name] = { sent: line, logs: s.logs.slice(mark).map((l) => l.line).filter((l) => /Exception|Not implemented|Unknown|Error|POINTER|KEY_/.test(l)).slice(0, 4), framesAfter: s.frames.length - frames };
    };
    await probe('K down/up (implemented)', 'K D 53');
    s.input('K U 53');
    await probe('T pointer (implemented)', 'T 0 D 100 100');
    s.input('T 0 U 100 100');
    await probe('X on', 'X 1');
    await probe('X off', 'X 0');
    await probe('X invalid value', 'X 2');
    await probe('E (text input, "WIP" in the spec)', 'E hello');
    await probe('I (reserved)', 'I');
    await probe('unknown type Z', 'Z 1');
    await probe('S speed (does not exist)', 'S 2');
    await probe('malformed K', 'K D');
    await probe('K with a non-number', 'K D abc');
    await probe('C unknown command id', 'C 999999');
    await probe('P unknown permission id', 'P 12345 1');
    await sleep(500);
    out.stillRunning = s.a.state === 'running';
    out.framesKeepComing = s.frames.length > 0 && s.frames.at(-1).at > Date.now() - s.t0 - 3000;
    await s.stop();
    return out;
  },

  // ---- outbound packets seen for each screen type -----------------------------------------------------------------
  async packets() {
    const out = {};
    for (const [name, jar] of [
      ['kemtest (canvas)', kemtest],
      ['form', lab('kemscreens-form.jar')],
      ['list', lab('kemscreens-list.jar')],
      ['textbox', lab('kemscreens-textbox.jar')],
      ['alert', lab('kemscreens-alert.jar')],
      ['canvas with commands', lab('kemscreens-canvascmd.jar')],
      ['net (permission, url, vibrate)', lab('kemnet.jar')],
      ['form with TextField and MIDlet-Icon', audit('probe-lcdui.jar')],
    ]) {
      const s = await session(jar, { settle: 3000 });
      if (name.startsWith('net')) {
        s.input('K D 49'); s.input('K U 49'); // vibrate
        await sleep(600);
        s.input('K D 50'); s.input('K U 50'); // platformRequest
        await sleep(1200);
        const perm = s.packets.find((p) => p.type === 'P');
        if (perm) { s.input(`P ${perm.body.readUInt32BE(0)} 1`); await sleep(1200); }
      }
      if (name.startsWith('canvas with')) { s.input('K D -6'); s.input('K U -6'); await sleep(800); }
      const kinds = {};
      for (const p of s.packets) kinds[p.type] = (kinds[p.type] ?? 0) + 1;
      const d = s.packets.filter((p) => p.type === 'D').map((p) => String.fromCharCode(p.body[0]));
      const icon = s.packets.find((p) => p.type === 'I');
      out[name] = {
        packetTypes: kinds,
        displayableKinds: [...new Set(d)],
        title: s.packets.filter((p) => p.type === 'T').map((p) => p.body.toString('utf8')).at(-1) ?? null,
        icon: icon ? { width: icon.body.readUInt16BE(0), height: icon.body.readUInt16BE(2), rgbaBytes: icon.body.length - 4 } : null,
        textAreaPackets: s.packets.filter((p) => p.type === 'A').length,
        exceptions: s.logs.map((l) => l.line).filter((l) => /Exception|Not implemented/.test(l)).slice(0, 3),
        framesReceived: s.frames.length,
      };
      await s.stop();
    }
    return out;
  },

  // ---- can text be typed? ------------------------------------------------------------------------------------------
  async textfield() {
    const s = await session(audit('probe-lcdui.jar'));
    const read = () => (s.text().match(/LCDUI textfield=(.*?) caret=(\d+)/g) ?? []).at(-1);
    const start = read();
    for (const code of [53, 54, 55, 49, -5]) { s.input(`K D ${code}`); await sleep(120); s.input(`K U ${code}`); await sleep(200); }
    s.input('T 0 D 40 60'); await sleep(100); s.input('T 0 U 40 60');
    s.input('E zzz');
    await sleep(1500);
    const out = { before: start, after: read(), textAreaPackets: s.packets.filter((p) => p.type === 'A').length, itemStateChanged: /itemStateChanged/.test(s.text()), exceptions: s.logs.map((l) => l.line).filter((l) => /Not implemented|Exception/.test(l)).slice(0, 3) };
    await s.stop();
    return out;
  },

  // ---- media ---------------------------------------------------------------------------------------------------------
  async media() {
    const s = await session(audit('probe-media.jar'), { settle: 1000 });
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline && !/PROBE done/.test(s.text())) await sleep(300);
    const lines = s.logs.map((l) => ({ at: l.at, line: l.line })).filter((l) => /PROBE /.test(l.line));
    const items = {};
    for (const name of ['tone', 'wav', 'mp3', 'amr', 'midi']) {
      const start = lines.find((l) => l.line.startsWith(`PROBE ${name} START`));
      const end = lines.find((l) => l.line.startsWith(`PROBE ${name} END`));
      const startedLine = lines.find((l) => l.line.startsWith(`PROBE ${name} STARTED`));
      const win = start && end ? s.pcm.filter((c) => c.at >= start.at && c.at <= end.at + 400) : [];
      items[name] = { result: end ? end.line.replace(`PROBE ${name} END `, '') : 'no result', started: startedLine?.line.replace(`PROBE ${name} STARTED `, '') ?? null, pcm: pcmStats(win) };
    }
    const types = lines.find((l) => l.line.startsWith('PROBE types'));
    const protocols = lines.find((l) => l.line.startsWith('PROBE protocols'));
    const out = { supportedContentTypes: types?.line.replace('PROBE types OK ', '') ?? null, supportedProtocols: protocols?.line.replace('PROBE protocols OK ', '') ?? null, items, otherLog: s.logs.map((l) => l.line).filter((l) => /vlc|VLC|Exception/.test(l) && !/PROBE/.test(l)).slice(0, 5) };
    await s.stop();
    return out;
  },

  // ---- optional JSRs and device properties --------------------------------------------------------------------------
  async apis() {
    const s = await session(audit('probe-api.jar'), { settle: 500 });
    const asked = [];
    s.a.on('state', (type, body) => {
      if (type === 'P') { asked.push(body.subarray(4).toString('utf8')); s.input(`P ${body.readUInt32BE(0)} 1`); }
    });
    const deadline = Date.now() + 40000;
    while (Date.now() < deadline && !/API done/.test(s.text())) await sleep(300);
    const lines = s.logs.map((l) => l.line).filter((l) => l.startsWith('API '));
    const props = {};
    const results = {};
    for (const l of lines) {
      const m = /^API prop (\S+)=(.*)$/.exec(l);
      if (m) props[m[1]] = m[2]; else if (!l.startsWith('API canvas') && l !== 'API done') results[l.split(' ')[1]] = l.split(' ').slice(2).join(' ');
    }
    if (!lines.length) console.log(s.text().split('\n').slice(-25).join('\n'));
    const out = { canvas: lines.find((l) => l.startsWith('API canvas'))?.slice(11), properties: props, results, permissionPromptsAnswered: asked };
    await s.stop();
    return out;
  },

  // ---- is SoundfontPath honoured (property.txt in the per-game user path)? ----------------------------------------
  async soundfont() {
    const source = process.env.SF2 ?? '/root/.gervill/soundbank-emg.sf2';
    if (!existsSync(source)) return { skipped: `no SoundFont at ${source} (set SF2=...)` };
    // a copy under a unique name, so that opening it can only be the effect of the setting
    const sf2 = path.join(tmpdir(), 'jgo-audit-custom.sf2');
    writeFileSync(sf2, readFileSync(source));
    const trace = path.join(tmpdir(), `kem-strace-${process.pid}.txt`);
    const run = async (files) => {
      rmSync(trace, { force: true });
      const s = await session(audit('probe-media.jar'), { settle: 1000, userFiles: files, wrapper: ['strace', '-f', '-qq', '-e', 'trace=openat', '-o', trace] });
      const deadline = Date.now() + 25000;
      while (Date.now() < deadline && !/PROBE midi END/.test(s.text())) await sleep(300);
      const midi = /PROBE midi END (\S+)/.exec(s.text())?.[1] ?? 'no result';
      await s.stop();
      const opened = existsSync(trace) ? readFileSync(trace, 'utf8').split('\n').filter((l) => l.includes(path.basename(sf2)) && !l.includes('ENOENT')).length : 0;
      return { midiPlayback: midi, soundFontOpens: opened };
    };
    const without = await run({});
    const withProp = await run({ 'property.txt': `SoundfontPath=${sf2}\n` });
    rmSync(trace, { force: true });
    rmSync(sf2, { force: true });
    return { soundFontCopy: 'jgo-audit-custom.sf2', withoutSetting: without, withPropertyTxt: withProp };
  },
};

for (const name of Object.keys(scenarios)) {
  if (only.length && !only.includes(name)) continue;
  process.stdout.write(`▶ ${name} ... `);
  try {
    results[name] = await scenarios[name]();
    console.log('done');
  } catch (e) {
    results[name] = { error: String(e?.stack ?? e).split('\n').slice(0, 3).join(' | ') };
    console.log('FAILED', e.message);
  }
}
const file = path.join(root, 'tools/audit/results.json');
mkdirSync(path.dirname(file), { recursive: true });
let merged = results;
if (only.length && existsSync(file)) { try { merged = { ...JSON.parse(readFileSync(file, 'utf8')), ...results }; } catch { /* start over */ } }
writeFileSync(file, JSON.stringify(merged, null, 2) + '\n');
console.log(JSON.stringify(results, null, 2));
process.exit(0);
