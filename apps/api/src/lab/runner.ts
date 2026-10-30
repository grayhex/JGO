import { mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import {
  decodeFrameHeader, FRAME_ENC_DEFLATE_RAW, type GameMeta, KEY_LAYOUTS, type KeyCodes, type LayoutId, type SessionStatus, WS_BIN_AUDIO, WS_BIN_FRAME, WS_FRAME_HEADER_BYTES,
} from '@j2me-web/protocol';
import type { JarAnalysis } from './analyze.js';
import { frameStats, type FrameStats } from './frames.js';
import { encodePng } from './png.js';

export interface GameLabConfig {
  /** Device preset id, 'auto' (use the analyzer's recommendation) or 'none' (emulator defaults). */
  device?: string;
  width?: number;
  height?: number;
  layout?: LayoutId;
  midlet?: string;
  heapMb?: number;
  /** Seconds of the idle measurement window. */
  measureSeconds?: number;
  firstFrameTimeoutMs?: number;
  /** Explicit J2ME key codes to press instead of the default smoke sequence. */
  keys?: number[];
  note?: string;
}

export interface LabInput {
  jarPath: string;
  jadPath?: string | undefined;
  label: string;
  config?: GameLabConfig;
}

export interface LabOptions {
  base: string;
  cookie?: string;
  outDir: string;
  defaults: Required<Pick<GameLabConfig, 'device' | 'measureSeconds' | 'firstFrameTimeoutMs'>>;
  log?: (msg: string) => void;
}

export interface Shot {
  label: string;
  file: string;
  atMs: number;
  width: number;
  height: number;
  stats: FrameStats;
}

export type AutoStatus = 'pass' | 'warn' | 'fail';

export interface GameResult {
  label: string;
  file: string;
  jad: string | null;
  game: Pick<GameMeta, 'id' | 'sha256' | 'name' | 'vendor' | 'version' | 'sizeBytes' | 'classVersion' | 'midlets' | 'warnings'> | null;
  analysis: JarAnalysis | null;
  recommendedDevice: string | null;
  device: string | null;
  size: { width: number; height: number } | null;
  startedAt: string;
  durationMs: number;
  start: { ok: boolean; error: string | null };
  firstFrameMs: number | null;
  frames: {
    total: number;
    fpsIdle: number;
    fpsAfterInput: number;
    distinctIdle: number;
    distinctAfterInput: number;
    newAfterInput: number;
    dominantShareMin: number;
    colorsMax: number;
    litShareMax: number;
  } | null;
  verdicts: { blank: boolean; animated: boolean; static: boolean; inputResponse: 'yes' | 'no' | 'unknown' };
  resources: SessionStatus['resources'];
  audio: { bytes: number; seconds: number; audible: boolean; peak: number };
  exit: { state: string; code: number | null; detail: string | null; cleanShutdown: boolean };
  /** Things the game asked the platform for during the run (menus, permission prompts, vibration, URLs, screen changes). */
  platformEvents: { menus: number; permissions: string[]; vibrations: number; urls: string[]; softkeys: { left: string; right: string } | null; title: string | null; displayables: string[] };
  diagnostics: string[];
  errorLines: string[];
  logTail: string[];
  shots: Shot[];
  auto: { status: AutoStatus; reasons: string[] };
  /** Filled in by the HTML report / ratings.json. */
  manual?: { rating: 'works' | 'minor' | 'broken' | 'untested'; note: string };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const NOISE = /net\.java\.games\.input|LinuxEnvironmentPlugin|DefaultControllerEnvironment|XDG_RUNTIME_DIR|INFO: Loading|Picked up JAVA_TOOL|^\s+at |Sending packet|properties load failed/;

class Api {
  constructor(private base: string, private cookie?: string) {}
  headers(extra: Record<string, string> = {}): Record<string, string> {
    return { ...(this.cookie ? { cookie: this.cookie } : {}), ...extra };
  }
  async json<T>(p: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
    const r = await fetch(this.base + p, { ...init, headers: this.headers((init.headers as Record<string, string>) ?? {}) });
    const text = await r.text();
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { message: text }; }
    return { status: r.status, body: body as T };
  }
  post<T>(p: string, data: unknown) {
    return this.json<T>(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  }
}

interface Collected {
  t: number;
  w: number;
  h: number;
  px: Uint8Array;
}

export async function runGame(input: LabInput, opts: LabOptions): Promise<GameResult> {
  const log = opts.log ?? (() => undefined);
  const api = new Api(opts.base, opts.cookie);
  const cfg = { ...opts.defaults, ...input.config };
  const t0 = Date.now();
  const res: GameResult = {
    label: input.label, file: path.basename(input.jarPath), jad: input.jadPath ? path.basename(input.jadPath) : null, game: null, analysis: null, recommendedDevice: null, device: null,
    size: null, startedAt: new Date().toISOString(), durationMs: 0, start: { ok: false, error: null }, firstFrameMs: null, frames: null,
    verdicts: { blank: false, animated: false, static: false, inputResponse: 'unknown' }, resources: null, audio: { bytes: 0, seconds: 0, audible: false, peak: 0 },
    exit: { state: 'unknown', code: null, detail: null, cleanShutdown: false }, platformEvents: { menus: 0, permissions: [], vibrations: 0, urls: [], softkeys: null, title: null, displayables: [] }, diagnostics: [], errorLines: [], logTail: [], shots: [], auto: { status: 'fail', reasons: [] },
  };
  const fail = (reason: string) => { res.auto.reasons.push(reason); res.auto.status = 'fail'; };
  let sessionId: string | null = null;
  try {
    // 1. upload
    const fd = new FormData();
    fd.append('jar', new Blob([await readFile(input.jarPath)]), path.basename(input.jarPath));
    if (input.jadPath) fd.append('jad', new Blob([await readFile(input.jadPath)]), path.basename(input.jadPath));
    const up = await api.json<{ game: GameMeta; message?: string; error?: string }>('/api/games', { method: 'POST', body: fd });
    if (up.status >= 400) { res.start.error = `upload rejected: ${up.body.message ?? up.status}`; fail(res.start.error); return res; }
    const game = up.body.game;
    res.game = { id: game.id, sha256: game.sha256, name: game.name, vendor: game.vendor, version: game.version, sizeBytes: game.sizeBytes, classVersion: game.classVersion, midlets: game.midlets, warnings: game.warnings };

    // 2. static analysis
    const an = await api.json<{ analysis: JarAnalysis; recommendedDevice: string | null }>(`/api/games/${game.id}/analysis`);
    if (an.status === 200) { res.analysis = an.body.analysis; res.recommendedDevice = an.body.recommendedDevice; }
    if (game.classVersion >= 49) { res.start.error = `class version ${game.classVersion} is not supported by KEmulator`; fail(res.start.error); return res; }

    // 3. settings
    const device = cfg.device === 'auto' ? res.recommendedDevice : cfg.device === 'none' ? null : cfg.device ?? null;
    const settings: Record<string, unknown> = { ...(device ? { device } : {}) };
    for (const k of ['width', 'height', 'layout', 'midlet', 'heapMb'] as const) if (cfg[k] !== undefined) settings[k] = cfg[k];
    res.device = device;
    const need3d = res.analysis?.needsGl;
    const s = await api.post<SessionStatus & { message?: string; error?: string }>('/api/sessions', { gameId: game.id, settings });
    if (s.status !== 201) { res.start.error = `${s.body.error ?? s.status}: ${s.body.message ?? ''}`.slice(0, 600); fail(`session did not start (${res.start.error.split('\n')[0]})`); return res; }
    sessionId = s.body.id;
    res.start.ok = true;
    res.size = { width: s.body.width, height: s.body.height };
    const keysOf = (await api.json<{ presets: { id: string; keys: KeyCodes }[] }>('/api/devices')).body?.presets?.find((p) => p.id === device)?.keys;
    const layoutId = (settings.layout as LayoutId | undefined) ?? 'nokia';
    const keys: KeyCodes = keysOf ?? KEY_LAYOUTS[layoutId].keys;

    // 4. stream
    const wsUrl = opts.base.replace(/^http/, 'ws') + `/api/sessions/${sessionId}/stream`;
    const ws = new WebSocket(wsUrl, opts.cookie ? ({ headers: { cookie: opts.cookie } } as never) : undefined);
    ws.binaryType = 'arraybuffer';
    const frames: Collected[] = [];
    const stats: { t: number; s: FrameStats }[] = [];
    let last: Collected | null = null;
    let audioBytes = 0, audioPeak = 0;
    const tStream = Date.now();
    ws.onmessage = (m) => {
      if (typeof m.data === 'string') {
        let ev: { t: string; [k: string]: unknown };
        try { ev = JSON.parse(m.data); } catch { return; }
        const pe = res.platformEvents;
        if (ev.t === 'menu') { // answer like a user would: take the first entry
          pe.menus++;
          const first = (ev.items as { id: number }[] | undefined)?.[0];
          if (first && ws.readyState === 1) ws.send(JSON.stringify({ t: 'cmd', id: first.id }));
        } else if (ev.t === 'permission') {
          pe.permissions.push(String(ev.message ?? '').slice(0, 200));
          if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'perm', id: ev.id, allow: true }));
        } else if (ev.t === 'vibrate') pe.vibrations++;
        else if (ev.t === 'url') pe.urls.push(String(ev.url).slice(0, 200));
        else if (ev.t === 'softkeys') pe.softkeys = { left: String(ev.left), right: String(ev.right) };
        else if (ev.t === 'title') pe.title = String(ev.title);
        else if (ev.t === 'displayable' && !pe.displayables.includes(String(ev.kind))) pe.displayables.push(String(ev.kind));
        return;
      }
      const u8 = new Uint8Array(m.data as ArrayBuffer);
      if (u8[0] === WS_BIN_AUDIO) {
        audioBytes += u8.length - 1;
        for (let i = 1; i + 1 < u8.length; i += 64) audioPeak = Math.max(audioPeak, Math.abs(((u8[i + 1]! << 8) | u8[i]!) << 16 >> 16) / 32768);
        return;
      }
      if (u8[0] !== WS_BIN_FRAME || u8.length < WS_FRAME_HEADER_BYTES) return;
      const h = decodeFrameHeader(u8);
      const body = u8.subarray(WS_FRAME_HEADER_BYTES);
      const px = h.enc === FRAME_ENC_DEFLATE_RAW ? new Uint8Array(inflateRawSync(body)) : new Uint8Array(body);
      if (px.length !== h.w * h.h * 4) return;
      const c: Collected = { t: Date.now() - tStream, w: h.w, h: h.h, px };
      last = c;
      frames.push(c);
      if (frames.length > 20) frames.shift(); // keep memory flat; stats are what we need
      stats.push({ t: c.t, s: frameStats(px) });
    };
    await new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = () => reject(new Error('websocket error')); });
    ws.send(JSON.stringify({ t: 'audio', on: true }));

    const shot = (label: string): void => {
      if (!last) return;
      const file = `shots/${res.game!.id}-${label}.png`;
      mkdirSync(path.join(opts.outDir, 'shots'), { recursive: true });
      writeFileSync(path.join(opts.outDir, file), encodePng(last.px, last.w, last.h));
      res.shots.push({ label, file, atMs: Date.now() - tStream, width: last.w, height: last.h, stats: frameStats(last.px) });
    };

    // first frame
    const timeout = cfg.firstFrameTimeoutMs * (need3d ? 1.5 : 1);
    const tWait = Date.now();
    while (!last && Date.now() - tWait < timeout) {
      const st = (await api.json<SessionStatus>(`/api/sessions/${sessionId}`)).body;
      if (st.state === 'failed' || st.state === 'exited') break;
      await sleep(100);
    }
    if (!last) {
      const st = (await api.json<SessionStatus>(`/api/sessions/${sessionId}`)).body;
      fail(st.state === 'failed' || st.state === 'exited' ? `emulator stopped before the first frame (${st.exitDetail ?? st.state}, code ${st.exitCode})` : `no frame within ${Math.round(timeout / 1000)} s`);
      ws.close();
    } else {
      res.firstFrameMs = (await api.json<SessionStatus>(`/api/sessions/${sessionId}`)).body.firstFrameMs;
      log(`  first frame after ${res.firstFrameMs} ms`);
      await sleep(400);
      shot('first');

      // 5. idle window
      const idleStart = Date.now() - tStream;
      const cpuA = (await api.json<SessionStatus>(`/api/sessions/${sessionId}`)).body.resources;
      await sleep(cfg.measureSeconds * 1000);
      const idleEnd = Date.now() - tStream;
      shot('idle');
      const idle = stats.filter((x) => x.t >= idleStart && x.t <= idleEnd);
      const idleHashes = new Set(idle.map((x) => x.s.hash));

      // 6. input phase: a generic smoke sequence on the device's own key codes
      const seq = cfg.keys ?? [keys.fire, keys.softLeft, keys.softRight, keys.right, keys.left, keys.up, keys.down, 53, 48, 42, 35];
      const inStart = Date.now() - tStream;
      const send = (ev: object) => { if (ws.readyState === 1) ws.send(JSON.stringify(ev)); };
      for (const code of seq) {
        send({ t: 'key', s: 'D', code });
        await sleep(120);
        send({ t: 'key', s: 'U', code });
        await sleep(250);
      }
      const w = res.size.width, h = res.size.height;
      send({ t: 'pointer', id: 0, s: 'D', x: w >> 1, y: h >> 1 });
      await sleep(80);
      send({ t: 'pointer', id: 0, s: 'U', x: w >> 1, y: h >> 1 });
      await sleep(900);
      shot('after-input');
      const inEnd = Date.now() - tStream;
      const post = stats.filter((x) => x.t >= inStart && x.t <= inEnd);
      const postHashes = new Set(post.map((x) => x.s.hash));
      const newAfter = [...postHashes].filter((x) => !idleHashes.has(x)).length;
      await sleep(600);
      shot('final');

      const cpuB = (await api.json<SessionStatus>(`/api/sessions/${sessionId}`)).body.resources;
      void cpuA; void cpuB;
      const all = stats;
      const dur = (a: number, b: number) => Math.max(0.001, (b - a) / 1000);
      res.frames = {
        total: all.length,
        fpsIdle: round(idle.length / dur(idleStart, idleEnd)),
        fpsAfterInput: round(post.length / dur(inStart, inEnd)),
        distinctIdle: idleHashes.size,
        distinctAfterInput: postHashes.size,
        newAfterInput: newAfter,
        dominantShareMin: round(Math.min(...all.map((x) => x.s.dominantShare)), 3),
        colorsMax: Math.max(...all.map((x) => x.s.colors)),
        litShareMax: round(Math.max(...all.map((x) => x.s.litShare)), 3),
      };
      res.verdicts.blank = all.every((x) => x.s.dominantShare >= 0.995) || res.frames.litShareMax < 0.002;
      res.verdicts.animated = idleHashes.size >= 3;
      res.verdicts.static = !res.verdicts.animated && newAfter === 0;
      res.verdicts.inputResponse = res.verdicts.animated ? 'unknown' : newAfter > 0 ? 'yes' : 'no';
      send({ t: 'release-all' });
      ws.close();
    }
    res.audio = { bytes: audioBytes, seconds: round(audioBytes / 176400), audible: audioPeak > 0.01, peak: round(audioPeak, 3) };
  } catch (e) {
    fail(`lab error: ${(e as Error).message}`);
  } finally {
    // 7. stop + collect
    if (sessionId) {
      const stop = await api.json<SessionStatus>(`/api/sessions/${sessionId}`, { method: 'DELETE' }).catch(() => null);
      const st = stop?.body ?? (await api.json<SessionStatus>(`/api/sessions/${sessionId}`).catch(() => null))?.body;
      if (st) {
        res.resources = st.resources;
        res.diagnostics = st.diagnostics;
        res.logTail = st.logTail.filter((l) => !NOISE.test(l)).slice(-40);
        res.errorLines = st.logTail.filter((l) => !NOISE.test(l) && /Exception|Error\b|FAILED|failed/.test(l)).slice(0, 8);
        res.exit = { state: st.state, code: st.exitCode, detail: st.exitDetail, cleanShutdown: st.state === 'exited' && st.exitCode === 0 };
        if (!res.audio.bytes) res.audio.bytes = st.audioBytes;
      }
    }
    res.durationMs = Date.now() - t0;
  }
  judge(res);
  return res;
}

function round(n: number, d = 1): number {
  const k = 10 ** d;
  return Math.round(n * k) / k;
}

/** Turns the measurements into pass/warn/fail with human-readable reasons. */
export function judge(res: GameResult): void {
  if (res.auto.status === 'fail' && res.auto.reasons.length) return; // already failed hard
  const reasons: string[] = [];
  let status: AutoStatus = 'pass';
  const bad = (r: string) => { status = 'fail'; reasons.push(r); };
  const warn = (r: string) => { if (status === 'pass') status = 'warn'; reasons.push(r); };
  if (!res.start.ok) bad('session did not start');
  else if (!res.frames) bad('no frames received');
  else {
    if (!res.exit.cleanShutdown && res.exit.state === 'failed') bad(`emulator crashed (${res.exit.detail ?? 'unknown'}, code ${res.exit.code})`);
    if (res.verdicts.blank) bad('picture is blank (single colour / black)');
    if (res.verdicts.static) warn('picture never changes, even after input');
    if (res.verdicts.animated && res.frames.fpsIdle < 10) warn(`low frame rate (${res.frames.fpsIdle} fps)`);
    if (res.verdicts.inputResponse === 'no') warn('no visible reaction to key presses');
  }
  if (res.diagnostics.length) warn(`${res.diagnostics.length} emulator diagnostic(s): ${res.diagnostics[0]}`);
  if (res.errorLines.length && status === 'pass') warn(`${res.errorLines.length} error line(s) in the log`);
  if (res.analysis?.findings.some((f) => f.level === 'error') && status === 'pass') warn('static analysis found blocking issues even though the game ran');
  res.auto = { status, reasons };
}
