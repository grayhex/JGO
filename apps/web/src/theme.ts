import { useEffect, useState } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';
const KEY = 'j2me-web.theme';

export function useTheme(): [ThemeChoice, (t: ThemeChoice) => void] {
  const [t, setT] = useState<ThemeChoice>(() => {
    try { return (localStorage.getItem(KEY) as ThemeChoice) || 'system'; } catch { return 'system'; }
  });
  useEffect(() => {
    if (t === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem(KEY, t); } catch { /* private mode */ }
  }, [t]);
  return [t, setT];
}
