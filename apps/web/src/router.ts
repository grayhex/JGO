import { useCallback, useEffect, useState } from 'react';

const EVT = 'j2me:navigate';

/** Old links looked like /#play/<id>; they are rewritten once to /play/<id>. */
export function normalizeLocation(): void {
  const m = /^#play\/([0-9a-f]{16})$/.exec(location.hash);
  if (m) history.replaceState(null, '', `/play/${m[1]}`);
  else if (location.hash === '#' || location.hash === '#/') history.replaceState(null, '', '/');
}

export function navigate(to: string, replace = false): void {
  if (to === location.pathname + location.search) return;
  if (replace) history.replaceState(null, '', to);
  else history.pushState(null, '', to);
  window.dispatchEvent(new Event(EVT));
  window.scrollTo(0, 0);
}

export function usePath(): [string, (to: string, replace?: boolean) => void] {
  const [path, setPath] = useState(() => { normalizeLocation(); return location.pathname; });
  useEffect(() => {
    const f = () => setPath(location.pathname);
    window.addEventListener('popstate', f);
    window.addEventListener(EVT, f);
    return () => { window.removeEventListener('popstate', f); window.removeEventListener(EVT, f); };
  }, []);
  return [path, useCallback((to, replace) => navigate(to, replace), [])];
}
