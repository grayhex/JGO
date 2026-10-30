import { useLocale, setLocale } from '../i18n';
import { t as translateUI } from '../i18n';
import type { HealthStatus } from '@j2me-web/protocol';
import { useEffect, useState, type ReactNode } from 'react';
import type { ThemeChoice } from '../theme';
import { Icon, type IconName } from './Icon';
import { Seg } from './ui';

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

export function Shell({ path, go, health, theme, setTheme, title, subtitle, search, children }: {
  path: string; go: (to: string) => void; health: HealthStatus | null; theme: ThemeChoice; setTheme: (t: ThemeChoice) => void;
  title: string; subtitle?: string; search?: { value: string; onChange: (v: string) => void }; children: ReactNode;
}) {
  const locale=useLocale();
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
  const ok = health?.ok !== false;

  return (
    <div className={`app ${collapsed ? 'shell-collapsed' : ''} ${drawer ? 'shell-drawer' : ''}`}>
      <aside className="sidebar glass" aria-label={translateUI("Main navigation")}>
        <Link to="/" onNavigate={go} className="brand" aria-label={translateUI("J2ME Web home")}>
          <span className="brand-mark" aria-hidden><svg viewBox="0 0 24 24"><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M10 6.5h4v5h-4zM10.5 17h3" /></svg></span>
          <span className="brand-text">{translateUI("J2ME Web")}</span>
        </Link>
        <nav className="nav">
          <div className="nav-title">{translateUI("Workspace")}</div>
          {item('/', 'library', 'Library', path === '/' || inPlayer)}
          {item('/phones', 'phone', 'Phones', path === '/phones')}
          {item('/settings', 'sliders', 'Settings', path === '/settings')}
        </nav>
        <div className="sidebar-foot">
          <div className="runtime" title={translateUI(health ? `KEmulator ${health.kemulator.commit?.slice(0, 9) ?? '?'} · Java ${health.java.version ?? 'missing'}` : 'Checking the server')}>
            <span className={`dot ${ok ? '' : 'bad'}`} aria-hidden />
            <span className="runtime-text">
              <b>{translateUI(health ? (ok ? 'Emulator ready' : 'Runtime not ready') : 'Connecting…')}</b>
              {translateUI(health ? `${health.activeSessions}/${health.maxSessions} sessions · v${health.version}` : 'checking server')}
            </span>
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
        <span className="spacer" />
        <select className="select" aria-label="Language / Язык" value={locale} onChange={e=>setLocale(e.target.value as 'en'|'ru')}><option value="en">EN</option><option value="ru">RU</option></select>
        {search && <input className="input-shell" type="search" placeholder={translateUI("Search games or vendors")} value={search.value} onChange={(e) => search.onChange(e.target.value)} aria-label={translateUI("Search")} />}
        {health && !health.ok && <span className="badge mock hide-narrow" title={translateUI("The emulator runtime is missing on this server")}>{translateUI("Runtime not ready")}</span>}
        <Seg
          className="on-shell"
          label={translateUI("Theme")}
          value={theme}
          onChange={setTheme}
          options={[
            { value: 'system', label: 'Auto', title: 'Follow the system' },
            { value: 'light', label: <Icon name="sun" />, title: 'Light' },
            { value: 'dark', label: <Icon name="moon" />, title: 'Dark' },
          ]}
        />
      </header>
      <main className="content" id="main">
        <div className="container">{children}</div>
      </main>
    </div>
  );
}
