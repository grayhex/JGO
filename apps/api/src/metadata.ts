import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { GameInfo, GameMeta, MetadataJob, MetaStatus, MobyCandidate } from '@j2me-web/protocol';
import { UploadError } from './jar.js';
import type { Library } from './library.js';
import { ATTRIBUTION, decideMatch, MobyError, normalizeTitle, toCandidate, type MobyClient, type MobyGameData } from './mobygames.js';

const TTL_MS = 30 * 24 * 3600 * 1000;
const IMG_EXT = ['jpg', 'png', 'gif', 'webp'] as const;

interface Row {
  group_key: string;
  status: MetaStatus;
  moby_id: number | null;
  data_json: string;
  candidates_json: string;
  fetched_at: string | null;
  locked: number;
  error: string | null;
}

interface StoredData {
  title?: string;
  description?: string | null;
  genres?: string[];
  publishers?: string[];
  developers?: string[];
  year?: number | null;
  score?: number | null;
  criticScore?: number | null;
  playerScore?: number | null;
  mobyUrl?: string | null;
  officialUrl?: string | null;
  hasCover?: boolean;
  screenshots?: number;
}

type StoredCandidate = MobyCandidate & { data?: MobyGameData };

export type Scope = 'missing' | 'retry' | 'all';

/**
 * Keeps what MobyGames told us about each game (grouped by vendor + name, so every version of a game shares it),
 * together with the cover and screenshots, on the server's disk. The browser only ever talks to JGO: images are
 * served from here, so the API key never leaves the server and no third-party request is made by a page view.
 *
 * Terms-wise this module does three things: it always carries the attribution text and the MobyGames link, it
 * refreshes data rather than keeping it forever (30 days), and `clear()` removes everything again.
 */
export class MetadataService {
  private state: MetadataJob = { state: 'idle', total: 0, done: 0, matched: 0, ambiguous: 0, unmatched: 0, failed: 0, current: null, waitingUntil: null, error: null };
  private cancelled = false;
  private running: Promise<void> | null = null;
  readonly dir: string;

  constructor(private library: Library, dataDir: string, private client: () => MobyClient, private enabled: () => boolean) {
    this.dir = path.join(dataDir, 'metadata');
  }

  job(): MetadataJob {
    return { ...this.state };
  }

  setWaiting(until: number | null): void {
    this.state.waitingUntil = until;
  }

  async idle(): Promise<void> {
    await this.running;
  }

  cancel(): boolean {
    if (!this.running) return false;
    this.cancelled = true;
    return true;
  }

  // ---- reads --------------------------------------------------------------------------------------------

  private row(groupKey: string): Row | undefined {
    return this.library.db.prepare('SELECT * FROM metadata WHERE group_key = ?').get(groupKey) as unknown as Row | undefined;
  }

  private groupDir(groupKey: string): string {
    if (!/^[0-9a-f]{12}$/.test(groupKey)) throw new UploadError('bad_request', 'Invalid group key');
    return path.join(this.dir, groupKey);
  }

  info(groupKey: string): GameInfo {
    const r = this.row(groupKey);
    const d = (r ? JSON.parse(r.data_json) : {}) as StoredData;
    const cands = (r ? JSON.parse(r.candidates_json) : []) as StoredCandidate[];
    return {
      status: r?.status ?? 'none',
      groupKey,
      mobyId: r?.moby_id ?? null,
      title: d.title ?? null,
      description: d.description ?? null,
      genres: d.genres ?? [],
      publishers: d.publishers ?? [],
      developers: d.developers ?? [],
      year: d.year ?? null,
      score: d.score ?? null,
      mobyUrl: d.mobyUrl ?? null,
      officialUrl: d.officialUrl ?? null,
      hasCover: !!d.hasCover && !!this.imagePath(groupKey, 'cover'),
      screenshots: d.screenshots ?? 0,
      candidates: cands.map(({ data: _data, ...c }) => c),
      fetchedAt: r?.fetched_at ?? null,
      attribution: ATTRIBUTION,
      error: r?.error ?? null,
    };
  }

  /** Path of cover / shot-N on disk, whatever the image format turned out to be. */
  imagePath(groupKey: string, name: string): { file: string; ext: (typeof IMG_EXT)[number] } | null {
    if (!/^(cover|shot-[1-6])$/.test(name)) return null;
    const dir = this.groupDir(groupKey);
    for (const ext of IMG_EXT) {
      const file = path.join(dir, `${name}.${ext}`);
      if (existsSync(file)) return { file, ext };
    }
    return null;
  }

  /** Lists groups: one entry per (vendor, name), represented by its newest game. */
  groups(): { groupKey: string; name: string; vendor: string; games: GameMeta[] }[] {
    const by = new Map<string, GameMeta[]>();
    for (const g of this.library.list()) {
      const l = by.get(g.groupKey) ?? [];
      l.push(g);
      by.set(g.groupKey, l);
    }
    return [...by].map(([groupKey, games]) => ({ groupKey, name: games[0]!.name, vendor: games[0]!.vendor, games }));
  }

  needsReview(): { groupKey: string; gameId: string; name: string; vendor: string; status: MetaStatus; candidates: MobyCandidate[] }[] {
    const out = [];
    for (const g of this.groups()) {
      const i = this.info(g.groupKey);
      if (i.status === 'ambiguous') out.push({ groupKey: g.groupKey, gameId: g.games[0]!.id, name: g.name, vendor: g.vendor, status: i.status, candidates: i.candidates });
    }
    return out;
  }

  // ---- writes ------------------------------------------------------------------------------------------

  private save(groupKey: string, p: { status: MetaStatus; mobyId?: number | null; data?: StoredData; candidates?: StoredCandidate[]; locked?: boolean; error?: string | null }): void {
    this.library.db
      .prepare(
        `INSERT INTO metadata (group_key, status, moby_id, data_json, candidates_json, fetched_at, locked, error) VALUES (?,?,?,?,?,?,?,?)
         ON CONFLICT(group_key) DO UPDATE SET status=excluded.status, moby_id=excluded.moby_id, data_json=excluded.data_json, candidates_json=excluded.candidates_json,
           fetched_at=excluded.fetched_at, locked=excluded.locked, error=excluded.error`,
      )
      .run(groupKey, p.status, p.mobyId ?? null, JSON.stringify(p.data ?? {}), JSON.stringify(p.candidates ?? []), new Date().toISOString(), p.locked ? 1 : 0, p.error ?? null);
  }

  private async applyGame(groupKey: string, g: MobyGameData, status: MetaStatus, locked: boolean): Promise<void> {
    const dir = this.groupDir(groupKey);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const client = this.client();
    let hasCover = false;
    let shots = 0;
    const warn: string[] = [];
    if (g.coverUrl || g.thumbUrl) {
      try {
        const img = await client.fetchImage((g.coverUrl ?? g.thumbUrl)!);
        writeFileSync(path.join(dir, `cover.${img.ext}`), img.bytes, { mode: 0o600 });
        hasCover = true;
      } catch (e) {
        warn.push(`cover: ${(e as Error).message}`);
      }
    }
    for (const u of g.screenshotUrls.slice(0, 6)) {
      if (this.cancelled) break;
      try {
        const img = await client.fetchImage(u);
        writeFileSync(path.join(dir, `shot-${shots + 1}.${img.ext}`), img.bytes, { mode: 0o600 });
        shots++;
      } catch (e) {
        warn.push(`screenshot: ${(e as Error).message}`);
      }
    }
    this.save(groupKey, {
      status, mobyId: g.mobyId, locked,
      data: { title: g.title, description: g.description, genres: g.genres, publishers: g.publishers, developers: g.developers, year: g.year, score: g.score, criticScore: g.criticScore, playerScore: g.playerScore, mobyUrl: g.mobyUrl, officialUrl: g.officialUrl, hasCover, screenshots: shots },
      candidates: [], error: warn.length ? warn.slice(0, 3).join('; ') : null,
    });
    // a decisive or hand-confirmed match gives the game its genre, unless the user or a stronger source already set it
    this.library.classes.applyMoby(groupKey, g.genres);
  }

  /** Looks one group up and stores the outcome. `query` overrides the library name (manual search). */
  async matchGroup(groupKey: string, name: string, query?: string): Promise<MetaStatus> {
    const q = (query ?? name).trim();
    const client = this.client();
    const { games, platformFiltered, platformId } = await client.search(normalizeTitle(q) || q);
    const decision = decideMatch(q, games, platformId, platformFiltered);
    if (decision.kind === 'matched') {
      await this.applyGame(groupKey, decision.best, 'matched', false);
      return 'matched';
    }
    if (decision.kind === 'ambiguous') {
      const cands: StoredCandidate[] = decision.ranked.map((r) => ({ ...r.candidate, data: r.game }));
      this.save(groupKey, { status: 'ambiguous', candidates: cands });
      return 'ambiguous';
    }
    this.save(groupKey, { status: 'unmatched' });
    return 'unmatched';
  }

  /** Manual choice of one of the stored candidates (no new API call). */
  async choose(groupKey: string, mobyId: number): Promise<GameInfo> {
    const r = this.row(groupKey);
    const stored = (r ? JSON.parse(r.candidates_json) : []) as StoredCandidate[];
    let data = stored.find((c) => c.mobyId === mobyId)?.data ?? null;
    if (!data) {
      if (!this.enabled()) throw new UploadError('no_key', 'Add a MobyGames API key first', 400);
      data = await this.client().byId(mobyId);
    }
    if (!data) throw new UploadError('not_found', 'MobyGames has no such game', 404);
    await this.applyGame(groupKey, data, 'manual', true);
    return this.info(groupKey);
  }

  /** A manual search with free text: replaces the candidate list, does not choose anything. */
  async search(groupKey: string, query: string): Promise<GameInfo> {
    const q = query.trim().slice(0, 120);
    if (q.length < 2) throw new UploadError('bad_request', 'Type at least two characters', 400);
    const { games, platformId } = await this.client().search(normalizeTitle(q) || q, { allPlatforms: true });
    const ranked = games.map((g) => ({ ...toCandidate(g, q, platformId), data: g })).sort((a, b) => b.score - a.score || Number(b.j2me) - Number(a.j2me)).slice(0, 8);
    const prev = this.row(groupKey);
    this.save(groupKey, { status: ranked.length ? 'ambiguous' : prev?.status === 'matched' || prev?.status === 'manual' ? prev.status : 'unmatched', mobyId: prev?.moby_id ?? null, data: prev ? JSON.parse(prev.data_json) : {}, candidates: ranked, locked: !!prev?.locked });
    return this.info(groupKey);
  }

  /** "This is not the game": forget the match and do not match it again automatically. */
  unlink(groupKey: string): GameInfo {
    rmSync(this.groupDir(groupKey), { recursive: true, force: true });
    this.save(groupKey, { status: 'none', locked: true });
    return this.info(groupKey);
  }

  /** Removes all MobyGames data and images from this server. */
  clear(): void {
    this.library.db.exec('DELETE FROM metadata');
    rmSync(this.dir, { recursive: true, force: true });
  }

  stats(): { matched: number; ambiguous: number; unmatched: number; bytes: number } {
    const rows = this.library.db.prepare('SELECT status, COUNT(*) AS n FROM metadata GROUP BY status').all() as unknown as { status: string; n: number }[];
    const n = (s: string[]) => rows.filter((r) => s.includes(r.status)).reduce((a, r) => a + r.n, 0);
    let bytes = 0;
    if (existsSync(this.dir)) {
      for (const g of readdirSync(this.dir)) {
        for (const f of readdirSync(path.join(this.dir, g))) bytes += readFileSync(path.join(this.dir, g, f)).length;
      }
    }
    return { matched: n(['matched', 'manual']), ambiguous: n(['ambiguous']), unmatched: n(['unmatched']), bytes };
  }

  // ---- background job -----------------------------------------------------------------------------------

  private due(groupKey: string, scope: Scope): boolean {
    const r = this.row(groupKey);
    if (!r) return true;
    if (r.locked) return false;
    if (scope === 'all') return true;
    if (scope === 'retry') return r.status !== 'matched' && r.status !== 'manual';
    if (r.status === 'matched' && r.fetched_at && Date.now() - Date.parse(r.fetched_at) > TTL_MS) return true; // stale
    return false;
  }

  start(scope: Scope): MetadataJob {
    if (this.running) throw new UploadError('job_running', 'A MobyGames lookup is already running', 409);
    if (!this.enabled()) throw new UploadError('no_key', 'Add a MobyGames API key in Settings first', 400);
    const todo = this.groups().filter((g) => this.due(g.groupKey, scope));
    this.cancelled = false;
    this.state = { state: 'running', total: todo.length, done: 0, matched: 0, ambiguous: 0, unmatched: 0, failed: 0, current: null, waitingUntil: null, error: null };
    this.running = this.runJob(todo).finally(() => {
      this.running = null;
    });
    return this.job();
  }

  private async runJob(todo: { groupKey: string; name: string }[]): Promise<void> {
    const s = this.state;
    try {
      for (const g of todo) {
        if (this.cancelled) { s.state = 'cancelled'; break; }
        s.current = g.name;
        try {
          const st = await this.matchGroup(g.groupKey, g.name);
          if (st === 'matched') s.matched++;
          else if (st === 'ambiguous') s.ambiguous++;
          else s.unmatched++;
        } catch (e) {
          if (e instanceof MobyError && (e.code === 'invalid_key' || e.code === 'rate_limited')) {
            s.error = e.message;
            s.state = 'failed';
            break;
          }
          s.failed++;
          this.save(g.groupKey, { status: 'error', error: e instanceof Error ? e.message.slice(0, 300) : 'lookup failed' });
        }
        s.done++;
      }
      if (s.state === 'running') s.state = 'done';
    } catch (e) {
      s.state = 'failed';
      s.error = e instanceof Error ? e.message : String(e);
    } finally {
      s.current = null;
      s.waitingUntil = null;
    }
  }
}
