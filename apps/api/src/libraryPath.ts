import { accessSync, constants, lstatSync, opendirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import type { LibraryCheck, LibraryRoot } from '@j2me-web/protocol';
import type { Config } from './config.js';

/**
 * Everything the API may read from the container's filesystem goes through here. A library directory is only
 * accepted when its *real* path (symlinks resolved) is a configured root or inside one, so neither `..` nor a
 * symlink can lead out of it. Directory walking never follows symlinks.
 */

export const MAX_DEPTH = 16;
export const MAX_ENTRIES = 100_000;
const CHECK_BUDGET_MS = 4000;

export function allowedRoots(cfg: Pick<Config, 'libraryRoots' | 'dataDir'>): string[] {
  return [...new Set([...cfg.libraryRoots, path.join(cfg.dataDir, 'import')])];
}

function realOrNull(p: string): string | null {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}

export function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** The real path of `p` when it is a root or inside one, else null (also null when it does not exist). */
export function resolveInsideRoots(cfg: Pick<Config, 'libraryRoots' | 'dataDir'>, p: string): { real: string; root: string } | null {
  if (typeof p !== 'string' || !path.isAbsolute(p) || p.includes('\0')) return null;
  const real = realOrNull(p);
  if (!real) return null;
  for (const r of allowedRoots(cfg)) {
    const rr = realOrNull(r);
    if (rr && isInside(rr, real)) return { real, root: rr };
  }
  return null;
}

function can(p: string, mode: number): boolean {
  try {
    accessSync(p, mode);
    return true;
  } catch {
    return false;
  }
}

export function listRoots(cfg: Pick<Config, 'libraryRoots' | 'dataDir'>): LibraryRoot[] {
  return allowedRoots(cfg).map((r) => {
    const real = realOrNull(r);
    if (!real) return { path: r, exists: false, readable: false, writable: false, note: 'not present: add the directory (see docs/PROXMOX.md, "Game library")' };
    let isDir = false;
    try { isDir = statSync(real).isDirectory(); } catch { /* gone */ }
    const readable = isDir && can(real, constants.R_OK | constants.X_OK);
    const writable = isDir && can(real, constants.W_OK);
    return { path: r, exists: isDir, readable, writable, note: !isDir ? 'not a directory' : !readable ? 'not readable by the jgo user' : writable ? 'writable (a read-only mount is safer; JGO never writes here)' : null };
  });
}

export interface WalkEntry {
  rel: string;
  abs: string;
  size: number;
  mtimeMs: number;
  kind: 'jar' | 'jad';
}

export interface WalkStats {
  entries: number;
  symlinksSkipped: number;
  truncated: boolean;
  unreadableDirs: string[];
}

const SKIP_DIRS = new Set(['__MACOSX', '.git', '.svn', '$RECYCLE.BIN', 'System Volume Information', 'lost+found']);

/** Recursive walk that stays inside `root`: symlinks are skipped, depth and entry count are bounded. */
export async function* walkLibrary(root: string, stats: WalkStats, isCancelled: () => boolean = () => false): AsyncGenerator<WalkEntry> {
  const stack: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];
  while (stack.length) {
    if (isCancelled()) return;
    const { dir, depth } = stack.pop()!;
    let handle;
    try {
      handle = opendirSync(dir);
    } catch {
      stats.unreadableDirs.push(path.relative(root, dir) || '.');
      continue;
    }
    const dirs: string[] = [];
    try {
      for (let ent = handle.readSync(); ent; ent = handle.readSync()) {
        if (++stats.entries > MAX_ENTRIES) { stats.truncated = true; return; }
        const name = ent.name;
        if (ent.isSymbolicLink()) { stats.symlinksSkipped++; continue; }
        const abs = path.join(dir, name);
        if (ent.isDirectory()) {
          if (depth < MAX_DEPTH && !SKIP_DIRS.has(name)) dirs.push(abs);
          continue;
        }
        if (!ent.isFile() || name.startsWith('._')) continue; // "._x.jar" are macOS resource forks
        const lower = name.toLowerCase();
        const kind = lower.endsWith('.jar') ? 'jar' : lower.endsWith('.jad') ? 'jad' : null;
        if (!kind) continue;
        let st;
        try { st = lstatSync(abs); } catch { continue; }
        if (!st.isFile()) continue;
        yield { rel: path.relative(root, abs), abs, size: st.size, mtimeMs: Math.floor(st.mtimeMs), kind };
      }
    } finally {
      try { handle.closeSync(); } catch { /* already closed */ }
    }
    dirs.sort().reverse().forEach((d) => stack.push({ dir: d, depth: depth + 1 }));
  }
}

/** Is the path usable as the game library? Also counts what is in there (bounded, so a huge tree cannot stall the API). */
export async function checkLibraryDir(cfg: Pick<Config, 'libraryRoots' | 'dataDir'>, p: string): Promise<LibraryCheck> {
  const out: LibraryCheck = { ok: false, path: p, exists: false, isDirectory: false, readable: false, writable: false, insideRoot: false, jarCount: 0, jadCount: 0, totalBytes: 0, truncated: false, problems: [], warnings: [] };
  if (typeof p !== 'string' || !path.isAbsolute(p) || p.includes('\0')) {
    out.problems.push('The path must be absolute.');
    return out;
  }
  // Whether something exists outside the allowed locations is none of the caller's business: one answer for "missing" and "forbidden".
  const hit = resolveInsideRoots(cfg, p);
  if (!hit) {
    out.problems.push(`The directory does not exist, is not visible to the jgo user, or is outside the allowed library locations (${allowedRoots(cfg).join(', ')}). Mount the folder into the container at one of them.`);
    return out;
  }
  const real = hit.real;
  out.exists = true;
  out.insideRoot = true;
  let st;
  try { st = statSync(real); } catch { st = null; }
  out.isDirectory = !!st?.isDirectory();
  if (!out.isDirectory) {
    out.problems.push('The path is not a directory.');
    return out;
  }
  out.readable = can(real, constants.R_OK | constants.X_OK);
  out.writable = can(real, constants.W_OK);
  if (!out.readable) {
    out.problems.push('The jgo user cannot read this directory. In an unprivileged container the host files must be readable by "others" (or mapped to the container uid), see docs/PROXMOX.md.');
    return out;
  }
  if (out.writable) out.warnings.push('The directory is writable. JGO never writes there; a read-only bind mount (ro=1) is recommended.');
  const stats: WalkStats = { entries: 0, symlinksSkipped: 0, truncated: false, unreadableDirs: [] };
  const t0 = Date.now();
  for await (const e of walkLibrary(real, stats)) {
    if (e.kind === 'jar') { out.jarCount++; out.totalBytes += e.size; } else out.jadCount++;
    if (Date.now() - t0 > CHECK_BUDGET_MS) { stats.truncated = true; break; }
  }
  out.truncated = stats.truncated;
  if (stats.truncated) out.warnings.push('The directory is large: the numbers above are a partial count.');
  if (stats.symlinksSkipped) out.warnings.push(`${stats.symlinksSkipped} symbolic link(s) are ignored: JGO never follows links out of the library directory.`);
  if (stats.unreadableDirs.length) out.warnings.push(`${stats.unreadableDirs.length} sub-director${stats.unreadableDirs.length === 1 ? 'y is' : 'ies are'} not readable and will be skipped.`);
  if (out.jarCount === 0) out.warnings.push('No .jar files found (searched recursively).');
  out.ok = true;
  out.path = real;
  return out;
}

export interface BrowseResult {
  path: string | null;
  parent: string | null;
  dirs: { name: string; path: string }[];
  truncated: boolean;
}

/** Sub-directory names below an allowed root, for the folder picker. `null` lists the roots themselves. */
export function browseLibrary(cfg: Pick<Config, 'libraryRoots' | 'dataDir'>, p: string | null): BrowseResult | null {
  if (p === null || p === '') {
    return { path: null, parent: null, dirs: listRoots(cfg).filter((r) => r.exists).map((r) => ({ name: r.path, path: r.path })), truncated: false };
  }
  const hit = resolveInsideRoots(cfg, p);
  if (!hit) return null;
  const dirs: BrowseResult['dirs'] = [];
  let truncated = false;
  let handle;
  try {
    handle = opendirSync(hit.real);
  } catch {
    return { path: hit.real, parent: null, dirs: [], truncated: false };
  }
  try {
    for (let ent = handle.readSync(); ent; ent = handle.readSync()) {
      if (!ent.isDirectory() || ent.name.startsWith('.')) continue; // symlinks are not directories here
      if (dirs.length >= 500) { truncated = true; break; }
      dirs.push({ name: ent.name, path: path.join(hit.real, ent.name) });
    }
  } finally {
    handle.closeSync();
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name));
  const up = path.dirname(hit.real);
  return { path: hit.real, parent: hit.real === hit.root ? null : isInside(hit.root, up) ? up : null, dirs, truncated };
}
