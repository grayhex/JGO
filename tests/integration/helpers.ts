import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp, type App } from '../../apps/api/src/server.ts';
import { loadConfig, type Config } from '../../apps/api/src/config.ts';
import { decodeFrameHeader, WS_BIN_FRAME, type ServerEvent } from '@j2me-web/protocol';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const fixtures = path.join(root, 'tests/fixtures/testmidlet/build');
export const jar1 = path.join(fixtures, 'kemtest.jar');
export const jar2 = path.join(fixtures, 'kemtest2.jar');

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function waitFor<T>(fn: () => T | Promise<T>, what: string, timeoutMs = 15000, stepMs = 50): Promise<NonNullable<T>> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v as NonNullable<T>;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${what}`);
    await sleep(stepMs);
  }
}

export interface TestEnv {
  app: App;
  base: string;
  dataDir: string;
  runDir: string;
  cfg: Config;
  stop(): Promise<void>;
}

export async function startApp(over: Partial<Record<string, string>> = {}, dataDir?: string): Promise<TestEnv> {
  const dir = dataDir ?? mkdtempSync(path.join(tmpdir(), 'j2me-it-'));
  const runDir = mkdtempSync('/dev/shm/j2me-it-run-');
  const cfg = loadConfig({
    ...process.env,
    HOST: '127.0.0.1',
    PORT: '0',
    DATA_DIR: dir,
    RUN_DIR: runDir,
    WEB_DIR: '/nonexistent',
    LOG_LEVEL: 'silent',
    ...over,
  });
  const app = await buildApp(cfg);
  await app.fastify.listen({ host: '127.0.0.1', port: 0 });
  const addr = app.fastify.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    app,
    base: `http://127.0.0.1:${port}`,
    dataDir: dir,
    runDir,
    cfg,
    async stop() {
      await app.close();
      rmSync(runDir, { recursive: true, force: true });
    },
  };
}

export function cleanup(env: TestEnv, removeData = true) {
  if (removeData) rmSync(env.dataDir, { recursive: true, force: true });
}

export async function upload(base: string, file: string | Buffer, name = 'game.jar', headers: Record<string, string> = {}, extra?: { jad?: Buffer }) {
  const fd = new FormData();
  const buf = typeof file === 'string' ? readFileSync(file) : file;
  fd.append('jar', new Blob([buf]), name);
  if (extra?.jad) fd.append('jad', new Blob([extra.jad]), 'game.jad');
  const r = await fetch(`${base}/api/games`, { method: 'POST', body: fd, headers });
  return { status: r.status, body: (await r.json()) as any };
}

export function javaProcs(): number[] {
  // processes whose command line mentions our KEmulator jar
  const out: number[] = [];
  for (const pid of readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
    try {
      const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8');
      if ((cmd.includes('KEmulator.jar') || cmd.includes('kem-adapter')) && Number(pid) !== process.pid) out.push(Number(pid));
    } catch { /* gone */ }
  }
  return out;
}

export function killJava(): void {
  for (const pid of javaProcs()) {
    try {
      const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8');
      if (cmd.startsWith('java') || cmd.includes('/bin/java')) process.kill(pid, 'SIGKILL');
    } catch { /* gone */ }
  }
}

export interface Stream {
  ws: WebSocket;
  events: ServerEvent[];
  frames: { seq: number; w: number; h: number; enc: number; pixels: Uint8Array; at: number }[];
  send(ev: object): void;
  close(): void;
}

export async function openStream(base: string, sessionId: string, headers?: Record<string, string>): Promise<Stream> {
  const url = base.replace('http', 'ws') + `/api/sessions/${sessionId}/stream`;
  const ws = new WebSocket(url, headers ? ({ headers } as any) : undefined);
  ws.binaryType = 'arraybuffer';
  const s: Stream = { ws, events: [], frames: [], send: (ev) => ws.send(JSON.stringify(ev)), close: () => ws.close() };
  ws.onmessage = (m) => {
    if (typeof m.data === 'string') s.events.push(JSON.parse(m.data));
    else {
      const u8 = new Uint8Array(m.data as ArrayBuffer);
      if (u8[0] === WS_BIN_FRAME) {
        const h = decodeFrameHeader(u8);
        s.frames.push({ ...h, pixels: u8.subarray(14), at: Date.now() });
        if (s.frames.length > 400) s.frames.splice(0, 200);
      }
    }
  };
  await new Promise<void>((res, rej) => {
    ws.onopen = () => res();
    ws.onerror = () => rej(new Error('ws error'));
  });
  return s;
}

export function pixel(f: { w: number; pixels: Uint8Array }, x: number, y: number): string {
  const o = (y * f.w + x) * 4;
  return [f.pixels[o]!, f.pixels[o + 1]!, f.pixels[o + 2]!].map((v) => v.toString(16).padStart(2, '0')).join('');
}

export function countColor(f: { pixels: Uint8Array }, rgb: string): number {
  const r = parseInt(rgb.slice(0, 2), 16), g = parseInt(rgb.slice(2, 4), 16), b = parseInt(rgb.slice(4, 6), 16);
  let n = 0;
  for (let i = 0; i < f.pixels.length; i += 4) if (f.pixels[i] === r && f.pixels[i + 1] === g && f.pixels[i + 2] === b) n++;
  return n;
}

export function dirEntries(p: string): string[] {
  try { return readdirSync(p); } catch { return []; }
}
void execFileSync;
