import { t as translateUI } from '../i18n';
import { useDeveloperMode, setDeveloperMode } from '../developer';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import { Icon, type IconName } from '../components/Icon';
import { CatalogPanel } from '../components/CatalogPanel';
import { CleanupPanel } from '../components/CleanupPanel';
import { LibrarySource, ScanPanel } from '../components/LibrarySource';
import { MobyPanel } from '../components/Moby';
import { SymbianPanel } from '../components/SymbianPanel';
import { NativePhoneDefaults, PhoneDefaultsForm, ServerForm, SoundControlsForm } from '../components/SettingsForms';
import { SystemDashboard } from '../components/SystemDashboard';
import { NgageCatalogPanel } from '../components/NgageCatalogPanel';
import { useServerSettings } from '../serverSettings';

type Toaster = (kind: 'info' | 'error', text: string) => void;

function Section({ id, icon, title, children, hint }: { id: string; icon: IconName; title: string; children: ReactNode; hint?: string }) {
  return (
    <section className="card card-pad settings-section" id={id} aria-labelledby={`${id}-h`}>
      <header>
        <h2 id={`${id}-h`}><Icon name={icon} /> {translateUI(title)}</h2>
        {hint && <p className="muted small">{translateUI(hint)}</p>}
      </header>
      {children}
    </section>
  );
}

export const SECTIONS: { id: string; label: string; icon: IconName }[] = [
  { id: 'system', label: 'System', icon: 'cpu' },
  { id: 'library', label: 'Game library', icon: 'library' },
  { id: 'mobygames', label: 'Game metadata', icon: 'info' },
  { id: 'phone', label: 'Default phone', icon: 'phone' },
  { id: 'sound', label: 'Sound & controls', icon: 'gamepad' },
  { id: 'symbian', label: 'Symbian (experimental)', icon: 'cpu' },
  { id: 'server', label: 'Server', icon: 'sliders' },
];

export function SettingsPage({ toast, onRunWizard, onLibraryChanged }: { toast: Toaster; onRunWizard: () => void; onLibraryChanged: () => void }) {
  const developer=useDeveloperMode();
  const server = useServerSettings();
  const [scanKey, setScanKey] = useState(0);
  const [folder, setFolder] = useState<string | null>('j2me');
  const selected = () => SECTIONS.some(s => s.id === location.hash.slice(1)) ? location.hash.slice(1) : 'system';
  const [tab, setTab] = useState(selected);
  useEffect(() => { const sync = () => setTab(selected()); window.addEventListener('hashchange', sync); window.addEventListener('popstate', sync); return () => { window.removeEventListener('hashchange', sync); window.removeEventListener('popstate', sync); }; }, []);


  return (
    <div className="settings">
      <div className="page-head">
        <div>
          <h1>{translateUI("Settings")}</h1>
          <p>{translateUI("Library, emulators and server preferences.")}</p>
        </div>
        <span className="spacer" />
        <button className="btn" type="button" onClick={onRunWizard}>{translateUI("Run the setup wizard again")}</button>
      </div>
      <nav className="settings-nav settings-tabs" role="tablist" aria-label={translateUI("Settings sections")}>
        {SECTIONS.map((s, index) => <button type="button" role="tab" id={`tab-${s.id}`} aria-controls={`panel-${s.id}`} aria-selected={tab === s.id} tabIndex={tab === s.id ? 0 : -1} key={s.id} onClick={() => { setTab(s.id); history.replaceState(null, '', `#${s.id}`); }} onKeyDown={e => {
          if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return; e.preventDefault();
          const target = SECTIONS[e.key === 'Home' ? 0 : e.key === 'End' ? SECTIONS.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + SECTIONS.length) % SECTIONS.length]!;
          setTab(target.id); history.replaceState(null, '', `#${target.id}`); document.getElementById(`tab-${target.id}`)?.focus();
        }}><Icon name={s.icon} /> {translateUI(s.label)}</button>)}
      </nav>
      <div role="tabpanel" id="panel-system" aria-labelledby="tab-system" hidden={tab !== 'system'}><Section id="system" icon="cpu" title={translateUI("System")} hint={translateUI("Is everything MGO needs installed and working?")}>{tab === 'system' && <SystemDashboard toast={toast} />}</Section></div>
      <div role="tabpanel" id="panel-library" aria-labelledby="tab-library" hidden={tab !== 'library'}><Section id="library" icon="library" title={translateUI("Game library")} hint={translateUI("Separate read-only folders for Java ME, N-Gage and Symbian. Browser uploads remain available.")}>
        <div className="library-sources">{(['j2me', 'ngage', 'symbian'] as const).map(kind => <details className="source-folder" key={kind} open={folder === kind} onToggle={e => { if (e.currentTarget.open) setFolder(kind); else setFolder(current => current === kind ? null : current); }}>
          <summary>{({ j2me: 'Java ME · .jar / .jad', ngage: 'N-Gage · .zip / .n-gage', symbian: 'Symbian · .sis / .sisx' })[kind]}<small>{server?.settings.libraryPaths?.[kind] ?? (kind === 'j2me' ? server?.settings.libraryPath : null) ?? translateUI('Not configured')}</small></summary>
          <LibrarySource kind={kind} toast={toast} onSaved={(p) => { if (p) void api.scanStart('update').then(() => setScanKey(k => k + 1), () => undefined); }} />
        </details>)}</div>
        <h3>{translateUI("Import")}</h3>
        <ScanPanel key={scanKey} toast={toast} canScan={!!server?.settings.libraryPath || Object.values(server?.settings.libraryPaths ?? {}).some(Boolean)} onDone={() => { onLibraryChanged(); }} />
        <h3>{translateUI("Clean up")}</h3>
        <CleanupPanel toast={toast} onChanged={() => { onLibraryChanged(); }} />
        <h3>{translateUI("Genres")}</h3>
        <CatalogPanel toast={toast} onChanged={onLibraryChanged} />
        <label className="switch-line">
          <input type="checkbox" checked={server?.settings.autoScan ?? false} onChange={(e) => void api.patchSettings({ autoScan: e.target.checked }).then((r) => { import('../serverSettings').then((m) => m.setServerSettings(r)); }, (x) => toast('error', (x as Error).message))} />
          <span>{translateUI("Scan for changes every time MGO starts")}</span>
        </label>
      </Section></div>
      <div role="tabpanel" id="panel-mobygames" aria-labelledby="tab-mobygames" hidden={tab !== 'mobygames'}><Section id="mobygames" icon="info" title={translateUI("Game metadata")} hint={translateUI("Covers, descriptions, genres, publishers, years, ratings and screenshots (optional).")}><NgageCatalogPanel toast={toast} onChanged={onLibraryChanged} /><MobyPanel toast={toast} /></Section></div>
      <div role="tabpanel" id="panel-phone" aria-labelledby="tab-phone" hidden={tab !== 'phone'}><Section id="phone" icon="phone" title={translateUI("Default phone")}><h3>Java ME</h3><PhoneDefaultsForm toast={toast} /><h3>N-Gage / Symbian</h3><NativePhoneDefaults toast={toast} /></Section></div>
      <div role="tabpanel" id="panel-sound" aria-labelledby="tab-sound" hidden={tab !== 'sound'}><Section id="sound" icon="gamepad" title={translateUI("Sound & controls")}><SoundControlsForm toast={toast} /></Section></div>
      <div role="tabpanel" id="panel-symbian" aria-labelledby="tab-symbian" hidden={tab !== 'symbian'}><Section id="symbian" icon="cpu" title={translateUI("Symbian (experimental)")} hint={translateUI("Optional second emulator (EKA2L1) for Symbian S60 and N-Gage games. You bring your own firmware.")}><SymbianPanel toast={toast} /></Section></div>
      <div role="tabpanel" id="panel-server" aria-labelledby="tab-server" hidden={tab !== 'server'}><Section id="server" icon="sliders" title={translateUI("Server")} hint={translateUI("Limits that apply to all games.")}><ServerForm toast={toast} /><label className="switch-line"><input type="checkbox" checked={developer} onChange={e => setDeveloperMode(e.target.checked)} /><span>{translateUI("Developer Mode — extended diagnostics")}</span></label></Section></div>
    </div>
  );
}
