import { createWriteStream, lstatSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, type Dirent } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import type { GameFileEntry } from '@j2me-web/protocol';
import { UploadError } from './jar.js';

/** Most a game may keep in its file area, and most entries one listing shows. */
export const GAME_FILES_QUOTA_BYTES = 64 * 1024 * 1024;
export const GAME_FILES_MAX_ENTRIES = 1000;

/**
 * The file area of one game: what the MIDlet sees as `file:///` (JSR-75) lives in `<saves>/file`. Every path from the
 * client is relative to it and checked segment by segment: no `..`, no absolute paths, no backslashes or NUL, and
 * nothing that goes through a symbolic link, so a request can never reach anything outside this directory.
 */
export class GameFiles {
  readonly root: string;

  constructor(savesDir: string) {
    this.root = path.join(savesDir, 'file');
  }

  /** The absolute path for `rel`, or an UploadError. The path may not exist yet. */
  resolve(rel: string): string {
    if (rel.includes('\0') || rel.includes('\\')) throw new UploadError('bad_path', 'Invalid path', 400);
    const parts = rel.split('/').filter((p) => p !== '' && p !== '.');
    if (parts.some((p) => p === '..')) throw new UploadError('bad_path', 'Invalid path', 400);
    let cur = this.root;
    let exists = true;
    for (const p of parts) {
      cur = path.join(cur, p);
      if (!exists) continue; // below a folder that does not exist yet there is nothing that could be a link
      try {
        if (lstatSync(cur).isSymbolicLink()) throw new UploadError('bad_path', 'Links are not followed', 403);
      } catch (e) {
        if (e instanceof UploadError) throw e;
        exists = false;
      }
    }
    return cur;
  }

  list(rel: string): { entries: GameFileEntry[]; truncated: boolean } {
    const dir = this.resolve(rel);
    let items: Dirent[];
    try {
      items = readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { entries: [], truncated: false };
      throw new UploadError('not_a_directory', 'Not a directory', 400);
    }
    const entries: GameFileEntry[] = [];
    for (const d of items) {
      if (d.isSymbolicLink() || (!d.isDirectory() && !d.isFile())) continue;
      const st = statSync(path.join(dir, d.name));
      entries.push({ name: d.name, dir: d.isDirectory(), size: d.isDirectory() ? 0 : st.size, modified: st.mtime.toISOString() });
    }
    entries.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
    return { entries: entries.slice(0, GAME_FILES_MAX_ENTRIES), truncated: entries.length > GAME_FILES_MAX_ENTRIES };
  }

  /** Absolute path of a regular file for download. */
  file(rel: string): { abs: string; size: number } {
    const abs = this.resolve(rel);
    try {
      const st = lstatSync(abs);
      if (!st.isFile()) throw new UploadError('not_a_file', 'Not a file', 400);
      return { abs, size: st.size };
    } catch (e) {
      if (e instanceof UploadError) throw e;
      throw new UploadError('not_found', 'No such file', 404);
    }
  }

  usedBytes(dir = this.root): number {
    let total = 0;
    let items: Dirent[];
    try { items = readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
    for (const d of items) {
      const p = path.join(dir, d.name);
      if (d.isDirectory()) total += this.usedBytes(p);
      else if (d.isFile()) total += statSync(p).size;
    }
    return total;
  }

  /** Streams an upload into `dirRel/name`; refuses to go over the quota and never overwrites a directory. */
  async save(dirRel: string, filename: string, src: Readable & { truncated?: boolean }): Promise<GameFileEntry> {
    // eslint-disable-next-line no-control-regex
    const name = path.basename(filename.replace(/\\/g, '/')).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 120);
    if (!name || name === '.' || name === '..') throw new UploadError('bad_path', 'The file needs a name', 400);
    const dir = this.resolve(dirRel);
    const target = this.resolve([dirRel, name].join('/'));
    try {
      if (lstatSync(target).isDirectory()) throw new UploadError('exists', 'A folder with this name exists', 409);
    } catch (e) {
      if (e instanceof UploadError) throw e;
    }
    let existing = 0;
    try { existing = lstatSync(target).size; } catch { /* new file */ }
    const others = this.usedBytes() - existing; // measured before the upload file exists
    mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `.upload-${process.pid}-${Date.now()}`);
    try {
      await pipeline(src, createWriteStream(tmp, { mode: 0o640 }));
      if (src.truncated) throw new UploadError('too_large', 'The file is too large', 413);
      if (others + statSync(tmp).size > GAME_FILES_QUOTA_BYTES) throw new UploadError('quota', `The game's file area is limited to ${GAME_FILES_QUOTA_BYTES / (1024 * 1024)} MB`, 413);
      renameSync(tmp, target);
    } finally {
      rmSync(tmp, { force: true });
    }
    const st = statSync(target);
    return { name, dir: false, size: st.size, modified: st.mtime.toISOString() };
  }

  remove(rel: string): void {
    const abs = this.resolve(rel);
    if (abs === this.root) throw new UploadError('bad_path', 'The file area itself cannot be deleted', 400);
    try { lstatSync(abs); } catch { throw new UploadError('not_found', 'No such file or folder', 404); }
    rmSync(abs, { recursive: true, force: true });
  }
}
