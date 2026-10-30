import { execFile } from 'node:child_process';
import { accessSync, constants, existsSync, readdirSync, statfsSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { SystemCheck, SystemStatus } from '@j2me-web/protocol';
import { type Config, readKemCommit } from './config.js';
import type { Library } from './library.js';
import { resolveInsideRoots } from './libraryPath.js';
import type { SettingsStore } from './settingsStore.js';

const LIB_DIRS = ['/usr/lib/x86_64-linux-gnu', '/usr/lib64', '/usr/lib', '/lib/x86_64-linux-gnu', '/usr/lib/aarch64-linux-gnu'];

function ldconfig(): Promise<string> {
  return new Promise((resolve) => {
    execFile('ldconfig', ['-p'], { timeout: 3000, env: { PATH: '/usr/sbin:/sbin:/usr/bin:/bin' }, maxBuffer: 4 * 1024 * 1024 }, (err, out) => resolve(err ? '' : out));
  });
}

function haveFile(re: RegExp): boolean {
  for (const d of LIB_DIRS) {
    try {
      if (readdirSync(d).some((f) => re.test(f))) return true;
      const dri = path.join(d, 'dri');
      if (existsSync(dri) && readdirSync(dri).some((f) => re.test(f))) return true;
    } catch { /* directory absent */ }
  }
  return false;
}

/** Software OpenGL (Mesa llvmpipe) is what M3G / Mascot Capsule 3D runs on in a container without a GPU. */
export async function mesaCheck(cfg: Config): Promise<SystemCheck> {
  const cache = await ldconfig();
  const has = (re: RegExp) => re.test(cache) || haveFile(re);
  const gl = has(/libGL\.so\.1/);
  const mesa = has(/libGLX_mesa\.so/) || has(/libEGL_mesa\.so/) || has(/swrast_dri\.so/) || has(/libgallium/);
  const display = cfg.display;
  const sock = display.startsWith(':') ? `/tmp/.X11-unix/X${display.slice(1).split('.')[0]}` : null;
  if (!gl || !mesa) {
    return { id: 'mesa', label: 'Mesa (software OpenGL)', state: 'warn', detail: 'libGL / Mesa not found: 2D games and sound work, 3D games (M3G, Mascot Capsule) will not.', hint: 'apt install libgl1 libgl1-mesa-dri libglx-mesa0' };
  }
  if (!display) return { id: 'mesa', label: 'Mesa (software OpenGL)', state: 'warn', detail: 'Mesa is installed but no display is configured (KEM_DISPLAY): 3D games are disabled.', hint: 'jgo doctor' };
  if (sock && !existsSync(sock)) return { id: 'mesa', label: 'Mesa (software OpenGL)', state: 'warn', detail: `Mesa is installed but the virtual display ${display} is not running.`, hint: 'systemctl status jgo-xvfb' };
  return { id: 'mesa', label: 'Mesa (software OpenGL)', state: 'ok', detail: `Mesa llvmpipe available, virtual display ${display || 'n/a'} is up.` };
}

function writable(dir: string): boolean {
  try {
    const f = path.join(dir, `.write-test-${process.pid}`);
    writeFileSync(f, 'x');
    unlinkSync(f);
    return true;
  } catch {
    return false;
  }
}

function canExec(p: string): boolean {
  try {
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function systemStatus(cfg: Config, library: Library, store: SettingsStore, java: string | null, version: string): Promise<SystemStatus> {
  const checks: SystemCheck[] = [];
  const jarPath = path.join(cfg.kemDir, 'KEmulator.jar');
  checks.push(java
    ? { id: 'java', label: 'Java', state: 'ok', detail: `OpenJDK ${java}` }
    : { id: 'java', label: 'Java', state: 'error', detail: `"${cfg.javaBin}" was not found or does not start.`, hint: 'apt install openjdk-21-jre-headless, or run `jgo doctor`' });
  const commit = readKemCommit(cfg.kemDir);
  checks.push(existsSync(jarPath)
    ? { id: 'kemulator', label: 'KEmulator', state: 'ok', detail: commit ? `KEmulator nnmod, commit ${commit.slice(0, 10)}` : 'KEmulator.jar present (commit unknown)' }
    : { id: 'kemulator', label: 'KEmulator', state: 'error', detail: 'KEmulator.jar is missing from the installation.', hint: '`jgo update`, or `jgo rollback` if it was working before' });
  const adapterOk = existsSync(cfg.adapterBin) && canExec(cfg.adapterBin);
  const runOk = (() => { try { return existsSync(cfg.runDir) ? writable(cfg.runDir) : true; } catch { return false; } })();
  checks.push(!adapterOk
    ? { id: 'bridge', label: 'Bridge (kem-adapter)', state: 'error', detail: 'The Bridge supervisor binary is missing or not executable.', hint: '`jgo update` or `jgo doctor`' }
    : !runOk
      ? { id: 'bridge', label: 'Bridge (kem-adapter)', state: 'error', detail: 'The Bridge is installed but its runtime directory is not writable.', hint: 'systemctl restart jgo' }
      : { id: 'bridge', label: 'Bridge (kem-adapter)', state: 'ok', detail: 'Supervisor installed, runtime directory writable.' });
  checks.push(await mesaCheck(cfg));

  // storage
  const dataWritable = writable(cfg.dataDir);
  let total = 0;
  let free = 0;
  try {
    const s = statfsSync(cfg.dataDir);
    total = s.blocks * s.bsize;
    free = s.bavail * s.bsize;
  } catch { /* unknown filesystem */ }
  const libraryBytes = library.totalBytes();
  const gb = (n: number) => `${(n / 1073741824).toFixed(1)} GB`;
  if (!dataWritable) checks.push({ id: 'storage', label: 'Storage', state: 'error', detail: 'The data directory is not writable: nothing can be saved.', hint: 'check the container disk and `systemctl status jgo`' });
  else if (total && free < Math.min(512 * 1024 * 1024, total * 0.05)) checks.push({ id: 'storage', label: 'Storage', state: 'warn', detail: `Only ${gb(free)} of ${gb(total)} left on the data disk.`, hint: 'grow the container disk (pct resize) or remove games' });
  else checks.push({ id: 'storage', label: 'Storage', state: 'ok', detail: total ? `${gb(free)} free of ${gb(total)}; library ${gb(libraryBytes)} of ${gb(cfg.libraryQuotaBytes)} quota` : `library ${gb(libraryBytes)}` });
  const quotaUsed = cfg.libraryQuotaBytes ? libraryBytes / cfg.libraryQuotaBytes : 0;
  if (quotaUsed > 0.9) checks.push({ id: 'quota', label: 'Library quota', state: 'warn', detail: `${Math.round(quotaUsed * 100)}% of the library quota is used.`, hint: 'raise it in Settings > Server' });

  // library directory (read access only: counting files is the job of the "check" button)
  const lp = store.get().libraryPath;
  if (lp) {
    const hit = resolveInsideRoots(cfg, lp);
    let readable = false;
    if (hit) { try { accessSync(hit.real, constants.R_OK | constants.X_OK); readable = true; } catch { /* no */ } }
    checks.push(!hit
      ? { id: 'library', label: 'Game library directory', state: 'error', detail: 'The configured directory is missing or outside the allowed locations. Is the folder mounted?', hint: 'Settings > Library' }
      : !readable
        ? { id: 'library', label: 'Game library directory', state: 'error', detail: 'The directory exists but the jgo user cannot read it.', hint: 'docs/PROXMOX.md, "Game library": file permissions and uid mapping' }
        : { id: 'library', label: 'Game library directory', state: 'ok', detail: 'Readable.' });
  } else {
    checks.push({ id: 'library', label: 'Game library directory', state: 'ok', detail: 'Not configured (optional): games can still be uploaded.' });
  }
  const moby = store.mobygamesInfo();
  checks.push({ id: 'mobygames', label: 'MobyGames', state: 'ok', detail: moby.configured ? `API key configured (${moby.source === 'environment' ? 'from the environment' : 'stored on the server'}).` : 'No API key (optional): the library works with the metadata inside the JAR files.' });
  return { version, checks, storage: { totalBytes: total, freeBytes: free, libraryBytes, quotaBytes: cfg.libraryQuotaBytes } };
}
