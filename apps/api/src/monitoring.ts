import { readFileSync } from 'node:fs';
import os from 'node:os';
const number = (file: string) => { try { const s = readFileSync(file, 'utf8').trim(); return s === 'max' ? null : Number(s); } catch { return null; } };
let previous: { cpu: number; time: number } | null = null;
/** cgroup counters cover Node and its emulators, rather than the whole Docker host. */
export function monitoring() {
  const now = performance.now();
  let cpu = process.cpuUsage().user + process.cpuUsage().system;
  let cores = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  try {
    cpu = Number(/^usage_usec (\d+)/m.exec(readFileSync('/sys/fs/cgroup/cpu.stat', 'utf8'))?.[1] ?? cpu);
    const [quota, period] = readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim().split(/\s+/);
    if (quota !== 'max') cores = Math.min(cores, Number(quota) / Number(period));
  } catch { /* native process fallback */ }
  const percent = previous && now > previous.time ? Math.max(0, Math.min(100, (cpu - previous.cpu) / ((now - previous.time) * 1000) / cores * 100)) : null;
  previous = { cpu, time: now };
  return { uptimeSeconds: process.uptime(), cpuPercent: percent, cpuCores: cores, memoryBytes: number('/sys/fs/cgroup/memory.current') ?? process.memoryUsage().rss, memoryLimitBytes: number('/sys/fs/cgroup/memory.max') ?? os.totalmem(), sessions: 0, frames: 0, audioBytes: 0, nodeVersion: process.version, platform: `${os.platform()} ${os.arch()}` };
}
