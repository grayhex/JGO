import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_SETTINGS, type GameMeta, type GameSettings, SCREEN_PRESETS, type LayoutId } from '@j2me-web/protocol';
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
}

const LAYOUTS: LayoutId[] = ['nokia', 'sonyericsson', 'siemens', 'motorola'];

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
  void SCREEN_PRESETS;
  return out;
}

/** SQLite metadata + files on disk: <data>/games/<id>/{game.jar,game.jad,icon.png}. */
export class Library {
  private db: DatabaseSync;
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
    };
  }

  list(): GameMeta[] {
    return (this.db.prepare('SELECT * FROM games ORDER BY name COLLATE NOCASE, created_at').all() as unknown as Row[]).map((r) => this.toMeta(r));
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

  add(jar: Uint8Array, jadBytes: Uint8Array | null, quotaBytes: number): { game: GameMeta; duplicate: boolean } {
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

    const settings: GameSettings = { ...DEFAULT_SETTINGS };
    const firstMidlet = info.midlets[0];
    if (info.midlets.length > 1 && firstMidlet) settings.midlet = firstMidlet.className;
    const groupKey = createHash('sha1').update(`${vendor.toLowerCase()}\0${name.toLowerCase()}`).digest('hex').slice(0, 12);
    this.db
      .prepare(
        `INSERT INTO games (id, sha256, name, vendor, version, group_key, midlets_json, class_version, size_bytes, has_icon, has_jad,
          favorite, created_at, last_played_at, settings_json, warnings_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?,NULL,?,?)`,
      )
      .run(
        id, sha, name, vendor, sanitizeText(info.version, 40), groupKey,
        JSON.stringify(info.midlets.map((m) => ({ name: sanitizeText(m.name), className: m.className }))),
        info.classVersion, jar.length, info.icon ? 1 : 0, jadBytes ? 1 : 0,
        new Date().toISOString(), JSON.stringify(settings), JSON.stringify(info.warnings),
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
