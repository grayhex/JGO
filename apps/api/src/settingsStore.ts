import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isPhoneId, KEY_LAYOUTS, PHONE_PROFILES, type LayoutId, type PublicSettings, type SetupStatus } from '@j2me-web/protocol';
import type { Config } from './config.js';
import { UploadError } from './jar.js';

/** Phone skins shipped with the web UI (apps/web/public/phones); the list lives in the protocol package, a test keeps it in sync with the directory. */
export const SKIN_IDS = Object.keys(PHONE_PROFILES);

const SCHEMA_VERSION = 1;
const LAYOUTS = Object.keys(KEY_LAYOUTS) as LayoutId[];

interface SettingsFile {
  version: number;
  setup: { status: SetupStatus; completedAt: string | null; legacy: boolean };
  settings: Partial<PublicSettings>;
}

interface SecretsFile {
  version: number;
  mobygames?: { apiKey: string };
}

export function envServerDefaults(cfg: Config): PublicSettings['server'] {
  return {
    maxSessions: cfg.maxSessions,
    sessionMaxMinutes: Math.round(cfg.sessionMaxMs / 60_000),
    sessionIdleMinutes: Math.round(cfg.sessionIdleMs / 60_000),
    libraryQuotaMb: Math.round(cfg.libraryQuotaBytes / (1024 * 1024)),
    frameEncoding: cfg.frameEncoding,
  };
}

export function defaultSettings(server: PublicSettings['server']): PublicSettings {
  return {
    libraryPath: null,
    autoScan: false,
    autoMetadata: true,
    phone: { skinId: 'nokia-n95', view: 'full', device: null, layout: 'nokia', width: 240, height: 320, heapMb: 256 },
    audio: { enabled: true, volume: 80 },
    controls: { keypad: 'auto', haptics: true, gamepad: true },
    server: { ...server },
  };
}

function bad(msg: string): never {
  throw new UploadError('bad_settings', msg);
}

function obj(v: unknown, name: string): Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) bad(`${name} must be an object`);
  return v as Record<string, unknown>;
}

function int(v: unknown, lo: number, hi: number, name: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) bad(`${name} must be an integer in ${lo}..${hi}`);
  return v;
}

function bool(v: unknown, name: string): boolean {
  if (typeof v !== 'boolean') bad(`${name} must be true or false`);
  return v;
}

function noExtra(o: Record<string, unknown>, allowed: string[], name: string): void {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) bad(`unknown setting ${name}.${k}`);
}

/**
 * Validates a partial settings object and returns a full, merged one. Unknown keys are rejected, so a typo
 * is an error instead of a silently ignored value. `libraryPath` is only checked for its shape here: the
 * route decides whether the directory is inside an allowed root (it needs the roots and the filesystem).
 */
export function mergeSettings(base: PublicSettings, patch: unknown): PublicSettings {
  const p = obj(patch, 'settings');
  noExtra(p, ['libraryPath', 'autoScan', 'autoMetadata', 'phone', 'audio', 'controls', 'server'], 'settings');
  const out: PublicSettings = JSON.parse(JSON.stringify(base));
  if ('libraryPath' in p) {
    const v = p.libraryPath;
    if (v === null || v === '') out.libraryPath = null;
    else if (typeof v !== 'string' || v.length > 1024 || v.includes('\0') || !path.isAbsolute(v)) bad('libraryPath must be an absolute path or null');
    else out.libraryPath = path.normalize(v).replace(/\/+$/, '') || '/';
  }
  if ('autoScan' in p) out.autoScan = bool(p.autoScan, 'autoScan');
  if ('autoMetadata' in p) out.autoMetadata = bool(p.autoMetadata, 'autoMetadata');
  if ('phone' in p) {
    const o = obj(p.phone, 'phone');
    noExtra(o, ['skinId', 'view', 'device', 'layout', 'width', 'height', 'heapMb'], 'phone');
    if ('skinId' in o) {
      if (!isPhoneId(o.skinId)) bad(`phone.skinId must be one of ${SKIN_IDS.join(', ')}`);
      out.phone.skinId = o.skinId;
    }
    if ('view' in o) {
      if (o.view !== 'full' && o.view !== 'screen') bad('phone.view must be "full" or "screen"');
      out.phone.view = o.view;
    }
    if ('device' in o) {
      if (o.device === null || o.device === '') out.phone.device = null;
      else if (typeof o.device !== 'string' || !/^[a-z0-9][a-z0-9-]{0,120}$/.test(o.device)) bad('phone.device is not a valid device id');
      else out.phone.device = o.device;
    }
    if ('layout' in o) {
      if (!LAYOUTS.includes(o.layout as LayoutId)) bad('phone.layout is not a known key layout');
      out.phone.layout = o.layout as LayoutId;
    }
    if ('width' in o) out.phone.width = int(o.width, 64, 800, 'phone.width');
    if ('height' in o) out.phone.height = int(o.height, 64, 800, 'phone.height');
    if ('heapMb' in o) out.phone.heapMb = int(o.heapMb, 64, 1024, 'phone.heapMb');
  }
  if ('audio' in p) {
    const o = obj(p.audio, 'audio');
    noExtra(o, ['enabled', 'volume'], 'audio');
    if ('enabled' in o) out.audio.enabled = bool(o.enabled, 'audio.enabled');
    if ('volume' in o) out.audio.volume = int(o.volume, 0, 100, 'audio.volume');
  }
  if ('controls' in p) {
    const o = obj(p.controls, 'controls');
    noExtra(o, ['keypad', 'haptics', 'gamepad'], 'controls');
    if ('keypad' in o) {
      if (o.keypad !== 'auto' && o.keypad !== 'always' && o.keypad !== 'never') bad('controls.keypad must be auto, always or never');
      out.controls.keypad = o.keypad;
    }
    if ('haptics' in o) out.controls.haptics = bool(o.haptics, 'controls.haptics');
    if ('gamepad' in o) out.controls.gamepad = bool(o.gamepad, 'controls.gamepad');
  }
  if ('server' in p) {
    const o = obj(p.server, 'server');
    noExtra(o, ['maxSessions', 'sessionMaxMinutes', 'sessionIdleMinutes', 'libraryQuotaMb', 'frameEncoding'], 'server');
    if ('maxSessions' in o) out.server.maxSessions = int(o.maxSessions, 1, 8, 'server.maxSessions');
    if ('sessionMaxMinutes' in o) out.server.sessionMaxMinutes = int(o.sessionMaxMinutes, 1, 1440, 'server.sessionMaxMinutes');
    if ('sessionIdleMinutes' in o) out.server.sessionIdleMinutes = int(o.sessionIdleMinutes, 1, 240, 'server.sessionIdleMinutes');
    if ('libraryQuotaMb' in o) out.server.libraryQuotaMb = int(o.libraryQuotaMb, 64, 4 * 1024 * 1024, 'server.libraryQuotaMb');
    if ('frameEncoding' in o) {
      if (o.frameEncoding !== 'raw' && o.frameEncoding !== 'deflate') bad('server.frameEncoding must be raw or deflate');
      out.server.frameEncoding = o.frameEncoding;
    }
  }
  return out;
}

/** MobyGames keys look like `moby_...`; accept any token-ish string, nothing that could break a query string or a header. */
export function validateApiKey(v: unknown): string {
  if (typeof v !== 'string') bad('the API key must be a string');
  const k = v.trim();
  if (!/^[A-Za-z0-9_.-]{8,200}$/.test(k)) bad('the API key must be 8-200 characters: letters, digits, "_", "-" or "."');
  return k;
}

function writeJsonAtomic(file: string, data: unknown): void {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  renameSync(tmp, file);
  try { chmodSync(file, 0o600); } catch { /* best effort */ }
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

/**
 * Server-side settings. `settings.json` holds everything the web UI may show; `secrets.json` (mode 0600) holds
 * the MobyGames key and never leaves the server: every API response only says whether a key is configured.
 * Both live in the data directory, so they survive updates, backups and restores together with the library.
 * Values missing from the file fall back to the defaults, so a file written by an older version keeps working.
 */
export class SettingsStore {
  readonly file: string;
  readonly secretsFile: string;
  readonly envDefaults: PublicSettings['server'];
  private data: SettingsFile;
  private secrets: SecretsFile;
  private envKey: string | null;

  constructor(readonly dataDir: string, private cfg: Config, env: NodeJS.ProcessEnv = process.env) {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.file = path.join(dataDir, 'settings.json');
    this.secretsFile = path.join(dataDir, 'secrets.json');
    this.envDefaults = envServerDefaults(cfg);
    const existing = existsSync(this.file) ? readJson<SettingsFile>(this.file) : null;
    this.data = {
      version: SCHEMA_VERSION,
      setup: { status: 'pending', completedAt: null, legacy: false, ...(existing?.setup ?? {}) },
      settings: existing?.settings ?? {},
    };
    this.secrets = readJson<SecretsFile>(this.secretsFile) ?? { version: SCHEMA_VERSION };
    this.envKey = env.MOBYGAMES_API_KEY?.trim() || null;
    this.fresh = existing === null;
    this.applyToConfig();
  }

  /** True when no settings file existed before this process started. */
  readonly fresh: boolean;

  /**
   * Installations that predate the setup wizard already have a library: they are not nagged with a wizard,
   * and nothing about how they behave changes until somebody edits a setting.
   */
  markLegacyIfPopulated(gameCount: number): void {
    if (this.fresh && gameCount > 0 && this.data.setup.status === 'pending') {
      this.data.setup = { status: 'completed', completedAt: new Date().toISOString(), legacy: true };
      this.save();
    }
  }

  get(): PublicSettings {
    const d = defaultSettings(this.envDefaults);
    const s = this.data.settings;
    // a stored section may predate a newer field: fill the gaps from the defaults
    return {
      libraryPath: typeof s.libraryPath === 'string' ? s.libraryPath : d.libraryPath,
      autoScan: s.autoScan ?? d.autoScan,
      autoMetadata: s.autoMetadata ?? d.autoMetadata,
      phone: { ...d.phone, ...(s.phone ?? {}) },
      audio: { ...d.audio, ...(s.audio ?? {}) },
      controls: { ...d.controls, ...(s.controls ?? {}) },
      server: { ...d.server, ...(s.server ?? {}) },
    };
  }

  update(patch: unknown): PublicSettings {
    const next = mergeSettings(this.get(), patch);
    // only values that differ from the environment defaults are pinned: editing /etc/jgo/jgo.env keeps working for the rest
    const overrides: Partial<PublicSettings['server']> = {};
    for (const k of Object.keys(next.server) as (keyof PublicSettings['server'])[]) {
      if (next.server[k] !== this.envDefaults[k]) (overrides as Record<string, unknown>)[k] = next.server[k];
    }
    // keep what was saved sparse: only values somebody set are stored, the rest keep following the defaults
    const stored: Record<string, unknown> = { ...this.data.settings, server: overrides };
    const p = patch as Record<string, unknown>;
    for (const k of ['libraryPath', 'autoScan', 'autoMetadata'] as const) if (k in p) stored[k] = next[k];
    for (const sec of ['phone', 'audio', 'controls'] as const) {
      if (!(sec in p)) continue;
      const cur = (stored[sec] ?? {}) as Record<string, unknown>;
      for (const key of Object.keys(p[sec] as object)) cur[key] = (next[sec] as Record<string, unknown>)[key];
      stored[sec] = cur;
    }
    this.data.settings = stored as Partial<PublicSettings>;
    this.save();
    this.applyToConfig();
    return next;
  }

  /** The phone values that were saved explicitly (settings.json), as opposed to the built-in defaults. */
  explicitPhone(): Partial<PublicSettings['phone']> {
    return { ...(this.data.settings.phone ?? {}) };
  }

  setup(): SettingsFile['setup'] {
    return { ...this.data.setup };
  }

  setSetup(status: SetupStatus): void {
    this.data.setup = { status, completedAt: status === 'pending' ? null : new Date().toISOString(), legacy: false };
    this.save();
  }

  mobygamesKey(): string | null {
    return this.secrets.mobygames?.apiKey ?? this.envKey;
  }

  mobygamesInfo(): { configured: boolean; hint: string | null; source: 'stored' | 'environment' | null } {
    const stored = this.secrets.mobygames?.apiKey;
    const key = stored ?? this.envKey;
    if (!key) return { configured: false, hint: null, source: null };
    return { configured: true, hint: `…${key.slice(-4)}`, source: stored ? 'stored' : 'environment' };
  }

  setMobygamesKey(key: string | null): void {
    if (key === null) delete this.secrets.mobygames;
    else this.secrets.mobygames = { apiKey: validateApiKey(key) };
    this.secrets.version = SCHEMA_VERSION;
    writeJsonAtomic(this.secretsFile, this.secrets);
  }

  /** Runtime values the sessions read on every use; limits that need a restart (host, port, token) are not here. */
  applyToConfig(): void {
    const s = this.get().server;
    this.cfg.maxSessions = s.maxSessions;
    this.cfg.sessionMaxMs = s.sessionMaxMinutes * 60_000;
    this.cfg.sessionIdleMs = s.sessionIdleMinutes * 60_000;
    this.cfg.libraryQuotaBytes = s.libraryQuotaMb * 1024 * 1024;
    this.cfg.frameEncoding = s.frameEncoding;
  }

  private save(): void {
    writeJsonAtomic(this.file, this.data);
  }
}
