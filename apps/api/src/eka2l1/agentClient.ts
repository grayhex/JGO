import type { Readable } from 'node:stream';
import type { FirmwareInstallRequest } from '@j2me-web/protocol';

/** Errors of the jgo-symbian service or of EKA2L1 behind it, with the HTTP status and EKA2L1's error code when it sent one. */
export class AgentError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

export interface AgentOptions {
  baseUrl: string;
  token: string | null;
  fetchImpl?: typeof fetch;
  /** Ordinary requests; long ones (uploads, firmware) pass their own. */
  timeoutMs?: number;
}

export interface AgentHealth {
  ok: boolean;
  /** EKA2L1 version / commit the image was built from. */
  emulator: string | null;
  firmware: { installed: boolean; devices: { code: string; manufacturer: string; model: string }[] };
  /** Per-platform default device (firmware code). */
  defaults?: Partial<Record<'symbian' | 'ngage' | 'ngage2', string>>;
  /** Free / total space of the service's data volume. */
  disk?: { free: number; total: number } | null;
  /** Files in the service's inbox folder. */
  inbox?: { name: string; size: number }[];
  instance: { running: boolean; saveKey: string | null; since: number | null };
  audio: boolean;
}

export interface AgentJob {
  id: string;
  kind: 'install_device' | 'delete_device';
  state: 'running' | 'succeeded' | 'failed';
  progress: number | null;
  error?: string | null;
}

/**
 * The jgo-symbian container offers its own small API under `/agent/` (instances, uploads, audio, saves) and passes an allow-list of
 * EKA2L1's `/v1` control API through `/v1/` (EKA2L1 itself only listens on 127.0.0.1 inside that container and has no authentication).
 * Every request carries the shared token.
 */
export class AgentClient {
  private readonly f: typeof fetch;
  private readonly timeout: number;
  constructor(private readonly o: AgentOptions) {
    this.f = o.fetchImpl ?? fetch;
    this.timeout = o.timeoutMs ?? 15_000;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { ...(this.o.token ? { authorization: `Bearer ${this.o.token}` } : {}), ...extra };
  }

  private async raw(method: string, path: string, init: { body?: BodyInit; headers?: Record<string, string>; timeoutMs?: number; signal?: AbortSignal; duplex?: boolean } = {}): Promise<Response> {
    const signals = [AbortSignal.timeout(init.timeoutMs ?? this.timeout)];
    if (init.signal) signals.push(init.signal);
    let res: Response;
    try {
      res = await this.f(this.o.baseUrl + path, {
        method,
        headers: this.headers(init.headers),
        ...(init.body !== undefined ? { body: init.body } : {}),
        signal: AbortSignal.any(signals),
        ...(init.duplex ? { duplex: 'half' } : {}),
      } as RequestInit);
    } catch (e) {
      throw new AgentError(`The Symbian service is not reachable: ${(e as Error).message}`, 0, 'unreachable');
    }
    return res;
  }

  private async fail(res: Response): Promise<never> {
    let message = `HTTP ${res.status}`, code: string | undefined;
    try {
      const j = (await res.json()) as { error?: { code?: string; message?: string } | string };
      if (typeof j.error === 'string') message = j.error;
      else if (j.error) { message = j.error.message ?? message; code = j.error.code; }
    } catch { /* not JSON */ }
    throw new AgentError(message, res.status, code);
  }

  async json<T>(method: string, path: string, body?: unknown, timeoutMs?: number): Promise<T> {
    const res = await this.raw(method, path, { ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : method === 'POST' || method === 'PUT' ? { body: '{}', headers: { 'content-type': 'application/json' } } : {}), ...(timeoutMs ? { timeoutMs } : {}) });
    if (!res.ok) await this.fail(res);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  health(): Promise<AgentHealth> {
    return this.json<AgentHealth>('GET', '/agent/health');
  }

  startInstance(body: { saveKey: string; maintenance?: boolean }): Promise<{ id: string; app: { uid: string } | null }> {
    return this.json('POST', '/agent/instance', body, 90_000);
  }

  stopInstance(): Promise<void> {
    return this.json('DELETE', '/agent/instance', undefined, 30_000);
  }

  rememberApp(saveKey: string, uid: string): Promise<void> {
    return this.json('PUT', `/agent/saves/${encodeURIComponent(saveKey)}/app`, { uid });
  }

  deleteSaves(saveKey: string): Promise<void> {
    return this.json('DELETE', `/agent/saves/${encodeURIComponent(saveKey)}`);
  }

  /** Streams a package into the running instance; returns the path EKA2L1 can read it from (a directory for a zipped game card). */
  async upload(kind: 'package' | 'card', name: string, body: Readable | Buffer, size: number, timeoutMs = 10 * 60_000): Promise<{ path: string }> {
    const res = await this.raw('PUT', `/agent/upload/${kind}?name=${encodeURIComponent(name)}`, {
      body: body as unknown as BodyInit,
      headers: { 'content-type': 'application/octet-stream', 'content-length': String(size) },
      timeoutMs,
      duplex: true,
    });
    if (!res.ok) await this.fail(res);
    return (await res.json()) as { path: string };
  }

  /** Streams one firmware file (no length known in advance: the service enforces its own limit while it writes). */
  async uploadFirmware(slot: 'rom' | 'rpkg' | 'archive' | 'vpl' | 'fpsx', name: string, body: Readable, signal?: AbortSignal, bundle?: string): Promise<{ file: string }> {
    const res = await this.raw('PUT', `/agent/firmware/${slot}?name=${encodeURIComponent(name)}${bundle ? `&bundle=${encodeURIComponent(bundle)}` : ''}`, {
      body: body as unknown as BodyInit,
      headers: { 'content-type': 'application/octet-stream' },
      timeoutMs: 60 * 60_000,
      duplex: true,
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) await this.fail(res);
    return (await res.json()) as { file: string };
  }

  installFirmware(files: FirmwareInstallRequest): Promise<AgentJob> {
    return this.json<AgentJob>('POST', '/agent/firmware/install', files);
  }
  discardFirmwareBundle(bundle: string): Promise<void> {
    return this.json('DELETE', `/agent/firmware/bundles/${bundle}`);
  }

  job(id: string): Promise<AgentJob> {
    return this.json<AgentJob>('GET', `/agent/jobs/${encodeURIComponent(id)}`);
  }

  /** What the service and the emulator said recently (live, or the last run when nothing is running). */
  logs(): Promise<{ live: boolean; agent: string[]; output: string[]; eka2l1Log: string[]; lastRun?: { savedAt: string; maintenance: boolean } | null }> {
    return this.json('GET', '/agent/log');
  }

  setDefault(platform: 'symbian' | 'ngage' | 'ngage2', code: string | null): Promise<{ defaults: Record<string, string> }> {
    return this.json('PUT', '/agent/defaults', { platform, code });
  }

  deleteDevice(code: string): Promise<AgentJob> {
    return this.json<AgentJob>('DELETE', `/agent/firmware/${encodeURIComponent(code)}`);
  }

  /** `/v1/...` of EKA2L1 through the allow-list. */
  control<T = Record<string, unknown>>(method: string, path: string, body?: unknown, timeoutMs?: number): Promise<T> {
    return this.json<T>(method, path, body, timeoutMs);
  }

  /** The guest screen as PNG. `null` when there is no picture yet (409 no_screen). */
  async screenshot(signal?: AbortSignal): Promise<{ png: Buffer; frame: number } | null> {
    const res = await this.raw('GET', '/v1/screenshot?region=guest', { ...(signal ? { signal } : {}), timeoutMs: 5000 });
    if (res.status === 409 || res.status === 503) { await res.arrayBuffer().catch(() => undefined); return null; }
    if (!res.ok) await this.fail(res);
    return { png: Buffer.from(await res.arrayBuffer()), frame: Number(res.headers.get('x-frame-count') ?? -1) };
  }

  /** Raw s16le / 44.1 kHz / stereo from the service's virtual sound card, until `signal` aborts. */
  async *audio(signal: AbortSignal): AsyncGenerator<Buffer> {
    const res = await this.raw('GET', '/agent/audio', { signal, timeoutMs: 24 * 3600_000 });
    if (!res.ok || !res.body) { await res.body?.cancel().catch(() => undefined); throw new AgentError('no audio from the Symbian service', res.status, 'no_audio'); }
    const reader = res.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        if (value) yield Buffer.from(value);
      }
    } finally {
      reader.cancel().catch(() => undefined);
    }
  }
}

export function agentFromConfig(cfg: { symbianAgentUrl: string | null; symbianAgentToken: string | null }): AgentClient | null {
  return cfg.symbianAgentUrl ? new AgentClient({ baseUrl: cfg.symbianAgentUrl, token: cfg.symbianAgentToken }) : null;
}
