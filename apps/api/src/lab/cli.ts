#!/usr/bin/env node
/**
 * Compatibility lab CLI.
 *
 *   lab run <jar|dir>... [--out lab-out] [--device auto|none|<preset-id>] [--measure 6] [--timeout 25]
 *                        [--config lab.json] [--base URL --token T] [--ratings ratings.json]
 *   lab report [--out lab-out] [--ratings ratings.json]   re-render report.html from results.json
 *   lab analyze <jar|dir>... [--json]                      static analysis only (no emulator run)
 *   lab devices                                            list KEmulator device presets
 *
 * Games are read from wherever you point it; nothing is copied into the repository.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, readKemCommit } from '../config.js';
import { loadDevicePresets } from '../devices.js';
import { buildApp } from '../server.js';
import { analyzeJar, emulatorClassSet, readAttributes } from '../analysis/analyze.js';
import { discoverGames } from './discover.js';
import { applyRatings, renderReport, type Ratings, type ReportMeta } from './report.js';
import { type GameLabConfig, type GameResult, runGame } from './runner.js';

function parseArgs(argv: string[]) {
  const flags: Record<string, string | true> = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1];
      if (v !== undefined && !v.startsWith('--') && !['json', 'no-xvfb', 'keep'].includes(k)) { flags[k] = v; i++; } else flags[k] = true;
    } else rest.push(a);
  }
  return { flags, rest };
}

function die(msg: string): never {
  console.error(`lab: ${msg}`);
  process.exit(2);
}

function writeReport(outDir: string, results: GameResult[], meta: ReportMeta, ratings: Ratings | null): string {
  applyRatings(results, ratings);
  const shotData = new Map<string, string>();
  for (const r of results) for (const s of r.shots) {
    const f = path.join(outDir, s.file);
    if (existsSync(f)) shotData.set(s.file, `data:image/png;base64,${readFileSync(f).toString('base64')}`);
  }
  const file = path.join(outDir, 'report.html');
  writeFileSync(file, renderReport(results, meta, shotData));
  return file;
}

async function startXvfb(): Promise<{ proc: ChildProcess; display: string } | null> {
  if (!existsSync('/usr/bin/Xvfb')) return null;
  for (let n = 90; n < 130; n++) {
    if (existsSync(`/tmp/.X11-unix/X${n}`) || existsSync(`/tmp/.X${n}-lock`)) continue;
    const proc = spawn('Xvfb', [`:${n}`, '-screen', '0', '1024x768x24', '+extension', 'GLX', '-nolisten', 'tcp'], { stdio: 'ignore' });
    for (let i = 0; i < 50; i++) {
      if (existsSync(`/tmp/.X11-unix/X${n}`)) return { proc, display: `:${n}` };
      await new Promise((r) => setTimeout(r, 100));
    }
    proc.kill();
  }
  return null;
}

async function main() {
  const { flags, rest } = parseArgs(process.argv.slice(2));
  const cmd = rest.shift();
  const outDir = path.resolve(String(flags.out ?? 'lab-out'));
  const ratings: Ratings | null = flags.ratings ? JSON.parse(readFileSync(String(flags.ratings), 'utf8')) : null;
  const cfg0 = loadConfig({ ...process.env, HOST: '127.0.0.1', PORT: '0', LOG_LEVEL: 'silent', WEB_DIR: '/nonexistent', DATA_DIR: path.join(outDir, '.data') });

  if (cmd === 'devices') {
    for (const p of loadDevicePresets(cfg0.kemDir).presets) console.log(`${p.id.padEnd(58)} ${p.vendor.padEnd(12)} ${`${p.width}x${p.height}`.padEnd(8)} ${p.layout.padEnd(18)} ${p.model}`);
    return;
  }

  if (cmd === 'analyze') {
    if (!rest.length) die('analyze needs at least one jar or directory');
    const set = emulatorClassSet(path.join(cfg0.kemDir, 'KEmulator.jar'));
    const out = discoverGames(rest).map((g) => {
      const jar = readFileSync(g.jarPath);
      return { file: path.basename(g.jarPath), ...analyzeJar(jar, readAttributes(jar, g.jadPath ? readFileSync(g.jadPath) : undefined), set, g.jarPath) };
    });
    if (flags.json) console.log(JSON.stringify(out, null, 2));
    else for (const a of out) console.log(`${a.file.padEnd(40)} risk=${a.risk.padEnd(6)} family=${a.platform.family.padEnd(12)} classes=${a.classCount} v${a.classVersion.max} apis=[${a.apis.map((x) => x.id).join(',')}]${a.missingClasses.length ? ` MISSING=${a.missingClasses.length}` : ''}`);
    return;
  }

  if (cmd === 'report') {
    const resultsFile = path.join(outDir, 'results.json');
    if (!existsSync(resultsFile)) die(`${resultsFile} not found; run "lab run" first`);
    const saved = JSON.parse(readFileSync(resultsFile, 'utf8')) as { meta: ReportMeta; results: GameResult[] };
    console.log(`report: ${writeReport(outDir, saved.results, saved.meta, ratings)}`);
    return;
  }

  if (cmd !== 'run') die('usage: lab run|report|analyze|devices ... (see the header of apps/api/src/lab/cli.ts)');
  if (!rest.length) die('run needs at least one jar or directory');
  const configs: Record<string, GameLabConfig> = flags.config ? JSON.parse(readFileSync(String(flags.config), 'utf8')).games ?? {} : {};
  let inputs = discoverGames(rest, configs);
  if (flags.filter) inputs = inputs.filter((i) => i.label.toLowerCase().includes(String(flags.filter).toLowerCase()));
  if (!inputs.length) die('no .jar files found');
  mkdirSync(outDir, { recursive: true });

  let xvfb: Awaited<ReturnType<typeof startXvfb>> = null;
  const env = { ...process.env };
  if (!flags.base && !env.KEM_DISPLAY && !env.DISPLAY && !flags['no-xvfb']) {
    xvfb = await startXvfb();
    if (xvfb) { env.KEM_DISPLAY = xvfb.display; env.LIBGL_ALWAYS_SOFTWARE = '1'; console.log(`lab: started Xvfb ${xvfb.display} for 3D games`); }
    else console.log('lab: no X display available: 3D games will fail to initialise OpenGL');
  }

  let base = String(flags.base ?? '');
  let app: Awaited<ReturnType<typeof buildApp>> | null = null;
  if (!base) {
    if (!flags.keep) rmSync(path.join(outDir, '.data'), { recursive: true, force: true });
    app = await buildApp(loadConfig({ ...env, HOST: '127.0.0.1', PORT: '0', LOG_LEVEL: 'silent', WEB_DIR: '/nonexistent', DATA_DIR: path.join(outDir, '.data'), MAX_SESSIONS: '1', SESSION_MAX_MINUTES: '10' }));
    await app.fastify.listen({ host: '127.0.0.1', port: 0 });
    const addr = app.fastify.server.address();
    base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  }
  let cookie: string | undefined;
  if (flags.token) {
    const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: flags.token }) });
    cookie = r.headers.get('set-cookie')?.split(';')[0];
    if (!cookie) die('login failed');
  }

  console.log(`lab: ${inputs.length} game(s) → ${outDir}`);
  const results: GameResult[] = [];
  const defaults = { device: String(flags.device ?? 'auto'), measureSeconds: Number(flags.measure ?? 6), firstFrameTimeoutMs: Number(flags.timeout ?? 25) * 1000 };
  for (const [i, input] of inputs.entries()) {
    console.log(`[${i + 1}/${inputs.length}] ${input.label}`);
    const r = await runGame(input, { base, ...(cookie ? { cookie } : {}), outDir, defaults, log: (m) => console.log(m) });
    results.push(r);
    console.log(`  → ${r.auto.status.toUpperCase()}${r.auto.reasons.length ? ` (${r.auto.reasons.join('; ')})` : ''}${r.frames ? ` · ${r.frames.fpsIdle} fps idle · cpu ${r.resources?.cpuPercentAvg ?? '?'}% · rss ${r.resources?.peakRssMb ?? '?'} MB` : ''}`);
    writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ meta: metaOf(defaults.device), results }, null, 2)); // incremental: a crash keeps what was done
  }
  function metaOf(dev: string): ReportMeta {
    return { generatedAt: new Date().toISOString(), emulatorCommit: readKemCommit(cfg0.kemDir), host: `${os.type()} ${os.release()} · ${os.cpus().length} vCPU · ${Math.round(os.totalmem() / 2 ** 30)} GiB`, defaultsDevice: dev, title: String(flags.title ?? 'J2ME Web compatibility lab') };
  }
  const file = writeReport(outDir, results, metaOf(defaults.device), ratings);
  console.log(`\nlab: ${results.filter((r) => r.auto.status === 'pass').length} pass, ${results.filter((r) => r.auto.status === 'warn').length} warn, ${results.filter((r) => r.auto.status === 'fail').length} fail`);
  console.log(`lab: report ${file}`);
  if (app) await app.close();
  xvfb?.proc.kill('SIGKILL');
  if (flags['fail-on-error'] && results.some((r) => r.auto.status === 'fail')) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
