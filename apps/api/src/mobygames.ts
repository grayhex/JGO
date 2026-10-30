import type { MobyCandidate } from '@j2me-web/protocol';

/**
 * Client for the MobyGames API v2 (https://api.mobygames.com/v2, `api_key` query parameter).
 *
 *  - The key stays on the server: it is read through `getKey` for every call and is never put into an error message.
 *  - Requests are serialised and spaced out; a 429 is waited out (Retry-After) instead of hammered.
 *  - Only game metadata and images are fetched. Nothing here can download a game: the one download helper only
 *    accepts image hosts of MobyGames and checks the bytes for an image signature.
 */

export const DEFAULT_API_BASE = 'https://api.mobygames.com/v2';
export const ATTRIBUTION = 'Game data and images courtesy of MobyGames (https://www.mobygames.com). Not for redistribution.';
const J2ME_PLATFORM_FALLBACK = 64;
const BASE_INCLUDE = 'game_id,title,moby_url,official_url,description,genres,platforms,covers,screenshots,moby_score,publishers,developers,release_date';
const EXT_INCLUDE = `${BASE_INCLUDE},critic_score,player_score`;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export class MobyError extends Error {
  constructor(public code: 'invalid_key' | 'rate_limited' | 'network' | 'bad_response' | 'http', message: string, public status = 502, public retryAfterMs = 0) {
    super(message);
  }
}

export interface MobyGameData {
  mobyId: number;
  title: string;
  description: string | null;
  genres: string[];
  publishers: string[];
  developers: string[];
  year: number | null;
  /** 0..10 */
  score: number | null;
  criticScore: number | null;
  playerScore: number | null;
  mobyUrl: string | null;
  officialUrl: string | null;
  platforms: { id: number; name: string; year: number | null }[];
  coverUrl: string | null;
  screenshotUrls: string[];
  thumbUrl: string | null;
}

export interface MobyOptions {
  base?: string;
  fetch?: typeof fetch;
  /** Minimum time between two API requests. */
  minIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Called while the client waits for the rate limit to reset. */
  onWait?: (until: number | null) => void;
  now?: () => number;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}
function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}
function obj(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
/** Names from either ["A","B"] or [{name:"A"}] or [{company_name:"A"}]. */
function names(v: unknown): string[] {
  const out: string[] = [];
  for (const x of arr(v)) {
    const s = str(x) ?? str(obj(x)?.name) ?? str(obj(x)?.company_name) ?? str(obj(x)?.genre_name);
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/** MobyGames descriptions are marked-up text: keep the words, drop the markup. */
export function cleanText(s: string, max = 4000): string {
  return s
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#?\w+);/g, (m, e: string) => ENTITIES[e] ?? m)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

function yearOf(v: unknown): number | null {
  const s = str(v);
  const m = s ? /^(\d{4})/.exec(s) : null;
  return m ? Number(m[1]) : null;
}

function httpsUrl(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Turns one entry of the API's `games` array into our shape; tolerant of fields a plan does not include. */
export function normalizeGame(raw: unknown, j2mePlatform: number): MobyGameData | null {
  const g = obj(raw);
  const id = num(g?.game_id ?? g?.id);
  const title = str(g?.title);
  if (!g || id === null || !title) return null;
  const platforms = arr(g.platforms).flatMap((p) => {
    const o = obj(p);
    const pid = num(o?.platform_id ?? o?.id);
    const name = str(o?.name ?? o?.platform_name);
    return o && pid !== null && name ? [{ id: pid, name, year: yearOf(o.release_date) }] : [];
  });
  const j2me = platforms.find((p) => p.id === j2mePlatform) ?? null;

  // covers: groups of images; prefer a group that is for the J2ME platform
  const coverGroups = arr(g.covers).map(obj).filter((x): x is Record<string, unknown> => !!x);
  const forJ2me = coverGroups.find((c) => arr(c.platforms).some((p) => num(obj(p)?.platform_id ?? obj(p)?.id) === j2mePlatform || /j2me/i.test(str(obj(p)?.name ?? obj(p)?.platform_name) ?? (typeof p === 'string' ? p : ''))));
  const coverImgs = arr((forJ2me ?? coverGroups[0])?.images).map(obj).filter((x): x is Record<string, unknown> => !!x);
  const cover = coverImgs[0];

  // screenshots grouped by platform
  const shotGroups = arr(g.screenshots).map(obj).filter((x): x is Record<string, unknown> => !!x);
  const preferred = shotGroups.filter((s) => num(s.platform_id) === j2mePlatform);
  const shots: string[] = [];
  for (const grp of preferred.length ? preferred : shotGroups) {
    for (const im of arr(grp.images)) {
      const o = obj(im);
      const u = httpsUrl(o?.image_url) ?? httpsUrl(o?.thumbnail_url);
      if (u && shots.length < 6) shots.push(u);
    }
  }

  return {
    mobyId: id,
    title: cleanText(title, 200),
    description: str(g.description) ? cleanText(String(g.description)) : null,
    genres: names(g.genres),
    publishers: names(g.publishers),
    developers: names(g.developers),
    year: j2me?.year ?? yearOf(g.release_date) ?? platforms.map((p) => p.year).filter((y): y is number => y !== null).sort()[0] ?? null,
    score: num(g.moby_score),
    criticScore: num(g.critic_score),
    playerScore: num(g.player_score),
    mobyUrl: httpsUrl(g.moby_url),
    officialUrl: httpsUrl(g.official_url),
    platforms,
    coverUrl: httpsUrl(cover?.image_url) ?? httpsUrl(cover?.thumbnail_url),
    screenshotUrls: shots,
    thumbUrl: httpsUrl(cover?.thumbnail_url) ?? httpsUrl(cover?.image_url),
  };
}

// ---- title matching ------------------------------------------------------------------------------

/** Library names are file-ish ("Prince of Persia 3D v1.2 (Gameloft)"): reduce them to comparable words. */
export function normalizeTitle(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[([{][^)\]}]*[)\]}]/g, ' ')
    .replace(/\bv(?:er(?:sion)?)?\s*\d+(?:[._]\d+)*\b/g, ' ')
    .replace(/\b(?:j2me|midp|jar|jad|java|mobile|mobil|game)\b/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/_/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/^(?:the|a|an)\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const t = ` ${s} `;
  for (let i = 0; i < t.length - 1; i++) {
    const b = t.slice(i, i + 2);
    m.set(b, (m.get(b) ?? 0) + 1);
  }
  return m;
}

/** 0..1: Dice coefficient over character bigrams, with a bonus for identical word sets (word order differs a lot between sources). */
export function titleSimilarity(a: string, b: string): number {
  const x = normalizeTitle(a);
  const y = normalizeTitle(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const bx = bigrams(x);
  const by = bigrams(y);
  let inter = 0;
  for (const [k, v] of bx) inter += Math.min(v, by.get(k) ?? 0);
  const dice = (2 * inter) / ([...bx.values()].reduce((s, v) => s + v, 0) + [...by.values()].reduce((s, v) => s + v, 0));
  const wx = new Set(x.split(' '));
  const wy = new Set(y.split(' '));
  const sameWords = wx.size === wy.size && [...wx].every((w) => wy.has(w));
  return Math.min(1, sameWords ? Math.max(dice, 0.97) : dice);
}

export function toCandidate(g: MobyGameData, query: string, j2mePlatform: number): MobyCandidate {
  return {
    mobyId: g.mobyId,
    title: g.title,
    year: g.year,
    platforms: g.platforms.map((p) => p.name).slice(0, 8),
    genres: g.genres.slice(0, 4),
    url: g.mobyUrl,
    score: Math.round(titleSimilarity(query, g.title) * 1000) / 1000,
    j2me: g.platforms.some((p) => p.id === j2mePlatform),
    thumb: g.thumbUrl,
  };
}

export type MatchDecision =
  | { kind: 'matched'; best: MobyGameData }
  | { kind: 'ambiguous'; ranked: { game: MobyGameData; candidate: MobyCandidate }[] }
  | { kind: 'unmatched' };

/**
 * Chooses automatically only when the call is clear: a J2ME game whose title is (almost) identical and that no
 * other J2ME candidate comes close to. Anything else is left for a person to pick.
 */
export function decideMatch(query: string, games: MobyGameData[], j2mePlatform: number, platformFiltered: boolean): MatchDecision {
  const ranked = games
    .map((game) => ({ game, candidate: toCandidate(game, query, j2mePlatform) }))
    .filter((r) => r.candidate.score >= 0.5)
    .sort((a, b) => b.candidate.score - a.candidate.score || Number(b.candidate.j2me) - Number(a.candidate.j2me));
  if (!ranked.length) return { kind: 'unmatched' };
  const top = ranked[0]!;
  const rival = ranked.slice(1).find((r) => r.candidate.score >= top.candidate.score - 0.05 && (!platformFiltered || r.candidate.j2me));
  if (platformFiltered && top.candidate.j2me && top.candidate.score >= 0.9 && !rival) return { kind: 'matched', best: top.game };
  return { kind: 'ambiguous', ranked: ranked.slice(0, 6) };
}

// ---- HTTP -----------------------------------------------------------------------------------------------

export class MobyClient {
  private base: string;
  private doFetch: typeof fetch;
  private minInterval: number;
  private sleep: (ms: number) => Promise<void>;
  private now: () => number;
  private last = 0;
  private chain: Promise<unknown> = Promise.resolve();
  private platformId: number | null = null;
  private extended = true;
  /** Requests made since start (for the tests and for the status line). */
  requests = 0;

  constructor(private getKey: () => string | null, private opts: MobyOptions = {}) {
    this.base = (opts.base ?? DEFAULT_API_BASE).replace(/\/+$/, '');
    this.doFetch = opts.fetch ?? fetch;
    this.minInterval = opts.minIntervalMs ?? 1100;
    this.sleep = opts.sleep ?? realSleep;
    this.now = opts.now ?? Date.now;
  }

  hasKey(): boolean {
    return !!this.getKey();
  }

  private imageHosts(): (host: string) => boolean {
    let baseHost = '';
    try { baseHost = new URL(this.base).host; } catch { /* default */ }
    const overridden = this.base !== DEFAULT_API_BASE;
    return (h) => h === 'mobygames.com' || h.endsWith('.mobygames.com') || (overridden && h === baseHost);
  }

  private redact(s: string): string {
    const k = this.getKey();
    return k ? s.split(k).join('***') : s;
  }

  /** One API call, queued behind the others and spaced out. Retries 429 (waiting) and 5xx (once). */
  private request(pathname: string, params: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    const run = async (): Promise<unknown> => {
      const key = this.getKey();
      if (!key) throw new MobyError('invalid_key', 'No MobyGames API key is configured', 400);
      for (let attempt = 0; ; attempt++) {
        const wait = this.last + this.minInterval - this.now();
        if (wait > 0) await this.sleep(wait);
        this.last = this.now();
        const url = new URL(`${this.base}${pathname}`);
        for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
        url.searchParams.set('api_key', key);
        let res: Response;
        this.requests++;
        try {
          res = await this.doFetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'JGO (self-hosted J2ME web player)' }, signal: AbortSignal.timeout(20_000), redirect: 'error' });
        } catch (e) {
          if (attempt < 1) { await this.sleep(1500); continue; }
          throw new MobyError('network', this.redact(`Cannot reach MobyGames: ${(e as Error).message}`), 502);
        }
        if (res.status === 429) {
          const ra = Number(res.headers.get('retry-after'));
          const ms = Math.min(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 15_000 * 2 ** attempt, 15 * 60_000);
          if (attempt >= 3) throw new MobyError('rate_limited', 'MobyGames rate limit reached; try again later', 429, ms);
          this.opts.onWait?.(this.now() + ms);
          await this.sleep(ms);
          this.opts.onWait?.(null);
          continue;
        }
        if (res.status === 401 || res.status === 403) throw new MobyError('invalid_key', 'MobyGames rejected the API key (or the plan does not include this data)', 400);
        if (res.status >= 500 && attempt < 1) { await this.sleep(2000); continue; }
        if (!res.ok) throw new MobyError('http', `MobyGames answered HTTP ${res.status}`, 502);
        try {
          return await res.json();
        } catch {
          throw new MobyError('bad_response', 'MobyGames sent a response that is not JSON', 502);
        }
      }
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => undefined);
    return p;
  }

  /** Validates the key with the cheapest call; also resolves the J2ME platform id. */
  async test(): Promise<{ platformId: number }> {
    this.platformId = null;
    return { platformId: await this.j2mePlatform() };
  }

  async j2mePlatform(): Promise<number> {
    if (this.platformId !== null) return this.platformId;
    const body = obj(await this.request('/platforms', {}));
    const list = arr(body?.platforms).map(obj);
    const hit = list.find((p) => /^j2me$/i.test(str(p?.name ?? p?.platform_name) ?? ''));
    this.platformId = num(hit?.platform_id ?? hit?.id) ?? J2ME_PLATFORM_FALLBACK;
    return this.platformId;
  }

  private async games(params: Record<string, string | number | boolean | undefined>): Promise<MobyGameData[]> {
    const plat = await this.j2mePlatform();
    const call = async (include: string) => obj(await this.request('/games', { ...params, include, limit: params.limit ?? 10 }));
    let body;
    try {
      body = await call(this.extended ? EXT_INCLUDE : BASE_INCLUDE);
    } catch (e) {
      // a plan without critic/player scores refuses the longer field list: remember it and use the base list
      if (this.extended && e instanceof MobyError && (e.code === 'invalid_key' || e.code === 'http')) {
        this.extended = false;
        body = await call(BASE_INCLUDE);
      } else throw e;
    }
    return arr(body?.games).flatMap((g) => {
      const n = normalizeGame(g, plat);
      return n ? [n] : [];
    });
  }

  /** Looks a title up; the J2ME platform is tried first. */
  async search(title: string, opts: { allPlatforms?: boolean } = {}): Promise<{ games: MobyGameData[]; platformFiltered: boolean; platformId: number }> {
    const platformId = await this.j2mePlatform();
    if (!opts.allPlatforms) {
      const hit = await this.games({ title, platform: platformId, fuzzy: true });
      if (hit.length) return { games: hit, platformFiltered: true, platformId };
    }
    return { games: await this.games({ title, fuzzy: true }), platformFiltered: false, platformId };
  }

  async byId(id: number): Promise<MobyGameData | null> {
    return (await this.games({ id, limit: 1 }))[0] ?? null;
  }

  /** Downloads one image from a MobyGames host. */
  async fetchImage(rawUrl: string): Promise<{ bytes: Buffer; ext: 'jpg' | 'png' | 'gif' | 'webp' }> {
    const allowed = this.imageHosts();
    let url: URL;
    try { url = new URL(rawUrl); } catch { throw new MobyError('bad_response', 'Invalid image URL', 502); }
    for (let hop = 0; hop < 3; hop++) {
      if (!['https:', 'http:'].includes(url.protocol) || !allowed(url.host.toLowerCase()) || (url.protocol === 'http:' && this.base === DEFAULT_API_BASE)) {
        throw new MobyError('bad_response', 'Refusing to download an image from a host that is not MobyGames', 502);
      }
      let res: Response;
      try {
        res = await this.doFetch(url, { headers: { Accept: 'image/*', 'User-Agent': 'JGO (self-hosted J2ME web player)' }, signal: AbortSignal.timeout(20_000), redirect: 'manual' });
      } catch (e) {
        throw new MobyError('network', `Image download failed: ${(e as Error).message}`, 502);
      }
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) throw new MobyError('bad_response', 'Redirect without a location', 502);
        url = new URL(loc, url);
        continue;
      }
      if (!res.ok) throw new MobyError('http', `Image download answered HTTP ${res.status}`, 502);
      const len = Number(res.headers.get('content-length'));
      if (Number.isFinite(len) && len > MAX_IMAGE_BYTES) throw new MobyError('bad_response', 'Image is too large', 502);
      const chunks: Uint8Array[] = [];
      let total = 0;
      const reader = res.body?.getReader();
      if (!reader) throw new MobyError('bad_response', 'Empty image response', 502);
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > MAX_IMAGE_BYTES) { await reader.cancel(); throw new MobyError('bad_response', 'Image is too large', 502); }
        chunks.push(value);
      }
      const bytes = Buffer.concat(chunks);
      const ext = sniffImage(bytes);
      if (!ext) throw new MobyError('bad_response', 'The download is not a JPEG/PNG/GIF/WebP image', 502);
      return { bytes, ext };
    }
    throw new MobyError('bad_response', 'Too many redirects', 502);
  }
}

export function sniffImage(b: Uint8Array): 'jpg' | 'png' | 'gif' | 'webp' | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
  return null;
}
