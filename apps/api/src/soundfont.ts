import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, openSync, readSync, closeSync } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import type { SoundfontInfo } from '@j2me-web/protocol';
import { UploadError } from './jar.js';

/** The biggest SoundFont accepted. General-purpose banks are 30-150 MB; the file is streamed to disk, not buffered. */
export const SOUNDFONT_MAX_BYTES = 256 * 1024 * 1024;

/**
 * The one MIDI SoundFont the emulator should use instead of its built-in bank (Gervill's emergency soundbank).
 * It lives at `<dataDir>/soundfont/custom.sf2`; every session start writes its path into the game's `property.txt`
 * (`SoundfontPath`, see appSettings.ts). Only SF2 is accepted: Gervill cannot read SF3.
 */
export class SoundfontStore {
  readonly dir: string;
  private readonly file: string;
  private readonly meta: string;

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, 'soundfont');
    this.file = path.join(this.dir, 'custom.sf2');
    this.meta = path.join(this.dir, 'custom.json');
  }

  info(): SoundfontInfo | null {
    if (!existsSync(this.file) || !existsSync(this.meta)) return null;
    try {
      const m = JSON.parse(readFileSync(this.meta, 'utf8')) as Partial<SoundfontInfo>;
      if (typeof m.name !== 'string' || typeof m.updatedAt !== 'string') return null;
      return { name: m.name, size: statSync(this.file).size, updatedAt: m.updatedAt };
    } catch {
      return null;
    }
  }

  /** Absolute path of the bank, or null when none is installed. */
  path(): string | null {
    return this.info() ? this.file : null;
  }

  /** Streams `src` to disk, checks that it is a complete SF2 file and replaces the installed bank. */
  async save(src: Readable & { truncated?: boolean }, filename: string): Promise<SoundfontInfo> {
    const name = cleanName(filename);
    if (!/\.sf2$/i.test(name)) throw new UploadError('unsupported_format', 'Only SoundFont 2 files (.sf2) are supported; .sf3 and other formats cannot be used by the emulator', 400);
    mkdirSync(this.dir, { recursive: true, mode: 0o750 });
    const tmp = path.join(this.dir, `upload-${process.pid}-${Date.now()}.tmp`);
    try {
      await pipeline(src, createWriteStream(tmp, { mode: 0o640 }));
      if (src.truncated) throw new UploadError('too_large', `The SoundFont is larger than ${SOUNDFONT_MAX_BYTES / (1024 * 1024)} MB`, 413);
      const problem = sf2Problem(tmp);
      if (problem) throw new UploadError('invalid_soundfont', problem, 400);
      renameSync(tmp, this.file);
    } finally {
      rmSync(tmp, { force: true });
    }
    const info = { name, size: statSync(this.file).size, updatedAt: new Date().toISOString() };
    writeFileSync(this.meta, JSON.stringify({ name: info.name, updatedAt: info.updatedAt }), { mode: 0o640 });
    return info;
  }

  remove(): void {
    rmSync(this.file, { force: true });
    rmSync(this.meta, { force: true });
  }
}

function cleanName(filename: string): string {
  // eslint-disable-next-line no-control-regex
  return path.basename(filename.replace(/\\/g, '/')).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 120) || 'soundfont.sf2';
}

/** A SoundFont is a RIFF file of form type `sfbk` whose declared length fits the file. Returns the problem, or null. */
function sf2Problem(file: string): string | null {
  const size = statSync(file).size;
  if (size < 12) return 'The file is too small to be a SoundFont';
  const head = Buffer.alloc(12);
  const fd = openSync(file, 'r');
  try {
    readSync(fd, head, 0, 12, 0);
  } finally {
    closeSync(fd);
  }
  if (head.toString('latin1', 0, 4) !== 'RIFF' || head.toString('latin1', 8, 12) !== 'sfbk') return 'This is not a SoundFont 2 file (RIFF "sfbk" header expected)';
  if (head.readUInt32LE(4) + 8 > size) return 'The SoundFont file is incomplete (shorter than its header says)';
  return null;
}
