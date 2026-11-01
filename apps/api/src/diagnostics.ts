import { execFile } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { SessionStatus } from '@mgo/protocol';

/** The emulator's JVM is the process started with `-bridge <this session's bridge directory>`. */
export function findJvmPid(bridgeDir: string): number | null {
  let entries: string[];
  try { entries = readdirSync('/proc'); } catch { return null; }
  for (const e of entries) {
    if (!/^\d+$/.test(e)) continue;
    try {
      const args = readFileSync(`/proc/${e}/cmdline`, 'latin1').split('\0');
      // the adapter and an `unshare` wrapper carry the same arguments: only the JVM itself counts
      if (path.basename(args[0] ?? '') !== 'java') continue;
      const i = args.indexOf('-bridge');
      if (i >= 0 && args[i + 1] === path.resolve(bridgeDir) && args.some((a) => a.endsWith('KEmulator.jar'))) return Number(e);
    } catch { /* the process ended while we looked */ }
  }
  return null;
}

function jcmdBin(javaBin: string): string {
  return javaBin.includes('/') ? path.join(path.dirname(javaBin), 'jcmd') : 'jcmd';
}

function jcmd(javaBin: string, pid: number, command: string, timeoutMs = 8000): Promise<string> {
  return new Promise((resolve) => {
    execFile(jcmdBin(javaBin), [String(pid), command], { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      // the JVM prints its JAVA_TOOL_OPTIONS banner on stderr before anything else
      const clean = (t: string) => t.split('\n').filter((l) => l.trim() && !l.startsWith('Picked up ')).join('\n').trim();
      if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') resolve('(jcmd is not installed: the JRE-only install has no JVM tools; apt install openjdk-21-jdk-headless adds them)');
      else if (err) resolve(`(unavailable: ${clean(`${stderr}\n${stdout}`).split('\n')[0]?.slice(0, 200) || err.message.slice(0, 200)})`);
      else resolve(clean(stdout.toString()));
    });
  });
}

export interface DiagnosticsInput {
  status: SessionStatus;
  gameName: string;
  settings: unknown;
  logTail: string[];
  bridgeDir: string;
  javaBin: string;
  version: string;
  /** More sections, for example the Symbian service's own report. */
  extra?: { title: string; body: string }[];
}

/** The failure of a Symbian / N-Gage start in words: what stopped, the facts it rests on, and what MGO concludes. */
export function describeFailure(f: NonNullable<SessionStatus['failure']>): string {
  const L: string[] = [];
  L.push(`RESULT: ${f.cause} at step "${f.stage}" after ${(f.elapsedMs / 1000).toFixed(1)} s`, `MESSAGE: ${f.message}`);
  L.push(`APPLICATION: ${f.appName ?? '(unknown)'} UID ${f.uid ?? '(none yet)'}   PLATFORM: ${f.platform}`);
  L.push(`FIRMWARE: ${f.firmware ? `${f.firmware.manufacturer} ${f.firmware.model} (${f.firmware.code})${f.firmware.os ? `, ${f.firmware.os}` : ''}` : '(not chosen)'}`);
  if (f.likelyIncompatibleGame) L.push('', '>>> The facts point at an INCOMPATIBILITY between this game and EKA2L1 / this firmware, not at MGO settings. <<<');
  if (f.launch) L.push('', `LAUNCH ANSWER: HTTP ${f.launch.httpStatus}${f.launch.code ? ` ${f.launch.code}` : ''}${f.launch.message ? ` "${f.launch.message}"` : ''}${f.launch.session ? ` session=${JSON.stringify(f.launch.session)}` : ''}`);
  if (f.timeline.length) L.push('', 'SESSION STATES SEEN (ms since the start of the wait):', ...f.timeline.map((t) => `  +${t.atMs} ms  state=${t.state}  screenVisible=${t.screenVisible}${t.lastExit ? `  lastExit=${JSON.stringify(t.lastExit)}` : ''}`));
  if (f.screenshots.length) L.push('', 'SCREENSHOT ANSWERS (changes only):', ...f.screenshots.map((t) => `  +${t.atMs} ms  ${t.result}${t.httpStatus ? ` HTTP ${t.httpStatus}` : ''}${t.code ? ` ${t.code}` : ''}${t.frame !== null ? ` frame ${t.frame}` : ''}`));
  L.push('', `EMULATOR STATUS: ${JSON.stringify(f.status)}`);
  if (f.emulatorErrors.length) L.push('', 'ERROR LINES OF THE EMULATOR LOG:', ...f.emulatorErrors.map((x) => `  ${x}`));
  if (f.fontNotes.length) L.push('', 'FONT LINES:', ...f.fontNotes.map((x) => `  ${x}`));
  if (f.hints.length) L.push('', 'WHAT THIS MEANS:', ...f.hints.map((x) => `  - ${x}`));
  return L.join('\n');
}

/**
 * A plain-text report for whoever has to work out why a game misbehaves: the session and its settings, the emulator
 * log and, while the emulator runs, what the JVM is doing (heap, threads). It holds no tokens or secrets.
 */
export async function buildDiagnostics(i: DiagnosticsInput): Promise<string> {
  const out: string[] = [];
  const section = (title: string, body: string) => out.push(`==== ${title} ====`, body, '');
  out.push(`MGO ${i.version} diagnostics for "${i.gameName}" - ${new Date().toISOString()}`, '');
  const { logTail: _ignored, ...status } = i.status;
  if (i.status.failure) section('start failure', describeFailure(i.status.failure));
  section('session', JSON.stringify(status, null, 2));
  section('game settings', JSON.stringify(i.settings, null, 2));
  const pid = i.status.backend !== 'eka2l1' && (i.status.state === 'running' || i.status.state === 'stopping') ? findJvmPid(i.bridgeDir) : null;
  if (i.status.backend === 'eka2l1') section('JVM', '(this game runs in EKA2L1, not in the Java emulator)');
  else if (pid === null) section('JVM', '(the emulator is not running, so there is no live JVM data)');
  else {
    section('JVM version', await jcmd(i.javaBin, pid, 'VM.version'));
    section('JVM heap', await jcmd(i.javaBin, pid, 'GC.heap_info'));
    section('JVM threads', await jcmd(i.javaBin, pid, 'Thread.print'));
  }
  section(`emulator log (last ${i.logTail.length} lines)`, i.logTail.join('\n'));
  for (const e of i.extra ?? []) section(e.title, e.body);
  return out.join('\n');
}
