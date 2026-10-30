import { appendFile } from 'node:fs/promises';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import {
  type ClientEvent,
  encodeFrameHeader,
  type GameMeta,
  type GameSettings,
  KEY_LAYOUTS,
  type ServerEvent,
  type SessionState,
  type SessionStatus,
  WS_BIN_AUDIO,
} from '@j2me-web/protocol';
import { ResourceMeter } from './procstats.js';
import { writeMidletsIni } from './appSettings.js';
import { findPreset, loadDevicePresets } from './devices.js';
import { KEmulatorAdapter, type ExitInfo, type FrameMsg } from './kemulator/adapter.js';
import { newId, type Library } from './library.js';
import type { Config } from './config.js';

export class SessionError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export interface StreamClient {
  id: string;
  sendText(s: string): void;
  /** Returns false when the frame was dropped because the socket is congested. */
  sendFrame(b: Buffer): boolean;
  /** Audio chunk (already prefixed with the WS audio kind byte). Dropped when congested. */
  sendAudio(b: Buffer): void;
  close(): void;
}

const DIAG_RULES: { re: RegExp; msg: (m: RegExpMatchArray) => string }[] = [
  { re: /ClassNotFoundException:?\s*([\w.$/]+)/, msg: (m) => `Missing class ${m[1]} — API not provided by the emulator (or the JAR is incomplete).` },
  { re: /NoClassDefFoundError:?\s*([\w.$/]+)/, msg: (m) => `Missing class definition ${m[1]} — unsupported API.` },
  { re: /(NoSuchMethodError|NoSuchFieldError|AbstractMethodError):?\s*(.*)/, msg: (m) => `${m[1]}: ${m[2]} — API mismatch.` },
  { re: /Invalid class version:?\s*(\d+)/, msg: (m) => `Class file version ${m[1]} is not supported (J2ME classes must be <= 48).` },
  { re: /OutOfMemoryError/, msg: () => 'Out of memory — raise "Heap (MB)" in the game settings.' },
  { re: /UnsupportedOperationException:?\s*(.*)/, msg: (m) => `Unsupported operation: ${m[1] || 'n/a'}` },
  { re: /Not implemented|not implemented/, msg: () => 'The game used a feature this emulator frontend has not implemented yet.' },
  { re: /Fail to launch the MIDlet class:?\s*(\S+)/, msg: (m) => `MIDlet class ${m[1]} failed to launch.` },
  { re: /Can not find MIDlet class/, msg: () => 'No MIDlet class found; set the MIDlet class in the game settings.' },
  { re: /Get Classes Failed/, msg: () => 'The JAR could not be read by the emulator.' },
  { re: /(GLFW|glfw).*(fail|error|Error)|Failed to create (the )?GLFW|UnsatisfiedLinkError.*(GL|lwjgl)/, msg: () => '3D initialisation failed (OpenGL/GLFW). Check DISPLAY and Mesa in the runtime.' },
  { re: /SecurityException:?\s*(.*)/, msg: (m) => `Permission denied: ${m[1] || 'security exception'}` },
];

export class Session {
  readonly createdAt = Date.now();
  state: SessionState = 'starting';
  title: string | null = null;
  softkeys = { left: '', right: '' };
  displayable: 'canvas' | 'textbox' | 'list' = 'canvas';
  logTail: string[] = [];
  diagnostics: string[] = [];
  exit: ExitInfo | null = null;
  framesDropped = 0;
  latencyMs: number | null = null;
  endedAt: number | null = null;
  readonly clients = new Map<string, { c: StreamClient; held: Set<number>; audio: boolean }>();
  audioBytes = 0;
  readonly meter = new ResourceMeter();
  private lastPacked: Buffer | null = null;
  private timers: NodeJS.Timeout[] = [];
  private pendingMenu: ServerEvent | null = null;
  /** permission prompts waiting for a viewer's answer (id -> deny timer) */
  private pendingPerms = new Map<number, NodeJS.Timeout>();
  private logFile: string;

  constructor(
    readonly id: string,
    readonly game: GameMeta,
    readonly settings: GameSettings,
    readonly owner: string,
    readonly adapter: KEmulatorAdapter,
    readonly bridgeDir: string,
    logFile: string,
    private cfg: Config,
    private onEnded: (s: Session) => void,
  ) {
    this.logFile = logFile;
    adapter.on('frame', (f) => this.onFrame(f));
    adapter.on('audio', (a) => this.onAudio(a));
    adapter.on('state', (t, b) => this.onStatePacket(t, b));
    adapter.on('log', (l) => this.pushLog(l));
    adapter.on('exit', (e) => this.onExit(e));
    this.timers.push(
      setInterval(() => this.broadcastText({ t: 'stats', ...this.stats() }), 1000),
      setInterval(() => this.meter.sample(this.adapter.getStatus().pid), 500),
      setTimeout(() => void this.stop('max duration reached'), cfg.sessionMaxMs),
    );
    for (const t of this.timers) t.unref();
  }

  stats() {
    const st = this.adapter.getStatus();
    return { fps: Math.round(st.fps * 10) / 10, frames: st.frames, dropped: this.framesDropped, latencyMs: this.latencyMs };
  }

  status(): SessionStatus {
    const st = this.adapter.getStatus();
    return {
      id: this.id,
      gameId: this.game.id,
      state: this.state,
      width: this.settings.width,
      height: this.settings.height,
      startedAt: new Date(this.createdAt).toISOString(),
      uptimeMs: (this.endedAt ?? Date.now()) - this.createdAt,
      framesReceived: st.frames,
      framesDropped: this.framesDropped,
      fps: Math.round(st.fps * 10) / 10,
      exitCode: this.exit?.code ?? null,
      exitDetail: this.exit?.detail ?? null,
      title: this.title,
      softkeys: this.softkeys,
      logTail: this.logTail.slice(-60),
      diagnostics: this.diagnostics,
      audioBytes: this.audioBytes,
      firstFrameMs: st.firstFrameAt ? st.firstFrameAt - this.createdAt : null,
      resources: this.meter.peakRssKb ? this.meter.usage() : null,
      device: this.settings.device ?? null,
      encoding: this.cfg.frameEncoding,
    };
  }

  private pushLog(line: string): void {
    if (!line.trim()) return;
    // JAVA_TOOL_OPTIONS banner and jinput probing are noise
    if (line.startsWith('Picked up JAVA_TOOL_OPTIONS')) return;
    this.logTail.push(line);
    if (this.logTail.length > 300) this.logTail.splice(0, this.logTail.length - 300);
    void appendFile(this.logFile, `${new Date().toISOString()} ${line}\n`).catch(() => undefined);
    for (const r of DIAG_RULES) {
      const m = line.match(r.re);
      if (m) {
        const d = r.msg(m);
        if (!this.diagnostics.includes(d) && this.diagnostics.length < 20) {
          this.diagnostics.push(d);
          this.broadcastText({ t: 'log', line: `⚠ ${d}` });
        }
      }
    }
    this.broadcastText({ t: 'log', line: line.slice(0, 500) });
  }

  private onFrame(f: FrameMsg): void {
    this.latencyMs = Math.max(0, Date.now() - f.tsUs / 1000);
    const hdr = encodeFrameHeader(f.seq, f.enc, this.settings.width, this.settings.height, Date.now() & 0xffffffff);
    const packed = Buffer.concat([hdr, f.data]);
    this.lastPacked = packed;
    for (const { c } of this.clients.values()) if (!c.sendFrame(packed)) this.framesDropped++;
  }

  private onAudio(pcm: Buffer): void {
    this.audioBytes += pcm.length;
    if (![...this.clients.values()].some((e) => e.audio)) return;
    const msg = Buffer.concat([Buffer.from([WS_BIN_AUDIO]), pcm]);
    for (const e of this.clients.values()) if (e.audio) e.c.sendAudio(msg);
  }

  private onStatePacket(type: string, b: Buffer): void {
    switch (type) {
      case 'C': {
        const i = b.indexOf(0);
        this.softkeys = i < 0 ? { left: b.toString('utf8'), right: '' } : { left: b.subarray(0, i).toString('utf8'), right: b.subarray(i + 1).toString('utf8') };
        this.broadcastText({ t: 'softkeys', ...this.softkeys });
        break;
      }
      case 'T':
        this.title = b.toString('utf8');
        this.broadcastText({ t: 'title', title: this.title });
        break;
      case 'D': {
        const k = String.fromCharCode(b[0] ?? 66);
        this.displayable = k === 'T' ? 'textbox' : k === 'L' ? 'list' : 'canvas';
        this.broadcastText({ t: 'displayable', kind: this.displayable });
        if (this.displayable !== 'canvas') this.pushLog(`[emulator] ${this.displayable} screens are not rendered by the Bridge frontend yet`);
        break;
      }
      case 'M': {
        const n = b.readUInt32BE(0);
        const items: { id: number; kind: 'normal' | 'radio' | 'radio-selected'; text: string }[] = [];
        let o = 4;
        for (let k = 0; k < n && o + 5 <= b.length; k++) {
          const id = b.readUInt32BE(o);
          const kc = String.fromCharCode(b[o + 4]!);
          o += 5;
          const end = b.indexOf(0, o);
          if (end < 0) break;
          items.push({ id, kind: kc === '2' ? 'radio-selected' : kc === '1' ? 'radio' : 'normal', text: b.subarray(o, end).toString('utf8') });
          o = end + 1;
        }
        this.pendingMenu = { t: 'menu', items };
        this.broadcastText(this.pendingMenu);
        break;
      }
      case 'O':
        this.pendingMenu = null;
        this.broadcastText({ t: 'menu-close' });
        break;
      case 'V':
        if (b.length >= 8) this.broadcastText({ t: 'vibrate', ms: Number(b.readBigUInt64BE(0)) });
        break;
      case 'P': {
        const id = b.readUInt32BE(0);
        const message = b.subarray(4).toString('utf8');
        // The MIDlet thread is blocked until we answer. Nobody watching -> deny at once; otherwise give
        // the viewer a bounded time, so a closed tab can never freeze the game forever.
        if (!this.clients.size) {
          this.pushLog(`[session] permission denied (no viewer connected): ${message}`);
          this.adapter.answerPermission(id, false);
          break;
        }
        const t = setTimeout(() => {
          this.pendingPerms.delete(id);
          this.pushLog(`[session] permission denied (no answer in ${Math.round(this.cfg.permissionTimeoutMs / 1000)} s): ${message}`);
          this.adapter.answerPermission(id, false);
        }, this.cfg.permissionTimeoutMs);
        t.unref();
        this.pendingPerms.set(id, t);
        this.broadcastText({ t: 'permission', id, message });
        break;
      }
      case 'U': {
        const url = b.toString('utf8');
        // only schemes a browser can handle safely; file:, vlc: and friends are never forwarded
        if (/^(https?|mailto|tel):/i.test(url)) this.broadcastText({ t: 'url', url });
        else this.pushLog(`[session] ignored platformRequest to ${url.slice(0, 80)}`);
        break;
      }
      case 'L':
        this.pushLog(`[emulator] ${b.toString('utf8')}`);
        break;
      default:
        break; // 'A' (text area), 'I' (icon): not used by the web UI yet
    }
  }

  private onExit(e: ExitInfo): void {
    this.exit = e;
    this.endedAt = Date.now();
    this.state = e.reason === 0 && (e.code === 0 || e.code === null) ? 'exited' : 'failed';
    if (this.state === 'failed' && e.code !== null && e.code !== 0) this.pushLog(`[adapter] emulator exited with code ${e.code}: ${e.detail}`);
    for (const t of this.timers) clearTimeout(t), clearInterval(t);
    for (const t of this.pendingPerms.values()) clearTimeout(t);
    this.pendingPerms.clear();
    this.broadcastText({ t: 'state', state: this.state, exitCode: e.code, detail: e.detail });
    for (const { c } of [...this.clients.values()]) c.close();
    this.clients.clear();
    rmSync(this.bridgeDir, { recursive: true, force: true });
    this.onEnded(this);
  }

  broadcastText(ev: ServerEvent): void {
    if (!this.clients.size) return;
    const s = JSON.stringify(ev);
    for (const { c } of this.clients.values()) c.sendText(s);
  }

  addClient(c: StreamClient): void {
    this.clients.set(c.id, { c, held: new Set(), audio: false });
    this.clearIdle();
    c.sendText(JSON.stringify({ t: 'hello', sessionId: this.id, width: this.settings.width, height: this.settings.height, state: this.state } satisfies ServerEvent));
    c.sendText(JSON.stringify({ t: 'softkeys', ...this.softkeys } satisfies ServerEvent));
    if (this.title !== null) c.sendText(JSON.stringify({ t: 'title', title: this.title } satisfies ServerEvent));
    if (this.pendingMenu) c.sendText(JSON.stringify(this.pendingMenu));
    for (const d of this.diagnostics) c.sendText(JSON.stringify({ t: 'log', line: `⚠ ${d}` } satisfies ServerEvent));
    // late joiners / reconnects must see the current screen even if the game never repaints
    if (this.lastPacked) c.sendFrame(this.lastPacked);
  }

  removeClient(id: string): void {
    const e = this.clients.get(id);
    if (!e) return;
    this.clients.delete(id);
    for (const k of e.held) this.adapter.keyUp(k); // never leave keys stuck
    if (!this.clients.size) {
      this.adapter.releaseAll();
      for (const [id, t] of this.pendingPerms) { clearTimeout(t); this.adapter.answerPermission(id, false); }
      this.pendingPerms.clear();
      this.startIdle();
    }
  }

  handleClientEvent(clientId: string, ev: ClientEvent): void {
    const e = this.clients.get(clientId);
    if (!e || this.state !== 'running') return;
    switch (ev.t) {
      case 'key': {
        if (!Number.isInteger(ev.code) || ev.code < -1000 || ev.code > 0x10ffff) return;
        if (ev.s === 'D' || ev.s === 'R') {
          e.held.add(ev.code);
          this.adapter.keyDown(ev.code);
        } else if (ev.s === 'U') {
          e.held.delete(ev.code);
          this.adapter.keyUp(ev.code);
        }
        break;
      }
      case 'release-all':
        for (const k of e.held) this.adapter.keyUp(k);
        e.held.clear();
        break;
      case 'pointer': {
        const { width: w, height: h } = this.settings;
        if (ev.x < -w || ev.x > 2 * w || ev.y < -h || ev.y > 2 * h) return;
        this.adapter.pointerEvent(ev.id & 7, ev.s, Math.round(ev.x), Math.round(ev.y));
        break;
      }
      case 'cmd':
        this.adapter.invokeCommand(ev.id);
        break;
      case 'perm': {
        const t = this.pendingPerms.get(ev.id);
        if (!t) break; // unknown or already expired
        clearTimeout(t);
        this.pendingPerms.delete(ev.id);
        this.adapter.answerPermission(ev.id, !!ev.allow);
        break;
      }
      case 'audio':
        e.audio = !!ev.on;
        break;
      case 'ping':
        e.c.sendText(JSON.stringify({ t: 'pong', ts: ev.ts } satisfies ServerEvent));
        break;
    }
  }

  private idleTimer: NodeJS.Timeout | null = null;
  private startIdle(): void {
    this.clearIdle();
    this.idleTimer = setTimeout(() => void this.stop('no viewer connected'), this.cfg.sessionIdleMs);
    this.idleTimer.unref();
  }
  private clearIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  async stop(reason = 'requested'): Promise<ExitInfo> {
    this.clearIdle();
    if (this.state === 'starting' || this.state === 'running') {
      this.state = 'stopping';
      this.pushLog(`[session] stopping: ${reason}`);
      this.broadcastText({ t: 'state', state: 'stopping' });
    }
    return this.adapter.stop();
  }
}

export class SessionManager {
  private sessions = new Map<string, Session>();

  constructor(
    private cfg: Config,
    private lib: Library,
  ) {
    mkdirSync(cfg.runDir, { recursive: true, mode: 0o700 });
  }

  active(): Session[] {
    return [...this.sessions.values()].filter((s) => s.state === 'starting' || s.state === 'running' || s.state === 'stopping');
  }

  list(): Session[] {
    return [...this.sessions.values()];
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  async create(game: GameMeta, overrides: GameSettings, owner: string): Promise<Session> {
    if (this.active().length >= this.cfg.maxSessions) {
      throw new SessionError('session_limit', `Session limit reached (${this.cfg.maxSessions}). Stop the running session first.`, 429);
    }
    if (game.classVersion >= 49) {
      throw new SessionError('unsupported_jar', `This JAR contains Java ${game.classVersion - 44}+ class files; KEmulator only runs J2ME-era classes (version <= 48).`, 422);
    }
    const paths = this.lib.paths(game.id);
    let preset;
    if (overrides.device) {
      try {
        preset = findPreset(loadDevicePresets(this.cfg.kemDir).presets, overrides.device);
      } catch (e) {
        throw new SessionError('devices_unavailable', `Cannot read KEmulator device presets: ${(e as Error).message}`, 503);
      }
      if (!preset) throw new SessionError('unknown_device', `Unknown device preset "${overrides.device}"`, 400);
    }
    const sid = newId(12);
    const bridgeDir = path.join(this.cfg.runDir, sid);
    mkdirSync(bridgeDir, { recursive: true, mode: 0o700 });
    const userPath = this.lib.savesDir(owner, game.id);
    this.lib.pruneLogs();
    // Per-app emulator settings (device preset, key codes of the chosen layout) go to midlets.ini
    writeMidletsIni(userPath, { jarPath: paths.jar, width: overrides.width, height: overrides.height, keys: KEY_LAYOUTS[overrides.layout].keys, preset });
    const adapter = new KEmulatorAdapter({
      adapterBin: this.cfg.adapterBin,
      javaBin: this.cfg.javaBin,
      kemDir: this.cfg.kemDir,
      bridgeDir,
      jarPath: paths.jar,
      jadPath: paths.jad ?? undefined,
      userPath,
      width: overrides.width,
      height: overrides.height,
      heapMb: overrides.heapMb,
      midlet: overrides.midlet,
      frameEncoding: this.cfg.frameEncoding,
      cpuSeconds: this.cfg.cpuSeconds,
      display: this.cfg.display,
      jvmExtraArgs: this.cfg.jvmExtraArgs,
      launchWrapper: this.cfg.launchWrapper,
    });
    const session = new Session(sid, game, overrides, owner, adapter, bridgeDir, this.lib.sessionLogPath(sid), this.cfg, (s) => this.onEnded(s));
    this.sessions.set(session.id, session);
    this.lib.touchPlayed(game.id);
    try {
      await adapter.start();
      session.state = 'running';
      return session;
    } catch (e) {
      session.state = 'failed';
      const tail = session.logTail.slice(-8).join('\n');
      await adapter.stop().catch(() => undefined);
      throw new SessionError('start_failed', `${(e as Error).message}${tail ? `\n${tail}` : ''}`, 500);
    }
  }

  private onEnded(s: Session): void {
    // keep finished sessions queryable for a while, then forget them
    const t = setTimeout(() => this.sessions.delete(s.id), 10 * 60_000);
    t.unref();
  }

  async stop(id: string): Promise<boolean> {
    const s = this.sessions.get(id);
    if (!s) return false;
    await s.stop('requested');
    return true;
  }

  async stopAll(): Promise<void> {
    await Promise.all(this.active().map((s) => s.stop('server shutdown').catch(() => undefined)));
  }
}
