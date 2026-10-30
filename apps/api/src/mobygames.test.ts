import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { FakeMoby, PNG } from './dev/fakeMoby.js';
import { Library } from './library.js';
import { MetadataService } from './metadata.js';
import { cleanText, decideMatch, MobyClient, MobyError, normalizeGame, normalizeTitle, titleSimilarity } from './mobygames.js';
import { makeJar, tmpDir } from './dev/testing.js';

const noSleep = async () => undefined;

describe('title matching', () => {
  it('normalises file-ish names', () => {
    assert.equal(normalizeTitle('Prince_of_Persia (Gameloft) v1.2'), 'prince of persia');
    assert.equal(normalizeTitle('The Sims 3 J2ME'), 'sims 3');
    assert.equal(normalizeTitle('Pokémon & Friends'), 'pokemon and friends');
  });
  it('scores identical > reordered > similar > different', () => {
    assert.equal(titleSimilarity('Asphalt 4', 'asphalt 4: elite racing'.split(':')[0]!), 1);
    assert.ok(titleSimilarity('Bounce Tales', 'Tales Bounce') >= 0.97);
    assert.ok(titleSimilarity('Prince of Persia', 'Prince of Persia: Warrior Within') > 0.6);
    assert.ok(titleSimilarity('Asphalt 4', 'Brain Challenge') < 0.4);
  });
  it('decides: clear J2ME match is automatic, rivals and other platforms need a person', () => {
    const g = (id: number, title: string, plat: number): any => ({ mobyId: id, title, platforms: [{ id: plat, name: plat === 64 ? 'J2ME' : 'PC', year: 2007 }], genres: [], publishers: [], developers: [], description: null, year: 2007, score: null, criticScore: null, playerScore: null, mobyUrl: null, officialUrl: null, coverUrl: null, screenshotUrls: [], thumbUrl: null });
    assert.equal(decideMatch('Asphalt 4', [g(1, 'Asphalt 4', 64)], 64, true).kind, 'matched');
    assert.equal(decideMatch('Asphalt 4', [g(1, 'Asphalt 4', 64), g(2, 'Asphalt 4', 64)], 64, true).kind, 'ambiguous');
    assert.equal(decideMatch('Asphalt 4', [g(3, 'Asphalt 4', 5)], 64, false).kind, 'ambiguous');
    assert.equal(decideMatch('Asphalt 4', [g(4, 'Something else entirely', 64)], 64, true).kind, 'unmatched');
    assert.equal(decideMatch('Asphalt 4', [g(5, 'Asphalt 4: Elite Racing', 64)], 64, true).kind, 'ambiguous', 'a similar-but-not-identical title is not trusted');
  });
  it('cleans markup out of descriptions', () => {
    assert.equal(cleanText('<p>Race &amp; win</p><br/>now<script>x</script>'), 'Race & win\n\nnowx');
  });
  it('tolerates a plan that returns fewer fields and different shapes', () => {
    const n = normalizeGame({ game_id: 7, title: 'X', publishers: ['A', { name: 'B' }, { company_name: 'C' }], platforms: [{ platform_id: 64, name: 'J2ME', release_date: '2005-03-01' }] }, 64)!;
    assert.deepEqual(n.publishers, ['A', 'B', 'C']);
    assert.equal(n.year, 2005);
    assert.equal(n.coverUrl, null);
    assert.equal(normalizeGame({ title: 'no id' }, 64), null);
  });
});

describe('MobyGames client', () => {
  let fake: FakeMoby;
  before(async () => {
    fake = await new FakeMoby().start();
  });
  after(() => fake.stop());
  const mk = (key: string | null = fake.validKey, over: object = {}) => new MobyClient(() => key, { base: fake.base, minIntervalMs: 0, sleep: noSleep, ...over });

  it('sends the key as api_key, resolves the J2ME platform and searches with it first', async () => {
    fake.games = [{ game_id: 11, title: 'Bounce Tales', platforms: [{ platform_id: 64, name: 'J2ME', release_date: '2008-01-01' }] }];
    fake.requests.length = 0;
    const r = await mk().search('Bounce Tales');
    assert.equal(r.platformFiltered, true);
    assert.equal(r.games[0]!.title, 'Bounce Tales');
    assert.equal(r.games[0]!.year, 2008);
    assert.deepEqual(fake.requests.map((x) => x.path), ['/v2/platforms', '/v2/games']);
    const q = fake.requests[1]!.query;
    assert.equal(q.get('platform'), '64');
    assert.equal(q.get('fuzzy'), 'true');
    assert.equal(q.get('api_key'), fake.validKey);
  });

  it('falls back to all platforms when J2ME has no hit', async () => {
    fake.games = [{ game_id: 12, title: 'Sudoku', platforms: [{ platform_id: 5, name: 'Windows' }] }];
    const r = await mk().search('Sudoku');
    assert.equal(r.platformFiltered, false);
    assert.equal(r.games.length, 1);
  });

  it('a wrong key is an invalid_key error that does not contain the key', async () => {
    const c = mk('moby_wrong_key_999');
    await assert.rejects(c.test(), (e: unknown) => e instanceof MobyError && e.code === 'invalid_key' && !e.message.includes('moby_wrong'));
    await assert.rejects(mk(null).test(), (e: unknown) => e instanceof MobyError && e.code === 'invalid_key');
  });

  it('waits out a 429 using Retry-After, then succeeds; gives up after repeated 429s', async () => {
    const waits: number[] = [];
    fake.failWith = { status: 429, retryAfter: 7, times: 2 };
    fake.games = [{ game_id: 11, title: 'Bounce Tales', platforms: [{ platform_id: 64, name: 'J2ME' }] }];
    const c = mk(fake.validKey, { sleep: async (ms: number) => { waits.push(ms); } });
    assert.equal((await c.search('Bounce Tales')).games.length, 1);
    assert.deepEqual(waits.filter((w) => w >= 1000), [7000, 7000]);
    fake.failWith = { status: 429, times: 99 };
    await assert.rejects(mk().search('Bounce Tales'), (e: unknown) => e instanceof MobyError && e.code === 'rate_limited');
    fake.failWith = null;
  });

  it('spaces requests out', async () => {
    let t = 0;
    const waits: number[] = [];
    const c = new MobyClient(() => fake.validKey, { base: fake.base, minIntervalMs: 1000, now: () => t, sleep: async (ms) => { waits.push(ms); t += ms; } });
    await c.j2mePlatform();
    await c.search('Bounce Tales');
    assert.ok(waits.length >= 1 && waits.every((w) => w <= 1000));
  });

  it('retries without the optional score fields when the plan refuses them', async () => {
    fake.rejectExtendedInclude = true;
    fake.games = [{ game_id: 11, title: 'Bounce Tales', platforms: [{ platform_id: 64, name: 'J2ME' }] }];
    const c = mk();
    assert.equal((await c.search('Bounce Tales')).games.length, 1);
    fake.requests.length = 0;
    await c.search('Bounce Tales');
    assert.ok(fake.requests.every((r) => !(r.query.get('include') ?? '').includes('critic_score')), 'remembers that the plan has no extended fields');
    fake.rejectExtendedInclude = false;
  });

  it('downloads only images, only from MobyGames hosts, and checks the bytes', async () => {
    const c = mk();
    const origin = fake.base.replace('/v2', '');
    const ok = await c.fetchImage(`${origin}/img/x.png`);
    assert.equal(ok.ext, 'png');
    assert.deepEqual(ok.bytes, PNG);
    await assert.rejects(c.fetchImage(`${origin}/img/bad.png`), /not a JPEG/);
    await assert.rejects(c.fetchImage(`${origin}/img/redirect.png`), /not MobyGames/);
    await assert.rejects(c.fetchImage('https://example.com/game.jar'), /not MobyGames/);
    await assert.rejects(c.fetchImage('file:///etc/passwd'), /not MobyGames|Invalid/);
    const prod = new MobyClient(() => 'moby_prodkey_0001', { fetch: (async () => { throw new Error('must not be called'); }) as typeof fetch });
    await assert.rejects(prod.fetchImage('http://cdn.mobygames.com/x.jpg'), /not MobyGames/, 'plain http is refused with the real base');
    await assert.rejects(prod.fetchImage(`${origin}/img/x.png`), /not MobyGames/);
    await assert.rejects(prod.fetchImage('https://mobygames.com.evil.example/x.jpg'), /not MobyGames/);
  });
});

describe('metadata service', () => {
  let fake: FakeMoby;
  before(async () => {
    fake = await new FakeMoby().start();
  });
  after(() => fake.stop());

  function setup() {
    const dir = tmpDir('jgo-meta-');
    const lib = new Library(dir);
    const client = new MobyClient(() => fake.validKey, { base: fake.base, minIntervalMs: 0, sleep: noSleep });
    const svc = new MetadataService(lib, dir, () => client, () => true);
    const add = (name: string, vendor = 'V', version = '1.0') => lib.add(makeJar(name, { vendor, version }), null, 1e9).game;
    return { dir, lib, svc, add, client };
  }

  it('matches, stores data + images locally, and serves nothing from the network afterwards', async () => {
    fake.games = [{ game_id: 11, title: 'Bounce Tales', platforms: [{ platform_id: 64, name: 'J2ME', release_date: '2008-05-01' }], genres: [{ name: 'Platform' }], description: '<p>Hop &amp; roll</p>', moby_score: 7.4 }];
    const t = setup();
    const g = t.add('Bounce Tales');
    t.svc.start('missing');
    await t.svc.idle();
    assert.equal(t.svc.job().state, 'done');
    const i = t.svc.info(g.groupKey);
    assert.deepEqual([i.status, i.title, i.year, i.score, i.genres, i.publishers, i.description], ['matched', 'Bounce Tales', 2008, 7.4, ['Platform'], ['Gameloft'], 'Hop & roll']);
    assert.match(i.attribution, /MobyGames/);
    assert.equal(i.mobyUrl, 'https://www.mobygames.com/game/11/');
    assert.equal(i.hasCover, true);
    assert.equal(i.screenshots, 2);
    assert.deepEqual(readFileSync(t.svc.imagePath(g.groupKey, 'cover')!.file), PNG);
    assert.ok(t.svc.imagePath(g.groupKey, 'shot-2'));
    assert.equal(t.svc.imagePath(g.groupKey, '../../etc/passwd'), null);
    assert.equal(t.lib.list()[0]!.info?.status, 'matched');
    const before = fake.requests.length;
    t.svc.start('missing'); // nothing is due any more
    await t.svc.idle();
    assert.equal(fake.requests.length, before, 'a second run makes no API call');
  });

  it('versions of one game share the match', async () => {
    fake.games = [{ game_id: 11, title: 'Bounce Tales', platforms: [{ platform_id: 64, name: 'J2ME' }] }];
    const t = setup();
    const a = t.add('Bounce Tales', 'V', '1.0');
    const b = t.add('Bounce Tales', 'V', '2.0');
    assert.equal(a.groupKey, b.groupKey);
    t.svc.start('missing');
    await t.svc.idle();
    assert.equal(t.svc.job().total, 1);
    assert.deepEqual(t.lib.list().map((g) => g.info?.status), ['matched', 'matched']);
  });

  it('ambiguous results wait for a manual choice; the choice needs no further API call and sticks', async () => {
    fake.games = [
      { game_id: 21, title: 'Snake', platforms: [{ platform_id: 64, name: 'J2ME', release_date: '2003-01-01' }] },
      { game_id: 22, title: 'Snake', platforms: [{ platform_id: 64, name: 'J2ME', release_date: '2006-01-01' }] },
    ];
    const t = setup();
    const g = t.add('Snake');
    t.svc.start('missing');
    await t.svc.idle();
    assert.equal(t.svc.job().ambiguous, 1);
    const i = t.svc.info(g.groupKey);
    assert.equal(i.status, 'ambiguous');
    assert.deepEqual(i.candidates.map((c) => c.mobyId).sort(), [21, 22]);
    assert.equal(t.svc.needsReview().length, 1);
    const n = fake.requests.length;
    const chosen = await t.svc.choose(g.groupKey, 22);
    assert.equal(chosen.status, 'manual');
    assert.equal(chosen.year, 2006);
    assert.equal(chosen.hasCover, true);
    assert.ok(fake.requests.length === n, 'candidate data was kept, so no second lookup');
    t.svc.start('all');
    await t.svc.idle();
    assert.equal(t.svc.info(g.groupKey).mobyId, 22, 'a manual choice is not overwritten by a refresh');
    assert.equal(t.svc.needsReview().length, 0);
  });

  it('manual search with free text, unlink, and clear', async () => {
    fake.games = [{ game_id: 31, title: 'Zuma Deluxe', platforms: [{ platform_id: 5, name: 'Windows' }] }];
    const t = setup();
    const g = t.add('zum');
    const s = await t.svc.search(g.groupKey, 'Zuma');
    assert.equal(s.status, 'ambiguous');
    assert.equal(s.candidates[0]!.j2me, false);
    await t.svc.choose(g.groupKey, 31);
    assert.equal(t.svc.info(g.groupKey).status, 'manual');
    const u = t.svc.unlink(g.groupKey);
    assert.equal(u.status, 'none');
    assert.equal(u.hasCover, false);
    t.svc.start('all');
    await t.svc.idle();
    assert.equal(t.svc.job().total, 0, 'an unlinked game is not matched again by itself');
    await t.svc.choose(g.groupKey, 31);
    t.svc.clear();
    assert.equal(t.svc.info(g.groupKey).status, 'none');
    assert.ok(!existsSync(t.svc.dir));
  });

  it('unmatched titles are recorded and retried only on request', async () => {
    fake.games = [];
    const t = setup();
    const g = t.add('Totally Unknown Game');
    t.svc.start('missing');
    await t.svc.idle();
    assert.equal(t.svc.info(g.groupKey).status, 'unmatched');
    t.svc.start('missing');
    await t.svc.idle();
    assert.equal(t.svc.job().total, 0);
    fake.games = [{ game_id: 41, title: 'Totally Unknown Game', platforms: [{ platform_id: 64, name: 'J2ME' }] }];
    t.svc.start('retry');
    await t.svc.idle();
    assert.equal(t.svc.info(g.groupKey).status, 'matched');
  });

  it('a bad key stops the job with an error instead of marking every game as failed', async () => {
    const t = setup();
    t.add('A');
    t.add('B');
    const bad = new MobyClient(() => 'moby_wrong_key_999', { base: fake.base, minIntervalMs: 0, sleep: noSleep });
    const svc = new MetadataService(t.lib, t.dir, () => bad, () => true);
    svc.start('missing');
    await svc.idle();
    assert.equal(svc.job().state, 'failed');
    assert.match(svc.job().error ?? '', /rejected the API key/);
    assert.equal(svc.job().failed, 0);
    assert.equal(svc.stats().matched + svc.stats().unmatched, 0);
  });

  it('refuses to start without a key', () => {
    const t = setup();
    const svc = new MetadataService(t.lib, t.dir, () => t.client, () => false);
    assert.throws(() => svc.start('missing'), /API key/);
  });
});

void readdirSync; void path;
