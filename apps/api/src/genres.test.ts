import assert from 'node:assert/strict';
import { copyFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createHash } from 'node:crypto';
import { FakeMoby } from './dev/fakeMoby.js';
import { Library } from './library.js';
import { buildApp, type App } from './server.js';
import { makeJar, testConfig, tmpDir } from './dev/testing.js';

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

describe('genres: classifications by game, a catalog imported by SHA-256', () => {
  let app: App;
  let fake: FakeMoby;
  const jars = {
    race1: makeJar('Rally', { vendor: 'ACME', version: '1.0' }),
    race2: makeJar('Rally', { vendor: 'ACME', version: '2.0' }), // another build of the same game (same group)
    puzzle: makeJar('Blocks', { vendor: 'ACME' }),
    other: makeJar('Mystery', { vendor: 'ACME' }),
    nasty: makeJar('<img src=x onerror=alert(1)>', { vendor: 'ACME' }),
  };
  const ids: Record<string, string> = {};
  const group: Record<string, string> = {};

  before(async () => {
    fake = await new FakeMoby().start();
    process.env.MOBYGAMES_API_BASE = fake.base;
    process.env.MOBYGAMES_MIN_INTERVAL_MS = '0';
    app = await buildApp(testConfig({ roots: [], authToken: null }));
    for (const [k, jar] of Object.entries(jars)) {
      const { game } = app.library.add(jar, null, 1 << 30);
      ids[k] = game.id;
      group[k] = game.groupKey;
    }
  });
  after(async () => {
    await app.close();
    await fake.stop();
    delete process.env.MOBYGAMES_API_BASE;
    delete process.env.MOBYGAMES_MIN_INTERVAL_MS;
  });

  const call = async (method: string, url: string, body?: unknown, raw?: string) => {
    const res = await app.fastify.inject({
      method: method as 'GET', url,
      headers: body !== undefined || raw !== undefined ? { 'content-type': 'application/json' } : {},
      ...(raw !== undefined ? { payload: raw } : body !== undefined ? { payload: JSON.stringify(body) } : {}),
    });
    let json: any = null;
    try { json = res.json(); } catch { /* not JSON */ }
    return { status: res.statusCode, json, text: res.body };
  };
  const catalog = (games: object[]) => ({ schema: 1, games });
  const genreOf = (k: string) => (app.library.list().find((g) => g.id === ids[k]) as any)?.classification;

  it('the two builds of one game are one group', () => {
    assert.equal(group.race1, group.race2);
    assert.notEqual(group.race1, group.puzzle);
  });

  it('a preview changes nothing and tells apart what an import would do', async () => {
    const body = catalog([
      { sha256: sha(jars.race1), title: 'Rally Champion', genre: 'Racing', tags: ['3D', 'cars'] },
      { sha256: sha(jars.puzzle), title: 'Blocks', genre: 'Puzzle' },
      { sha256: 'a'.repeat(64), title: 'Not in the library', genre: 'Action' },
      { sha256: sha(jars.other), genre: 'Space Opera' },
      { sha256: 'xyz', genre: 'Action' },
    ]);
    const r = await call('POST', '/api/library/catalog/preview', body);
    assert.equal(r.status, 200, r.text);
    assert.deepEqual([r.json.entries, r.json.ok, r.json.missing, r.json.invalid, r.json.applied], [5, 2, 1, 2, 0]);
    assert.ok(r.json.items.some((i: any) => i.state === 'invalid' && /unknown genre/.test(i.detail)));
    assert.equal(genreOf('race1'), undefined, 'nothing was written');
    assert.equal((await call('GET', '/api/library/genres')).json.unclassified, 4);
  });

  it('an import writes the genre of the whole group, and a second import changes nothing', async () => {
    const body = catalog([
      { sha256: sha(jars.race1), title: 'Rally Champion', genre: 'Racing', tags: ['3D', 'cars'] },
      { sha256: sha(jars.puzzle), title: 'Blocks', genre: 'Puzzle', genres: ['Casual'] },
      { sha256: 'b'.repeat(64), genre: 'Sports' },
    ]);
    const first = await call('POST', '/api/library/catalog/import', body);
    assert.deepEqual([first.json.applied, first.json.unchanged, first.json.missing], [2, 0, 1]);
    for (const k of ['race1', 'race2']) {
      assert.equal(genreOf(k).primaryGenre, 'Racing', 'every build of the game shows the genre');
      assert.deepEqual([genreOf(k).source, genreOf(k).confidence, genreOf(k).canonicalTitle, genreOf(k).tags], ['curator', 'curated', 'Rally Champion', ['3D', 'cars']]);
    }
    assert.deepEqual(genreOf('puzzle').genres, ['Puzzle', 'Casual']);
    const again = await call('POST', '/api/library/catalog/import', body);
    assert.deepEqual([again.json.applied, again.json.unchanged], [0, 2], 'idempotent');
    assert.equal(app.library.count(), 5, 'games missing from the file are never deleted, hashes missing from the library never added');
    const sum = (await call('GET', '/api/library/genres')).json;
    assert.deepEqual([sum.total, sum.unclassified, sum.genres.find((g: any) => g.genre === 'Racing').count, sum.genres.find((g: any) => g.genre === 'Puzzle').count], [4, 2, 1, 1]);
  });

  it('the games can be filtered by genre', async () => {
    const racing = (await call('GET', '/api/games?genre=Racing')).json;
    assert.deepEqual(racing.map((g: any) => g.id).sort(), [ids.race1, ids.race2].sort());
    assert.equal((await call('GET', '/api/games?genre=Casual')).json.length, 1, 'a secondary genre counts for the filter');
    assert.equal((await call('GET', '/api/games?genre=unclassified')).json.length, 2);
    assert.equal((await call('GET', '/api/games?genre=Polka')).status, 400);
    assert.equal((await call('GET', '/api/games')).json.length, 5);
  });

  it('a genre chosen by hand is locked: imports and MobyGames lookups leave it alone', async () => {
    const r = await call('PATCH', `/api/library/groups/${group.race1}/classification`, { primaryGenre: 'Arcade', tags: ['my favourite'], canonicalTitle: 'Rally' });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual([r.json.primaryGenre, r.json.locked, r.json.source, r.json.tags], ['Arcade', true, 'manual', ['my favourite']]);
    const imp = await call('POST', '/api/library/catalog/import', catalog([{ sha256: sha(jars.race2), genre: 'Racing' }]));
    assert.deepEqual([imp.json.applied, imp.json.locked], [0, 1]);
    assert.ok(imp.json.items.some((i: any) => i.state === 'locked'));
    // MobyGames matches the same game and says Racing
    await call('PUT', '/api/settings/mobygames-key', { key: 'moby_testkey_0001' });
    fake.games = [{ game_id: 11, title: 'Rally', platforms: [{ platform_id: 64, name: 'J2ME', release_date: '2007-01-01' }], genres: [{ name: 'Racing / Driving' }] }];
    assert.equal((await call('POST', `/api/games/${ids.race1}/info/refresh`)).status, 200);
    assert.equal(genreOf('race1').primaryGenre, 'Arcade', 'the hand-picked genre survived the lookup');
    assert.equal(genreOf('race1').locked, true);
    assert.equal((await call('PATCH', `/api/library/groups/${group.race1}/classification`, { locked: false })).json.locked, false);
  });

  it('a MobyGames genre beats the curator but not the user; the curator cannot overwrite it', async () => {
    fake.games = [{ game_id: 12, title: 'Blocks', platforms: [{ platform_id: 64, name: 'J2ME', release_date: '2005-01-01' }], genres: [{ name: 'Strategy/Tactics' }, { name: 'Puzzle' }] }];
    assert.equal((await call('POST', `/api/games/${ids.puzzle}/info/refresh`)).status, 200);
    assert.deepEqual([genreOf('puzzle').primaryGenre, genreOf('puzzle').source, genreOf('puzzle').confidence], ['Strategy', 'mobygames', 'verified']);
    const imp = await call('POST', '/api/library/catalog/import', catalog([{ sha256: sha(jars.puzzle), genre: 'Puzzle' }]));
    assert.deepEqual([imp.json.applied, imp.json.protected], [0, 1]);
    assert.equal(genreOf('puzzle').primaryGenre, 'Strategy');
  });

  it('two files of one game with different genres in the catalog are reported, not guessed', async () => {
    app.library.classes.clear(group.race1!);
    const r = await call('POST', '/api/library/catalog/import', catalog([
      { sha256: sha(jars.race1), genre: 'Racing' },
      { sha256: sha(jars.race2), genre: 'Action' },
    ]));
    assert.deepEqual([r.json.applied, r.json.conflict], [0, 2]);
    assert.equal(genreOf('race1'), undefined);
  });

  it('refuses a broken, foreign or oversized input', async () => {
    assert.equal((await call('POST', '/api/library/catalog/preview', undefined, '{not json')).status, 400);
    assert.equal((await call('POST', '/api/library/catalog/preview', [])).status, 400);
    assert.equal((await call('POST', '/api/library/catalog/preview', { schema: 2, games: [] })).status, 400);
    assert.equal((await call('POST', '/api/library/catalog/preview', { schema: 1 })).status, 400);
    const big = JSON.stringify(catalog([{ sha256: 'c'.repeat(64), genre: 'Action', title: 'x'.repeat(3 * 1024 * 1024) }]));
    assert.equal((await call('POST', '/api/library/catalog/preview', undefined, big)).status, 413);
    assert.equal((await call('PATCH', '/api/library/groups/0123456789ab/classification', { primaryGenre: 'Action' })).status, 404, 'a group that is not in the library');
    assert.equal((await call('PATCH', '/api/library/groups/..%2F..%2Fx/classification', { primaryGenre: 'Action' })).status, 404);
    assert.equal((await call('PATCH', `/api/library/groups/${group.other}/classification`, { primaryGenre: 'Polka' })).status, 400);
    assert.equal((await call('PATCH', `/api/library/groups/${group.other}/classification`, { primaryGenre: 'Action', admin: true })).status, 400);
    assert.equal((await call('PATCH', `/api/library/groups/${group.other}/classification`, { tags: [1] })).status, 400);
    assert.equal((await call('PATCH', `/api/library/groups/${group.other}/classification`, {})).status, 400);
    assert.equal(genreOf('other'), undefined, 'a refused request writes nothing');
  });

  it('markup in titles and tags is stored as plain text (the UI escapes it) and control characters are dropped', async () => {
    const r = await call('POST', '/api/library/catalog/import', catalog([{ sha256: sha(jars.nasty), title: '<script>alert(1)</script>\u0000\n', genre: 'Action', tags: ['<b>x</b>\u0007', '<b>x</b>'] }]));
    assert.equal(r.json.applied, 1);
    const c = genreOf('nasty');
    assert.equal(c.canonicalTitle, '<script>alert(1)</script>');
    assert.deepEqual(c.tags, ['<b>x</b>']);
    const game = (await call('GET', `/api/games/${ids.nasty}`)).json;
    assert.equal(game.name, '<script>alert(1)</script>', 'the catalog title is shown, as plain text (React escapes it when rendering)');
  });

  it('the export can be imported again, and the classifications are in library.sqlite (a backup keeps them)', async () => {
    await call('PATCH', `/api/library/groups/${group.other}/classification`, { primaryGenre: 'Fighting' });
    const exp = await call('GET', '/api/library/catalog/export');
    assert.equal(exp.status, 200);
    assert.equal(exp.json.schema, 1);
    const entry = exp.json.games.find((g: any) => g.sha256 === sha(jars.other));
    assert.equal(entry.genre, 'Fighting');
    assert.equal((await call('POST', '/api/library/catalog/preview', exp.json)).json.invalid, 0);
    // a copy of the database file, as `jgo backup` takes it, opened by a fresh library
    app.library.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const copyDir = tmpDir('jgo-backup-');
    copyFileSync(path.join(app.cfg.dataDir, 'library.sqlite'), path.join(copyDir, 'library.sqlite'));
    const restored = new Library(copyDir);
    assert.equal(restored.classes.get(group.other!)?.primaryGenre, 'Fighting');
    assert.equal(restored.classes.get(group.puzzle!)?.primaryGenre, 'Strategy');
    restored.close();
  });

  it('reads the curator manifest: confidence maps to the source, paths are dropped, checked entries outweigh guesses', async () => {
    const extra = { guess: makeJar('Guess', { vendor: 'ACME' }), blank: makeJar('Blank', { vendor: 'ACME' }), checked: makeJar('Checked', { vendor: 'ACME' }) };
    for (const [k, jar] of Object.entries(extra)) { const { game } = app.library.add(jar, null, 1 << 30); ids[k] = game.id; group[k] = game.groupKey; }
    const item = (jar: Uint8Array, over: object) => ({ rank: 1, title: 'T', title_key: 't', genre: 'Action', genre_confidence: 'manual', sha256: sha(jar), source_relative: 'Gameloft\\Secret.jar', file: 'Secret.jar', resolution: '', vendor: 'V', version: '1', ...over });
    const manifest = { schema: 'jgo-curator-manifest-v1', generated_by: 'J2ME Curator 1.1.0', report_source_root: '\\\\192.168.1.5\\Games', target: 500, items: [
      item(extra.checked, { title: 'Checked', genre: 'Sports' }),
      item(extra.guess, { title: 'Guess', genre: 'Strategy', genre_confidence: 'heuristic' }),
      item(extra.blank, { title: 'Blank', genre: 'Other', genre_confidence: 'unclassified' }),
      item(jars.other, { genre: 'Action', genre_confidence: 'psychic' }),
    ] };
    const pre = await call('POST', '/api/library/catalog/preview', manifest);
    assert.equal(pre.status, 200, pre.text);
    assert.deepEqual([pre.json.entries, pre.json.ok, pre.json.invalid], [4, 3, 1]);
    assert.ok(!JSON.stringify(pre.json).includes('Secret') && !JSON.stringify(pre.json).includes('192.168'), 'no path in the answer');
    const r = await call('POST', '/api/library/catalog/import', manifest);
    assert.equal(r.json.applied, 3);
    assert.deepEqual([genreOf('checked').source, genreOf('checked').confidence, genreOf('checked').unconfirmed], ['curator', 'curated', false]);
    assert.deepEqual([genreOf('guess').source, genreOf('guess').confidence, genreOf('guess').unconfirmed], ['heuristic', 'heuristic', true]);
    assert.deepEqual([genreOf('blank').primaryGenre, genreOf('blank').confidence, genreOf('blank').unconfirmed], ['Other', 'unclassified', true]);
    assert.ok(!JSON.stringify(app.library.db.prepare('SELECT * FROM game_classifications').all()).includes('Secret'), 'paths were never stored');
    assert.equal((await call('POST', '/api/library/catalog/import', manifest)).json.unchanged, 3, 'idempotent');
    // a later, checked entry replaces a guess; a guess never replaces a checked entry
    const upgrade = await call('POST', '/api/library/catalog/import', { ...manifest, items: [item(extra.guess, { title: 'Guess', genre: 'Puzzle' }), item(extra.checked, { genre: 'Arcade', genre_confidence: 'heuristic' })] });
    assert.deepEqual([upgrade.json.applied, upgrade.json.protected], [1, 1]);
    assert.deepEqual([genreOf('guess').primaryGenre, genreOf('guess').confidence], ['Puzzle', 'curated']);
    assert.equal(genreOf('checked').primaryGenre, 'Sports');
  });

  it('removing the MobyGames match removes its genre, but not a genre from the user or the catalog', async () => {
    // "Blocks" got Strategy from MobyGames above; "Rally" is the user's, "Checked" the catalog's
    assert.equal(genreOf('puzzle').source, 'mobygames');
    assert.equal((await call('DELETE', `/api/games/${ids.puzzle}/info`)).status, 200);
    assert.equal(genreOf('puzzle'), undefined, 'the rejected match took its genre with it');
    assert.equal((await call('DELETE', `/api/games/${ids.checked}/info`)).status, 200);
    assert.equal(genreOf('checked').primaryGenre, 'Sports', 'a catalog genre stays');
    fake.games = [{ game_id: 12, title: 'Blocks', platforms: [{ platform_id: 64, name: 'J2ME', release_date: '2005-01-01' }], genres: [{ name: 'Puzzle' }] }];
    await call('POST', `/api/games/${ids.puzzle}/info/refresh`);
    assert.equal(genreOf('puzzle').source === 'mobygames' || genreOf('puzzle') === undefined, true);
    app.library.classes.setManual(group.puzzle!, { primaryGenre: 'Casual' });
    assert.equal((await call('DELETE', '/api/metadata')).status, 204);
    assert.equal(genreOf('puzzle').primaryGenre, 'Casual', 'deleting all MobyGames data keeps a genre the user chose');
  });

  it('single-game answers carry the genre, so a favourite toggle does not lose it', async () => {
    const before = genreOf('checked');
    const patched = (await call('PATCH', `/api/games/${ids.checked}`, { favorite: true })).json;
    assert.equal(patched.favorite, true);
    assert.deepEqual(patched.classification, before);
    assert.deepEqual((await call('GET', `/api/games/${ids.checked}`)).json.classification, before);
  });

  it('a genre can come from the folder a file sits in, and is the weakest source after a guess', async () => {
    const dir = tmpDir('jgo-folders-');
    const lib = new Library(dir);
    const add = (name: string) => lib.add(makeJar(name, { vendor: 'ACME' }), null, 1 << 30).game.groupKey;
    const racer = add('Racer'), shooter = add('Shooter'), twin = add('Twin'), curated = add('Curated'), mine = add('Mine'), nofolder = add('Plain');
    lib.classes.importCatalog({ schema: 1, games: [] }, () => null);
    lib.classes.setManual(mine, { primaryGenre: 'Puzzle' });
    const r1 = lib.classes.assignFromFolders([
      { groupKey: racer, relPath: 'JGO-Top500/Racing/Racer.jar' },
      { groupKey: shooter, relPath: 'top/action/sub/Shooter.jar' },
      { groupKey: twin, relPath: 'Racing/Twin.jar' },
      { groupKey: twin, relPath: 'Sports/Twin v2.jar' },
      { groupKey: mine, relPath: 'Racing/Mine.jar' },
      { groupKey: nofolder, relPath: 'misc/Plain.jar' },
    ]);
    assert.deepEqual(r1, { assigned: 2, unchanged: 0, skipped: 2 }, 'twin (two genres) and mine (hand-picked) are left alone');
    assert.deepEqual([lib.classes.get(racer)?.primaryGenre, lib.classes.get(racer)?.source, lib.classes.get(racer)?.unconfirmed], ['Racing', 'folder', false]);
    assert.equal(lib.classes.get(shooter)?.primaryGenre, 'Action', 'folder names match without regard to case, at any depth');
    assert.equal(lib.classes.get(twin), null);
    assert.equal(lib.classes.get(mine)?.primaryGenre, 'Puzzle');
    assert.equal(lib.classes.get(nofolder), null);
    assert.deepEqual(lib.classes.assignFromFolders([{ groupKey: racer, relPath: 'JGO-Top500/Racing/Racer.jar' }]), { assigned: 0, unchanged: 1, skipped: 0 }, 'idempotent');
    // a catalog entry outranks the folder; a folder outranks a guess
    const sha = createHash('sha256').update(makeJar('Curated', { vendor: 'ACME' })).digest('hex');
    lib.classes.importCatalog({ schema: 1, games: [{ sha256: sha, genre: 'Strategy' }] }, (x) => (x === sha ? curated : null));
    assert.equal(lib.classes.assignFromFolders([{ groupKey: curated, relPath: 'Sports/Curated.jar' }]).skipped, 1);
    assert.equal(lib.classes.get(curated)?.primaryGenre, 'Strategy');
    lib.classes.importCatalog({ schema: 1, games: [{ sha256: createHash('sha256').update(makeJar('Racer', { vendor: 'ACME' })).digest('hex'), genre: 'Other', confidence: 'unclassified' }] }, () => racer);
    assert.equal(lib.classes.get(racer)?.primaryGenre, 'Racing', 'a guess does not replace a folder genre');
    lib.close();
  });

  it('shows clean titles: release-group tags and file-name style words are fixed, a catalog title wins', async () => {
    const a = app.library.add(makeJar('Asphalt 3 **MASYAKA**', { vendor: 'Gameloft SA by dedomil.net' }), null, 1 << 30).game;
    const b = app.library.add(makeJar('ExtremeAirSnowboarding3D', { vendor: 'Sefan' }), null, 1 << 30).game;
    const c = app.library.add(makeJar('ewjim', { vendor: 'Shiny' }), null, 1 << 30).game;
    assert.deepEqual([a.name, a.vendor, b.name], ['Asphalt 3', 'Gameloft SA', 'Extreme Air Snowboarding 3D']);
    assert.equal((await call('GET', `/api/games/${c.id}`)).json.name, 'Ewjim');
    const sha2 = createHash('sha256').update(makeJar('ewjim', { vendor: 'Shiny' })).digest('hex');
    await call('POST', '/api/library/catalog/import', catalog([{ sha256: sha2, title: 'Earthworm Jim', genre: 'Platformer' }]));
    assert.equal((await call('GET', `/api/games/${c.id}`)).json.name, 'Earthworm Jim', 'the title from the catalog');
    assert.equal(app.library.list().find((g) => g.id === c.id)!.name, 'Earthworm Jim');
    // the same game with and without tags is one game
    const a2 = app.library.add(makeJar('Asphalt 3', { vendor: 'Gameloft SA', version: '9.9' }), null, 1 << 30).game;
    assert.equal(a2.groupKey, a.groupKey);
  });

  it('an older database without the table is upgraded in place, and no game is lost', () => {
    const dir = tmpDir('jgo-old-');
    const old = new Library(dir);
    old.add(makeJar('Old'), null, 1 << 30);
    old.db.exec('DROP TABLE game_classifications');
    old.close();
    const upgraded = new Library(dir);
    assert.equal(upgraded.count(), 1);
    assert.equal(upgraded.classes.summary().unclassified, 1);
    upgraded.close();
  });
});
