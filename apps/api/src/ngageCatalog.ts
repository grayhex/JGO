import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { isGenre, type GameMeta, type NgageInfo } from '@mgo/protocol';
import type { Library } from './library.js';

export const AAS_ORIGIN = 'https://allaboutsymbian.com';
export const AAS_INDEX = '/n-gage-games/original/';
const TTL = 30 * 86400_000;
const text = (s: string) => s.replace(/<[^>]*>/g, '').replace(/&#(?:x([\da-f]+)|(\d+));/gi, (_, h, d) => String.fromCodePoint(parseInt(h || d, h ? 16 : 10))).replace(/&(amp|quot|apos|lt|gt|nbsp|middot);/g, (_, n) => ({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' ',middot:'·'})[n as string] ?? '').trim();
export const catalogTitle = (s: string) => text(s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\.(zip|n-gage)$/i, '').replace(/\[[^\]]*\]|\([^)]*(?:ngage|n-gage|crack|eng|multi)[^)]*\)/gi, '').replace(/[^a-z0-9]/g, '');
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
export function matchAas(title: string, entries: CatalogEntry[]): CatalogEntry | null {
  const key = catalogTitle(title), matches = entries.filter(e => catalogTitle(e.title) === key);
  return matches.length === 1 ? matches[0]! : null;
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

/** Only fixed AAS pages/images are fetched. No page view contacts a third party. */
export class NgageCatalog {
  private entries: CatalogEntry[] = [];
  private info = new Map<string, NgageInfo>();
  private running: Promise<void> | null = null;
  private lastIndex = 0;
  private active = false;
  private pending = false;
  private abort = new AbortController();
  private error: string | null = null;
  readonly dir: string;
  constructor(private library: Library, dataDir: string, private fetcher: typeof fetch = fetch, private proxy = process.env.AAS_PROXY_URL ?? '') {
    this.dir = path.join(dataDir, 'aas'); mkdirSync(this.dir, { recursive: true });
    try { const saved = JSON.parse(readFileSync(path.join(this.dir, 'catalog.json'), 'utf8')); this.entries = saved.entries; this.lastIndex = saved.updatedAt; this.info = new Map(saved.info); } catch { /* first refresh populates the cache */ }
  }
  status() { return { running: !!this.running, entries: this.entries.length, matched: this.info.size, updatedAt: this.lastIndex ? new Date(this.lastIndex).toISOString() : null, error: this.error, sourceUrl: AAS_ORIGIN + AAS_INDEX }; }
  enrich(game: GameMeta): GameMeta { const info = game.platform === 'ngage' ? this.info.get(game.groupKey) : null; return info ? { ...game, ngageInfo: info } : game; }
  cover(group: string): string | null { const file = path.join(this.dir, `${group}.img`); return /^[a-f0-9]{12}$/.test(group) && existsSync(file) ? file : null; }
  private async request(url: string, limit: number) {
    const allowed = new URL(url, AAS_ORIGIN);
    if (allowed.origin !== AAS_ORIGIN || !/^\/(n-gage-games\/original\/(?:item\/[a-z0-9-]+\.php)?|images\/ngage\/[\w/.-]+)$/.test(allowed.pathname)) throw new Error('Unsupported catalog URL');
    const endpoint = this.proxy ? this.proxy.replace(/\/$/, '') + allowed.pathname : allowed.href;
    const response = await this.fetcher(endpoint, { signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(15000)]), redirect: 'error', headers: { 'user-agent': 'MGO metadata/1.0' } });
    if (!response.ok) throw new Error(`All About Symbian: HTTP ${response.status}`);
    const reader = response.body!.getReader(); let size = 0; const chunks: Uint8Array[] = [];
    try { for (;;) { const r = await reader.read(); if (r.done) break; size += r.value.length; if (size > limit) throw new Error('Catalog response is too large'); chunks.push(r.value); } }
    finally { await reader.cancel().catch(() => undefined); }
    return { bytes: Buffer.concat(chunks), type: response.headers.get('content-type') ?? '' };
  }
  start() { this.active = true; if (this.library.list().some(g => g.platform === 'ngage')) void this.refresh(); }
  schedule() { if (this.running) { this.pending = true; return; } if (this.active) void this.refresh(); }
  stop() { this.active = false; this.abort.abort(); }
  async idle() { await this.running; }
  refresh(force = false): Promise<void> {
    if (this.running) return this.running;
    this.running = this.update(force).catch(e => { this.error = e.message; }).finally(() => { this.running = null; if (this.pending && this.active) { this.pending = false; this.schedule(); } }); return this.running;
  }
  private async update(force: boolean) {
    this.error = null;
    try {
      if (force || Date.now() - this.lastIndex > TTL || !this.entries.length) { this.entries = parseAasIndex((await this.request(AAS_ORIGIN + AAS_INDEX, 2 * 1024 * 1024)).bytes.toString('utf8')); this.lastIndex = Date.now(); }
      for (const game of this.library.list().filter(g => g.platform === 'ngage')) {
        const old = this.info.get(game.groupKey);
        if (!force && old && Date.now() - Date.parse(old.fetchedAt) < TTL) continue;
        const match = matchAas(game.name, this.entries); if (!match) continue;
        const detail = (await this.request(match.url, 2 * 1024 * 1024)).bytes.toString('utf8');
        const info = parseAasDetails(detail, match);
        const full = /"image"\s*:\s*"(https:\/\/allaboutsymbian\.com\/images\/ngage\/[^"]+)"/.exec(detail)?.[1] ?? match.cover;
        if (full) try {
          const image = await this.request(full, 4 * 1024 * 1024);
          const b = image.bytes;
          if (!((b[0] === 255 && b[1] === 216 && b[2] === 255) || b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || (b.toString('ascii',0,4) === 'RIFF' && b.toString('ascii',8,12) === 'WEBP'))) throw new Error('Invalid cover image');
          const dest = path.join(this.dir, `${game.groupKey}.img`); writeFileSync(dest + '.tmp', b); renameSync(dest + '.tmp', dest); info.hasCover = true;
        } catch { info.hasCover = !!this.cover(game.groupKey); }
        this.info.set(game.groupKey, info);
        if (isGenre(info.genre)) this.library.classes.setCurated(game.groupKey, info.genre, info.title);
      }
    } catch (e) { this.error = (e as Error).message; }
    const dest = path.join(this.dir, 'catalog.json'); writeFileSync(dest + '.tmp', JSON.stringify({ entries: this.entries, updatedAt: this.lastIndex, info: [...this.info] })); renameSync(dest + '.tmp', dest);
  }
}
