import type { HealthStatus } from '@j2me-web/protocol';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';
import { SetupWizard } from './components/SetupWizard';
import { Library } from './components/Library';
import { Player } from './components/Player';
import { Shell } from './components/Shell';
import { PhonesPage } from './pages/PhonesPage';
import { SettingsPage } from './pages/SettingsPage';
import { loadServerSettings } from './serverSettings';
import { usePath } from './router';
import { useTheme } from './theme';

export type Toast = { id: number; kind: 'info' | 'error'; text: string };

function Login({ onDone }: { onDone: () => void }) {
  const [token, setToken] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="login">
      <div className="login-hero">
        <h1>J2ME&nbsp;Web</h1>
        <p>Your Java ME games, played by the real KEmulator on this server and streamed to any browser.</p>
      </div>
      <div className="login-side">
        <form
          className="login-card"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try { await api.login(token); onDone(); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
          }}
        >
          <h2>Sign in</h2>
          <p className="muted">This server requires an access token. On a Proxmox install run <code>jgo token</code> in the container.</p>
          <input className="input" type="password" autoFocus placeholder="Access token" value={token} onChange={(e) => setToken(e.target.value)} aria-label="Access token" />
          <button className="btn primary" type="submit" disabled={busy || !token}>Sign in</button>
          {err && <p className="error">{err}</p>}
        </form>
      </div>
    </div>
  );
}

export function App() {
  const [theme, setTheme] = useTheme();
  const [path, go] = usePath();
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [query, setQuery] = useState('');
  const [ready, setReady] = useState(false);
  const [wizard, setWizard] = useState(false);

  const toast = useCallback((kind: Toast['kind'], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 8000 : 3500);
  }, []);

  const refreshHealth = useCallback(async () => {
    try { setHealth(await api.health()); } catch (e) { toast('error', (e as Error).message); }
  }, [toast]);

  // after sign-in: load the server-side defaults first (so the player starts with them), then offer the wizard once
  const boot = useCallback(async () => {
    await loadServerSettings();
    setReady(true);
    try { if ((await api.setup()).needsWizard) setWizard(true); } catch { /* an older server has no wizard */ }
  }, []);

  useEffect(() => {
    void refreshHealth();
    api.games().then(() => void boot(), (e) => { if (e instanceof ApiError && e.status === 401) setNeedLogin(true); else void boot(); });
    const t = window.setInterval(() => { api.health().then(setHealth, () => undefined); }, 15000);
    return () => window.clearInterval(t);
  }, [refreshHealth, boot]);

  if (needLogin) return <Login onDone={() => { setNeedLogin(false); void refreshHealth(); void boot(); }} />;
  if (!ready) return null;

  const play = /^\/play\/([0-9a-f]{16})\/?$/.exec(path);
  const phones = path === '/phones' || path === '/phones/';
  const settings = path === '/settings' || path === '/settings/';
  const page = play
    ? { title: 'Player', subtitle: 'Live emulator session', node: <Player key={play[1]} gameId={play[1]!} toast={toast} onExit={() => go('/')} health={health} /> }
    : settings
      ? { title: 'Settings', subtitle: 'Library, MobyGames, phone, sound, server', node: <SettingsPage toast={toast} onRunWizard={() => setWizard(true)} onLibraryChanged={() => window.dispatchEvent(new Event('j2me:library-changed'))} /> }
    : phones
      ? { title: 'Phone lab', subtitle: 'Skins, views and hitboxes', node: <PhonesPage /> }
      : { title: 'Library', subtitle: 'Your games on this server', node: <Library toast={toast} onPlay={(id) => go(`/play/${id}`)} health={health} query={query} /> };

  return (
    <>
      <Shell path={path} go={go} health={health} theme={theme} setTheme={setTheme} title={page.title} subtitle={page.subtitle} search={!play && !phones && !settings ? { value: query, onChange: setQuery } : undefined}>
        {page.node}
      </Shell>
      {wizard && (
        <SetupWizard
          toast={toast}
          onClose={() => setWizard(false)}
          onFinished={(scanNow) => {
            setWizard(false);
            go('/');
            if (scanNow) void api.scanStart('update').then(() => window.dispatchEvent(new Event('j2me:library-changed')), (e) => toast('error', (e as Error).message));
          }}
        />
      )}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}
      </div>
    </>
  );
}
