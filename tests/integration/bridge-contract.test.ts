/**
 * Contract of the patched KEmulator Bridge, checked against the real emulator (see docs/BRIDGE.md).
 * The adapter is driven directly, so the raw statepipe packets can be decoded: if a KEmulator update or a patch
 * changes a packet format or the way bad input is handled, this suite fails before a viewer notices.
 * Replaces the manual probe runs of tools/audit for everything that is deterministic.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { KEmulatorAdapter } from '../../apps/api/src/kemulator/adapter.ts';
import { fixtures, jar1, root, sleep, waitFor } from './helpers.ts';

const lab = (name: string) => path.join(fixtures, '../../labgames/build', name);
const kemDir = path.join(root, 'runtime/build/kemulator');
const adapterBin = path.join(root, 'bridge/kemulator-adapter/target/release/kem-adapter');
const cleanups: string[] = [];
after(() => { for (const d of cleanups) rmSync(d, { recursive: true, force: true }); });

interface Packet { type: string; body: Buffer }
async function open(jar: string, w = 240, h = 320) {
  const bridgeDir = mkdtempSync('/dev/shm/kem-contract-');
  const userPath = mkdtempSync(path.join(tmpdir(), 'kem-contract-user-'));
  cleanups.push(bridgeDir, userPath);
  const a = new KEmulatorAdapter({ adapterBin, javaBin: 'java', kemDir, bridgeDir, jarPath: jar, userPath, width: w, height: h, heapMb: 256, frameEncoding: 'raw', cpuSeconds: 0, display: '', jvmExtraArgs: [], launchWrapper: [] } as never);
  const packets: Packet[] = [];
  const logs: string[] = [];
  let frames = 0;
  a.on('state', (type: string, body: Buffer) => packets.push({ type, body }));
  a.on('log', (l: string) => logs.push(l));
  a.on('frame', () => { frames++; });
  await a.start();
  await waitFor(() => frames > 0, 'first frame', 20000);
  const input = (line: string) => (a as unknown as { input(l: string): void }).input(line);
  return {
    a, packets, logs, input,
    frames: () => frames,
    text: () => logs.join('\n'),
    of: (t: string) => packets.filter((p) => p.type === t),
    stop: () => a.stop(),
  };
}

describe('Bridge contract: input lines (client -> emulator)', () => {
  it('K, T, X are applied; every bad line is survived and reported, never fatal', async () => {
    const s = await open(jar1);
    const alive = async (why: string) => { const n = s.frames(); await waitFor(() => s.frames() > n, `frames keep coming after ${why}`, 5000); assert.equal(s.a.state, 'running', why); };

    s.input('K D 53'); await waitFor(() => /KEY_DOWN 53/.test(s.text()), 'K D'); s.input('K U 53');
    s.input('T 0 D 100 100'); await waitFor(() => /POINTER_DOWN 100,100/.test(s.text()), 'T D'); s.input('T 0 U 100 100');
    s.input('X 1'); s.input('X 0');
    await alive('X 1 / X 0');

    const cases: [string, RegExp][] = [
      ['X 2', /IllegalArgumentException/],
      ['I', /Not implemented/], // reserved by the protocol, not implemented by the core
      ['Z 1', /Unknown event type: Z/],
      ['K D', /ArrayIndexOutOfBoundsException/],
      ['K D abc', /NumberFormatException/],
      ['K X 5', /IllegalArgumentException/],
      ['C 999999', /IllegalArgumentException/],
      ['P 12345 1', /IllegalArgumentException/],
      ['S 2', /IllegalArgumentException/], // S is JGO's suspend command: only 0 and 1 are valid
    ];
    for (const [line, expect] of cases) {
      const mark = s.logs.length;
      s.input(line);
      await waitFor(() => expect.test(s.logs.slice(mark).join('\n')), `"${line}" is reported (${expect})`, 5000);
      await alive(`"${line}"`);
    }
    // E with no text area focused is ignored quietly (a canvas game has none)
    const mark = s.logs.length;
    s.input('E hello'); s.input('E'); s.input('E %D0%9F');
    await sleep(500);
    assert.doesNotMatch(s.logs.slice(mark).join('\n'), /Exception|Not implemented/);
    await alive('E without a text area');
    await s.stop();
  });
});

describe('Bridge contract: state packets (emulator -> client)', () => {
  it('canvas: D "B", T title, C soft keys "left\\0right"; no A / I / M', async () => {
    const s = await open(jar1);
    const d = s.of('D');
    assert.ok(d.length >= 1);
    for (const p of d) assert.equal(p.body.toString('latin1'), 'B', 'the patched Bridge draws every screen itself: only "B"');
    assert.ok(s.of('T').length >= 1);
    const c = s.of('C').at(-1)!;
    assert.ok(c.body.includes(0), 'soft key labels are separated by a NUL byte');
    for (const t of ['N', 'I', 'M', 'P', 'U', 'V']) assert.equal(s.of(t).length, 0, `no "${t}" from a plain canvas`);
    for (const p of s.of('A')) assert.equal(p.body.length, 0, 'switching screens only cancels the text area (A without data)');
    await s.stop();
  });

  it('commands: M lists commands (u32 count, then u32 id, u8 kind, NUL-terminated label), the chosen command reaches the MIDlet', async () => {
    const s = await open(lab('kemscreens-canvascmd.jar'));
    s.input('K D -6'); s.input('K U -6'); // left soft key = the menu
    const m = await waitFor(() => s.of('M')[0], 'menu packet');
    const n = m.body.readUInt32BE(0);
    assert.ok(n >= 1);
    let o = 4;
    const labels: string[] = [];
    for (let i = 0; i < n; i++) {
      o += 4 + 1; // id + kind
      const end = m.body.indexOf(0, o);
      assert.ok(end > o, 'label is NUL-terminated');
      labels.push(m.body.subarray(o, end).toString('utf8'));
      o = end + 1;
    }
    assert.equal(o, m.body.length, 'no trailing bytes');
    assert.ok(labels.some((l) => /Option A|Back|Option B/.test(l)), JSON.stringify(labels));
    const id = m.body.readUInt32BE(4);
    s.input(`C ${id}`);
    await waitFor(() => /COMMAND_ACTION/.test(s.text()), 'command delivered to the MIDlet');
    await s.stop();
  });

  it('net: V is 8 bytes (u64 ms), P is u32 id + message, U carries the URL after the answer', async () => {
    const s = await open(lab('kemnet.jar'));
    s.input('K D 49'); s.input('K U 49');
    const v = await waitFor(() => s.of('V')[0], 'vibra packet');
    assert.equal(v.body.length, 8);
    assert.ok(Number(v.body.readBigUInt64BE(0)) > 0);
    s.input('K D 50'); s.input('K U 50');
    const p = await waitFor(() => s.of('P')[0], 'permission packet');
    assert.ok(p.body.length > 4);
    assert.match(p.body.subarray(4).toString('utf8'), /example\.invalid/);
    s.input(`P ${p.body.readUInt32BE(0)} 1`);
    const u = await waitFor(() => s.of('U')[0], 'url packet (JGO patch 0008)');
    assert.match(u.body.toString('utf8'), /^http:\/\/example\.invalid\//);
    await s.stop();
  });

  it('icon: I is u16 width, u16 height, then width*height RGBA words', async () => {
    const s = await open(lab('kemicon.jar'));
    const i = await waitFor(() => s.of('I')[0], 'icon packet');
    const w = i.body.readUInt16BE(0), h = i.body.readUInt16BE(2);
    assert.deepEqual([w, h], [16, 16]);
    assert.equal(i.body.length, 4 + w * h * 4);
    await s.stop();
  });

  it('text fields: N (u32 maxSize, u32 constraints, kind) precedes A (4 x i16 area + UTF-8 text)', async () => {
    const s = await open(lab('kemtext.jar'));
    const a = await waitFor(() => s.of('A').find((p) => p.body.length >= 8), 'text area');
    const n = s.of('N').at(-1)!;
    assert.equal(n.body.length, 9);
    assert.equal(n.body.readInt32BE(0), 8, 'maxSize of the first field');
    assert.equal(String.fromCharCode(n.body[8]!), 'F');
    const [x, y, w, h] = [0, 2, 4, 6].map((o) => a.body.readInt16BE(o));
    assert.ok(x! >= 0 && y! >= 0 && w! > 0 && h! > 0);
    assert.equal(a.body.subarray(8).toString('utf8'), 'ab');
    s.input('E %D0%9F%D1%80'); // "Пр"
    await waitFor(() => s.of('A').some((p) => p.body.subarray(8).toString('utf8') === 'Пр'), 'the game echoes the accepted text');
    await s.stop();
  });

  it('every screen type is reported as "B" and gets a title', async () => {
    for (const jar of ['kemscreens-form.jar', 'kemscreens-list.jar', 'kemscreens-textbox.jar', 'kemscreens-alert.jar']) {
      const s = await open(lab(jar));
      assert.deepEqual([...new Set(s.of('D').map((p) => p.body.toString('latin1')))], ['B'], jar);
      assert.ok(s.of('T').length >= 1, jar);
      await s.stop();
    }
  });
});
