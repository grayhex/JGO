import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { parseAttributes, parseJad, parseJar, UploadError } from './jar.js';

const classOf = (major: number) => {
  const b = new Uint8Array(16);
  b.set([0xca, 0xfe, 0xba, 0xbe, 0, 0, major >> 8, major & 255]);
  return b;
};
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

function jar(files: Record<string, Uint8Array>, manifest: string) {
  return zipSync({ 'META-INF/MANIFEST.MF': strToU8(manifest), ...files });
}

describe('manifest parsing', () => {
  it('handles CRLF, continuation lines and duplicate keys', () => {
    const a = parseAttributes('MIDlet-Name: Long\r\n Name\r\nMIDlet-Vendor: V\r\nMIDlet-Name: ignored\r\n');
    assert.equal(a['MIDlet-Name'], 'LongName');
    assert.equal(a['MIDlet-Vendor'], 'V');
  });
});

describe('parseJar', () => {
  it('extracts name, vendor, version, midlets, icon and class version', () => {
    const j = jar({ 'a/Game.class': classOf(47), 'icon.png': png }, 'MIDlet-Name: Foo\nMIDlet-Vendor: Bar\nMIDlet-Version: 1.2\nMIDlet-1: Foo, /icon.png, a.Game\n');
    const i = parseJar(j);
    assert.deepEqual([i.name, i.vendor, i.version, i.classVersion], ['Foo', 'Bar', '1.2', 47]);
    assert.deepEqual(i.midlets, [{ name: 'Foo', icon: '/icon.png', className: 'a.Game' }]);
    assert.ok(i.icon && i.icon.bytes[0] === 0x89);
    assert.equal(i.warnings.length, 0);
  });

  it('JAD attributes override the manifest', () => {
    const j = jar({ 'a/Game.class': classOf(46) }, 'MIDlet-Name: Old\nMIDlet-1: Old,,a.Game\n');
    assert.equal(parseJar(j, parseJad(strToU8('MIDlet-Name: New\n'))).name, 'New');
  });

  it('warns about Java 5+ class files that KEmulator cannot load', () => {
    const j = jar({ 'a/Game.class': classOf(52) }, 'MIDlet-Name: X\nMIDlet-1: X,,a.Game\n');
    const i = parseJar(j);
    assert.equal(i.classVersion, 52);
    assert.match(i.warnings.join(' '), /KEmulator only accepts/);
  });

  for (const [name, files, code] of [
    ['path traversal', { '../evil': strToU8('x') }, 'unsafe_entry'],
    ['absolute path', { '/etc/passwd': strToU8('x') }, 'unsafe_entry'],
    ['backslash path', { 'a\\b': strToU8('x') }, 'unsafe_entry'],
  ] as const) {
    it(`rejects ${name} entries`, () => {
      assert.throws(() => parseJar(jar({ ...files }, 'MIDlet-Name: x\n')), (e) => e instanceof UploadError && e.code === code);
    });
  }

  it('rejects non-zip input, missing manifest, and zip bombs', () => {
    assert.throws(() => parseJar(strToU8('hello world, this is not a zip file')), (e) => (e as UploadError).code === 'not_a_jar');
    assert.throws(() => parseJar(zipSync({ 'x.txt': strToU8('x') })), (e) => (e as UploadError).code === 'no_manifest');
    const bomb = zipSync({ 'META-INF/MANIFEST.MF': strToU8('MIDlet-Name: x\n'), 'big.bin': new Uint8Array(600 * 1024 * 1024) }, { level: 1 });
    assert.throws(() => parseJar(bomb), (e) => (e as UploadError).code === 'zip_bomb');
  });

  it('ignores a non-PNG icon', () => {
    const j = jar({ 'a/G.class': classOf(46), 'i.png': strToU8('notpng') }, 'MIDlet-Name: x\nMIDlet-Icon: /i.png\nMIDlet-1: x,,a.G\n');
    assert.equal(parseJar(j).icon, null);
  });
});
