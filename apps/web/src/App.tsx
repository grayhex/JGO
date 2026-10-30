import type { HealthStatus } from '@j2me-web/protocol';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';
import { Library } from './components/Library';
import { Player } from './components/Player';
import { useTheme, type ThemeChoice } from './theme';

export type Toast = { id: number; kind: 'info' | 'error'; text: string };

function useHashRoute(): [string, (r: string) => void] {
  const [h, setH] = useState(() => location.hash.slice(1));
  useEffect(() => {
    const f = () => setH(location.hash.slice(1));
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return [h, (r) => { location.hash = r; }];
}

function Login({ onDone }: { onDone: () => void }) {
  const [token, setToken] = useState('');
  const [err, setErr] = useState('');
  return (
    <div className="login">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try { await api.login(token); onDone(); } catch (x) { setErr((x as Error).message); }
        }}
      >
        <h1>J2ME Web</h1>
        <p className="muted">This server requires an access token.</p>
        <input type="password" autoFocus placeholder="Access token" value={token} onChange={(e) => setToken(e.target.value)} />
        <button className="btn primary" type="submit">Sign in</button>
        {err && <p className="error">{err}</p>}
      </form>
    </div>
  );
}

export function App() {
  const [theme, setTheme] = useTheme();
  const [route, go] = useHashRoute();
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((kind: Toast['kind'], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 8000 : 3500);
  }, []);

  const refreshHealth = useCallback(async () => {
    try { setHealth(await api.health()); } catch (e) { toast('error', (e as Error).message); }
  }, [toast]);

  useEffect(() => {
    void refreshHealth();
    api.games().catch((e) => { if (e instanceof ApiError && e.status === 401) setNeedLogin(true); });
  }, [refreshHealth]);

  if (needLogin) return <Login onDone={() => { setNeedLogin(false); void refreshHealth(); }} />;

  const m = /^play\/([0-9a-f]{16})$/.exec(route);
  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#" onClick={() => go('')}>
          <span className="brand-mark" aria-hidden />
          <span>J2ME&nbsp;Web</span>
        </a>
        <div className="spacer" />
        {health && !health.ok && <span className="pill warn" title="See docs/README.md">Emulator runtime not ready</span>}
        <select aria-label="Theme" className="select compact" value={theme} onChange={(e) => setTheme(e.target.value as ThemeChoice)}>
          <option value="system">Auto</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </header>
      <main>
        {m ? <Player gameId={m[1]!} toast={toast} onExit={() => go('')} health={health} /> : <Library toast={toast} onPlay={(id) => go(`play/${id}`)} health={health} />}
      </main>
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>
        ))}
      </div>
    </div>
  );
}
