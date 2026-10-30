import { type ChildProcessByStdio, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Readable, Writable } from 'node:stream';

export type AdapterState = 'idle' | 'starting' | 'running' | 'stopping' | 'exited';

export interface AdapterOptions {
  adapterBin: string;
  javaBin: string;
  kemDir: string;
  /** Directory for FIFOs and the `screen` file. Must exist, be private and live on tmpfs. */
  bridgeDir: string;
  jarPath: string;
  jadPath?: string | undefined;
  /** Becomes `-Dkem.userpath` (RMS, settings, JSR-75 root). Per game/owner. */
  userPath: string;
  width: number;
  height: number;
  heapMb: number;
  midlet?: string | undefined;
  frameEncoding: 'raw' | 'deflate';
  cpuSeconds: number;
  display: string;
  jvmExtraArgs: string[];
  launchWrapper: string[];
  graceMs?: number;
  handshakeTimeoutMs?: number;
}

export interface FrameMsg {
  seq: number;
  /** Adapter-side timestamp (µs since epoch) taken right after the framebuffer copy. */
  tsUs: number;
  /** 0 = RGBA, 1 = raw deflate of RGBA. */
  enc: number;
  data: Buffer;
}

export interface ExitInfo {
  code: number | null;
  /** 0 normal, 1 failed before handshake, 2 signalled, 3 killed (timeout). */
  reason: number;
  detail: string;
}

export interface AdapterEvents {
  ready: [{ width: number; height: number }];
  frame: [FrameMsg];
  /** Verbatim KEmulator statepipe packet. */
  state: [type: string, body: Buffer];
  log: [string];
  exit: [ExitInfo];
}

const JAVA_OPENS = [
  'java.base/java.lang',
  'java.base/java.lang.reflect',
  'java.base/java.lang.ref',
  'java.base/java.io',
  'java.base/java.nio',
  'java.base/java.util',
  'jdk.unsupported/sun.misc',
  'java.desktop/com.sun.media.sound',
  'java.desktop/javax.sound.midi',
];

/**
 * One KEmulator process driven through the Rust `kem-adapter` supervisor.
 * Method names follow the project spec: start, stop, keyDown, keyUp, pointerEvent, getStatus.
 */
export class KEmulatorAdapter extends EventEmitter<AdapterEvents> {
  private proc: ChildProcessByStdio<Writable, Readable, Readable> | null = null;
  private buf: Buffer = Buffer.alloc(0);
  private _state: AdapterState = 'idle';
  private held = new Set<number>();
  private exitInfo: ExitInfo | null = null;
  private stopTimer: NodeJS.Timeout | null = null;
  frames = 0;
  private fpsWindow: number[] = [];
  lastFrame: FrameMsg | null = null;
  private readyWaiters: { resolve: () => void; reject: (e: Error) => void }[] = [];

  readonly opts: AdapterOptions;

  constructor(opts: AdapterOptions) {
    super();
    // the supervisor runs with cwd = kemDir, so everything must be absolute
    this.opts = {
      ...opts,
      adapterBin: path.resolve(opts.adapterBin),
      kemDir: path.resolve(opts.kemDir),
      bridgeDir: path.resolve(opts.bridgeDir),
      jarPath: path.resolve(opts.jarPath),
      jadPath: opts.jadPath ? path.resolve(opts.jadPath) : undefined,
      userPath: path.resolve(opts.userPath),
    };
  }

  get state(): AdapterState {
    return this._state;
  }

  getStatus() {
    const now = Date.now();
    this.fpsWindow = this.fpsWindow.filter((t) => now - t <= 2000);
    return {
      state: this._state,
      frames: this.frames,
      fps: this.fpsWindow.length / 2,
      exit: this.exitInfo,
      pid: this.proc?.pid ?? null,
      heldKeys: [...this.held],
    };
  }

  buildJavaArgs(): string[] {
    const o = this.opts;
    const kemJar = path.join(o.kemDir, 'KEmulator.jar');
    const args = [
      `-Xmx${o.heapMb}M`,
      '-XX:+UseSerialGC',
      '-Xshare:auto',
      '-Djna.nosys=true',
      `-Djava.library.path=${o.kemDir}`,
      '-Dfile.encoding=UTF-8',
      '-Dswt.autoScale=false',
      `-Dkem.userpath=${o.userPath}`,
      // DISPLAY is only needed for 3D (GLFW/OpenGL); 2D works without it
      ...(o.display ? [] : ['-Djava.awt.headless=true']),
      `-javaagent:${kemJar}`,
      '-XX:+IgnoreUnrecognizedVMOptions',
      ...JAVA_OPENS.flatMap((m) => ['--add-opens', `${m}=ALL-UNNAMED`]),
      '--enable-native-access=ALL-UNNAMED',
      ...o.jvmExtraArgs,
      '-jar',
      kemJar,
      '-bridge',
      o.bridgeDir,
      '-s',
      '-screen',
      `${o.width}x${o.height}`,
      '-jar',
      o.jarPath,
    ];
    if (o.jadPath) args.push('-jad', o.jadPath);
    if (o.midlet) args.push('-midlet', o.midlet);
    return args;
  }

  /** Spawns the supervisor and resolves once the Bridge handshake is done. */
  start(): Promise<void> {
    if (this._state !== 'idle') return Promise.reject(new Error(`cannot start in state ${this._state}`));
    const o = this.opts;
    for (const [what, p] of [
      ['adapter binary', o.adapterBin],
      ['KEmulator.jar', path.join(o.kemDir, 'KEmulator.jar')],
      ['game jar', o.jarPath],
    ] as const) {
      if (!existsSync(p)) return Promise.reject(new Error(`${what} not found: ${p}`));
    }
    this._state = 'starting';
    const javaCmd = [...o.launchWrapper, o.javaBin, ...this.buildJavaArgs()];
    const args = [
      '--dir', o.bridgeDir,
      '--width', String(o.width),
      '--height', String(o.height),
      '--enc', o.frameEncoding,
      '--grace-ms', String(o.graceMs ?? 3000),
      '--handshake-timeout-ms', String(o.handshakeTimeoutMs ?? 60_000),
      ...(o.cpuSeconds > 0 ? ['--max-cpu-seconds', String(o.cpuSeconds)] : []),
      '--max-file-bytes', String(256 * 1024 * 1024),
      '--',
      ...javaCmd,
    ];
    // Minimal environment: no API secrets reach the untrusted MIDlet's JVM.
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
      HOME: o.userPath,
      LANG: 'C.UTF-8',
      ...(o.display ? { DISPLAY: o.display } : {}),
      ...(process.env.LIBGL_ALWAYS_SOFTWARE ? { LIBGL_ALWAYS_SOFTWARE: process.env.LIBGL_ALWAYS_SOFTWARE } : {}),
      ...(process.env.JAVA_HOME ? { JAVA_HOME: process.env.JAVA_HOME } : {}),
    };
    const proc = spawn(o.adapterBin, args, { stdio: ['pipe', 'pipe', 'pipe'], env, cwd: o.kemDir });
    this.proc = proc;
    proc.stdout.on('data', (c: Buffer) => this.onData(c));
    proc.stderr.on('data', (c: Buffer) => this.emit('log', `[adapter] ${c.toString('utf8').trimEnd()}`));
    proc.stdin.on('error', () => undefined);
    proc.on('error', (e) => this.finish({ code: null, reason: 1, detail: `cannot spawn adapter: ${e.message}` }));
    proc.on('close', (code, sig) => {
      this.finish({ code, reason: this.exitInfo ? this.exitInfo.reason : 2, detail: this.exitInfo?.detail ?? `adapter ended (${sig ?? code})` });
    });
    return new Promise<void>((resolve, reject) => this.readyWaiters.push({ resolve, reject }));
  }

  private onData(chunk: Buffer): void {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    for (;;) {
      if (this.buf.length < 5) return;
      const len = this.buf.readUInt32BE(1);
      if (this.buf.length < 5 + len) return;
      const type = this.buf[0]!;
      const payload = this.buf.subarray(5, 5 + len);
      this.buf = this.buf.subarray(5 + len);
      this.dispatch(type, payload);
    }
  }

  private dispatch(type: number, p: Buffer): void {
    switch (String.fromCharCode(type)) {
      case 'R': {
        this._state = 'running';
        this.emit('ready', { width: p.readUInt16BE(0), height: p.readUInt16BE(2) });
        for (const w of this.readyWaiters.splice(0)) w.resolve();
        break;
      }
      case 'F': {
        const f: FrameMsg = { seq: p.readUInt32BE(0), tsUs: Number(p.readBigUInt64BE(4)), enc: p[12]!, data: Buffer.from(p.subarray(13)) };
        this.frames++;
        this.fpsWindow.push(Date.now());
        this.lastFrame = f;
        this.emit('frame', f);
        break;
      }
      case 'S':
        this.emit('state', String.fromCharCode(p[0]!), Buffer.from(p.subarray(1)));
        break;
      case 'L':
        this.emit('log', p.toString('utf8'));
        break;
      case 'X': {
        const code = p.readInt32BE(0);
        this.exitInfo = { code: code < 0 ? null : code, reason: p[4]!, detail: p.subarray(5).toString('utf8') };
        break;
      }
    }
  }

  private finish(info: ExitInfo): void {
    if (this._state === 'exited') return;
    this.exitInfo ??= info;
    this._state = 'exited';
    if (this.stopTimer) clearTimeout(this.stopTimer);
    for (const w of this.readyWaiters.splice(0)) {
      w.reject(new Error(`KEmulator exited before it was ready: ${this.exitInfo.detail}${this.exitInfo.code != null ? ` (code ${this.exitInfo.code})` : ''}`));
    }
    this.emit('exit', this.exitInfo);
  }

  private send(type: string, payload: Buffer | string = ''): void {
    const proc = this.proc;
    if (!proc || !proc.stdin.writable) return;
    const body = typeof payload === 'string' ? Buffer.from(payload, 'ascii') : payload;
    const head = Buffer.alloc(5);
    head.write(type, 0, 'ascii');
    head.writeUInt32BE(body.length, 1);
    proc.stdin.write(Buffer.concat([head, body]));
  }

  private input(line: string): void {
    if (this._state === 'running') this.send('I', line);
  }

  keyDown(code: number): void {
    if (!Number.isInteger(code)) return;
    if (this.held.has(code)) this.input(`K R ${code}`);
    else {
      this.held.add(code);
      this.input(`K D ${code}`);
    }
  }

  keyUp(code: number): void {
    if (!Number.isInteger(code) || !this.held.delete(code)) return;
    this.input(`K U ${code}`);
  }

  /** Releases every held key, e.g. on focus loss or when the last viewer leaves. */
  releaseAll(): void {
    for (const c of [...this.held]) this.keyUp(c);
  }

  pointerEvent(id: number, s: 'D' | 'M' | 'U', x: number, y: number): void {
    if (![id, x, y].every(Number.isInteger) || !['D', 'M', 'U'].includes(s)) return;
    this.input(`T ${id} ${s} ${x} ${y}`);
  }

  invokeCommand(id: number): void {
    if (Number.isInteger(id)) this.input(`C ${id}`);
  }

  answerPermission(id: number, allow: boolean): void {
    if (Number.isInteger(id)) this.input(`P ${id} ${allow ? 1 : 0}`);
  }

  /** Graceful stop: close inputpipe, the supervisor SIGKILLs the process group after the grace period. */
  stop(): Promise<ExitInfo> {
    if (this._state === 'exited') return Promise.resolve(this.exitInfo!);
    return new Promise((resolve) => {
      this.once('exit', resolve);
      if (this._state === 'idle') return this.finish({ code: null, reason: 0, detail: 'never started' });
      this._state = this._state === 'starting' ? 'starting' : 'stopping';
      this.send('Q');
      // safety net in case the supervisor itself is wedged
      this.stopTimer = setTimeout(() => {
        this.send('K');
        this.proc?.kill('SIGKILL');
      }, (this.opts.graceMs ?? 3000) + 2000);
      this.stopTimer.unref();
    });
  }
}
