import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { isGenre, type GameMeta, type NgageInfo } from '@mgo/protocol';
import type { Library } from './library.js';
import { AAS_SNAPSHOT, AAS_SNAPSHOT_DATE } from './ngageSnapshot.js';

export const AAS_ORIGIN = 'https://allaboutsymbian.com';
export const AAS_INDEX = '/n-gage-games/original/';
const TTL = 30 * 86400_000;
const text = (s: string) => s.replace(/<[^>]*>/g, '').replace(/&#(?:x([\da-f]+)|(\d+));/gi, (_, h, d) => String.fromCodePoint(parseInt(h || d, h ? 16 : 10))).replace(/&(amp|quot|apos|lt|gt|nbsp|middot);/g, (_, n) => ({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' ',middot:'·'})[n as string] ?? '').trim();
export interface CatalogEntry { title: string; url: string; genre: string; publisher: string; year: number | null; cover: string | null }
export function parseAasIndex(html: string): CatalogEntry[] {
  const released = html.split(/<h2[^>]+id="unreleased"/i)[0]!;
  const entries: CatalogEntry[] = []; let genre = '';
  for (const token of released.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>|<a\b[^>]*href="(item\/[a-z0-9-]+\.php)"[^>]*class="game-card"[^>]*>([\s\S]*?)<\/a>/gi)) {
    if (token[1]) { genre = text(token[1]).replace(/\s*\(\d+\)$/, ''); continue; }
    const card = token[3]!;
    const title = text(/class="title"[^>]*>([\s\S]*?)<\/div>/i.exec(card)?.[1] ?? '');
    const meta = text(/class="meta"[^>]*>([\s\S]*?)<\/div>/i.exec(card)?.[1] ?? '');
    const image = /<img[^>]+src="([^"]+)"/i.exec(card)?.[1] ?? null;
    if (title) entries.push({ title, url: AAS_ORIGIN + AAS_INDEX + token[2], genre, publisher: meta.split('·')[0]!.split(' / ')[0]!.trim(), year: Number(/\b(19\d\d|20\d\d)\b/.exec(meta)?.[1]) || null, cover: image && /^\/images\/ngage\//.test(image) ? AAS_ORIGIN + image : null });
  }
  if (!entries.length) throw new Error('All About Symbian returned an unrecognized game directory');
  return entries;
}
/**
 * Words of a title as they are compared. Everything a dump adds around the name is dropped: region and version tags in brackets
 * ("(E)", "[!]", "(Europe)", "v1.1"), the word N-Gage, punctuation, case and accents; "&" is "and", Roman numerals are digits.
 */
const ROMAN: Record<string, string> = { i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10' };
export function catalogTokens(raw: string, fileName = false): string[] {
  let s = text(raw).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\.(zip|n-gage)$/i, '');
  if (fileName) s = s.replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}/g, ' ').replace(/\bv\d+(?:\.\d+)*\b/g, ' ');
  const words = s.replace(/&/g, ' and ').replace(/['\u2019`]/g, '').split(/[^a-z0-9]+/).filter(Boolean);
  const tokens = words.filter(w => w !== 'ngage' && w !== 'gage' && !(w === 'n' && words[words.indexOf(w) + 1] === 'gage'));
  return tokens.map((w, i) => (i > 0 && ROMAN[w] ? ROMAN[w]! : w));
}
const FILLER = new Set(['the', 'a', 'an', 'and', 'of', 'to', 'in']);
const coreOf = (tokens: string[]) => tokens.filter(t => !FILLER.has(t));

/**
 * The directory entry that a game belongs to, or null when there is none or it is not certain. Exact title first (so that
 * "Pathway to Glory" never becomes its sequel), then a title with the publisher's brand left out or with a few extra
 * words around it ("Ghost Recon - Jungle Storm" is "Tom Clancy's Ghost Recon: Jungle Storm"). Two candidates are never guessed between.
 */
export function matchAas(title: string, entries: CatalogEntry[]): CatalogEntry | null {
  const file = catalogTokens(title, true), fileKey = file.join('');
  if (!fileKey) return null;
  const exact = entries.filter(e => catalogTokens(e.title).join('') === fileKey);
  if (exact.length) return exact.length === 1 ? exact[0]! : null;
  const loose = entries.filter(e => coreOf(catalogTokens(e.title)).join('') === coreOf(file).join(''));
  if (loose.length) return loose.length === 1 ? loose[0]! : null;
  const fileSet = new Set(coreOf(file));
  if (fileSet.size < 2 || fileKey.length < 8) return null;
  const superset = entries.filter(e => { const t = coreOf(catalogTokens(e.title)); return t.length - fileSet.size <= 2 && t.length > fileSet.size && [...fileSet].every(w => t.includes(w)); });
  if (superset.length) return superset.length === 1 ? superset[0]! : null;
  const subset = entries.filter(e => { const t = coreOf(catalogTokens(e.title)); return t.length >= 2 && fileSet.size - t.length <= 2 && fileSet.size > t.length && t.every(w => fileSet.has(w)); });
  return subset.length === 1 ? subset[0]! : null;
}
export function parseAasDetails(html: string, entry: CatalogEntry): NgageInfo {
  let game: Record<string, any> = {};
  for (const script of html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { const value = JSON.parse(script[1]!); if (value['@type'] === 'VideoGame') game = value; } catch { /* an unrelated invalid block */ }
  }
  const field = (name: string) => text(new RegExp(`<tr>\\s*<td>${name}<\\/td>\\s*<td>([\\s\\S]*?)<\\/td>`, 'i').exec(html)?.[1] ?? '');
  const score = Number(game.aggregateRating?.ratingValue), max = Number(game.aggregateRating?.bestRating ?? 100);
  return { title: entry.title, sourceUrl: entry.url, attribution: 'All About Symbian', genre: entry.genre, publisher: field('Publisher') || entry.publisher, developer: field('Developer') || null, year: entry.year, released: field('Released') || null, multiplayer: field('Multiplayer') || null, productCode: field('Product code') || null, rating: Number.isFinite(score) && max > 0 ? Math.round(score / max * 100) : null, hasCover: false, fetchedAt: new Date().toISOString() };
}

/** What is known about a game from the directory index alone (no page was fetched): enough for genre, publisher and year. */
function indexInfo(entry: CatalogEntry, fetchedAt: string): NgageInfo {
  return { title: entry.title, sourceUrl: entry.url, attribution: 'All About Symbian', genre: entry.genre, publisher: entry.publisher, developer: null, year: entry.year, released: null, multiplayer: null, productCode: null, rating: null, hasCover: false, fetchedAt };
}

/**
 * Only fixed AAS pages/images are fetched. No page view contacts a third party.
 *
 * Recognition does not need the network: a snapshot of the directory (titles, genres, publishers, years) ships with MGO, so a
 * game is recognised and its genre filled in even when the server has no route to the internet. The live directory, the game pages and
 * the covers are fetched on top of that when they can be reached; a failure is reported (with the reason) and never removes anything.
 */
export class NgageCatalog {
  private entries: CatalogEntry[] = AAS_SNAPSHOT;
  private live = false;
  private info = new Map<string, NgageInfo>();
  private quick = new Map<string, { name: string; info: NgageInfo | null }>();
  private running: Promise<void> | null = null;
  private lastIndex = 0;
  private active = false;
  private pending = false;
  private abort = new AbortController();
  private error: string | null = null;
  readonly dir: string;
  constructor(private library: Library, dataDir: string, private fetcher: typeof fetch = fetch, private proxy = process.env.AAS_PROXY_URL ?? '') {
    this.dir = path.join(dataDir, 'aas'); mkdirSync(this.dir, { recursive: true });
    try {
      const saved = JSON.parse(readFileSync(path.join(this.dir, 'catalog.json'), 'utf8'));
      if (Array.isArray(saved.entries) && saved.entries.length) { this.entries = saved.entries; this.live = true; }
      this.lastIndex = saved.updatedAt ?? 0; this.info = new Map(saved.info);
    } catch { /* first refresh populates the cache */ }
  }
  private ngageGames() { return this.library.list().filter(g => g.platform === 'ngage'); }
  status() {
    const unmatched = this.ngageGames().filter(g => !this.lookup(g)).map(g => g.name).sort();
    return {
      running: !!this.running, entries: this.entries.length, matched: this.ngageGames().length - unmatched.length, unmatched,
      updatedAt: this.lastIndex ? new Date(this.lastIndex).toISOString() : null, error: this.error, sourceUrl: AAS_ORIGIN + AAS_INDEX,
      /** `live`: the directory was downloaded from the source; `snapshot`: the list that ships with MGO is used. */
      source: this.live ? 'live' as const : 'snapshot' as const, snapshotDate: AAS_SNAPSHOT_DATE,
      covers: this.info.size ? [...this.info.values()].filter(i => i.hasCover).length : 0,
    };
  }
  /** Fetched details if there are any, else what the directory index says. Null: not an N-Gage game of the directory. */
  private lookup(game: GameMeta): NgageInfo | null {
    if (game.platform !== 'ngage') return null;
    const full = this.info.get(game.groupKey); if (full) return full;
    const cached = this.quick.get(game.groupKey);
    if (cached && cached.name === game.name) return cached.info;
    const entry = matchAas(game.name, this.entries);
    const info = entry ? indexInfo(entry, this.lastIndex ? new Date(this.lastIndex).toISOString() : AAS_SNAPSHOT_DATE) : null;
    this.quick.set(game.groupKey, { name: game.name, info });
    if (info && isGenre(info.genre)) this.library.classes.setCurated(game.groupKey, info.genre, info.title);
    return info;
  }
  enrich(game: GameMeta): GameMeta { const info = this.lookup(game); return info ? { ...game, ngageInfo: info } : game; }
  cover(group: string): string | null { const file = path.join(this.dir, `${group}.img`); return /^[a-f0-9]{12}$/.test(group) && existsSync(file) ? file : null; }
  private async request(url: string, limit: number) {
    // a redirect is followed by hand, and every address on the way has to be a fixed AAS page or image again
    let target = url, response: Response | undefined;
    for (let hop = 0; hop < 4; hop++) {
      const allowed = new URL(target, AAS_ORIGIN);
      if (allowed.origin !== AAS_ORIGIN || !/^\/(n-gage-games\/original\/(?:item\/[a-z0-9-]+\.php)?|images\/ngage\/[\w/.-]+)$/.test(allowed.pathname)) throw new Error('Unsupported catalog URL');
      const endpoint = this.proxy ? this.proxy.replace(/\/$/, '') + allowed.pathname : allowed.href;
      try { response = await this.fetcher(endpoint, { signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(15000)]), redirect: 'manual', headers: { 'user-agent': 'MGO metadata/1.0' } }); }
      catch (e) { throw new CatalogUnreachable(this.proxy ? `the metadata gateway ${this.proxy} does not answer` : 'allaboutsymbian.com cannot be reached from this server (no internet access?)', (e as Error).message); }
      const next = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null;
      if (!next) break;
      target = new URL(next, allowed).href; response = undefined;
    }
    if (!response) throw new Error('All About Symbian: too many redirects');
    if (!response.ok) throw new Error(`All About Symbian: HTTP ${response.status}`);
    const reader = response.body!.getReader(); let size = 0; const chunks: Uint8Array[] = [];
    try { for (;;) { const r = await reader.read(); if (r.done) break; size += r.value.length; if (size > limit) throw new Error('Catalog response is too large'); chunks.push(r.value); } }
    finally { await reader.cancel().catch(() => undefined); }
    return { bytes: Buffer.concat(chunks), type: response.headers.get('content-type') ?? '' };
  }
  start() { this.active = true; this.recognise(); if (this.ngageGames().length) void this.refresh(); }
  schedule() { this.recognise(); if (this.running) { this.pending = true; return; } if (this.active) void this.refresh(); }
  stop() { this.active = false; this.abort.abort(); }
  async idle() { await this.running; }
  /** Recognition from the index alone (no network): fills in the genre of every game it knows. */
  private recognise() { for (const g of this.ngageGames()) this.lookup(g); }
  refresh(force = false): Promise<void> {
    if (this.running) return this.running;
    this.running = this.update(force).catch(e => { this.error = e.message; }).finally(() => { this.running = null; if (this.pending && this.active) { this.pending = false; this.schedule(); } }); return this.running;
  }
  private async update(force: boolean) {
    this.error = null;
    this.quick.clear(); this.recognise();
    try {
      if (force || Date.now() - this.lastIndex > TTL || !this.live) { this.entries = parseAasIndex((await this.request(AAS_ORIGIN + AAS_INDEX, 2 * 1024 * 1024)).bytes.toString('utf8')); this.live = true; this.lastIndex = Date.now(); this.quick.clear(); }
      let failures = 0;
      for (const game of this.ngageGames()) {
        const old = this.info.get(game.groupKey);
        if (!force && old && Date.now() - Date.parse(old.fetchedAt) < TTL) continue;
        const match = matchAas(game.name, this.entries); if (!match) continue;
        try {
          const detail = (await this.request(match.url, 2 * 1024 * 1024)).bytes.toString('utf8');
          const info = parseAasDetails(detail, match);
          const full = /"image"\s*:\s*"(https:\/\/allaboutsymbian\.com\/images\/ngage\/[^"]+)"/.exec(detail)?.[1] ?? match.cover;
          if (full) try {
            const image = await this.request(full, 4 * 1024 * 1024);
            const b = image.bytes;
            if (!((b[0] === 255 && b[1] === 216 && b[2] === 255) || b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || (b.toString('ascii',0,4) === 'RIFF' && b.toString('ascii',8,12) === 'WEBP'))) throw new Error('Invalid cover image');
            const dest = path.join(this.dir, `${game.groupKey}.img`); writeFileSync(dest + '.tmp', b); renameSync(dest + '.tmp', dest); info.hasCover = true;
          } catch (e) { if (e instanceof CatalogUnreachable) throw e; info.hasCover = !!this.cover(game.groupKey); }
          this.info.set(game.groupKey, info); failures = 0;
          if (isGenre(info.genre)) this.library.classes.setCurated(game.groupKey, info.genre, info.title);
        } catch (e) {
          if (e instanceof CatalogUnreachable) throw e;
          this.error = `${game.name}: ${(e as Error).message}`; if (++failures >= 3) break; // a page that fails does not stop the others
        }
      }
    } catch (e) {
      this.error = e instanceof CatalogUnreachable
        ? `${e.message}. Games are still recognised from the list that ships with MGO (genre, publisher, year); covers and details need access to allaboutsymbian.com. In Docker the metadata gateway (AAS_PROXY_URL) provides it. (${e.detail})`
        : (e as Error).message;
    }
    const dest = path.join(this.dir, 'catalog.json');
    writeFileSync(dest + '.tmp', JSON.stringify({ entries: this.live ? this.entries : [], updatedAt: this.lastIndex, info: [...this.info] })); renameSync(dest + '.tmp', dest);
  }
}

class CatalogUnreachable extends Error { constructor(message: string, readonly detail: string) { super(message); } }
