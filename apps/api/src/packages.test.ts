import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { platformOfFile, backendOf, isPlatform, PLATFORMS } from '@mgo/protocol';
import { Library } from './library.js';
import { ScanManager } from './scanner.js';
import { SettingsStore } from './settingsStore.js';
import { UploadError } from './jar.js';
import { makeJar, put, testConfig, tmpDir } from './dev/testing.js';

const noQuota = 1 << 30;

describe('platforms', () => {
  it('knows the four platforms and the backend of each', () => {
    assert.deepEqual([...PLATFORMS], ['j2me', 'symbian', 'ngage', 'ngage2']);
    assert.equal(backendOf('j2me'), 'kemulator');
    for (const p of ['symbian', 'ngage', 'ngage2'] as const) assert.equal(backendOf(p), 'eka2l1');
    assert.ok(isPlatform('ngage2'));
    assert.ok(!isPlatform('wp7'));
  });
  it('guesses the platform from the file name only where the extension tells', () => {
    assert.equal(platformOfFile('a.JAR'), 'j2me');
    assert.equal(platformOfFile('a.sis'), 'symbian');
    assert.equal(platformOfFile('a.SISX'), 'symbian');
    assert.equal(platformOfFile('a.n-gage'), 'ngage2');
    assert.equal(platformOfFile('a.zip'), null, 'a .zip can be anything: the user has to say it is an N-Gage 1.0 card');
    assert.equal(platformOfFile('a.txt'), null);
  });
});

describe('Library.addPackage', () => {
  const lib = () => new Library(tmpDir('mgo-pkg-'));

  it('stores a .sis with its platform, a readable name and no J2ME data', () => {
    const l = lib();
    const r = l.addPackage(Buffer.from('sis-1'), 'Bounce Tales v1.0.sis', 'symbian', noQuota);
    assert.equal(r.duplicate, false);
    assert.equal(r.game.platform, 'symbian');
    assert.match(r.game.name, /Bounce Tales/);
    const p = l.packagePath(r.game.id)!;
    assert.ok(p.endsWith('game.sis'));
    assert.equal(readFileSync(p, 'utf8'), 'sis-1');
    assert.equal(l.get(r.game.id)!.platform, 'symbian');
  });

  it('dedupes by content and keeps different platforms apart', () => {
    const l = lib();
    const a = l.addPackage(Buffer.from('same'), 'A.sis', 'symbian', noQuota);
    const b = l.addPackage(Buffer.from('same'), 'copy.sis', 'symbian', noQuota);
    assert.equal(b.duplicate, true);
    assert.equal(b.game.id, a.game.id);
    assert.equal(l.count(), 1);
  });

  it('checks the extension against the platform and the .zip magic', () => {
    const l = lib();
    assert.throws(() => l.addPackage(Buffer.from('x'), 'a.sis', 'ngage2', noQuota), UploadError);
    assert.throws(() => l.addPackage(Buffer.from('x'), 'a.n-gage', 'symbian', noQuota), UploadError);
    assert.throws(() => l.addPackage(Buffer.from('x'), 'a.zip', 'symbian', noQuota), UploadError);
    assert.throws(() => l.addPackage(Buffer.from('not a zip'), 'a.zip', 'ngage', noQuota), UploadError);
    assert.throws(() => l.addPackage(Buffer.from('x'), 'a.exe', 'symbian', noQuota), UploadError);
    assert.doesNotThrow(() => l.addPackage(Buffer.from('PK\x03\x04..'), 'card.zip', 'ngage', noQuota));
    assert.equal(l.count(), 1);
  });

  it('honours the library quota', () => {
    const l = lib();
    assert.throws(() => l.addPackage(Buffer.alloc(2000, 1), 'big.sis', 'symbian', 1000), (e: unknown) => e instanceof UploadError);
  });

  it('removes the stored file with the game', () => {
    const l = lib();
    const r = l.addPackage(Buffer.from('rm'), 'rm.sis', 'symbian', noQuota);
    const p = l.packagePath(r.game.id)!;
    assert.ok(existsSync(p));
    assert.ok(l.remove(r.game.id));
    assert.ok(!existsSync(p));
  });

  it('migrates an existing database: old games become j2me', () => {
    const dir = tmpDir('mgo-mig-');
    const l1 = new Library(dir);
    const jar = makeJar('Old');
    const old = l1.add(jar, null, noQuota).game;
    const l2 = new Library(dir); // reopen: the additive migration must not disturb anything
    assert.equal(l2.get(old.id)!.platform, 'j2me');
    assert.equal(l2.packagePath(old.id), null);
  });
});

describe('library scan of Symbian and N-Gage files', () => {
  function setup() {
    const root = tmpDir('mgo-scan-');
    const cfg = testConfig({ roots: [root] });
    const store = new SettingsStore(cfg.dataDir, cfg, {});
    const library = new Library(cfg.dataDir);
    store.update({ libraryPath: root });
    const scan = new ScanManager(cfg, library, { settings: () => store.get() });
    return { root, cfg, library, scan, run: async () => { const r = scan.start('update'); await scan.idle(); return r; } };
  }

  it('imports .sis, .sisx and .n-gage next to .jar files, each with its platform', async () => {
    const t = setup();
    put(t.root, 'j2me/Race.jar', makeJar('Race'));
    put(t.root, 'S60/Rally.sis', 'rally sis');
    put(t.root, 'S60/Chess.sisx', 'chess sisx');
    put(t.root, 'NGage/Pocket Kingdom.n-gage', 'pk ngage2');
    put(t.root, 'NGage/readme.txt', 'x');
    const r = await t.run();
    assert.equal(r.state, 'done', JSON.stringify(r));
    assert.equal(r.jars, 4);
    assert.equal(r.added, 4);
    const by = Object.fromEntries(t.library.list().map((g) => [g.name, g.platform]));
    assert.equal(Object.keys(by).length, 4, JSON.stringify(by));
    assert.deepEqual(Object.values(by).sort(), ['j2me', 'ngage2', 'symbian', 'symbian']);
  });

  it('skips a package over the size limit and imports the same bytes once', async () => {
    const t = setup();
    t.cfg.maxPackageBytes = 100;
    put(t.root, 'big.sis', 'x'.repeat(500));
    put(t.root, 'a/one.sis', 'dup');
    put(t.root, 'b/two.sis', 'dup');
    const r = await t.run();
    assert.equal(t.library.count(), 1);
    assert.equal(r.duplicates, 1);
    assert.ok(r.skipped >= 1);
  });
});
