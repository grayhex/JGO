import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { DevicePreset, KeyCodes, LayoutId } from '@j2me-web/protocol';
import { unzipSync } from 'fflate';

/**
 * Device presets come from KEmulator itself (res/presets.xml inside the emulator jar), so the
 * list always matches the pinned emulator build. Nothing here is invented except the optional
 * `platform` string, which we only set for vendors with a well-known microedition.platform shape.
 */

const LAYOUT_IDS: Record<string, LayoutId> = {
  nokia: 'nokia', motorola: 'motorola', motorola_triplets: 'motorola-triplets', motorolav8: 'motorola-v8', siemens: 'siemens',
  lg: 'lg', sagem: 'sagem', sharp: 'sharp', motorola_i670: 'motorola-i670', motorola_v300: 'motorola-v300',
};

interface RawLayout { name: string; parent: string | null; defs: Record<string, string> }

export function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100);
}

function defs(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/<define\s+name="([^"]+)"\s+value="([^"]*)"\s*\/>/g)) out[m[1]!] = m[2]!;
  return out;
}

function vendorOf(name: string, comment: string): DevicePreset['vendor'] {
  // presets named "(COMMON - ...)" are generic sizes; the comment only says which phone has that screen
  if (/\(common\b/i.test(name)) return 'common';
  const t = `${name} ${comment}`.toLowerCase();
  if (t.includes('sony ericsson')) return 'sonyericsson';
  if (t.includes('nokia')) return 'nokia';
  if (t.includes('samsung')) return 'samsung';
  if (t.includes('motorola')) return 'motorola';
  if (t.includes('siemens')) return 'siemens';
  if (t.includes('(lg') || /\blg\b/.test(t)) return 'lg';
  if (t.includes('sharp') || t.includes('docomo') || t.includes('panasonic')) return 'sharp';
  if (t.includes('softbank')) return 'softbank';
  if (t.includes('common')) return 'common';
  return 'other';
}

/** Conventional microedition.platform values (model without firmware revision). */
function platformOf(vendor: DevicePreset['vendor'], model: string): string | null {
  const m = model.trim();
  if (vendor === 'nokia') {
    const x = /^Nokia\s+([A-Za-z]?\d[\w-]*)/i.exec(m);
    return x ? `Nokia${x[1]}` : null;
  }
  if (vendor === 'sonyericsson') {
    const x = /^Sony Ericsson\s+([A-Za-z]\d{3}[a-z]?i?)\b/i.exec(m);
    return x ? `SonyEricsson${x[1]}` : null;
  }
  return null;
}

export function parsePresets(xml: string): { presets: DevicePreset[]; defaultName: string | null } {
  const layouts = new Map<string, RawLayout>();
  for (const m of xml.matchAll(/<layout\s+name="([^"]+)"(?:\s+parent="([^"]+)")?\s*>([\s\S]*?)<\/layout>/g)) {
    layouts.set(m[1]!.toLowerCase(), { name: m[1]!, parent: m[2] ?? null, defs: defs(m[3]!) });
  }
  const resolve = (name: string): Record<string, string> => {
    const l = layouts.get(name.toLowerCase());
    if (!l) return {};
    return { ...(l.parent ? resolve(l.parent) : {}), ...l.defs };
  };
  const out: DevicePreset[] = [];
  // walk comments and presets in document order; the last comment before a preset names the phone
  const token = /<!--([\s\S]*?)-->|<preset\s+name="([^"]+)"\s+layout="([^"]+)"[^>]*>([\s\S]*?)<\/preset>/g;
  let lastComment = '';
  for (const m of xml.matchAll(token)) {
    if (m[1] !== undefined) {
      lastComment = m[1].replace(/\s+/g, ' ').trim();
      continue;
    }
    const comment = lastComment;
    lastComment = '';
    const name = m[2]!;
    const layoutName = m[3]!;
    const d = { ...resolve(layoutName), ...defs(m[4]!) };
    const num = (k: string, def = 0) => (d[k] !== undefined && /^-?\d+$/.test(d[k]!) ? Number(d[k]) : def);
    const w = num('SCREEN_WIDTH'), h = num('SCREEN_HEIGHT');
    if (!w || !h) continue;
    const keys: KeyCodes = { up: num('KEY_UP'), down: num('KEY_DOWN'), left: num('KEY_LEFT'), right: num('KEY_RIGHT'), fire: num('KEY_FIRE'), softLeft: num('KEY_S1'), softRight: num('KEY_S2'), clear: -8 };
    const vendor = vendorOf(name, comment);
    // a bare vendor heading such as "Nokia" or "Sony Ericsson" is not a model
    const model = /^(nokia|sony ericsson|samsung|motorola|siemens|lg|sharp|common)?$/i.test(comment) ? '' : comment;
    const notes: string[] = [];
    if (d.FORCE_FULLSCREEN === 'true') notes.push('Forces full-screen mode: Canvas.setFullScreenMode(false) is ignored (KEmulator FORCE_FULLSCREEN).');
    else notes.push('Honours Canvas.setFullScreenMode; non-fullscreen canvases lose the soft-key bar height.');
    if (layoutName.toLowerCase().startsWith('motorola')) notes.push('Motorola key codes (d-pad is not -1..-4).');
    if (layoutName.toLowerCase() === 'siemens') notes.push('Siemens key codes; soft keys are -1/-4.');
    if (vendor === 'common') notes.push(model ? `Generic size preset (modelled on ${model}); emulator default platform string is kept.` : 'Generic size preset; emulator default platform string is kept.');
    out.push({
      id: slug(name), name, model, vendor, width: w, height: h, forceFullscreen: d.FORCE_FULLSCREEN === 'true',
      layout: LAYOUT_IDS[layoutName.toLowerCase()] ?? 'nokia', layoutName, keys, platform: platformOf(vendor, model), notes,
    });
  }
  const dm = /<default\s+value="([^"]+)"/.exec(xml);
  return { presets: out, defaultName: dm ? dm[1]! : null };
}

let cache: { key: string; presets: DevicePreset[]; defaultName: string | null } | null = null;

/** Reads presets.xml from <kemDir>/KEmulator.jar. */
export function loadDevicePresets(kemDir: string): { presets: DevicePreset[]; defaultName: string | null } {
  const jar = path.join(kemDir, 'KEmulator.jar');
  if (cache?.key === jar) return cache;
  const files = unzipSync(readFileSync(jar), { filter: (f) => f.name === 'res/presets.xml' });
  const xml = files['res/presets.xml'];
  if (!xml) throw new Error(`res/presets.xml not found in ${jar}`);
  const parsed = parsePresets(new TextDecoder().decode(xml));
  cache = { key: jar, ...parsed };
  return parsed;
}

export function findPreset(presets: DevicePreset[], id: string): DevicePreset | undefined {
  return presets.find((p) => p.id === id);
}

export interface PresetHints {
  family: string;
  screens: { width: number; height: number }[];
}

/**
 * Picks a preset from analysis hints, or null when there is no evidence worth overriding the
 * emulator default for:
 *  - a screen-size hint (JAD attribute / file name) selects the preset with that size, preferring the platform family's vendor;
 *  - without a size hint, only families whose key codes differ from the Nokia/Sony Ericsson codes (Siemens, Motorola, DoJa, J-Phone)
 *    get a preset, so their keys work; the one closest to a typical 176x208 screen is used.
 */
export function recommendPreset(presets: DevicePreset[], h: PresetHints): DevicePreset | null {
  const wantedVendors: Record<string, DevicePreset['vendor'][]> = {
    nokia: ['nokia', 'common'], sonyericsson: ['sonyericsson', 'common'], siemens: ['siemens'], motorola: ['motorola'],
    samsung: ['samsung', 'common'], lg: ['lg', 'common'], doja: ['sharp'], jphone: ['softbank', 'motorola'], generic: ['common', 'nokia'],
  };
  const vendors = wantedVendors[h.family] ?? ['common'];
  if (h.screens.length) {
    const score = (p: DevicePreset): number => {
      const hit = h.screens.findIndex((sc) => sc.width === p.width && sc.height === p.height);
      if (hit < 0) return 0;
      const vi = vendors.indexOf(p.vendor);
      return 100 - hit * 5 + (vi >= 0 ? 10 - vi * 3 : 0);
    };
    const best = presets.map((p) => ({ p, s: score(p) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s)[0];
    return best?.p ?? null;
  }
  if (!['siemens', 'motorola', 'doja', 'jphone'].includes(h.family)) return null;
  const typical = 176 * 208;
  const pool = presets.filter((p) => vendors.includes(p.vendor));
  return pool.sort((a, b) => Math.abs(a.width * a.height - typical) - Math.abs(b.width * b.height - typical))[0] ?? null;
}
