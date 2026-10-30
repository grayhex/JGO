import { readdirSync, readFileSync } from 'node:fs';

const CLK_TCK = 100; // Linux USER_HZ; fixed by the kernel ABI on all supported platforms

interface Proc { pid: number; ppid: number; ticks: number; rssKb: number }

function readProc(pid: number): Proc | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const status = readFileSync(`/proc/${pid}/status`, 'utf8');
    const rss = /VmRSS:\s+(\d+)/.exec(status);
    return { pid, ppid: Number(rest[1]), ticks: Number(rest[11]) + Number(rest[12]), rssKb: rss ? Number(rss[1]) : 0 };
  } catch {
    return null;
  }
}

/** CPU ticks and RSS summed over `root` and all its descendants (Linux only; null elsewhere). */
export function sampleTree(root: number): { ticks: number; rssKb: number; pids: number[] } | null {
  let all: Proc[];
  try {
    all = readdirSync('/proc').filter((d) => /^\d+$/.test(d)).map((d) => readProc(Number(d))).filter((p): p is Proc => !!p);
  } catch {
    return null;
  }
  const byParent = new Map<number, Proc[]>();
  for (const p of all) (byParent.get(p.ppid) ?? byParent.set(p.ppid, []).get(p.ppid)!).push(p);
  const rootProc = all.find((p) => p.pid === root);
  if (!rootProc) return null;
  const stack = [rootProc];
  let ticks = 0, rssKb = 0;
  const pids: number[] = [];
  while (stack.length) {
    const p = stack.pop()!;
    ticks += p.ticks;
    rssKb += p.rssKb;
    pids.push(p.pid);
    for (const c of byParent.get(p.pid) ?? []) stack.push(c);
  }
  return { ticks, rssKb, pids };
}

/** Accumulates samples into the ResourceUsage numbers reported by the API. */
export class ResourceMeter {
  private last: { t: number; ticks: number } | null = null;
  private startT = Date.now();
  peakRssKb = 0;
  rssKb = 0;
  cpuSeconds = 0;
  now = 0;
  /** Highest tick count seen: the tree shrinks when child processes exit. */
  private maxTicks = 0;

  sample(rootPid: number | null): void {
    if (!rootPid) return;
    const s = sampleTree(rootPid);
    if (!s) return;
    const t = Date.now();
    this.rssKb = s.rssKb;
    this.peakRssKb = Math.max(this.peakRssKb, s.rssKb);
    this.maxTicks = Math.max(this.maxTicks, s.ticks);
    this.cpuSeconds = this.maxTicks / CLK_TCK;
    if (this.last && t > this.last.t) this.now = Math.max(0, ((s.ticks - this.last.ticks) / CLK_TCK / ((t - this.last.t) / 1000)) * 100);
    this.last = { t, ticks: s.ticks };
  }

  usage() {
    const up = Math.max(0.001, (Date.now() - this.startT) / 1000);
    const r = (n: number) => Math.round(n * 10) / 10;
    return { rssMb: r(this.rssKb / 1024), peakRssMb: r(this.peakRssKb / 1024), cpuSeconds: r(this.cpuSeconds), cpuPercentAvg: r((this.cpuSeconds / up) * 100), cpuPercentNow: r(this.now) };
  }
}
