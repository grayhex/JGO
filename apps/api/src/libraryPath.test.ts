import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { browseLibrary, checkLibraryDir, listRoots, resolveInsideRoots, walkLibrary, type WalkStats } from './libraryPath.js';
import { makeJar, put, testConfig, tmpDir } from './dev/testing.js';

describe('library path safety', () => {
  const root = tmpDir('jgo-root-');
  const outside = tmpDir('jgo-outside-');
  put(root, 'a/one.jar', makeJar('One'));
  put(root, 'a/one.jad', 'MIDlet-Name: One\n');
  put(root, 'b/deep/two.JAR', makeJar('Two'));
  put(root, '._junk.jar', 'resource fork');
  put(root, 'readme.txt', 'x');
  put(outside, 'secret.jar', makeJar('Secret'));
  symlinkSync(outside, path.join(root, 'escape'));
  symlinkSync(path.join(outside, 'secret.jar'), path.join(root, 'a/link.jar'));
  const cfg = testConfig({ roots: [root] });

  it('accepts the root and its sub-directories', () => {
    assert.ok(resolveInsideRoots(cfg, root));
    assert.ok(resolveInsideRoots(cfg, path.join(root, 'a')));
  });

  it('rejects paths outside the roots, relative paths, NUL bytes and ..', () => {
    for (const p of ['/etc', '/', '/root', cfg.dataDir, path.join(root, '..'), path.join(root, 'a/../..'), 'relative/dir', `${root}/a\0b`, '']) {
      assert.equal(resolveInsideRoots(cfg, p), null, p);
    }
  });

  it('rejects a symlink that leads out of the root', () => {
    assert.equal(resolveInsideRoots(cfg, path.join(root, 'escape')), null);
    assert.equal(resolveInsideRoots(cfg, path.join(root, 'escape/secret.jar')), null);
  });

  it('the data directory import folder is always allowed', () => {
    const imp = path.join(cfg.dataDir, 'import');
    mkdirSync(imp, { recursive: true });
    assert.ok(resolveInsideRoots(cfg, imp));
  });

  it('the walk finds JAR/JAD recursively, ignores symlinks, resource forks and other files', async () => {
    const stats: WalkStats = { entries: 0, symlinksSkipped: 0, truncated: false, unreadableDirs: [] };
    const found: string[] = [];
    for await (const e of walkLibrary(root, stats)) found.push(`${e.kind}:${e.rel}`);
    assert.deepEqual(found.sort(), ['jad:a/one.jad', 'jar:a/one.jar', 'jar:b/deep/two.JAR']);
    assert.equal(stats.symlinksSkipped, 2); // escape/ and a/link.jar
  });

  it('check reports counts, and refuses what is outside', async () => {
    const ok = await checkLibraryDir(cfg, root);
    assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.equal(ok.jarCount, 2);
    assert.equal(ok.jadCount, 1);
    assert.ok(ok.warnings.some((w) => /symbolic link/.test(w)));
    const bad = await checkLibraryDir(cfg, '/etc');
    assert.equal(bad.ok, false);
    assert.equal(bad.insideRoot, false);
    assert.equal(bad.jarCount, 0);
    const a = await checkLibraryDir(cfg, '/etc');
    const b = await checkLibraryDir(cfg, '/definitely-not-there-xyz');
    assert.deepEqual({ ...a, path: '' }, { ...b, path: '' }, 'an existing and a missing path outside the roots look the same');
    const missing = await checkLibraryDir(cfg, path.join(root, 'nope'));
    assert.equal(missing.ok, false);
    assert.equal(missing.exists, false);
    const viaLink = await checkLibraryDir(cfg, path.join(root, 'escape'));
    assert.equal(viaLink.ok, false);
    assert.equal(viaLink.jarCount, 0, 'the target of an escaping link must not even be counted');
  });

  it('an unreadable directory is reported with a hint (skipped when running as root, who can read anything)', async (t) => {
    if (process.getuid?.() === 0) return t.skip('root ignores permissions');
    const d = tmpDir('jgo-noread-');
    chmodSync(d, 0o000);
    const r = await checkLibraryDir(testConfig({ roots: [d] }), d);
    chmodSync(d, 0o700);
    assert.equal(r.ok, false);
    assert.equal(r.readable, false);
    assert.match(r.problems.join(' '), /cannot read/);
  });

  it('browse lists directory names only and never leaves the roots', () => {
    const top = browseLibrary(cfg, null)!;
    assert.ok(top.dirs.some((d) => d.path === root));
    const sub = browseLibrary(cfg, root)!;
    assert.deepEqual(sub.dirs.map((d) => d.name), ['a', 'b']); // no symlinked "escape", no files
    assert.equal(sub.parent, null);
    assert.equal(browseLibrary(cfg, path.join(root, 'a'))!.parent, root);
    assert.equal(browseLibrary(cfg, '/etc'), null);
    assert.equal(browseLibrary(cfg, path.join(root, 'escape')), null);
  });

  it('roots report their state', () => {
    const r = listRoots(testConfig({ roots: [root, '/definitely/not/here'] }));
    assert.equal(r.find((x) => x.path === root)!.exists, true);
    assert.equal(r.find((x) => x.path === '/definitely/not/here')!.exists, false);
  });
});
