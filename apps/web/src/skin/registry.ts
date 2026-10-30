import { getServerSettings } from '../serverSettings';
import { useEffect, useState } from 'react';
import { ACTIONS, type Action } from '../input';
import { parseHitboxSvg } from './hitboxes';
import type { Hitbox, LoadedSkin, SkinConfig, SkinViewId } from './types';

/** The five handsets, in the order the picker shows them. Files: /phones/<id>/ (see public/phones/README.md). */
export const SKIN_IDS = ['nokia-6100', 'nokia-6230i', 'sony-ericsson-k750i', 'nokia-n95', 'nokia-e71'] as const;
export type SkinId = (typeof SKIN_IDS)[number];
/** 240x320 is the default emulated screen and the N95's real display. */
export const DEFAULT_SKIN: SkinId = 'nokia-n95';

export const skinBase = (id: string) => `/phones/${id}/`;
export const isSkinId = (v: unknown): v is SkinId => typeof v === 'string' && (SKIN_IDS as readonly string[]).includes(v);

const isAction = (v: unknown): v is Action => typeof v === 'string' && (ACTIONS as string[]).includes(v);

function check(c: SkinConfig, warnings: string[]): void {
  for (const v of ['full', 'screen'] as const) {
    const view = c.views?.[v];
    if (!view) throw new Error(`config.json of ${c.id} has no views.${v}`);
    const r = view.screenRect;
    if (!r || [r.x, r.y, r.width, r.height].some((n) => !(n >= 0 && n <= 1)) || r.x + r.width > 1.0001 || r.y + r.height > 1.0001) throw new Error(`${c.id}: views.${v}.screenRect is outside the asset`);
    if (!(view.width > 0 && view.height > 0)) throw new Error(`${c.id}: views.${v} has no size`);
  }
  const win = c.views.full.screenRect;
  const wantRatio = c.screen.width / c.screen.height;
  const haveRatio = (win.width * c.views.full.width) / (win.height * c.views.full.height);
  if (Math.abs(wantRatio / haveRatio - 1) > 0.01) warnings.push(`display window ratio ${haveRatio.toFixed(3)} differs from ${c.screen.width}×${c.screen.height} (${wantRatio.toFixed(3)})`);
}

/** Resolves a hitbox to its logical action. A missing or null mapping means "no J2ME key": nothing is ever invented. */
export function bindingFor(config: Pick<SkinConfig, 'keyMappings'>, id: string): Action | null {
  const m = config.keyMappings?.[id];
  return isAction(m) ? m : null;
}

const cache = new Map<string, Promise<LoadedSkin>>();

export function loadSkin(id: string): Promise<LoadedSkin> {
  let p = cache.get(id);
  if (!p) {
    p = (async () => {
      const base = skinBase(id);
      const res = await fetch(`${base}config.json`);
      if (!res.ok) throw new Error(`${id}: config.json HTTP ${res.status}`);
      const config = (await res.json()) as SkinConfig;
      const warnings: string[] = [];
      check(config, warnings);
      let polys = config.buttons.map((b) => ({ id: b.id, label: b.label, points: b.polygon }));
      try {
        const svg = await fetch(`${base}${config.assets.hitboxes ?? 'hitboxes.svg'}`);
        if (!svg.ok) throw new Error(`HTTP ${svg.status}`);
        const parsed = parseHitboxSvg(await svg.text(), warnings);
        if (parsed.length) polys = parsed;
        else warnings.push('hitboxes.svg has no usable polygons; using config.json polygons');
      } catch (e) {
        warnings.push(`hitboxes.svg unavailable (${(e as Error).message}); using config.json polygons`);
      }
      const known = new Set(config.buttons.map((b) => b.id));
      for (const poly of polys) if (!known.has(poly.id)) warnings.push(`hitbox ${poly.id} is not in config.buttons`);
      for (const [k, v] of Object.entries(config.keyMappings)) if (v !== null && !isAction(v)) warnings.push(`keyMappings.${k} = "${String(v)}" is not a known action; treated as unbound`);
      const hitboxes: Hitbox[] = polys.map((poly) => ({ ...poly, action: bindingFor(config, poly.id) }));
      return { config, base, hitboxes, warnings };
    })();
    cache.set(id, p);
    p.catch(() => cache.delete(id));
  }
  return p;
}

export function useSkin(id: string): { skin: LoadedSkin | null; error: string | null } {
  const [state, setState] = useState<{ id: string; skin: LoadedSkin | null; error: string | null }>({ id, skin: null, error: null });
  useEffect(() => {
    let dead = false;
    loadSkin(id).then((skin) => { if (!dead) setState({ id, skin, error: null }); }, (e: Error) => { if (!dead) setState({ id, skin: null, error: e.message }); });
    return () => { dead = true; };
  }, [id]);
  // keep showing the previous model until the next one has arrived, but never report it as the new one
  return state.id === id ? { skin: state.skin, error: state.error } : { skin: null, error: null };
}

/** Preferences are presentation only: they never touch the emulated device or its resolution. */
export interface SkinPrefs { skinId: SkinId; view: SkinViewId; integer: boolean }
export const SKIN_PREFS_KEY = 'j2me-web.skin.v1';
const KEY = SKIN_PREFS_KEY;

/** What this browser has not chosen itself comes from the server's default phone (Settings). */
function serverDefault(): { skinId: SkinId; view: SkinViewId } {
  const p = getServerSettings()?.settings.phone;
  return { skinId: isSkinId(p?.skinId) ? p.skinId : DEFAULT_SKIN, view: p?.view === 'screen' ? 'screen' : 'full' };
}

export function loadPrefs(): SkinPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<SkinPrefs> | null;
    return { skinId: isSkinId(raw?.skinId) ? raw.skinId : serverDefault().skinId, view: raw ? (raw.view === 'screen' ? 'screen' : 'full') : serverDefault().view, integer: raw?.integer !== false };
  } catch {
    return { ...serverDefault(), integer: true };
  }
}

export function savePrefs(p: SkinPrefs): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage unavailable */ }
}

export function usePrefs(): [SkinPrefs, (patch: Partial<SkinPrefs>) => void] {
  const [p, setP] = useState(loadPrefs);
  return [p, (patch) => setP((cur) => { const next = { ...cur, ...patch }; savePrefs(next); return next; })];
}

/** All five models (config + hitboxes), for the picker and /phones. Null until every file has arrived. */
export function useCatalog(): { skins: LoadedSkin[] | null; error: string | null } {
  const [state, setState] = useState<{ skins: LoadedSkin[] | null; error: string | null }>({ skins: null, error: null });
  useEffect(() => {
    let dead = false;
    Promise.all(SKIN_IDS.map(loadSkin)).then((skins) => { if (!dead) setState({ skins, error: null }); }, (e: Error) => { if (!dead) setState({ skins: null, error: e.message }); });
    return () => { dead = true; };
  }, []);
  return state;
}
