import { isPhoneId } from '@j2me-web/protocol';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_SETTINGS, EMULATION_LIMITS, type EmulationTweaks, type GameInfoSummary, type GameMeta, type GameSettings, KEY_LAYOUTS, SCREEN_PRESETS, type LayoutId, type MetaStatus } from '@j2me-web/protocol';
import { parseJad, parseJar, sanitizeText, UploadError } from './jar.js';

interface Row {
  id: string;
  sha256: string;
  name: string;
  vendor: string;
  version: string;
  group_key: string;
  midlets_json: string;
  class_version: number;
  size_bytes: number;
  has_icon: number;
  has_jad: number;
  favorite: number;
  created_at: string;
  last_played_at: string | null;
  settings_json: string;
  warnings_json: string;
  origin?: string;
}

export interface SourceRow {
  rel_path: string;
  jad_rel_path: string | null;
  game_id: string;
  size: number;
  mtime_ms: number;
  jad_size: number;
  jad_mtime_ms: number;
  sha256: string;
  missing: number;
  last_seen_at: string;
}

export interface AddOptions {
  origin?: 'upload' | 'import';
  /** Settings a new game starts with (the "default phone"); explicit MIDlet choices still win. */
  defaults?: Partial<GameSettings>;
}

const LAYOUTS = Object.keys(KEY_LAYOUTS) as LayoutId[];

const LOCALE = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;

/** Every key is optional; an empty object means "all defaults". Anything unknown is refused instead of silently dropped. */
export function validateEmulation(input: unknown): EmulationTweaks {
  const bad = (m: string) => new UploadError('bad_settings', m);
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw bad('emulation must be an object');
  const o = input as Record<string, unknown>;
  const out: EmulationTweaks = {};
  for (const k of Object.keys(o)) if (!['frameRate', 'startAppOnResume', 'locale', 'pointerEvents', 'fontSizes'].includes(k)) throw bad(`unknown emulation option "${k}"`);
  const int = (v: unknown, lo: number, hi: number, name: string): number => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) throw bad(`${name} must be an integer in ${lo}..${hi}`);
    return v;
  };
  if (o.frameRate !== undefined) out.frameRate = int(o.frameRate, EMULATION_LIMITS.frameRate[0], EMULATION_LIMITS.frameRate[1], 'frameRate');
  if (o.startAppOnResume !== undefined) {
    if (typeof o.startAppOnResume !== 'boolean') throw bad('startAppOnResume must be true or false');
    out.startAppOnResume = o.startAppOnResume;
  }
  if (o.pointerEvents !== undefined) {
    if (typeof o.pointerEvents !== 'boolean') throw bad('pointerEvents must be true or false');
    out.pointerEvents = o.pointerEvents;
  }
  if (o.locale !== undefined) {
    if (typeof o.locale !== 'string' || !LOCALE.test(o.locale)) throw bad('locale must look like en-US or ru');
    out.locale = o.locale;
  }
  if (o.fontSizes !== undefined) {
    const f = o.fontSizes as Record<string, unknown> | null;
    if (typeof f !== 'object' || f === null) throw bad('fontSizes must be an object');
    const [lo, hi] = EMULATION_LIMITS.fontSize;
    out.fontSizes = { small: int(f.small, lo, hi, 'fontSizes.small'), medium: int(f.medium, lo, hi, 'fontSizes.medium'), large: int(f.large, lo, hi, 'fontSizes.large') };
  }
  return out;
}

export function validateSettings(input: unknown, base: GameSettings = DEFAULT_SETTINGS): GameSettings {
  const o = (input ?? {}) as Record<string, unknown>;
  const out: GameSettings = { ...base };
  const num = (v: unknown, lo: number, hi: number, name: string): number => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) throw new UploadError('bad_settings', `${name} must be an integer in ${lo}..${hi}`);
    return v;
  };
  if (o.width !== undefined) out.width = num(o.width, 64, 800, 'width');
  if (o.height !== undefined) out.height = num(o.height, 64, 800, 'height');
  if (o.heapMb !== undefined) out.heapMb = num(o.heapMb, 64, 1024, 'heapMb');
  if (o.layout !== undefined) {
    if (!LAYOUTS.includes(o.layout as LayoutId)) throw new UploadError('bad_settings', 'unknown key layout');
    out.layout = o.layout as LayoutId;
  }
  if (o.midlet !== undefined) {
    if (typeof o.midlet !== 'string' || !/^[A-Za-z0-9_.$/]{1,200}$/.test(o.midlet)) throw new UploadError('bad_settings', 'invalid midlet class name');
    out.midlet = o.midlet;
  }
  if (o.device !== undefined) {
    if (o.device === null || o.device === '') delete out.device;
    else if (typeof o.device !== 'string' || !/^[a-z0-9][a-z0-9-]{0,120}$/.test(o.device)) throw new UploadError('bad_settings', 'invalid device id');
    else out.device = o.device;
  }
  if (o.skinId !== undefined) {
    if (!isPhoneId(o.skinId)) throw new UploadError('bad_settings', 'unknown phone skin');
    out.skinId = o.skinId;
  }
  if (o.profileMode !== undefined) {
    if (o.profileMode !== 'auto' && o.profileMode !== 'advanced') throw new UploadError('bad_settings', 'invalid profile mode');
    out.profileMode = o.profileMode;
  }
  if (o.emulation !== undefined) {
    if (o.emulation === null) delete out.emulation;
    else out.emulation = validateEmulation(o.emulation);
  }
  void SCREEN_PRESETS;
  return out;
}

/** SQLite metadata + files on disk: <data>/games/<id>/{game.jar,game.jad,icon.png}. */
export class Library {
  readonly db: DatabaseSync;
  readonly gamesDir: string;

  constructor(readonly dataDir: string) {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.gamesDir = path.join(dataDir, 'games');
    mkdirSync(this.gamesDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, 'library.sqlite'));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS games (
        id TEXT PRIMARY KEY, sha256 TEXT NOT NULL UNIQUE, name TEXT NOT NULL, vendor TEXT NOT NULL,
        version TEXT NOT NULL, group_key TEXT NOT NULL, midlets_json TEXT NOT NULL, class_version INTEGER NOT NULL,
        size_bytes INTEGER NOT NULL, has_icon INTEGER NOT NULL, has_jad INTEGER NOT NULL, favorite INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, last_played_at TEXT, settings_json TEXT NOT NULL, warnings_json TEXT NOT NULL
      );
    `);
    this.migrate();
  }

  /**
   * Additive migrations only (new nullable/defaulted columns, new tables): a database written by this version
   * stays readable by the previous release, so `jgo rollback` keeps working.
   */
  private migrate(): void {
    const cols = (this.db.prepare('PRAGMA table_info(games)').all() as unknown as { name: string }[]).map((c) => c.name);
    if (!cols.includes('origin')) this.db.exec(`ALTER TABLE games ADD COLUMN origin TEXT NOT NULL DEFAULT 'upload'`);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sources (
        rel_path TEXT PRIMARY KEY, jad_rel_path TEXT, game_id TEXT NOT NULL, size INTEGER NOT NULL, mtime_ms INTEGER NOT NULL,
        jad_size INTEGER NOT NULL DEFAULT 0, jad_mtime_ms INTEGER NOT NULL DEFAULT 0, sha256 TEXT NOT NULL,
        missing INTEGER NOT NULL DEFAULT 0, last_seen_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sources_game ON sources(game_id);
      CREATE TABLE IF NOT EXISTS scans (
        id TEXT PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT, report_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS metadata (
        group_key TEXT PRIMARY KEY, status TEXT NOT NULL, moby_id INTEGER, data_json TEXT NOT NULL,
        candidates_json TEXT NOT NULL DEFAULT '[]', fetched_at TEXT, locked INTEGER NOT NULL DEFAULT 0, error TEXT
      );
    `);
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM games').get() as unknown as { n: number }).n;
  }

  // --- sources: where an imported game came from (relative to the library directory); never used to delete anything ---
  getSource(rel: string): SourceRow | undefined {
    return this.db.prepare('SELECT * FROM sources WHERE rel_path = ?').get(rel) as unknown as SourceRow | undefined;
  }

  sourcesOf(gameId: string): SourceRow[] {
    return this.db.prepare('SELECT * FROM sources WHERE game_id = ? ORDER BY rel_path').all(gameId) as unknown as SourceRow[];
  }

  allSources(): SourceRow[] {
    return this.db.prepare('SELECT * FROM sources').all() as unknown as SourceRow[];
  }

  upsertSource(r: Omit<SourceRow, 'missing' | 'last_seen_at'>): void {
    this.db
      .prepare(
        `INSERT INTO sources (rel_path, jad_rel_path, game_id, size, mtime_ms, jad_size, jad_mtime_ms, sha256, missing, last_seen_at)
         VALUES (?,?,?,?,?,?,?,?,0,?)
         ON CONFLICT(rel_path) DO UPDATE SET jad_rel_path=excluded.jad_rel_path, game_id=excluded.game_id, size=excluded.size, mtime_ms=excluded.mtime_ms,
           jad_size=excluded.jad_size, jad_mtime_ms=excluded.jad_mtime_ms, sha256=excluded.sha256, missing=0, last_seen_at=excluded.last_seen_at`,
      )
      .run(r.rel_path, r.jad_rel_path, r.game_id, r.size, r.mtime_ms, r.jad_size, r.jad_mtime_ms, r.sha256, new Date().toISOString());
  }

  touchSource(rel: string): void {
    this.db.prepare('UPDATE sources SET missing = 0, last_seen_at = ? WHERE rel_path = ?').run(new Date().toISOString(), rel);
  }

  markMissing(rel: string): void {
    this.db.prepare('UPDATE sources SET missing = 1 WHERE rel_path = ?').run(rel);
  }

  findBySha(sha: string): GameMeta | null {
    const r = this.db.prepare('SELECT * FROM games WHERE sha256 = ?').get(sha) as unknown as Row | undefined;
    return r ? this.toMeta(r) : null;
  }

  gamesInGroup(groupKey: string): GameMeta[] {
    return (this.db.prepare('SELECT * FROM games WHERE group_key = ? ORDER BY created_at').all(groupKey) as unknown as Row[]).map((r) => this.toMeta(r));
  }

  saveScan(id: string, startedAt: string, finishedAt: string | null, report: unknown): void {
    this.db
      .prepare('INSERT INTO scans (id, started_at, finished_at, report_json) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET finished_at=excluded.finished_at, report_json=excluded.report_json')
      .run(id, startedAt, finishedAt, JSON.stringify(report));
    this.db.prepare('DELETE FROM scans WHERE id NOT IN (SELECT id FROM scans ORDER BY started_at DESC LIMIT 10)').run();
  }

  lastScan(): unknown | null {
    const r = this.db.prepare('SELECT report_json FROM scans ORDER BY started_at DESC LIMIT 1').get() as unknown as { report_json: string } | undefined;
    return r ? JSON.parse(r.report_json) : null;
  }

  close(): void {
    this.db.close();
  }

  private toMeta(r: Row): GameMeta {
    return {
      id: r.id,
      sha256: r.sha256,
      name: r.name,
      vendor: r.vendor,
      version: r.version,
      midlets: JSON.parse(r.midlets_json),
      classVersion: r.class_version,
      sizeBytes: r.size_bytes,
      hasIcon: !!r.has_icon,
      hasJad: !!r.has_jad,
      favorite: !!r.favorite,
      createdAt: r.created_at,
      lastPlayedAt: r.last_played_at,
      groupKey: r.group_key,
      settings: JSON.parse(r.settings_json),
      warnings: JSON.parse(r.warnings_json),
      origin: r.origin === 'import' ? 'import' : 'upload',
    };
  }

  list(): GameMeta[] {
    const rows = this.db.prepare('SELECT * FROM games ORDER BY name COLLATE NOCASE, created_at').all() as unknown as Row[];
    const src = new Map<string, { n: number; active: number }>();
    for (const r of this.db.prepare('SELECT game_id, COUNT(*) AS n, SUM(CASE WHEN missing = 0 THEN 1 ELSE 0 END) AS active FROM sources GROUP BY game_id').all() as unknown as { game_id: string; n: number; active: number }[]) {
      src.set(r.game_id, { n: r.n, active: r.active });
    }
    const info = new Map<string, GameInfoSummary>();
    for (const m of this.db.prepare('SELECT group_key, status, data_json FROM metadata').all() as unknown as { group_key: string; status: string; data_json: string }[]) {
      const d = JSON.parse(m.data_json) as { title?: string; year?: number | null; genres?: string[]; hasCover?: boolean };
      info.set(m.group_key, { status: m.status as MetaStatus, ...(d.title ? { title: d.title } : {}), year: d.year ?? null, genres: d.genres ?? [], hasCover: !!d.hasCover });
    }
    return rows.map((r) => {
      const g = this.toMeta(r);
      const s = src.get(r.id);
      if (s && r.origin === 'import' && s.active === 0) g.sourceMissing = true;
      const i = info.get(r.group_key);
      if (i) g.info = i;
      return g;
    });
  }

  get(id: string): GameMeta | null {
    if (!/^[0-9a-f]{16}$/.test(id)) return null;
    const r = this.db.prepare('SELECT * FROM games WHERE id = ?').get(id) as unknown as Row | undefined;
    return r ? this.toMeta(r) : null;
  }

  totalBytes(): number {
    const r = this.db.prepare('SELECT COALESCE(SUM(size_bytes),0) AS n FROM games').get() as unknown as { n: number };
    return r.n;
  }

  paths(id: string): { dir: string; jar: string; jad: string | null; icon: string | null } {
    const dir = path.join(this.gamesDir, id);
    const jad = path.join(dir, 'game.jad');
    const icon = path.join(dir, 'icon.png');
    return { dir, jar: path.join(dir, 'game.jar'), jad: existsSync(jad) ? jad : null, icon: existsSync(icon) ? icon : null };
  }

  add(jar: Uint8Array, jadBytes: Uint8Array | null, quotaBytes: number, opts: AddOptions = {}): { game: GameMeta; duplicate: boolean } {
    const sha = createHash('sha256').update(jar).digest('hex');
    const dup = this.db.prepare('SELECT * FROM games WHERE sha256 = ?').get(sha) as unknown as Row | undefined;
    if (dup) return { game: this.toMeta(dup), duplicate: true };
    if (this.totalBytes() + jar.length > quotaBytes) throw new UploadError('quota_exceeded', 'Library quota exceeded; delete some games first', 507);

    const jad = jadBytes ? parseJad(jadBytes) : undefined;
    const info = parseJar(jar, jad);
    const id = sha.slice(0, 16);
    const name = sanitizeText(info.name) || 'Unnamed';
    const vendor = sanitizeText(info.vendor) || 'Unknown';
    const dir = path.join(this.gamesDir, id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'game.jar'), jar, { mode: 0o600 });
    if (jadBytes) writeFileSync(path.join(dir, 'game.jad'), jadBytes, { mode: 0o600 });
    if (info.icon) writeFileSync(path.join(dir, 'icon.png'), info.icon.bytes, { mode: 0o600 });

    const settings: GameSettings = { ...DEFAULT_SETTINGS, ...(opts.defaults ?? {}) };
    const firstMidlet = info.midlets[0];
    if (info.midlets.length > 1 && firstMidlet) settings.midlet = firstMidlet.className;
    const groupKey = createHash('sha1').update(`${vendor.toLowerCase()}\0${name.toLowerCase()}`).digest('hex').slice(0, 12);
    this.db
      .prepare(
        `INSERT INTO games (id, sha256, name, vendor, version, group_key, midlets_json, class_version, size_bytes, has_icon, has_jad,
          favorite, created_at, last_played_at, settings_json, warnings_json, origin) VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?,NULL,?,?,?)`,
      )
      .run(
        id, sha, name, vendor, sanitizeText(info.version, 40), groupKey,
        JSON.stringify(info.midlets.map((m) => ({ name: sanitizeText(m.name), className: m.className }))),
        info.classVersion, jar.length, info.icon ? 1 : 0, jadBytes ? 1 : 0,
        new Date().toISOString(), JSON.stringify(settings), JSON.stringify(info.warnings), opts.origin ?? 'upload',
      );
    return { game: this.get(id)!, duplicate: false };
  }

  update(id: string, patch: { favorite?: boolean; settings?: unknown }): GameMeta | null {
    const g = this.get(id);
    if (!g) return null;
    if (typeof patch.favorite === 'boolean') this.db.prepare('UPDATE games SET favorite = ? WHERE id = ?').run(patch.favorite ? 1 : 0, id);
    if (patch.settings !== undefined) {
      const s = validateSettings(patch.settings, g.settings);
      this.db.prepare('UPDATE games SET settings_json = ? WHERE id = ?').run(JSON.stringify(s), id);
    }
    return this.get(id);
  }

  touchPlayed(id: string): void {
    this.db.prepare('UPDATE games SET last_played_at = ? WHERE id = ?').run(new Date().toISOString(), id);
  }

  remove(id: string): boolean {
    if (!this.get(id)) return false;
    this.db.prepare('DELETE FROM games WHERE id = ?').run(id);
    rmSync(path.join(this.gamesDir, id), { recursive: true, force: true });
    return true;
  }

  /** Per-owner, per-game directory used as KEmulator's user path (RMS, settings). */
  savesDir(owner: string, gameId: string): string {
    const dir = path.join(this.dataDir, 'saves', owner, gameId);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    return dir;
  }

  removeSaves(owner: string, gameId: string): void {
    rmSync(path.join(this.dataDir, 'saves', owner, gameId), { recursive: true, force: true });
  }

  sessionLogPath(sessionId: string): string {
    const dir = path.join(this.dataDir, 'logs');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    return path.join(dir, `${sessionId}.log`);
  }

  /** Keeps the newest `keep` session logs. */
  pruneLogs(keep = 50): void {
    const dir = path.join(this.dataDir, 'logs');
    if (!existsSync(dir)) return;
    const files = readdirSync(dir).map((f) => ({ f, t: statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
    for (const x of files.slice(keep)) rmSync(path.join(dir, x.f), { force: true });
  }

  readIcon(id: string): Buffer | null {
    const p = this.paths(id).icon;
    return p ? readFileSync(p) : null;
  }
}

export function newId(bytes = 12): string {
  return randomBytes(bytes).toString('hex');
}
