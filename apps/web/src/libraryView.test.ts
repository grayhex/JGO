import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GameMeta } from '@j2me-web/protocol';
import { compareGroups, matchesStatus } from './libraryView';

let n = 0;
const game = (name: string, over: Partial<GameMeta> = {}): GameMeta[] => [{
  id: String(++n).padStart(16, '0'), sha256: '', name, vendor: 'v', version: '', midlets: [], classVersion: 47, sizeBytes: 1, hasIcon: false, hasJad: false,
  favorite: false, createdAt: '2026-01-01T00:00:00Z', lastPlayedAt: null, groupKey: String(n), settings: {} as never, warnings: [], ...over,
}];
const cls = (primaryGenre: string, unconfirmed = false) => ({ primaryGenre, genres: [primaryGenre], tags: [], canonicalTitle: null, source: 'curator', confidence: 'curated', locked: false, unconfirmed }) as never;

describe('library sorting and filters', () => {
  const a = game('Asphalt', { createdAt: '2026-03-01T00:00:00Z', playSeconds: 600, lastPlayedAt: '2026-04-01T00:00:00Z', classification: cls('Racing') });
  const b = game('Block Breaker', { createdAt: '2026-02-01T00:00:00Z', playSeconds: 7200, lastPlayedAt: '2026-05-01T00:00:00Z', classification: cls('Puzzle') });
  const c = game('Crazy Taxi', { createdAt: '2026-04-01T00:00:00Z', sourceMissing: true });
  const names = (key: Parameters<typeof compareGroups>[2]) => [a, b, c].sort((x, y) => compareGroups(x, y, key)).map((g) => g[0]!.name);

  it('orders by name, date added, last played, time played and genre', () => {
    assert.deepEqual(names('name'), ['Asphalt', 'Block Breaker', 'Crazy Taxi']);
    assert.deepEqual(names('name-desc'), ['Crazy Taxi', 'Block Breaker', 'Asphalt']);
    assert.deepEqual(names('added'), ['Crazy Taxi', 'Asphalt', 'Block Breaker']);
    assert.deepEqual(names('played'), ['Block Breaker', 'Asphalt', 'Crazy Taxi']);
    assert.deepEqual(names('time'), ['Block Breaker', 'Asphalt', 'Crazy Taxi']);
    assert.deepEqual(names('genre'), ['Block Breaker', 'Asphalt', 'Crazy Taxi'], 'Puzzle comes before Racing in the genre list; games without a genre are last');
  });

  it('sorts numbers in titles naturally', () => {
    const list = [game('Asphalt 10'), game('Asphalt 2'), game('Asphalt 3')];
    assert.deepEqual(list.sort((x, y) => compareGroups(x, y, 'name')).map((g) => g[0]!.name), ['Asphalt 2', 'Asphalt 3', 'Asphalt 10']);
  });

  it('filters by what happened to the game', () => {
    assert.deepEqual([a, b, c].filter((g) => matchesStatus(g, 'played')).map((g) => g[0]!.name), ['Asphalt', 'Block Breaker']);
    assert.deepEqual([a, b, c].filter((g) => matchesStatus(g, 'unplayed')).map((g) => g[0]!.name), ['Crazy Taxi']);
    assert.deepEqual([a, b, c].filter((g) => matchesStatus(g, 'gone')).map((g) => g[0]!.name), ['Crazy Taxi']);
    assert.deepEqual([a, b, c].filter((g) => matchesStatus(g, 'unconfirmed')).map((g) => g[0]!.name), ['Crazy Taxi'], 'no genre = not confirmed');
    assert.equal(matchesStatus(game('Other One', { classification: cls('Other', true) }), 'unconfirmed'), true);
    assert.equal(matchesStatus(a, 'all'), true);
  });

  it('a game with several versions is gone only when every version is', () => {
    const two = [...game('Twin', { sourceMissing: true }), ...game('Twin', { sourceMissing: false })];
    assert.equal(matchesStatus(two, 'gone'), false);
  });
});
