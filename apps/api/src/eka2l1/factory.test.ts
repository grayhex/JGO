import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { it } from 'node:test';
// @ts-expect-error plain ESM service module, without a declaration file
import { factoryDirectory, factoryUploadPath, factoryInstallFiles } from '../../../../symbian/agent/factory.mjs';

it('factory kits retain original names and isolate bundles with identical VPL/FPSX filenames', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'jgo-factory-'));
  try {
    const a = 'a'.repeat(32), b = 'b'.repeat(32);
    const first = factoryUploadPath(root, a, 'RM-596.core.fpsx', 'fpsx');
    const second = factoryUploadPath(root, b, 'RM-596.core.fpsx', 'fpsx');
    assert.notEqual(path.dirname(first), path.dirname(second));
    assert.equal(path.basename(first), 'RM-596.core.fpsx');
    mkdirSync(path.dirname(first), { recursive: true }); writeFileSync(first, 'first kit');
    mkdirSync(path.dirname(second), { recursive: true }); writeFileSync(second, 'second kit');
    assert.equal(readFileSync(first, 'utf8'), 'first kit');
    assert.throws(() => factoryUploadPath(root, a, 'rm-596.CORE.FPSX', 'fpsx'), /already in/);
    assert.throws(() => factoryDirectory(root, '../escape'));
    for (const name of ['../bad.fpsx', 'C:\\bad.fpsx', '.bad.fpsx', 'ＦＯＯ.fpsx', 'x.exe']) assert.throws(() => factoryUploadPath(root, a, name, 'fpsx'), name);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it('factory installation only uses a complete staged kit or plain inbox files, never links', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'jgo-factory-check-'));
  try {
    const bundle = 'a'.repeat(32), dir = factoryDirectory(root, bundle), inbox = path.join(root, 'inbox');
    mkdirSync(dir, { recursive: true }); mkdirSync(inbox);
    writeFileSync(path.join(dir, 'kit.vpl'), '<not-yet-parsed/>');
    assert.throws(() => factoryInstallFiles(root, inbox, { vpl: 'kit.vpl', bundle }), /fpsx/);
    writeFileSync(path.join(dir, 'core.fpsx'), 'synthetic image');
    const result = factoryInstallFiles(root, inbox, { vpl: 'kit.vpl', bundle, variant: 2 });
    assert.deepEqual(result, { files: { vpl: path.join(dir, 'kit.vpl') }, bundleDir: dir, variant: 2 });
    assert.throws(() => factoryInstallFiles(root, inbox, { vpl: 'kit.vpl', bundle, variant: -1 }));
    symlinkSync(path.join(dir, 'kit.vpl'), path.join(inbox, 'kit.vpl'));
    assert.throws(() => factoryInstallFiles(root, inbox, { vpl: 'kit.vpl', source: 'inbox' }), /regular/);
    rmSync(path.join(inbox, 'kit.vpl')); writeFileSync(path.join(inbox, 'kit.vpl'), 'manifest'); writeFileSync(path.join(inbox, 'core.fpsx'), 'image');
    assert.equal(factoryInstallFiles(root, inbox, { vpl: 'kit.vpl', source: 'inbox' }).keep, true);
    assert.throws(() => factoryInstallFiles(root, inbox, { vpl: 'kit.vpl', source: 'inbox', bundle }));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
