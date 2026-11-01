import { EventEmitter } from 'node:events';
import { createReadStream, statSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import type { Platform } from '@j2me-web/protocol';
import type { AdapterEvents, AdapterState, ExitInfo, FrameMsg } from '../kemulator/adapter.js';
import type { AdapterStatus, EmulatorAdapter } from '../emulator.js';
import { AgentClient, AgentError } from './agentClient.js';
import { ekaKeyName } from './keymap.js';
import { decodePng } from './png.js';
import { DeviceChoiceError, pickDevice } from './device.js';
import { classifyLog, FailureRecorder, hintsFor } from './failure.js';
import { EMULATED_DEVICES, type StartFailure, type StartFailureCause } from '@j2me-web/protocol';

export interface Eka2l1Options {
  agent: AgentClient;
  /** Stable per owner + game: where the game's C:/E: drives (its saves) live in the service. */
  saveKey: string;
  platform: Exclude<Platform, 'j2me'>;
  /** The stored game file (.sis / .sisx / .n-gage, or the .zip of an N-Gage 1.0 card). */
  /** Firmware code the game is bound to (`GameSettings.symbianDevice`); null = the platform default / the only device. */
  deviceCode?: string | null;
  packagePath: string;
  fileName: string;
  frameEncoding: 'raw' | 'deflate';
  /** Target pictures per second; the emulator draws at its own pace, duplicates are skipped. */
  fps?: number;
  launchTimeoutMs?: number;
  /** How long to wait for the first picture after the application started. */
  pictureTimeoutMs?: number;
  statusPollMs?: number;
}

const SYSTEM_STATES = new Set(['exited', 'crashed', 'closed', 'launch_failed']);

/** A start that stopped at a known step for a known reason. */
class StartError extends Error {
  constructor(message: string, readonly stage: StartFailure['stage'], readonly cause: StartFailureCause) { super(message); }
}

/**
 * Runs a game in EKA2L1 inside the optional jgo-symbian container. The emulator's own HTTP control API does the work
 * (install, launch, keys, touch, screenshots); sound is captured from the container's virtual sound card. Experimental: see docs/SYMBIAN.md
 * for what has and has not been checked against a real emulator.
 */
export class Eka2l1Adapter extends EventEmitter<AdapterEvents> implements EmulatorAdapter {
  readonly kind = 'eka2l1' as const;
  private _state: AdapterState = 'idle';
  private held = new Set<number>();
  private exitInfo: ExitInfo | null = null;
  private frames = 0;
  private firstFrameAt: number | null = null;
  private fpsWindow: number[] = [];
  private seq = 0;
  private abort = new AbortController();
  private lastFrameCount = -1;
  private pointerDown = new Set<number>();
  private queue: Promise<unknown> = Promise.resolve();
  private statusTimer: NodeJS.Timeout | null = null;
  private stopping: Promise<ExitInfo> | null = null;
  private warned = new Set<string>();
  private failure: StartFailure | null = null;
  private rec = new FailureRecorder();
  private deviceInfo: { code: string; manufacturer: string; model: string } | null = null;
  private stage: StartFailure['stage'] = 'device';

  constructor(private readonly o: Eka2l1Options) {
    super();
  }

  get state(): AdapterState { return this._state; }

  getStatus(): AdapterStatus {
    const now = Date.now();
    this.fpsWindow = this.fpsWindow.filter((t) => now - t <= 2000);
    return { state: this._state, frames: this.frames, fps: this.fpsWindow.length / 2, exit: this.exitInfo, pid: null, firstFrameAt: this.firstFrameAt, heldKeys: [...this.held] };
  }

  /** Set when start() failed: what EKA2L1 answered, and what JGO concludes from it. */
  getFailure(): StartFailure | null { return this.failure; }

  private log(line: string): void { this.emit('log', `[eka2l1] ${line}`); }
  private warnOnce(key: string, line: string): void { if (!this.warned.has(key)) { this.warned.add(key); this.log(line); } }

  async start(): Promise<void> {
    if (this._state !== 'idle') throw new Error('already started');
    this._state = 'starting';
    const { agent } = this.o;
    try {
      this.stage = 'device';
      const health = await agent.health();
      // decided BEFORE anything is started: a wrong choice must not cost a process
      let device;
      try {
        device = pickDevice({ requested: this.o.deviceCode, defaults: health.defaults ?? {}, platform: this.o.platform, devices: health.firmware.devices });
      } catch (e) {
        if (e instanceof DeviceChoiceError) throw new AgentError(e.message, e.code === 'device_required' ? 409 : 412, e.code);
        throw e;
      }
      this.deviceInfo = device;
      this.log(`device ${device.manufacturer} ${device.model} (${device.code})`);
      const inst = await agent.startInstance({ saveKey: this.o.saveKey });
      this.log(`instance ${inst.id} started`);
      await this.waitForEmulator();
      await this.ensureDevice(device.code);
      this.stage = 'install';
      const uid = await this.installAndFind(inst.app?.uid ?? null);
      this.rec.uid = uid;
      this.stage = 'launch';
      this.log(`launching ${uid}`);
      await this.launch(uid);
      void this.audioLoop();
      this.stage = 'first_frame';
      const first = await this.waitForPicture();
      this._state = 'running';
      this.emit('ready', first);
      void this.frameLoop();
      this.statusTimer = setInterval(() => void this.pollStatus(), this.o.statusPollMs ?? 2000);
      this.statusTimer.unref();
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      // facts first, while the instance is still alive; then the teardown
      await this.buildFailure(e);
      await this.teardown().catch(() => undefined);
      this._state = 'exited';
      this.exitInfo = { code: 1, reason: 1, detail: this.failure?.message ?? detail };
      throw e instanceof Error ? e : new Error(detail);
    }
  }

  /** Starts the application and keeps the exact answer: "launch_failed" and "running" are very different news. */
  private async launch(uid: string): Promise<void> {
    const timeout = this.o.launchTimeoutMs ?? 60_000;
    try {
      const body = await this.o.agent.control<{ state?: string; name?: string }>('POST', `/v1/apps/${uid}/launch`, { wait: true, timeoutMs: timeout }, timeout + 10_000);
      this.rec.launch = { httpStatus: 200, code: null, message: null, session: body };
      if (body.name) this.rec.appName = body.name;
      this.log(`launch answered: ${JSON.stringify(body)}`);
      if (body.state === 'launch_failed' || body.state === 'crashed' || body.state === 'exited') throw new StartError(`EKA2L1 reported the application as "${body.state}" right after the launch request`, 'launch', body.state === 'crashed' ? 'app_crashed' : body.state === 'exited' ? 'app_exited' : 'launch_rejected');
    } catch (e) {
      if (e instanceof StartError) throw e;
      if (e instanceof AgentError) {
        this.rec.launch = { httpStatus: e.status, code: e.code ?? null, message: e.message, session: null };
        this.log(`launch refused: HTTP ${e.status} ${e.code ?? ''} ${e.message}`);
        throw new StartError(e.status === 0 ? e.message : `EKA2L1 refused to start the application: ${e.message}${e.code ? ` (${e.code})` : ''}`, 'launch', e.status === 0 ? 'service' : 'launch_rejected');
      }
      throw e;
    }
  }

  /** The conclusion of a failed start, from what was actually seen. Never a made-up picture, never a guess presented as a fact. */
  private async buildFailure(e: unknown): Promise<void> {
    const { agent } = this.o;
    let cause: StartFailureCause, stage = this.stage, message = e instanceof Error ? e.message : String(e);
    if (e instanceof StartError) { cause = e.cause; stage = e.stage; }
    else if (e instanceof AgentError) {
      cause = e.code === 'no_firmware' ? 'no_firmware' : e.code === 'device_missing' || e.code === 'device_required' ? 'device' : e.status === 0 ? 'service' : stage === 'install' ? 'install_failed' : 'service';
    } else cause = stage === 'install' ? 'install_failed' : 'service';
    // a package that installed nothing is a game/firmware matter, not a service one
    if (stage === 'install' && /no application appeared|cannot tell which/.test(message)) cause = 'install_failed';
    let status: unknown = null;
    try { status = await agent.control('GET', '/v1/status'); } catch { /* the service may be gone */ }
    try {
      const sess = await agent.control<{ state?: string; screenVisible?: boolean; lastExit?: unknown }>('GET', '/v1/session');
      this.rec.session({ state: sess.state ?? 'unknown', screenVisible: sess.screenVisible ?? null, lastExit: sess.lastExit ?? null });
    } catch { /* idem */ }
    let lines: string[] = [];
    try { const l = await agent.logs(); lines = [...l.output, ...l.eka2l1Log]; } catch { /* idem */ }
    const { errors, fonts } = classifyLog(lines);
    const firmwareOs = this.deviceInfo ? EMULATED_DEVICES.find((d) => d.engine === 'eka2l1' && d.firmware.product.toLowerCase() === this.deviceInfo!.code.toLowerCase())?.os ?? null : null;
    const lastExit = [...this.rec.timeline].reverse().find((t) => t.lastExit)?.lastExit ?? null;
    const shotErrors = [...new Set(this.rec.screenshots.filter((x) => x.result === 'error').map((x) => `HTTP ${x.httpStatus ?? '?'} ${x.code ?? ''}`.trim()))];
    const { hints, likelyIncompatibleGame } = hintsFor({ cause, message, platform: this.o.platform, firmwareOs, launchCode: this.rec.launch?.code ?? null, lastExit, fonts, errors, screenshotErrors: shotErrors });
    this.failure = {
      stage, cause, message, likelyIncompatibleGame, uid: this.rec.uid, appName: this.rec.appName, platform: this.o.platform,
      firmware: this.deviceInfo ? { ...this.deviceInfo, os: firmwareOs } : null,
      launch: this.rec.launch, timeline: this.rec.timeline, screenshots: this.rec.screenshots, status, emulatorErrors: errors, fontNotes: fonts, hints, elapsedMs: this.rec.elapsed(),
    };
    this.log(`START FAILED at "${stage}": ${cause} - ${message}`);
    for (const h of hints) this.log(`hint: ${h}`);
  }

  private async waitForEmulator(): Promise<void> {
    const deadline = Date.now() + 60_000;
    for (;;) {
      try {
        const st = await this.o.agent.control<{ started?: boolean }>('GET', '/v1/status');
        if (st.started) return;
      } catch (e) {
        if (!(e instanceof AgentError) || (e.status !== 0 && e.status !== 502 && e.status !== 503)) throw e;
      }
      if (Date.now() > deadline) throw new Error('The emulator did not start within 60 s');
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  /** The chosen device has to be the booted one: `device: null` means nothing is booted yet, another code means another firmware. */
  private async ensureDevice(code: string): Promise<void> {
    const st = await this.o.agent.control<{ device?: { code?: string } | null }>('GET', '/v1/status');
    if (st.device?.code && st.device.code.toLowerCase() === code.toLowerCase()) return;
    this.log(`booting device ${code}`);
    await this.o.agent.control('POST', `/v1/devices/${encodeURIComponent(code)}/boot`, {}, 5 * 60_000);
  }

  /**
   * Gives the game to the emulator and finds out which application it is. Every game has its own C:/E: drives (they persist as its
   * saves), so after the installation the only application that is not a system one is the game; an install report that lists new
   * applications is preferred when there is one.
   */
  private async installAndFind(known: string | null): Promise<string> {
    const { agent } = this.o;
    if (known) {
      const apps = await agent.control<{ apps: { uid: string }[] }>('GET', '/v1/apps');
      if (apps.apps.some((a) => a.uid.toLowerCase() === known.toLowerCase())) { this.log('already installed'); return known; }
    }
    const size = statSync(this.o.packagePath).size;
    const kind = this.o.platform === 'ngage' ? 'card' : 'package';
    this.log(`uploading ${this.o.fileName} (${size} bytes)`);
    const up = await agent.upload(kind, this.o.fileName, createReadStream(this.o.packagePath), size);
    const type = this.o.platform === 'symbian' ? 'sis' : this.o.platform;
    const res = await agent.control<{ added?: { uid: string; name: string }[] }>('POST', '/v1/apps', { path: up.path, type }, 10 * 60_000);
    const addedApp = res.added?.find((a) => a.uid);
    let uid = addedApp?.uid ?? null;
    if (addedApp?.name) this.rec.appName = addedApp.name;
    if (!uid) {
      const apps = await agent.control<{ apps: { uid: string; name: string }[] }>('GET', '/v1/apps');
      if (apps.apps.length === 1) { uid = apps.apps[0]!.uid; this.rec.appName = apps.apps[0]!.name; }
      else if (apps.apps.length > 1) throw new Error(`The package installed, but the emulator lists ${apps.apps.length} applications and JGO cannot tell which one is the game`);
    }
    if (!uid) throw new Error('The package was installed but no application appeared (is it a game for this device?)');
    await agent.rememberApp(this.o.saveKey, uid).catch(() => undefined);
    return uid;
  }

  /** Waits for the first picture, but also watches the application: a crash or an exit ends the wait at once, with the reason. */
  private async waitForPicture(): Promise<{ width: number; height: number }> {
    const deadline = Date.now() + (this.o.pictureTimeoutMs ?? 60_000);
    let lastSessionAt = 0;
    let probes = 0, errorsOnly = true;
    while (Date.now() < deadline) {
      const probe = await this.o.agent.screenshotProbe(this.abort.signal);
      this.rec.screenshot(probe);
      probes++;
      if (probe.kind === 'ok') {
        const f = decodePng(probe.png);
        return { width: f.width, height: f.height };
      }
      if (probe.kind !== 'error') errorsOnly = false;
      if (Date.now() - lastSessionAt >= 500) {
        lastSessionAt = Date.now();
        try {
          const s = await this.o.agent.control<{ state?: string; screenVisible?: boolean; lastExit?: { fatal?: string | null } | null; name?: string }>('GET', '/v1/session');
          const state = s.state ?? 'unknown';
          if (s.name) this.rec.appName = s.name;
          this.rec.session({ state, screenVisible: s.screenVisible ?? null, lastExit: s.lastExit ?? null });
          if (SYSTEM_STATES.has(state)) {
            const fatal = s.lastExit?.fatal;
            if (state === 'crashed') throw new StartError(`The application crashed before it showed a picture${fatal ? ` (panic ${fatal})` : ''}`, 'first_frame', 'app_crashed');
            if (state === 'launch_failed') throw new StartError('EKA2L1 could not start the application (launch_failed)', 'first_frame', 'launch_rejected');
            throw new StartError(`The application ${state === 'closed' ? 'was closed' : 'exited'} before it showed a picture`, 'first_frame', 'app_exited');
          }
        } catch (e) {
          if (e instanceof StartError) throw e;
        }
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    if (probes > 0 && errorsOnly) throw new StartError('EKA2L1 kept answering the screenshot request with an error, so no picture could be read', 'first_frame', 'screenshot_error');
    throw new StartError(`The application is running but did not show a picture within ${Math.round((this.o.pictureTimeoutMs ?? 60_000) / 1000)} s`, 'first_frame', 'no_picture');
  }

  private async frameLoop(): Promise<void> {
    const interval = 1000 / (this.o.fps ?? 20);
    while (!this.abort.signal.aborted) {
      const t0 = Date.now();
      try {
        const shot = await this.o.agent.screenshot(this.abort.signal);
        if (shot && (shot.frame < 0 || shot.frame !== this.lastFrameCount)) {
          this.lastFrameCount = shot.frame;
          this.emitFrame(decodePng(shot.png));
        }
      } catch (e) {
        if (this.abort.signal.aborted) return;
        this.warnOnce('frame:' + (e as Error).message, `frame capture failed: ${(e as Error).message}`);
      }
      const wait = interval - (Date.now() - t0);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
  }

  private emitFrame(f: { width: number; height: number; data: Buffer }): void {
    this.frames++;
    this.fpsWindow.push(Date.now());
    if (this.firstFrameAt === null) this.firstFrameAt = Date.now();
    const enc = this.o.frameEncoding === 'deflate' ? 1 : 0;
    const msg: FrameMsg = { seq: ++this.seq, tsUs: Date.now() * 1000, enc, data: enc ? deflateRawSync(f.data) : f.data, width: f.width, height: f.height };
    this.emit('frame', msg);
  }

  private async audioLoop(): Promise<void> {
    try {
      for await (const chunk of this.o.agent.audio(this.abort.signal)) this.emit('audio', chunk);
    } catch (e) {
      if (!this.abort.signal.aborted) this.warnOnce('audio', `no sound: ${(e as Error).message}`);
    }
  }

  /** The emulator's own words end up in the session log: a start that fails on a real firmware has to be explainable from the UI. */
  private async collectLogs(): Promise<void> {
    try {
      const l = await this.o.agent.logs();
      for (const line of l.output.slice(-30)) this.log(`emulator: ${line}`);
      for (const line of l.eka2l1Log.slice(-60)) this.log(`EKA2L1.log: ${line}`);
    } catch { /* the service may be gone */ }
  }

  private async pollStatus(): Promise<void> {
    if (this._state !== 'running') return;
    try {
      const st = await this.o.agent.control<{ session?: { state?: string; lastExit?: { fatal?: string | null } } }>('GET', '/v1/status');
      const s = st.session?.state ?? 'none';
      if (SYSTEM_STATES.has(s)) {
        const fatal = st.session?.lastExit?.fatal;
        await this.finish({ code: s === 'exited' || s === 'closed' ? 0 : 1, reason: s === 'exited' || s === 'closed' ? 0 : 1, detail: fatal ? `panic ${fatal}` : s });
      }
    } catch (e) {
      if (e instanceof AgentError && e.status === 0) await this.finish({ code: 1, reason: 1, detail: 'the Symbian service stopped answering' });
    }
  }

  private async teardown(): Promise<void> {
    if (this.statusTimer) clearInterval(this.statusTimer);
    this.statusTimer = null;
    this.abort.abort();
    await this.o.agent.control('DELETE', '/v1/session').catch(() => undefined);
    await this.o.agent.stopInstance().catch(() => undefined);
  }

  private async finish(info: ExitInfo): Promise<void> {
    if (this._state === 'exited') return;
    await this.teardown();
    if (info.code !== 0) await this.collectLogs();
    this._state = 'exited';
    this.exitInfo = info;
    this.emit('exit', info);
  }

  stop(): Promise<ExitInfo> {
    if (this.stopping) return this.stopping;
    this.stopping = (async () => {
      if (this._state === 'exited') return this.exitInfo ?? { code: 0, reason: 0, detail: 'stopped' };
      this._state = 'stopping';
      await this.finish({ code: 0, reason: 0, detail: 'stopped' });
      return this.exitInfo!;
    })();
    return this.stopping;
  }

  /** Input goes one request at a time, in order: a key up must never overtake its key down. */
  private send(method: string, path: string, body: unknown): void {
    this.queue = this.queue.then(() => this.o.agent.control(method, path, body).catch((e) => this.warnOnce('input:' + path, `input failed (${path}): ${(e as Error).message}`)));
  }

  keyDown(code: number): void {
    const name = ekaKeyName(code);
    if (!name) { this.warnOnce('key:' + code, `key code ${code} has no Symbian key`); return; }
    this.held.add(code);
    this.send('POST', '/v1/input/key', { key: name, action: 'down' });
  }

  keyUp(code: number): void {
    const name = ekaKeyName(code);
    if (!name) return;
    this.held.delete(code);
    this.send('POST', '/v1/input/key', { key: name, action: 'up' });
  }

  releaseAll(): void {
    this.held.clear();
    this.pointerDown.clear();
    this.send('POST', '/v1/input/release', {});
  }

  pointerEvent(id: number, s: 'D' | 'M' | 'U', x: number, y: number): void {
    if (s === 'M' && !this.pointerDown.has(id)) return;
    if (s === 'D') this.pointerDown.add(id);
    if (s === 'U') this.pointerDown.delete(id);
    this.send('POST', '/v1/input/touch', { x, y, id, action: s === 'D' ? 'down' : s === 'U' ? 'up' : 'move' });
  }

  setPaused(on: boolean): void { this.send('POST', on ? '/v1/emulator/pause' : '/v1/emulator/resume', {}); }
  setSpeed(): void { this.warnOnce('speed', 'game speed is not supported for Symbian games'); }
  invokeCommand(): void { /* J2ME menus: nothing to invoke */ }
  setText(): void { this.warnOnce('text', 'text input is not supported for Symbian games yet'); }
  answerPermission(): void { /* the emulator service has no network and no prompts */ }
}
