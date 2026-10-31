import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { isPhoneId, type GameSettings, type PublicSettings, type ScanReport } from '@j2me-web/protocol';
import type { Config } from './config.js';
import { UploadError } from './jar.js';
import type { Library } from './library.js';
import { resolveInsideRoots, walkLibrary, type WalkEntry, type WalkStats } from './libraryPath.js';
import { newId } from './library.js';

const MAX_REPORTED_ERRORS = 200;
const tick = () => new Promise<void>((r) => setImmediate(r));

/** The "default phone" of the settings, as the settings a freshly added game starts with. */
export function gameDefaults(p: PublicSettings['phone'], explicit: Partial<PublicSettings['phone']> = {}): Partial<GameSettings> {
  // the phone picture is only pinned to a new game when somebody chose a default phone: otherwise the player keeps using the browser's own choice
  return { width: p.width, height: p.height, layout: p.layout, heapMb: p.heapMb, ...(p.device ? { device: p.device } : {}), ...(isPhoneId(explicit.skinId) ? { skinId: explicit.skinId } : {}) };
}

export interface ScanHooks {
  settings(): PublicSettings;
  /** The phone values somebody actually chose (not the built-in defaults). */
  explicitPhone?(): Partial<PublicSettings['phone']>;
  onFinished?(report: ScanReport): void;
}

/**
 * Imports the JAR/JAD files below the configured library directory into the library.
 *
 *  - Read-only on the source: nothing is ever written, moved or deleted there.
 *  - Additive on the library: games, their settings, favourites and saves are never removed by a scan. A file
 *    that disappears only marks its source as missing; a changed file becomes a new version next to the old one.
 *  - "update" skips files whose size and mtime are unchanged (no re-read, no re-hash); "full" re-hashes everything.
 */
export class ScanManager {
  private report: ScanReport | null = null;
  private cancelled = false;
  private running: Promise<void> | null = null;

  constructor(private cfg: Config, private library: Library, private hooks: ScanHooks) {}

  isRunning(): boolean {
    return this.running !== null;
  }

  current(): ScanReport | null {
    return this.report ?? (this.library.lastScan() as ScanReport | null);
  }

  cancel(): boolean {
    if (!this.running) return false;
    this.cancelled = true;
    return true;
  }

  /** Starts a scan in the background; resolves the returned report object as it progresses. */
  start(mode: 'update' | 'full'): ScanReport {
    if (this.running) throw new UploadError('scan_running', 'A scan is already running', 409);
    const libPath = this.hooks.settings().libraryPath;
    if (!libPath) throw new UploadError('no_library', 'No library directory is configured (Settings > Library)', 400);
    const hit = resolveInsideRoots(this.cfg, libPath);
    if (!hit) throw new UploadError('library_unavailable', 'The library directory is missing, unreadable or outside the allowed locations', 400);
    const r: ScanReport = {
      id: newId(6), mode, state: 'running', root: hit.real, startedAt: new Date().toISOString(), finishedAt: null,
      filesSeen: 0, jars: 0, added: 0, updated: 0, unchanged: 0, duplicates: 0, newVersions: 0, missing: 0, skipped: 0,
      errors: [], duplicateGroups: [], versionGroups: [], current: null, error: null,
    };
    this.report = r;
    this.cancelled = false;
    this.running = this.run(r, hit.real).finally(() => {
      this.running = null;
    });
    return r;
  }

  /** Test helper and graceful shutdown: waits for the running scan. */
  async idle(): Promise<void> {
    await this.running;
  }

  private fail(r: ScanReport, path_: string, e: unknown): void {
    const code = e instanceof UploadError ? e.code : 'read_failed';
    const message = e instanceof UploadError ? e.message : 'The file could not be read';
    r.skipped++;
    if (r.errors.length < MAX_REPORTED_ERRORS) r.errors.push({ path: path_, code, message });
  }

  private async run(r: ScanReport, root: string): Promise<void> {
    try {
      const stats: WalkStats = { entries: 0, symlinksSkipped: 0, truncated: false, unreadableDirs: [] };
      const jars = new Map<string, WalkEntry>();
      const jads = new Map<string, WalkEntry>();
      for await (const e of walkLibrary(root, stats, () => this.cancelled)) {
        r.filesSeen++;
        if (e.kind === 'jar') jars.set(e.rel, e);
        else jads.set(e.rel.toLowerCase(), e);
        if (r.filesSeen % 500 === 0) await tick();
      }
      if (this.cancelled) return this.finish(r, 'cancelled');
      r.jars = jars.size;
      if (stats.truncated) r.error = `The library has more than the supported number of entries; only part of it was scanned.`;
      if (stats.unreadableDirs.length) r.errors.push({ path: stats.unreadableDirs[0]!, code: 'unreadable_dir', message: `${stats.unreadableDirs.length} directory(ies) could not be read and were skipped` });

      const settings = this.hooks.settings();
      const defaults = gameDefaults(settings.phone, this.hooks.explicitPhone?.());
      const seen = new Set<string>();
      const sorted = [...jars.values()].sort((a, b) => a.rel.localeCompare(b.rel));
      const dirCounts = new Map<string, { jars: number; jad: WalkEntry | null }>();
      for (const j of sorted) {
        const dir = path.dirname(j.rel);
        const c = dirCounts.get(dir) ?? { jars: 0, jad: null };
        c.jars++;
        dirCounts.set(dir, c);
      }
      for (const j of jads.values()) {
        const c = dirCounts.get(path.dirname(j.rel));
        if (c) c.jad = j;
      }

      for (const jar of sorted) {
        if (this.cancelled) return this.finish(r, 'cancelled');
        r.current = jar.rel;
        seen.add(jar.rel);
        const base = jar.rel.slice(0, -4).toLowerCase();
        // a JAD belongs to a JAR with the same name; a directory with exactly one JAR and one JAD pairs them whatever they are called
        let jad = jads.get(`${base}.jad`) ?? null;
        const dc = dirCounts.get(path.dirname(jar.rel));
        if (!jad && dc && dc.jars === 1 && dc.jad) jad = dc.jad;
        try {
          await this.importOne(r, jar, jad, defaults);
        } catch (e) {
          this.fail(r, jar.rel, e);
        }
        await tick();
      }
      r.current = null;
      if (this.cancelled) return this.finish(r, 'cancelled');

      // sources that were not seen: flag, never delete
      const known = this.library.allSources();
      if (seen.size === 0 && known.length > 0) {
        r.error = 'The library directory looks empty although it was scanned before: is the folder mounted? Nothing was marked as missing.';
      } else if (!stats.truncated) {
        for (const s of known) if (!seen.has(s.rel_path) && !s.missing) this.library.markMissing(s.rel_path);
      }
      r.missing = this.library.allSources().filter((s) => s.missing).length;
      this.collectGroups(r, seen);
      this.finish(r, 'done');
    } catch (e) {
      r.error = e instanceof Error ? e.message : String(e);
      this.finish(r, 'failed');
    }
  }

  private async importOne(r: ScanReport, jar: WalkEntry, jad: WalkEntry | null, defaults: Partial<GameSettings>): Promise<void> {
    const prev = this.library.getSource(jar.rel);
    if (r.mode === 'update' && prev && prev.size === jar.size && prev.mtime_ms === jar.mtimeMs && prev.jad_size === (jad?.size ?? 0) && prev.jad_mtime_ms === (jad?.mtimeMs ?? 0) && this.library.get(prev.game_id)) {
      this.library.touchSource(jar.rel);
      r.unchanged++;
      return;
    }
    if (jar.size > this.cfg.maxUploadBytes) throw new UploadError('too_large', `File is larger than the ${Math.round(this.cfg.maxUploadBytes / 1048576)} MB limit`);
    const bytes = await readFile(jar.abs);
    if (bytes.length !== jar.size) throw new UploadError('changed_while_reading', 'The file changed while it was being read');
    const sha = createHash('sha256').update(bytes).digest('hex');
    const jadBytes = jad && jad.size <= 256 * 1024 ? await readFile(jad.abs).catch(() => null) : null;
    const existing = this.library.findBySha(sha);
    let gameId: string;
    if (existing) {
      gameId = existing.id;
      if (prev && prev.sha256 === sha) r.unchanged++;
      else if (prev) r.updated++;
      else if (this.library.sourcesOf(existing.id).some((s) => !s.missing && s.rel_path !== jar.rel)) r.unchanged++; // counted as a duplicate when the groups are collected
      else r.unchanged++;
    } else {
      const { game } = this.library.add(bytes, jadBytes, this.cfg.libraryQuotaBytes, { origin: 'import', defaults });
      gameId = game.id;
      if (prev) r.updated++;
      else r.added++;
      if (this.library.gamesInGroup(game.groupKey).length > 1) r.newVersions++;
    }
    this.library.upsertSource({ rel_path: jar.rel, jad_rel_path: jad?.rel ?? null, game_id: gameId, size: jar.size, mtime_ms: jar.mtimeMs, jad_size: jad?.size ?? 0, jad_mtime_ms: jad?.mtimeMs ?? 0, sha256: sha });
  }

  /** Duplicate files (same SHA-256 at several paths) and games that exist in several versions (same vendor + name, different bytes). */
  private collectGroups(r: ScanReport, seen: Set<string>): void {
    const byGame = new Map<string, string[]>();
    for (const s of this.library.allSources()) {
      if (s.missing || !seen.has(s.rel_path)) continue;
      const l = byGame.get(s.game_id) ?? [];
      l.push(s.rel_path);
      byGame.set(s.game_id, l);
    }
    r.duplicates = 0;
    r.duplicateGroups = [];
    for (const [gameId, paths] of byGame) {
      if (paths.length < 2) continue;
      r.duplicates += paths.length - 1;
      r.duplicateGroups.push({ gameId, name: this.library.get(gameId)?.name ?? gameId, paths: paths.sort() });
    }
    r.duplicateGroups.sort((a, b) => a.name.localeCompare(b.name));
    r.duplicateGroups = r.duplicateGroups.slice(0, 300);

    const groups = new Map<string, { gameId: string; version: string; name: string; path: string }[]>();
    for (const g of this.library.list()) {
      const first = byGame.get(g.id)?.sort()[0];
      if (!first) continue;
      const l = groups.get(g.groupKey) ?? [];
      l.push({ gameId: g.id, version: g.version, name: g.name, path: first });
      groups.set(g.groupKey, l);
    }
    r.versionGroups = [];
    for (const [groupKey, versions] of groups) {
      // a group is only interesting when the library really holds several versions of it (also ones imported earlier)
      const all = this.library.gamesInGroup(groupKey);
      if (all.length < 2) continue;
      r.versionGroups.push({ groupKey, name: versions[0]!.name, versions: all.map((g) => ({ gameId: g.id, version: g.version, path: versions.find((v) => v.gameId === g.id)?.path ?? '' })) });
    }
    r.versionGroups.sort((a, b) => a.name.localeCompare(b.name));
    r.versionGroups = r.versionGroups.slice(0, 300);
  }

  private finish(r: ScanReport, state: 'done' | 'cancelled' | 'failed'): void {
    r.state = state;
    r.current = null;
    r.finishedAt = new Date().toISOString();
    try { this.library.assignGenresFromFolders(); } catch { /* genres are a convenience: a failure here must not fail the import */ }
    this.library.saveScan(r.id, r.startedAt, r.finishedAt, r);
    try { this.hooks.onFinished?.(r); } catch { /* a hook must not break the scan */ }
  }
}
