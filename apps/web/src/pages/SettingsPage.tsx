import { t as translateUI } from '../i18n';
import { useDeveloperMode, setDeveloperMode } from '../developer';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import { Icon, type IconName } from '../components/Icon';
import { CatalogPanel } from '../components/CatalogPanel';
import { CleanupPanel } from '../components/CleanupPanel';
import { LibraryFolders } from '../components/LibraryFolders';
import { MobyPanel } from '../components/Moby';
import { SymbianPanel } from '../components/SymbianPanel';
import { MyPhones } from '../components/MyPhones';
import { PhoneDefaultsForm, ServerForm, SoundControlsForm } from '../components/SettingsForms';
import { SystemDashboard } from '../components/SystemDashboard';
import { NgageCatalogPanel } from '../components/NgageCatalogPanel';

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
  { id: 'phone', label: 'My phones', icon: 'phone' },
  { id: 'sound', label: 'Sound & controls', icon: 'gamepad' },
  { id: 'symbian', label: 'Firmware', icon: 'cpu' },
  { id: 'server', label: 'Server', icon: 'sliders' },
];

export function SettingsPage({ toast, onRunWizard, onLibraryChanged }: { toast: Toaster; onRunWizard: () => void; onLibraryChanged: () => void }) {
  const developer=useDeveloperMode();
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
      <div role="tabpanel" id="panel-library" aria-labelledby="tab-library" hidden={tab !== 'library'}><Section id="library" icon="library" title={translateUI("Game library")} hint={translateUI("One folder for each kind of games. MGO only reads them; you can also add games from the browser.")}>
        <LibraryFolders toast={toast} onChanged={onLibraryChanged} />
        <details className="more lib-more"><summary>{translateUI("More: missing files, empty everything, genres")}</summary>
          <h3>{translateUI("Clean up")}</h3>
          <CleanupPanel toast={toast} onChanged={() => { onLibraryChanged(); }} />
          <h3>{translateUI("Genres")}</h3>
          <CatalogPanel toast={toast} onChanged={onLibraryChanged} />
        </details>
      </Section></div>
      <div role="tabpanel" id="panel-mobygames" aria-labelledby="tab-mobygames" hidden={tab !== 'mobygames'}><Section id="mobygames" icon="info" title={translateUI("Game metadata")} hint={translateUI("Covers, descriptions, genres, publishers, years, ratings and screenshots (optional).")}><NgageCatalogPanel toast={toast} onChanged={onLibraryChanged} /><MobyPanel toast={toast} /></Section></div>
      <div role="tabpanel" id="panel-phone" aria-labelledby="tab-phone" hidden={tab !== 'phone'}><Section id="phone" icon="phone" title={translateUI("My phones")} hint={translateUI("The phones you play on, and which one starts each kind of games.")}><MyPhones toast={toast} /><details className="more lib-more"><summary>{translateUI("Screen size, key layout and look of the Java ME phone")}</summary><PhoneDefaultsForm toast={toast} /></details></Section></div>
      <div role="tabpanel" id="panel-sound" aria-labelledby="tab-sound" hidden={tab !== 'sound'}><Section id="sound" icon="gamepad" title={translateUI("Sound & controls")}><SoundControlsForm toast={toast} /></Section></div>
      <div role="tabpanel" id="panel-symbian" aria-labelledby="tab-symbian" hidden={tab !== 'symbian'}><Section id="symbian" icon="cpu" title={translateUI("Symbian and N-Gage firmware")} hint={translateUI("Symbian S60 and N-Gage games run in a second emulator (EKA2L1). You bring your own firmware.")}><SymbianPanel toast={toast} /></Section></div>
      <div role="tabpanel" id="panel-server" aria-labelledby="tab-server" hidden={tab !== 'server'}><Section id="server" icon="sliders" title={translateUI("Server")} hint={translateUI("Limits that apply to all games.")}><ServerForm toast={toast} /><label className="switch-line"><input type="checkbox" checked={developer} onChange={e => setDeveloperMode(e.target.checked)} /><span>{translateUI("Developer Mode — extended diagnostics")}</span></label></Section></div>
    </div>
  );
}
