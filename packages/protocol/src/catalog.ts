import type { CatalogEntry, CatalogFile } from './index.js';

/**
 * Brings a catalog file to the one shape the server works with. Two formats are understood:
 *  - JGO's own `{ "schema": 1, "games": [...] }`;
 *  - the curator's `{ "schema": "jgo-curator-manifest-v1", "items": [...] }` (sha256, title, genre, genre_confidence, ...).
 * Only the fields JGO uses are copied (hash, title, genre, tags, confidence). Everything else — above all the paths of the
 * files on the collector's disk — is dropped here, in the browser as well as on the server, and never reaches the API.
 * Values are passed on as they are; each entry is checked one by one later, so one bad entry does not spoil a file.
 */
export const CURATOR_SCHEMA = 'jgo-curator-manifest-v1';

export function normalizeCatalog(body: unknown): CatalogFile {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new Error('The catalog must be a JSON object');
  const o = body as Record<string, unknown>;
  const generated = typeof o.generated === 'string' ? { generated: o.generated.slice(0, 40) } : typeof o.generated_by === 'string' ? { generated: o.generated_by.slice(0, 40) } : {};
  const pick = (e: unknown, fields: Record<string, string>): CatalogEntry => {
    const r = typeof e === 'object' && e !== null ? (e as Record<string, unknown>) : {};
    const out: Record<string, unknown> = {};
    for (const [from, to] of Object.entries(fields)) if (r[from] !== undefined) out[to] = r[from];
    return out as unknown as CatalogEntry;
  };
  if (o.schema === 1) {
    if (!Array.isArray(o.games)) throw new Error('The catalog needs a "games" list');
    return { schema: 1, ...generated, games: o.games.map((e) => pick(e, { sha256: 'sha256', title: 'title', genre: 'genre', genres: 'genres', tags: 'tags', confidence: 'confidence' })) };
  }
  if (o.schema === CURATOR_SCHEMA) {
    if (!Array.isArray(o.items)) throw new Error('The curator manifest needs an "items" list');
    return { schema: 1, ...generated, games: o.items.map((e) => pick(e, { sha256: 'sha256', title: 'title', genre: 'genre', genre_confidence: 'confidence' })) };
  }
  throw new Error(`Unsupported catalog schema (expected 1 or "${CURATOR_SCHEMA}")`);
}
