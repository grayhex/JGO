import assert from 'node:assert/strict';
import { existsSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { Library } from './library.js';
import { nativeDefaults, ScanManager } from './scanner.js';
import { SettingsStore } from './settingsStore.js';
import { makeJar, put, testConfig, tmpDir } from './dev/testing.js';

function setup(extra: { quotaMb?: number } = {}) {
  const root = tmpDir('mgo-lib-');
  const cfg = testConfig({ roots: [root] });
  if (extra.quotaMb) cfg.libraryQuotaBytes = extra.quotaMb * 1024 * 1024;
  const store = new SettingsStore(cfg.dataDir, cfg, {});
  const library = new Library(cfg.dataDir);
  store.update({ libraryPath: root });
  const scan = new ScanManager(cfg, library, { settings: () => store.get() });
  const run = async (mode: 'update' | 'full' = 'update') => {
    const r = scan.start(mode);
    await scan.idle();
    return r;
  };
  return { root, cfg, store, library, scan, run };
}

describe('library scan', () => {
  it('imports recursively with the manifest, JAD pairing and the default phone', async () => {
    const t = setup();
    t.store.update({ phone: { width: 176, height: 220, layout: 'sonyericsson', heapMb: 128 } });
    put(t.root, 'Racing/Race.jar', makeJar('Race', { vendor: 'ACME', version: '1.1' }));
    put(t.root, 'Racing/Race.jad', 'MIDlet-Name: Race Deluxe\nMIDlet-Vendor: ACME\nMIDlet-Version: 1.1\n');
    put(t.root, 'a/b/c/Puzzle.jar', makeJar('Puzzle'));
    put(t.root, 'a/notes.txt', 'hi');
    const r = await t.run();
    assert.equal(r.state, 'done', JSON.stringify(r));
    assert.deepEqual([r.jars, r.added, r.skipped], [2, 2, 0]);
    const games = t.library.list();
    assert.deepEqual(games.map((g) => g.name).sort(), ['Puzzle', 'Race Deluxe']);
    const race = games.find((g) => g.name === 'Race Deluxe')!;
    assert.equal(race.hasJad, true, 'the JAD next to the JAR is stored and its attributes win');
    assert.equal(race.origin, 'import');
    assert.deepEqual([race.settings.width, race.settings.height, race.settings.layout, race.settings.heapMb], [176, 220, 'sonyericsson', 128]);
    assert.ok(existsSync(t.library.paths(race.id).jar));
    assert.equal(t.library.sourcesOf(race.id)[0]!.rel_path, 'Racing/Race.jar');
  });

  it('detects duplicates by SHA-256 across paths and different versions of one game', async () => {
    const t = setup();
    const v1 = makeJar('Snake', { vendor: 'V', version: '1.0' });
    put(t.root, 'x/Snake.jar', v1);
    put(t.root, 'y/copy of snake.jar', v1);
    put(t.root, 'z/deep/Snake_again.jar', v1);
    put(t.root, 'x/Snake 1.2.jar', makeJar('Snake', { vendor: 'V', version: '1.2' }));
    const r = await t.run();
    assert.equal(t.library.count(), 2);
    assert.equal(r.duplicates, 2);
    assert.deepEqual(r.duplicateGroups[0]!.paths, ['x/Snake.jar', 'y/copy of snake.jar', 'z/deep/Snake_again.jar']);
    assert.equal(r.newVersions, 1);
    assert.equal(r.versionGroups.length, 1);
    assert.deepEqual(r.versionGroups[0]!.versions.map((v) => v.version).sort(), ['1.0', '1.2']);
  });

  it('an update scan does not re-read unchanged files and keeps games, favourites and saves', async () => {
    const t = setup();
    const f = put(t.root, 'Game.jar', makeJar('Game'));
    const WHOLE_SECOND = 1_700_000_000; // an exactly representable mtime, so that it can be restored bit for bit
    utimesSync(f, WHOLE_SECOND, WHOLE_SECOND);
    await t.run();
    const g = t.library.list()[0]!;
    t.library.update(g.id, { favorite: true, settings: { heapMb: 512 } });
    const saves = t.library.savesDir('default', g.id);
    writeFileSync(path.join(saves, 'rms.dat'), 'progress');
    // same size and mtime, different bytes: an update scan trusts them (no read, no hash), a full scan looks again
    const swapped = makeJar('Game');
    swapped[swapped.length - 30] = swapped[swapped.length - 30]! ^ 0xff; // flips a byte inside the archive, length unchanged
    writeFileSync(f, swapped);
    utimesSync(f, WHOLE_SECOND, WHOLE_SECOND);
    const r2 = await t.run('update');
    assert.deepEqual([r2.added, r2.updated, r2.unchanged], [0, 0, 1]);
    writeFileSync(f, makeJar('Game'));
    utimesSync(f, WHOLE_SECOND, WHOLE_SECOND);
    // a new file arrives
    put(t.root, 'New.jar', makeJar('New'));
    const r3 = await t.run('update');
    assert.deepEqual([r3.added, r3.unchanged], [1, 1]);
    const again = t.library.get(g.id)!;
    assert.equal(again.favorite, true);
    assert.equal(again.settings.heapMb, 512);
    assert.equal(path.join(saves, 'rms.dat') && existsSync(path.join(saves, 'rms.dat')), true);
  });

  it('a changed file becomes a new version; the old game and its saves stay', async () => {
    const t = setup();
    const f = put(t.root, 'Game.jar', makeJar('Game', { version: '1.0' }));
    await t.run();
    const old = t.library.list()[0]!;
    writeFileSync(path.join(t.library.savesDir('default', old.id), 'rms.dat'), 'x');
    writeFileSync(f, makeJar('Game', { version: '2.0' }));
    utimesSync(f, new Date(), new Date(Date.now() + 5000));
    const r = await t.run();
    assert.deepEqual([r.updated, r.added, r.newVersions], [1, 0, 1]);
    assert.equal(t.library.count(), 2);
    assert.ok(t.library.get(old.id), 'the old version is still there');
    assert.ok(existsSync(path.join(t.library.savesDir('default', old.id), 'rms.dat')));
  });

  it('files that disappear are flagged, never deleted; they come back when the file does', async () => {
    const t = setup();
    const f = put(t.root, 'Gone.jar', makeJar('Gone'));
    put(t.root, 'Stay.jar', makeJar('Stay'));
    await t.run();
    const bytes = makeJar('Gone');
    rmSync(f);
    const r = await t.run();
    assert.equal(r.missing, 1);
    assert.equal(t.library.count(), 2);
    assert.equal(t.library.list().find((g) => g.name === 'Gone')!.sourceMissing, true);
    assert.equal(t.library.list().find((g) => g.name === 'Stay')!.sourceMissing, undefined);
    put(t.root, 'Gone.jar', bytes);
    const r2 = await t.run();
    assert.equal(r2.missing, 0);
    assert.equal(t.library.list().find((g) => g.name === 'Gone')!.sourceMissing, undefined);
  });

  it('an empty directory (a mount that is gone) does not flag everything as missing', async () => {
    const t = setup();
    const f = put(t.root, 'A.jar', makeJar('A'));
    await t.run();
    rmSync(f);
    const r = await t.run();
    assert.match(r.error ?? '', /looks empty/);
    assert.equal(r.missing, 0);
    assert.equal(t.library.list()[0]!.sourceMissing, undefined);
  });

  it('bad files are reported with their relative path and do not stop the scan', async () => {
    const t = setup();
    put(t.root, 'broken.jar', 'not a zip at all, long enough to pass the size check');
    put(t.root, 'ok.jar', makeJar('Fine'));
    put(t.root, 'sub/empty.jar', '');
    const r = await t.run();
    assert.equal(r.added, 1);
    assert.equal(r.skipped, 2);
    assert.deepEqual(r.errors.map((e) => e.path).sort(), ['broken.jar', 'sub/empty.jar']);
    assert.ok(r.errors.every((e) => !e.message.includes(t.root)), 'messages do not leak absolute paths');
  });

  it('respects the library quota and an upload that already exists is linked, not copied', async () => {
    const t = setup({ quotaMb: 64 });
    const bytes = makeJar('Uploaded');
    const up = t.library.add(bytes, null, t.cfg.libraryQuotaBytes);
    put(t.root, 'Uploaded.jar', bytes);
    const r = await t.run();
    assert.deepEqual([r.added, r.unchanged], [0, 1]);
    assert.equal(t.library.count(), 1);
    assert.equal(t.library.sourcesOf(up.game.id).length, 1);
    t.cfg.libraryQuotaBytes = 10;
    put(t.root, 'Big.jar', makeJar('Big'));
    const r2 = await t.run();
    assert.equal(r2.errors[0]?.code, 'quota_exceeded');
  });

  it('refuses to start without a library directory, or when it left the allowed roots', async () => {
    const t = setup();
    t.store.update({ libraryPath: null });
    assert.throws(() => t.scan.start('update'), /No library directory/);
    t.store.update({ libraryPath: '/etc' });
    assert.throws(() => t.scan.start('update'), /outside the allowed/);
  });

  it('cannot be started twice and can be cancelled', async () => {
    const t = setup();
    for (let i = 0; i < 30; i++) put(t.root, `g${i}.jar`, makeJar(`G${i}`));
    const r = t.scan.start('update');
    assert.throws(() => t.scan.start('update'), /already running/);
    t.scan.cancel();
    await t.scan.idle();
    assert.equal(r.state, 'cancelled');
    assert.ok(t.library.count() < 30);
    const r2 = await t.run();
    assert.equal(r2.state, 'done');
    assert.equal(t.library.count(), 30);
  });

  it('the old database layout is migrated in place without touching existing rows', async () => {
    const dir = tmpDir('mgo-old-');
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(path.join(dir, 'library.sqlite'));
    db.exec(`CREATE TABLE games (id TEXT PRIMARY KEY, sha256 TEXT NOT NULL UNIQUE, name TEXT NOT NULL, vendor TEXT NOT NULL, version TEXT NOT NULL, group_key TEXT NOT NULL, midlets_json TEXT NOT NULL, class_version INTEGER NOT NULL, size_bytes INTEGER NOT NULL, has_icon INTEGER NOT NULL, has_jad INTEGER NOT NULL, favorite INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, last_played_at TEXT, settings_json TEXT NOT NULL, warnings_json TEXT NOT NULL);
      INSERT INTO games VALUES ('0123456789abcdef','${'a'.repeat(64)}','Old Game','V','1','k','[]',47,10,0,0,1,'2020-01-01T00:00:00Z',NULL,'{"width":240,"height":320,"layout":"nokia","heapMb":256}','[]');`);
    db.close();
    const lib = new Library(dir);
    const g = lib.get('0123456789abcdef')!;
    assert.equal(g.name, 'Old Game');
    assert.equal(g.favorite, true);
    assert.equal(g.origin, 'upload');
    assert.equal(lib.count(), 1);
  });

  it('pointing the library at another folder keeps every game already imported (and its genre)', async () => {
    const t = setup();
    put(t.root, 'old/Racer.jar', makeJar('Racer'));
    await t.run();
    const groupKey = t.library.list()[0]!.groupKey;
    t.library.classes.setManual(groupKey, { primaryGenre: 'Racing' });
    const other = tmpDir('mgo-lib2-');
    t.cfg.libraryRoots.push(other);
    put(other, 'new/Puzzle.jar', makeJar('Puzzle'));
    t.store.update({ libraryPath: other });
    await t.run('full');
    assert.deepEqual(t.library.list().map((g) => g.name).sort(), ['Puzzle', 'Racer'], 'the old game is still there');
    assert.equal(t.library.list().find((g) => g.name === 'Racer')!.classification?.primaryGenre, 'Racing');
  });
});

it('scans three independent platform folders, imports N-Gage cards only from their folder, and protects an empty mount', async () => {
  const t = setup();
  try {
    const java = path.join(t.root, 'java'), ngage = path.join(t.root, 'ngage'), sis = path.join(t.root, 'sis');
    put(java, 'Game.jar', makeJar('Java Game'));
    put(java, 'not-a-card.zip', Buffer.from('PK\x03\x04 unrelated zip'));
    put(ngage, 'Game.zip', Buffer.from('PK\x03\x04 card fixture'));
    put(ngage, 'Game.n-gage', Buffer.from('second generation fixture'));
    put(ngage, 'ignore.jar', makeJar('Wrong folder'));
    put(sis, 'Game.sisx', Buffer.from('sis fixture'));
    t.store.update({ libraryPath: null, libraryPaths: { j2me: java, ngage, symbian: sis }, nativePhones: { ngage: 'nokia-n-gage-qd' } });
    const first = await t.run();
    assert.equal(first.state, 'done', first.error ?? ''); assert.equal(first.added, 4);
    const games = t.library.list();
    assert.deepEqual(games.map(g => g.platform ?? 'j2me').sort(), ['j2me','ngage','ngage2','symbian']);
    assert.equal(games.find(g => g.platform === 'ngage')?.settings.skinId, 'nokia-n-gage-qd');
    const native = games.find(g => g.platform === 'symbian')!;
    assert.ok(t.library.sourcesOf(native.id)[0]!.rel_path.startsWith('symbian/'));
    const javaGame = games.find(g => !g.platform || g.platform === 'j2me')!;
    rmSync(path.join(java, 'Game.jar')); rmSync(path.join(java, 'not-a-card.zip'));
    const second = await t.run(); assert.equal(second.added, 0);
    assert.equal(t.library.get(javaGame.id)!.sourceMissing, undefined, 'an empty mount is not evidence that the game was deleted');
    assert.equal(t.library.list().length, 4);
    rmSync(java, { recursive: true });
    const third = await t.run(); assert.equal(third.state, 'done');
    assert.ok(third.errors.some(e => e.code === 'library_unavailable'));
    assert.equal(t.library.get(javaGame.id)!.sourceMissing, undefined, 'an unavailable Java mount does not block or damage the other platform scans');
  } finally { t.library.close(); rmSync(t.root, { recursive: true, force: true }); }
});

it('native defaults bind the selected model and preserve an installed N95 8GB identity', () => {
  const t = setup();
  try {
    t.store.update({ nativePhones: { ngage: 'nokia-n-gage-qd', symbian: 'nokia-n95' } });
    const qd = nativeDefaults(t.store.get(), 'ngage');
    assert.equal(qd.emulatedDeviceId, 'eka2l1-ngage-qd'); assert.equal(qd.symbianDevice, 'RH-29');
    const status = { firmware: { devices: [{ code: 'RM-320' }] } } as import('@mgo/protocol').SymbianStatus;
    const n95 = nativeDefaults(t.store.get(), 'symbian', status);
    assert.equal(n95.emulatedDeviceId, 'eka2l1-n95-8gb'); assert.equal(n95.symbianDevice, 'RM-320');
    const game = t.library.addPackage(Buffer.from('synthetic'), 'new.sisx', 'symbian', 100000, { defaults: n95 }).game;
    assert.equal(game.settings.symbianDevice, 'RM-320'); assert.equal(game.settings.skinId, 'nokia-n95');
  } finally { t.library.close(); rmSync(t.root, { recursive: true, force: true }); }
});

it('scans only the folders of the chosen kinds, and the library can be cleared per kind', async () => {
  const t = setup();
  try {
    const java = path.join(t.root, 'java'), ngage = path.join(t.root, 'ngage'), sis = path.join(t.root, 'sis');
    put(java, 'Game.jar', makeJar('Java Game'));
    put(ngage, 'Card.zip', Buffer.from('PK\x03\x04 card fixture'));
    put(ngage, 'Two.n-gage', Buffer.from('second generation fixture'));
    put(sis, 'Game.sisx', Buffer.from('sis fixture'));
    t.store.update({ libraryPath: null, libraryPaths: { j2me: java, ngage, symbian: sis } });
    const only = t.scan.start('update', ['ngage']); await t.scan.idle();
    assert.equal(only.state, 'done', only.error ?? ''); assert.equal(only.added, 2, 'only the N-Gage folder was read');
    assert.deepEqual(t.library.list().map((g) => g.platform).sort(), ['ngage', 'ngage2']);
    assert.deepEqual(t.library.idsOfKind('ngage').length, 2, 'N-Gage means 1.0 cards and 2.0 packages');
    assert.equal(t.library.idsOfKind('j2me').length, 0);
    const rest = t.scan.start('update', ['j2me', 'symbian']); await t.scan.idle();
    assert.equal(rest.added, 2); assert.equal(t.library.list().length, 4);
    assert.equal(t.library.idsOfKind('symbian').length, 1);
    for (const id of t.library.idsOfKind('ngage')) t.library.remove(id);
    assert.deepEqual(t.library.list().map((g) => g.platform ?? 'j2me').sort(), ['j2me', 'symbian'], 'clearing N-Gage leaves the other kinds');
    const again = t.scan.start('update', ['ngage']); await t.scan.idle();
    assert.equal(again.added, 2, 'a new scan brings the cleared games back');
  } finally { t.library.close(); rmSync(t.root, { recursive: true, force: true }); }
});

it('the older single folder is part of "all" and of Java ME, never of a scan of other kinds', async () => {
  const t = setup();
  try {
    put(t.root, 'Old.jar', makeJar('Old Game'));
    // t.store.libraryPath is the root (set by setup)
    assert.throws(() => t.scan.start('update', ['ngage']), (e: { code?: string }) => e.code === 'no_library', 'a scan of N-Gage alone does not read the older folder');
    assert.equal(t.library.list().length, 0);
    await t.run();
    assert.equal(t.library.list().length, 1);
  } finally { t.library.close(); rmSync(t.root, { recursive: true, force: true }); }
});
