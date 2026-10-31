import { useSyncExternalStore } from 'react';

/** The game opened last in the player: the sidebar's "Game" item returns to it, /phones changes its phone. */
export interface LastGame { id: string; name: string }

const KEY = 'j2me-web.lastGame';
const EVENT = 'j2me-web:lastgame';

export function getLastGame(): LastGame | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    if (raw.startsWith('{')) {
      const v = JSON.parse(raw) as Partial<LastGame>;
      return typeof v.id === 'string' && typeof v.name === 'string' ? { id: v.id, name: v.name } : null;
    }
    return { id: raw, name: raw }; // an id stored by an older build
  } catch {
    return null;
  }
}

export function setLastGame(g: LastGame | null): void {
  try {
    const cur = getLastGame();
    if (cur?.id === g?.id && cur?.name === g?.name) return;
    if (g) localStorage.setItem(KEY, JSON.stringify(g)); else localStorage.removeItem(KEY);
    window.dispatchEvent(new Event(EVENT));
  } catch { /* storage unavailable */ }
}

let cache: { raw: string | null; value: LastGame | null } = { raw: null, value: null };
function snapshot(): LastGame | null {
  let raw: string | null = null;
  try { raw = localStorage.getItem(KEY); } catch { /* storage unavailable */ }
  if (raw !== cache.raw) cache = { raw, value: getLastGame() };
  return cache.value;
}
function subscribe(fn: () => void): () => void {
  window.addEventListener(EVENT, fn);
  window.addEventListener('storage', fn);
  return () => { window.removeEventListener(EVENT, fn); window.removeEventListener('storage', fn); };
}
export function useLastGame(): LastGame | null {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}
