import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { after, describe, it } from 'node:test';
import { writeSoundfontProperty } from './appSettings.js';
import { SoundfontStore } from './soundfont.js';

const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(path.join(tmpdir(), 'jgo-sf-')); dirs.push(d); return d; };
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function sf2(size: number, declared = size - 8): Buffer {
  const b = Buffer.alloc(size);
  b.write('RIFF', 0, 'latin1');
  b.writeUInt32LE(declared, 4);
  b.write('sfbk', 8, 'latin1');
  return b;
}

describe('SoundfontStore', () => {
  it('stores a valid SF2, reports it and removes it', async () => {
    const s = new SoundfontStore(tmp());
    assert.equal(s.info(), null);
    assert.equal(s.path(), null);
    const info = await s.save(Readable.from([sf2(1000)]), 'C:\\fonts\\Good Bank.SF2');
    assert.equal(info.name, 'Good Bank.SF2');
    assert.equal(info.size, 1000);
    assert.equal(s.info()?.size, 1000);
    assert.ok(s.path()?.endsWith('custom.sf2'));
    s.remove();
    assert.equal(s.info(), null);
  });

  it('rejects other formats and incomplete files, and keeps the installed bank', async () => {
    const s = new SoundfontStore(tmp());
    await s.save(Readable.from([sf2(100)]), 'a.sf2');
    await assert.rejects(s.save(Readable.from([sf2(100)]), 'a.sf3'), /\.sf2/);
    await assert.rejects(s.save(Readable.from([Buffer.from('definitely not riff data')]), 'a.sf2'), /not a SoundFont/);
    await assert.rejects(s.save(Readable.from([sf2(100, 9000)]), 'a.sf2'), /incomplete/);
    await assert.rejects(s.save(Object.assign(Readable.from([sf2(100)]), { truncated: true }), 'a.sf2'), /larger than/);
    assert.equal(s.info()?.name, 'a.sf2');
    assert.equal(s.info()?.size, 100);
  });
});

describe('writeSoundfontProperty', () => {
  it('adds, replaces and removes only its own key', () => {
    const d = tmp();
    const file = path.join(d, 'property.txt');
    writeSoundfontProperty(d, null);
    assert.equal(existsSync(file), false, 'nothing to write, nothing written');
    writeSoundfontProperty(d, '/data/soundfont/custom.sf2');
    assert.equal(readFileSync(file, 'utf8'), 'SoundfontPath=/data/soundfont/custom.sf2\n');
    writeFileSync(file, 'Other=1\nSoundfontPath=/old.sf2\nMore=2\n');
    writeSoundfontProperty(d, '/new.sf2');
    assert.equal(readFileSync(file, 'utf8'), 'Other=1\nMore=2\nSoundfontPath=/new.sf2\n');
    writeSoundfontProperty(d, null);
    assert.equal(readFileSync(file, 'utf8'), 'Other=1\nMore=2\n');
    writeFileSync(file, 'SoundfontPath=\n');
    writeSoundfontProperty(d, null);
    assert.equal(existsSync(file), false, 'a file that only held the key is removed');
  });
});
