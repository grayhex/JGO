import { GENRES, type GameMeta } from '@j2me-web/protocol';

/** How the library is ordered and which games it shows besides the genre and the search. A "game" here is a group: all versions of one title. */
export type SortKey = 'name' | 'name-desc' | 'added' | 'played' | 'time' | 'genre';
export type StatusFilter = 'all' | 'unplayed' | 'played' | 'gone' | 'unconfirmed';

export const SORT_KEYS: SortKey[] = ['name', 'name-desc', 'added', 'played', 'time', 'genre'];
export const STATUS_FILTERS: StatusFilter[] = ['all', 'unplayed', 'played', 'gone', 'unconfirmed'];

export const totalPlaySeconds = (vs: GameMeta[]): number => vs.reduce((n, v) => n + (v.playSeconds ?? 0), 0);
const lastPlayed = (vs: GameMeta[]): string => vs.reduce((m, v) => (v.lastPlayedAt && v.lastPlayedAt > m ? v.lastPlayedAt : m), '');
const addedAt = (vs: GameMeta[]): string => vs.reduce((m, v) => (v.createdAt > m ? v.createdAt : m), '');
const genreRank = (vs: GameMeta[]): number => {
  const g = vs[0]?.classification?.primaryGenre;
  const i = g ? GENRES.indexOf(g) : -1;
  return i < 0 ? GENRES.length : i;
};

export function matchesStatus(vs: GameMeta[], f: StatusFilter): boolean {
  switch (f) {
    case 'all': return true;
    case 'unplayed': return totalPlaySeconds(vs) === 0 && !vs.some((v) => v.lastPlayedAt);
    case 'played': return totalPlaySeconds(vs) > 0 || vs.some((v) => !!v.lastPlayedAt);
    case 'gone': return vs.every((v) => v.sourceMissing === true);
    case 'unconfirmed': { const c = vs[0]?.classification; return !c || c.unconfirmed; }
  }
}

const byName = (a: GameMeta[], b: GameMeta[]) => (a[0]?.name ?? '').localeCompare(b[0]?.name ?? '', undefined, { sensitivity: 'base', numeric: true });

export function compareGroups(a: GameMeta[], b: GameMeta[], key: SortKey): number {
  switch (key) {
    case 'name': return byName(a, b);
    case 'name-desc': return byName(b, a);
    case 'added': return addedAt(b).localeCompare(addedAt(a)) || byName(a, b);
    case 'played': return lastPlayed(b).localeCompare(lastPlayed(a)) || byName(a, b);
    case 'time': return totalPlaySeconds(b) - totalPlaySeconds(a) || byName(a, b);
    case 'genre': return genreRank(a) - genreRank(b) || byName(a, b);
  }
}
