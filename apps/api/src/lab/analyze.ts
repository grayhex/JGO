import { readFileSync } from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { parseAttributes } from '../jar.js';
import { API_FAMILIES, CHECKED_PREFIXES } from './apis.js';
import { ClassFormatError, readConstantPool } from './classfile.js';

export type Level = 'info' | 'warn' | 'error';
export type PlatformFamily = 'nokia' | 'sonyericsson' | 'siemens' | 'motorola' | 'samsung' | 'lg' | 'doja' | 'jphone' | 'generic';

export interface ApiUse {
  id: string;
  label: string;
  group: string;
  vendor?: string;
  /** number of distinct classes of this family referenced by the JAR */
  classes: number;
  examples: string[];
  /** referenced but provided neither by the JAR nor by the emulator */
  missing: string[];
  needsGl: boolean;
  note?: string;
}

export interface Finding {
  level: Level;
  code: string;
  message: string;
}

export interface ScreenHint {
  width: number;
  height: number;
  source: string;
}

export interface JarAnalysis {
  classCount: number;
  resourceCount: number;
  classVersion: { min: number; max: number };
  apis: ApiUse[];
  /** Directly referenced classes in vendor/JSR namespaces that the emulator does not provide. */
  missingClasses: string[];
  /** Same, but only mentioned as strings (Class.forName probes): usually harmless. */
  probedMissing: string[];
  needs3d: boolean;
  needsGl: boolean;
  platform: { family: PlatformFamily; evidence: string[] };
  screenHints: ScreenHint[];
  profile: string | null;
  configuration: string | null;
  findings: Finding[];
  /** Overall verdict of the static analysis, before running anything. */
  risk: 'low' | 'medium' | 'high';
}

const MAX_CLASS_BYTES = 8 * 1024 * 1024;

/** Names of all classes provided by the emulator build (internal form, no `.class`). */
export function emulatorClassSet(kemJarPath: string): Set<string> {
  const set = new Set<string>();
  unzipSync(readFileSync(kemJarPath), {
    filter: (f) => {
      if (f.name.endsWith('.class')) set.add(f.name.slice(0, -6));
      return false;
    },
  });
  return set;
}

const CLASS_TOKEN = /(?:^|[^\w/$.])L?((?:[a-z_][\w]*\/)+[A-Za-z_$][\w$]*)(?=;|$|[^\w/$])/g;
const DOTTED_TOKEN = /^(?:[a-z_][\w]*\.)+[A-Z_$][\w$]*$/;

function familyOf(name: string) {
  return API_FAMILIES.find((f) => f.prefixes.some((p) => name.startsWith(p)));
}

function inChecked(name: string): boolean {
  return CHECKED_PREFIXES.some((p) => name.startsWith(p));
}

function screenFromText(text: string, source: string, out: ScreenHint[]) {
  const m = /(\d{2,4})\s*[x,×]\s*(\d{2,4})/.exec(text);
  if (m) {
    const w = Number(m[1]), h = Number(m[2]);
    if (w >= 64 && w <= 800 && h >= 64 && h <= 800) out.push({ width: w, height: h, source });
  }
}

export function analyzeJar(jar: Uint8Array, attrs: Record<string, string>, emulatorClasses: Set<string>, jarName = ''): JarAnalysis {
  const own = new Set<string>();
  const classes: Uint8Array[] = [];
  let resourceCount = 0;
  const files = unzipSync(jar, {
    filter: (f) => {
      if (f.name.endsWith('.class')) {
        own.add(f.name.slice(0, -6));
        return f.originalSize <= MAX_CLASS_BYTES;
      }
      if (!f.name.endsWith('/')) resourceCount++;
      return false;
    },
  });
  for (const [, b] of Object.entries(files)) classes.push(b);

  let vmin = Infinity, vmax = 0;
  const direct = new Set<string>();
  const probed = new Set<string>();
  for (const bytes of classes) {
    let cp;
    try {
      cp = readConstantPool(bytes);
    } catch (e) {
      if (e instanceof ClassFormatError) continue;
      throw e;
    }
    vmin = Math.min(vmin, cp.major);
    vmax = Math.max(vmax, cp.major);
    for (const c of cp.classRefs) direct.add(c.startsWith('[') ? c.replace(/^\[+L?/, '').replace(/;$/, '') : c);
    for (const u of cp.utf8) {
      if (u.includes('/')) for (const m of u.matchAll(CLASS_TOKEN)) direct.add(m[1]!);
    }
    for (const s of cp.strings) {
      if (DOTTED_TOKEN.test(s)) probed.add(s.replace(/\./g, '/'));
      else if (/^(?:[a-z_]\w*\/)+[A-Z_$][\w$]*$/.test(s)) probed.add(s);
    }
  }
  const externalDirect = [...direct].filter((n) => !own.has(n) && inChecked(n));
  const externalProbed = [...probed].filter((n) => !own.has(n) && inChecked(n) && !direct.has(n));

  const apis: ApiUse[] = [];
  for (const fam of API_FAMILIES) {
    const used = [...new Set([...externalDirect].filter((n) => fam.prefixes.some((p) => n.startsWith(p))))].sort();
    if (!used.length) continue;
    apis.push({
      id: fam.id, label: fam.label, group: fam.group, ...(fam.vendor ? { vendor: fam.vendor } : {}),
      classes: used.length, examples: used.slice(0, 6).map((n) => n.replace(/\//g, '.')),
      missing: used.filter((n) => !emulatorClasses.has(n)).map((n) => n.replace(/\//g, '.')),
      needsGl: !!fam.needsGl, ...(fam.note ? { note: fam.note } : {}),
    });
  }
  const missingClasses = externalDirect.filter((n) => !emulatorClasses.has(n)).map((n) => n.replace(/\//g, '.')).sort();
  const probedMissing = externalProbed.filter((n) => !emulatorClasses.has(n)).map((n) => n.replace(/\//g, '.')).sort();

  // ---- platform family
  const evidence: string[] = [];
  const score: Record<string, number> = {};
  const vote = (fam: PlatformFamily, w: number, why: string) => {
    score[fam] = (score[fam] ?? 0) + w;
    if (evidence.length < 8) evidence.push(why);
  };
  for (const a of apis) {
    const map: Record<string, PlatformFamily> = { nokia: 'nokia', sonyericsson: 'sonyericsson', siemens: 'siemens', motorola: 'motorola', samsung: 'samsung', lg: 'lg', doja: 'doja', jphone: 'jphone' };
    if (a.vendor && map[a.vendor]) vote(map[a.vendor]!, 3, `uses ${a.label}`);
  }
  for (const k of Object.keys(attrs)) {
    if (/^Nokia-/i.test(k)) vote('nokia', 2, `attribute ${k}`);
    if (/^SEMC-|^Sony/i.test(k)) vote('sonyericsson', 3, `attribute ${k}`);
    if (/^MIDxlet-/i.test(k)) vote('jphone', 3, `attribute ${k}`);
    if (/^(AppName|PackageURL|AppClass)$/.test(k)) vote('doja', 3, `attribute ${k}`);
    if (/^(Siemens|SIE-)/i.test(k)) vote('siemens', 2, `attribute ${k}`);
    if (/^(Motorola|MOT-)/i.test(k)) vote('motorola', 2, `attribute ${k}`);
  }
  const nameHint = /(?:^|[^a-z])(nokia|s40|s60|se|sony|moto|motorola|siemens|samsung|lg)(?:[^a-z]|$)/i.exec(jarName);
  if (nameHint) {
    const n = nameHint[1]!.toLowerCase();
    const fam: PlatformFamily = n === 'nokia' || n === 's40' || n === 's60' ? 'nokia' : n === 'se' || n === 'sony' ? 'sonyericsson' : n === 'moto' || n === 'motorola' ? 'motorola' : (n as PlatformFamily);
    vote(fam, 1, `file name mentions "${n}"`);
  }
  const best = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
  const family: PlatformFamily = best ? (best[0] as PlatformFamily) : 'generic';

  // ---- screen hints
  const screenHints: ScreenHint[] = [];
  for (const k of ['Nokia-MIDlet-Original-Display-Size', 'SEMC-Screen-Size', 'MIDxlet-ScreenSize', 'Nokia-MIDlet-Display-Size']) if (attrs[k]) screenFromText(attrs[k]!, `attribute ${k}`, screenHints);
  screenFromText(path.basename(jarName), 'file name', screenHints);

  // ---- findings
  const findings: Finding[] = [];
  const max = vmax;
  if (classes.length === 0) findings.push({ level: 'error', code: 'no-classes', message: 'The JAR contains no readable class files.' });
  if (max >= 49) findings.push({ level: 'error', code: 'class-version', message: `Class files up to version ${max} (Java ${max - 44}). KEmulator only accepts <= 48; this JAR will not load.` });
  if (missingClasses.length) findings.push({ level: 'error', code: 'missing-api', message: `${missingClasses.length} referenced vendor/JSR class(es) are not provided by this emulator build: ${missingClasses.slice(0, 5).join(', ')}${missingClasses.length > 5 ? ', …' : ''}` });
  if (probedMissing.length) findings.push({ level: 'info', code: 'probed-api', message: `Probed by name (usually via Class.forName, handled by the game): ${probedMissing.slice(0, 4).join(', ')}${probedMissing.length > 4 ? ', …' : ''}` });
  const has = (id: string) => apis.find((a) => a.id === id);
  const needsGl = apis.some((a) => a.needsGl);
  if (needsGl) findings.push({ level: 'info', code: 'needs-gl', message: 'Uses 3D APIs: the runtime needs an X display with GLX and Mesa (software llvmpipe is fine, slower).' });
  if (has('lcdui-high')) findings.push({ level: 'warn', code: 'lcdui-high', message: 'Uses Form/List/TextBox/Alert: all are drawn into the framebuffer by software implementations; typing into a TextBox/TextField is not possible yet (Bridge "E" event is unimplemented in KEmulator).' });
  if (has('doja')) findings.push({ level: 'warn', code: 'doja', message: 'DoJa (i-appli) profile: only limited support in KEmulator.' });
  if (has('net')) findings.push({ level: 'info', code: 'network', message: 'Opens network connections; blocked unless the container is started with egress enabled.' });
  if (has('fileconn') || has('pim') || has('bluetooth') || has('wma') || has('location') || has('sensor')) {
    findings.push({ level: 'warn', code: 'optional-jsr', message: `Uses optional JSRs (${['fileconn', 'pim', 'bluetooth', 'wma', 'location', 'sensor'].filter(has).join(', ')}); behaviour depends on emulator support and sandbox policy.` });
  }
  if (has('sonyericsson')) findings.push({ level: 'warn', code: 'sonyericsson-api', message: 'Sony Ericsson API classes referenced; this emulator build ships none, so features that need them will fail.' });
  const profile = attrs['MicroEdition-Profile'] ?? null;
  const configuration = attrs['MicroEdition-Configuration'] ?? null;
  if (profile && !/MIDP-(1\.0|2\.0|2\.1)/.test(profile)) findings.push({ level: 'warn', code: 'profile', message: `Unusual MicroEdition-Profile "${profile}".` });

  const risk: JarAnalysis['risk'] = findings.some((f) => f.level === 'error') ? 'high' : findings.some((f) => f.level === 'warn') || needsGl ? 'medium' : 'low';
  return {
    classCount: classes.length, resourceCount,
    classVersion: { min: vmin === Infinity ? 0 : vmin, max: vmax },
    apis, missingClasses, probedMissing, needs3d: apis.some((a) => a.group === '3d'), needsGl,
    platform: { family, evidence }, screenHints, profile, configuration, findings, risk,
  };
}

/** Convenience for tests/CLI: manifest + JAD attributes of a jar file. */
export function readAttributes(jar: Uint8Array, jad?: Uint8Array): Record<string, string> {
  const m = unzipSync(jar, { filter: (f) => f.name.toUpperCase() === 'META-INF/MANIFEST.MF' && f.originalSize < 256 * 1024 });
  const mf = Object.values(m)[0];
  const base = mf ? parseAttributes(new TextDecoder().decode(mf)) : {};
  return jad ? { ...base, ...parseAttributes(new TextDecoder().decode(jad)) } : base;
}
