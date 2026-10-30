import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { GameLabConfig, LabInput } from './runner.js';

/** Finds .jar files below the given files/directories and pairs each with a same-named .jad. */
export function discoverGames(paths: string[], configs: Record<string, GameLabConfig> = {}): LabInput[] {
  const jars: string[] = [];
  const jads = new Map<string, string>();
  const walk = (p: string, depth: number) => {
    const st = statSync(p);
    if (st.isDirectory()) {
      if (depth > 6) return;
      for (const e of readdirSync(p).sort()) if (!e.startsWith('.')) walk(path.join(p, e), depth + 1);
    } else if (/\.jar$/i.test(p)) jars.push(p);
    else if (/\.jad$/i.test(p)) jads.set(p.replace(/\.jad$/i, '').toLowerCase(), p);
  };
  for (const p of paths) walk(path.resolve(p), 0);
  return jars.map((jar) => {
    const base = path.basename(jar);
    const cfg = configs[base] ?? configs[base.replace(/\.jar$/i, '')];
    return { jarPath: jar, jadPath: jads.get(jar.replace(/\.jar$/i, '').toLowerCase()), label: base.replace(/\.jar$/i, ''), ...(cfg ? { config: cfg } : {}) };
  });
}
