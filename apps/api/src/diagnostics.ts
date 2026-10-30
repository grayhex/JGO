import { execFile } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { SessionStatus } from '@j2me-web/protocol';

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
      if (err) resolve(`(unavailable: ${clean(`${stderr}\n${stdout}`).split('\n')[0]?.slice(0, 200) || err.message.slice(0, 200)})`);
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
}

/**
 * A plain-text report for whoever has to work out why a game misbehaves: the session and its settings, the emulator
 * log and, while the emulator runs, what the JVM is doing (heap, threads). It holds no tokens or secrets.
 */
export async function buildDiagnostics(i: DiagnosticsInput): Promise<string> {
  const out: string[] = [];
  const section = (title: string, body: string) => out.push(`==== ${title} ====`, body, '');
  out.push(`JGO ${i.version} diagnostics for "${i.gameName}" - ${new Date().toISOString()}`, '');
  const { logTail: _ignored, ...status } = i.status;
  section('session', JSON.stringify(status, null, 2));
  section('game settings', JSON.stringify(i.settings, null, 2));
  const pid = i.status.state === 'running' || i.status.state === 'stopping' ? findJvmPid(i.bridgeDir) : null;
  if (pid === null) section('JVM', '(the emulator is not running, so there is no live JVM data)');
  else {
    section('JVM version', await jcmd(i.javaBin, pid, 'VM.version'));
    section('JVM heap', await jcmd(i.javaBin, pid, 'GC.heap_info'));
    section('JVM threads', await jcmd(i.javaBin, pid, 'Thread.print'));
  }
  section(`emulator log (last ${i.logTail.length} lines)`, i.logTail.join('\n'));
  return out.join('\n');
}
