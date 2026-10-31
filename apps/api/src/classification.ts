import type { DatabaseSync } from 'node:sqlite';
import {
  GENRES,
  isGenre,
  type CatalogEntryState,
  type CatalogFile,
  type CatalogReport,
  type ClassificationConfidence,
  type ClassificationSource,
  type Genre,
  type GameClassification,
  type GenreSummary,
} from '@j2me-web/protocol';
import { sanitizeText, UploadError } from './jar.js';

export const CATALOG_MAX_BYTES = 2 * 1024 * 1024;
export const CATALOG_MAX_ENTRIES = 20000;
const MAX_TAGS = 12;
const MAX_TAG_LEN = 32;
const REPORT_ITEMS_PER_KIND = 25;

/** A stronger source is never replaced by a weaker one; a locked row is never replaced by anything but the user. */
const RANK: Record<ClassificationSource, number> = { manual: 4, mobygames: 3, curator: 2, heuristic: 1 };
const CONFIDENCE: Record<ClassificationSource, ClassificationConfidence> = { manual: 'manual', mobygames: 'verified', curator: 'curated', heuristic: 'heuristic' };

interface Row {
  group_key: string;
  canonical_title: string | null;
  primary_genre: string;
  genres_json: string;
  tags_json: string;
  source: string;
  confidence: string;
  locked: number;
  updated_at: string;
}

export interface ClassInput {
  primaryGenre: Genre;
  genres?: Genre[];
  tags?: string[];
  canonicalTitle?: string | null;
}

const bad = (m: string, status = 400) => new UploadError('bad_catalog', m, status);

/** Tags are free text from outside: control characters out, trimmed, short, no duplicates. */
export function cleanTags(v: unknown): string[] {
  if (!Array.isArray(v)) throw bad('tags must be a list of strings');
  const out: string[] = [];
  for (const t of v) {
    if (typeof t !== 'string') throw bad('tags must be a list of strings');
    const c = sanitizeText(t, MAX_TAG_LEN);
    if (c && !out.some((x) => x.toLowerCase() === c.toLowerCase())) out.push(c);
  }
  if (out.length > MAX_TAGS) throw bad(`at most ${MAX_TAGS} tags`);
  return out;
}

/** MobyGames names its genres its own way; this maps the ones that have a place in the library's list. */
export function mapMobyGenres(names: string[]): Genre[] {
  const out: Genre[] = [];
  const add = (g: Genre) => { if (!out.includes(g)) out.push(g); };
  for (const raw of names) {
    const n = raw.toLowerCase();
    if (/racing|driving/.test(n)) add('Racing');
    else if (/role-playing|\brpg\b/.test(n)) add('RPG');
    else if (/puzzle/.test(n)) add('Puzzle');
    else if (/sport/.test(n)) add('Sports');
    else if (/strategy|tactic/.test(n)) add('Strategy');
    else if (/simulation/.test(n)) add('Simulation');
    else if (/platform/.test(n)) add('Platformer');
    else if (/fighting|beat/.test(n)) add('Fighting');
    else if (/arcade/.test(n)) add('Arcade');
    else if (/adventure/.test(n)) add('Adventure');
    else if (/action|shooter/.test(n)) add('Action');
    else if (/board|card|casino|party|trivia|quiz/.test(n)) add('Casual');
  }
  return out;
}

export class Classifications {
  constructor(private readonly db: DatabaseSync) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS game_classifications (
        group_key TEXT PRIMARY KEY,
        canonical_title TEXT,
        primary_genre TEXT NOT NULL DEFAULT 'Other',
        genres_json TEXT NOT NULL DEFAULT '[]',
        tags_json TEXT NOT NULL DEFAULT '[]',
        source TEXT NOT NULL DEFAULT 'manual',
        confidence TEXT NOT NULL DEFAULT 'unclassified',
        locked INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ix_game_classifications_genre ON game_classifications(primary_genre);
    `);
  }

  private toClass(r: Row): GameClassification {
    const source = (r.source in RANK ? r.source : 'manual') as ClassificationSource;
    const genre = isGenre(r.primary_genre) ? r.primary_genre : 'Other';
    const parse = <T>(s: string, fallback: T): T => { try { return JSON.parse(s) as T; } catch { return fallback; } };
    return {
      primaryGenre: genre,
      genres: parse<string[]>(r.genres_json, []).filter(isGenre),
      tags: parse<string[]>(r.tags_json, []).filter((t) => typeof t === 'string'),
      canonicalTitle: r.canonical_title,
      source,
      confidence: (r.confidence as ClassificationConfidence) || CONFIDENCE[source],
      locked: !!r.locked,
      unconfirmed: !r.locked && (genre === 'Other' || source === 'heuristic'),
    };
  }

  get(groupKey: string): GameClassification | null {
    const r = this.db.prepare('SELECT * FROM game_classifications WHERE group_key = ?').get(groupKey) as unknown as Row | undefined;
    return r ? this.toClass(r) : null;
  }

  all(): Map<string, GameClassification> {
    const m = new Map<string, GameClassification>();
    for (const r of this.db.prepare('SELECT * FROM game_classifications').all() as unknown as Row[]) m.set(r.group_key, this.toClass(r));
    return m;
  }

  /** Why a write from `source` would be refused for this group, or null when it may go ahead. */
  refusal(groupKey: string, source: ClassificationSource): 'locked' | 'protected' | null {
    const cur = this.get(groupKey);
    if (!cur) return null;
    if (cur.locked) return 'locked';
    return RANK[cur.source] > RANK[source] ? 'protected' : null;
  }

  private write(groupKey: string, i: ClassInput, source: ClassificationSource, locked: boolean): void {
    const genres = [...new Set([i.primaryGenre, ...(i.genres ?? [])])];
    this.db
      .prepare(
        `INSERT INTO game_classifications (group_key, canonical_title, primary_genre, genres_json, tags_json, source, confidence, locked, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)
         ON CONFLICT(group_key) DO UPDATE SET canonical_title=excluded.canonical_title, primary_genre=excluded.primary_genre, genres_json=excluded.genres_json,
           tags_json=excluded.tags_json, source=excluded.source, confidence=excluded.confidence, locked=excluded.locked, updated_at=excluded.updated_at`,
      )
      .run(groupKey, i.canonicalTitle ?? null, i.primaryGenre, JSON.stringify(genres), JSON.stringify(i.tags ?? []), source, CONFIDENCE[source], locked ? 1 : 0, new Date().toISOString());
  }

  /** The user's choice: always wins, and from then on nothing else may change it. Omitted fields keep their current value. */
  setManual(groupKey: string, patch: { primaryGenre?: Genre; genres?: Genre[]; tags?: string[]; canonicalTitle?: string | null }): GameClassification {
    const cur = this.get(groupKey);
    const primary = patch.primaryGenre ?? cur?.primaryGenre ?? 'Other';
    this.write(
      groupKey,
      {
        primaryGenre: primary,
        genres: patch.genres ?? (patch.primaryGenre ? [] : cur?.genres ?? []),
        tags: patch.tags ?? cur?.tags ?? [],
        canonicalTitle: patch.canonicalTitle !== undefined ? patch.canonicalTitle : cur?.canonicalTitle ?? null,
      },
      'manual',
      true,
    );
    return this.get(groupKey)!;
  }

  /** Gives the choice back to automatic sources (the row stays, so tags and the title are kept). */
  unlock(groupKey: string): GameClassification | null {
    this.db.prepare(`UPDATE game_classifications SET locked = 0, source = CASE WHEN source = 'manual' THEN 'heuristic' ELSE source END, confidence = CASE WHEN source = 'manual' THEN 'heuristic' ELSE confidence END, updated_at = ? WHERE group_key = ?`).run(new Date().toISOString(), groupKey);
    return this.get(groupKey);
  }

  clear(groupKey: string): void {
    this.db.prepare('DELETE FROM game_classifications WHERE group_key = ?').run(groupKey);
  }

  /** A MobyGames match the user confirmed or that was decisive: its genres, unless a stronger source holds the group. */
  applyMoby(groupKey: string, mobyGenres: string[]): boolean {
    const mapped = mapMobyGenres(mobyGenres);
    if (!mapped.length || this.refusal(groupKey, 'mobygames')) return false;
    const cur = this.get(groupKey);
    this.write(groupKey, { primaryGenre: mapped[0]!, genres: mapped, tags: cur?.tags ?? [], canonicalTitle: cur?.canonicalTitle ?? null }, 'mobygames', false);
    return true;
  }

  summary(): GenreSummary {
    const counts = new Map<string, number>();
    for (const r of this.db
      .prepare('SELECT c.primary_genre AS g, COUNT(*) AS n FROM game_classifications c WHERE c.group_key IN (SELECT DISTINCT group_key FROM games) GROUP BY c.primary_genre')
      .all() as unknown as { g: string; n: number }[]) counts.set(r.g, r.n);
    const total = (this.db.prepare('SELECT COUNT(DISTINCT group_key) AS n FROM games').get() as unknown as { n: number }).n;
    const classified = [...counts.values()].reduce((a, b) => a + b, 0);
    return { genres: GENRES.map((genre) => ({ genre, count: counts.get(genre) ?? 0 })), unclassified: total - classified, total };
  }

  // ---------------------------------------------------------------- the catalog file
  /** Checks the structure of a catalog file. A broken file is refused whole; a broken entry is reported and skipped later. */
  static parse(body: unknown): CatalogFile {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) throw bad('The catalog must be a JSON object');
    const o = body as Record<string, unknown>;
    if (o.schema !== 1) throw bad('Unsupported catalog schema (expected "schema": 1)');
    if (!Array.isArray(o.games)) throw bad('The catalog needs a "games" list');
    if (o.games.length > CATALOG_MAX_ENTRIES) throw bad(`The catalog has more than ${CATALOG_MAX_ENTRIES} games`, 413);
    return { schema: 1, ...(typeof o.generated === 'string' ? { generated: sanitizeText(o.generated, 40) } : {}), games: o.games as CatalogFile['games'] };
  }

  /**
   * Matches every entry by SHA-256 and decides what an import would do, without writing. Entries are matched to the
   * group (all versions of a game) of the file with that hash; hashes that are not in the library are only counted.
   */
  analyze(file: CatalogFile, shaToGroup: (sha: string) => string | null): { report: CatalogReport; writes: { groupKey: string; input: ClassInput }[] } {
    type Cand = { idx: number; sha: string; groupKey: string; title: string | undefined; input: ClassInput };
    const report: CatalogReport = { entries: file.games.length, ok: 0, applied: 0, unchanged: 0, missing: 0, conflict: 0, locked: 0, protected: 0, invalid: 0, items: [] };
    const shown: Record<string, number> = {};
    const note = (state: CatalogEntryState, sha: string, extra: { title?: string; genre?: string; detail?: string } = {}) => {
      shown[state] = (shown[state] ?? 0) + 1;
      if (state !== 'ok' && shown[state]! <= REPORT_ITEMS_PER_KIND) report.items.push({ state, sha256: sha.slice(0, 64), ...extra });
    };
    const cands: Cand[] = [];
    file.games.forEach((e, idx) => {
      const sha = typeof e?.sha256 === 'string' ? e.sha256.toLowerCase() : '';
      const title = typeof e?.title === 'string' ? sanitizeText(e.title, 120) : undefined;
      const fail = (detail: string) => { report.invalid++; note('invalid', typeof e?.sha256 === 'string' ? e.sha256.slice(0, 64) : '', { ...(title ? { title } : {}), detail }); };
      if (!/^[0-9a-f]{64}$/.test(sha)) return fail('sha256 must be 64 hex characters');
      if (!isGenre(e.genre)) return fail(`unknown genre "${sanitizeText(String(e.genre), 40)}"`);
      let extra: Genre[] = [];
      if (e.genres !== undefined) {
        if (!Array.isArray(e.genres) || !e.genres.every(isGenre)) return fail('genres must be known genre names');
        extra = e.genres as Genre[];
      }
      let tags: string[] = [];
      if (e.tags !== undefined) {
        try { tags = cleanTags(e.tags); } catch (err) { return fail((err as Error).message); }
      }
      const groupKey = shaToGroup(sha);
      if (!groupKey) { report.missing++; note('missing', sha, { ...(title ? { title } : {}), genre: e.genre }); return; }
      cands.push({ idx, sha, groupKey, title, input: { primaryGenre: e.genre, genres: extra, tags, canonicalTitle: title ?? null } });
    });

    // one group, one genre: two files of a game that the catalog puts in different genres are left alone (not guessed)
    const byGroup = new Map<string, Cand[]>();
    for (const c of cands) (byGroup.get(c.groupKey) ?? byGroup.set(c.groupKey, []).get(c.groupKey)!).push(c);
    const writes: { groupKey: string; input: ClassInput }[] = [];
    for (const [groupKey, list] of byGroup) {
      const genres = new Set(list.map((c) => c.input.primaryGenre));
      if (genres.size > 1) {
        for (const c of list) { report.conflict++; note('conflict', c.sha, { ...(c.title ? { title: c.title } : {}), genre: c.input.primaryGenre, detail: `the same game is listed as ${[...genres].join(' and ')}` }); }
        continue;
      }
      const why = this.refusal(groupKey, 'curator');
      if (why) {
        for (const c of list) { report[why]++; note(why, c.sha, { ...(c.title ? { title: c.title } : {}), genre: c.input.primaryGenre, detail: why === 'locked' ? 'the genre was chosen by hand' : 'a MobyGames genre is already set' }); }
        continue;
      }
      report.ok += list.length;
      const first = list[0]!;
      const merged: ClassInput = {
        primaryGenre: first.input.primaryGenre,
        genres: [...new Set(list.flatMap((c) => c.input.genres ?? []))],
        tags: [...new Set(list.flatMap((c) => c.input.tags ?? []))].slice(0, MAX_TAGS),
        canonicalTitle: list.map((c) => c.title).find(Boolean) ?? null,
      };
      const cur = this.get(groupKey);
      const same = cur && cur.source === 'curator' && cur.primaryGenre === merged.primaryGenre && cur.canonicalTitle === merged.canonicalTitle
        && JSON.stringify(cur.tags) === JSON.stringify(merged.tags) && JSON.stringify(cur.genres) === JSON.stringify([...new Set([merged.primaryGenre, ...(merged.genres ?? [])])]);
      if (same) report.unchanged += list.length;
      else writes.push({ groupKey, input: merged });
    }
    return { report, writes };
  }

  /** Writes what `analyze` allowed, in one transaction: all of it or nothing. */
  importCatalog(file: CatalogFile, shaToGroup: (sha: string) => string | null): CatalogReport {
    const { report, writes } = this.analyze(file, shaToGroup);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const w of writes) this.write(w.groupKey, w.input, 'curator', false);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    report.applied = writes.length;
    return report;
  }

  /** The classified games as a catalog file: one entry per file (SHA-256), so it can be imported again elsewhere. */
  exportCatalog(files: { sha256: string; groupKey: string; name: string }[]): CatalogFile {
    const cls = this.all();
    const games: CatalogFile['games'] = [];
    for (const f of files) {
      const c = cls.get(f.groupKey);
      if (!c) continue;
      games.push({ sha256: f.sha256, title: c.canonicalTitle ?? f.name, genre: c.primaryGenre, ...(c.genres.length > 1 ? { genres: c.genres } : {}), ...(c.tags.length ? { tags: c.tags } : {}) });
    }
    return { schema: 1, generated: new Date().toISOString(), games };
  }
}
