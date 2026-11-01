import { api } from '../api';
import { useLocale, setLocale } from '../i18n';
import { t as translateUI } from '../i18n';
import type { GameMeta, HealthStatus, SymbianStatus } from '@mgo/protocol';
import { useEffect, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { Seg } from './ui';
import { useLastGame } from '../lastGame';

export function Link({ to, children, className, onNavigate, ...rest }: { to: string; children: ReactNode; className?: string; onNavigate: (to: string) => void } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'onClick'>) {
  return (
    <a
      {...rest}
      href={to}
      className={className}
      onClick={(e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        onNavigate(to);
      }}
    >
      {children}
    </a>
  );
}

const COLLAPSE = 'j2me-web.sidebar';

export function Shell({ path, go, health, symbian, title, subtitle, children }: {
  path: string; go: (to: string) => void; health: HealthStatus | null;
  symbian?: SymbianStatus | null;
  title: string; subtitle?: string; children: ReactNode;
}) {
  const locale=useLocale();
  const lastGame = useLastGame();
  const [loadedGame, setLoadedGame] = useState<GameMeta | null>(null);
  useEffect(() => { let dead = false; if (!lastGame) { setLoadedGame(null); return; } void api.games().then(games => { if (!dead) setLoadedGame(games.find(g => g.id === lastGame.id) ?? null); }, () => undefined); return () => { dead = true; }; }, [lastGame?.id, lastGame?.name]);
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem(COLLAPSE) === '1'; } catch { return false; } });
  const [drawer, setDrawer] = useState(false);
  useEffect(() => { try { localStorage.setItem(COLLAPSE, collapsed ? '1' : '0'); } catch { /* private mode */ } }, [collapsed]);
  useEffect(() => { setDrawer(false); }, [path]);
  useEffect(() => {
    if (!drawer) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawer(false); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [drawer]);

  const item = (to: string, icon: IconName, label: string, active: boolean) => (
    <Link to={to} onNavigate={go} className={`nav-item ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined} title={translateUI(label)}>
      <Icon name={icon} />
      <span className="nav-label">{translateUI(label)}</span>
    </Link>
  );
  const inPlayer = path.startsWith('/play/');

  return (
    <div className={`app ${collapsed ? 'shell-collapsed' : ''} ${drawer ? 'shell-drawer' : ''}`}>
      <aside className="sidebar glass" aria-label={translateUI("Main navigation")}>
        <Link to="/" onNavigate={go} className="brand" aria-label={translateUI("MGO home")}>
          <span className="brand-mark" aria-hidden><svg viewBox="0 0 24 24"><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M10 6.5h4v5h-4zM10.5 17h3" /></svg></span>
          <span className="brand-text">{translateUI("MGO")}</span>
        </Link>
        <nav className="nav">
          <div className="nav-title">{translateUI("Workspace")}</div>
          {item('/', 'library', 'Library', path === '/')}
          {lastGame && <Link to={`/play/${lastGame.id}`} onNavigate={go} data-testid="current-game" className={`nav-item current-game ${inPlayer ? 'active' : ''}`} title={lastGame.name} aria-label={translateUI('Current game: {name}', { name: lastGame.name })}>
            {loadedGame?.ngageInfo?.hasCover ? <img src={`/api/games/${lastGame.id}/ngage-cover`} alt="" /> : loadedGame?.info?.hasCover ? <img src={api.coverUrl(lastGame.id)} alt="" /> : <Icon name="play" />}
            <span className="nav-label"><small>{translateUI('Current game')}</small><strong>{lastGame.name}</strong><small>{loadedGame?.platform === 'ngage' ? 'N-Gage' : loadedGame?.platform === 'symbian' ? 'Symbian' : loadedGame?.platform === 'ngage2' ? 'N-Gage 2' : 'Java ME'}</small></span>
          </Link>}
          {item('/phones', 'phone', 'Phones', path === '/phones')}
          {item('/settings', 'sliders', 'Settings', path === '/settings')}
        </nav>
        <div className="sidebar-foot">
          <Seg<'en' | 'ru'> className="on-shell lang" label="Language / Язык" value={locale} onChange={setLocale} options={[{ value: 'en', label: 'EN', title: 'English' }, { value: 'ru', label: 'RU', title: 'Русский' }]} />
          <div className="runtime-list" aria-label={translateUI('Application and emulators')}>
            <div className="runtime" title={`MGO ${health?.version ?? '—'}`}><span className={`dot ${health ? '' : 'bad'}`} aria-hidden /><span className="runtime-text"><b>MGO <em>{translateUI(health ? 'Online' : 'Connecting…')}</em></b><small title={health?.version}>v{health?.version ?? '—'}</small></span></div>
            <div className="runtime" title={`KEmulator ${health?.kemulator.commit ?? '—'}`}><span className={`dot ${health?.ok ? '' : 'bad'}`} aria-hidden /><span className="runtime-text"><b>KEmulator <em>{translateUI(health?.ok ? 'Ready' : 'Unavailable')}</em></b><small title={health?.kemulator.commit ?? undefined}>Java ME · {health?.kemulator.commit?.slice(0, 9) ?? '—'}</small></span></div>
            <div className="runtime" data-testid="symbian-runtime" title={`EKA2L1 ${symbian?.emulator ?? '—'}`}><span className={`dot ${symbian?.reachable && symbian.firmware.installed ? '' : 'bad'}`} aria-hidden /><span className="runtime-text"><b>EKA2L1 <em>{translateUI(!symbian?.configured ? 'Not configured' : !symbian.reachable ? 'Unavailable' : symbian.busy ? 'Running' : symbian.firmware.installed ? 'Ready' : 'Needs firmware')}</em></b><small title={symbian?.emulator ?? undefined}>Symbian / N-Gage · {symbian?.emulator?.replace(/^EKA2L1\s*/, '') ?? '—'}</small></span></div>
          </div>
          <button className="nav-item hide-mobile" onClick={() => setCollapsed((c) => !c)} aria-pressed={collapsed} title={translateUI(collapsed ? 'Expand sidebar' : 'Collapse sidebar')}>
            <Icon name="sidebar" />
            <span className="nav-label">{translateUI(collapsed ? 'Expand' : 'Collapse')}</span>
          </button>
        </div>
      </aside>
      <div className="scrim" onClick={() => setDrawer(false)} aria-hidden />
      <header className="header glass">
        <button className="btn-shell show-mobile" onClick={() => setDrawer(true)} aria-label={translateUI("Open menu")}><Icon name="menu" /></button>
        <div style={{ minWidth: 0 }}>
          <div className="header-title">{translateUI(title)}</div>
          {subtitle && <div className="header-sub">{translateUI(subtitle)}</div>}
        </div>
      </header>
      <main className="content" id="main">
        <div className={`container${inPlayer ? ' wide' : ''}`}>{children}</div>
      </main>
    </div>
  );
}
