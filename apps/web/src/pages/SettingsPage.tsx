import type { SystemStatus } from '@j2me-web/protocol';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import { Icon, type IconName } from '../components/Icon';
import { LibrarySource, ScanPanel } from '../components/LibrarySource';
import { MobyPanel } from '../components/Moby';
import { PhoneDefaultsForm, ServerForm, SoundControlsForm, SystemChecks } from '../components/SettingsForms';
import { useServerSettings } from '../serverSettings';

type Toaster = (kind: 'info' | 'error', text: string) => void;

function Section({ id, icon, title, children, hint }: { id: string; icon: IconName; title: string; children: ReactNode; hint?: string }) {
  return (
    <section className="card card-pad settings-section" id={id} aria-labelledby={`${id}-h`}>
      <header>
        <h2 id={`${id}-h`}><Icon name={icon} /> {title}</h2>
        {hint && <p className="muted small">{hint}</p>}
      </header>
      {children}
    </section>
  );
}

export const SECTIONS: { id: string; label: string; icon: IconName }[] = [
  { id: 'system', label: 'System', icon: 'cpu' },
  { id: 'library', label: 'Game library', icon: 'library' },
  { id: 'mobygames', label: 'MobyGames', icon: 'info' },
  { id: 'phone', label: 'Default phone', icon: 'phone' },
  { id: 'sound', label: 'Sound & controls', icon: 'gamepad' },
  { id: 'server', label: 'Server', icon: 'sliders' },
];

export function SettingsPage({ toast, onRunWizard, onLibraryChanged }: { toast: Toaster; onRunWizard: () => void; onLibraryChanged: () => void }) {
  const server = useServerSettings();
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const loadStatus = useCallback(() => { setStatus(null); api.systemStatus().then(setStatus, (e) => toast('error', (e as Error).message)); }, [toast]);
  useEffect(() => { loadStatus(); }, [loadStatus]);
  useEffect(() => { // deep links such as /settings#library
    const id = location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView({ block: 'start' });
  }, [server === null]);

  return (
    <div className="settings">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Everything here is saved on the server and can be changed at any time. Your games, saves and favourites are never touched by changing settings.</p>
        </div>
        <span className="spacer" />
        <button className="btn" type="button" onClick={onRunWizard}>Run the setup wizard again</button>
      </div>
      <nav className="settings-nav" aria-label="Settings sections">
        {SECTIONS.map((s) => <a key={s.id} href={`#${s.id}`} onClick={(e) => { e.preventDefault(); history.replaceState(null, '', `#${s.id}`); document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}><Icon name={s.icon} /> {s.label}</a>)}
      </nav>
      <Section id="system" icon="cpu" title="System" hint="Is everything JGO needs installed and working?"><SystemChecks status={status} onReload={loadStatus} /></Section>
      <Section id="library" icon="library" title="Game library" hint="A folder with your .jar/.jad files, shared read-only with the container. Optional: you can always upload games from the browser.">
        <LibrarySource toast={toast} onSaved={loadStatus} />
        <h3>Import</h3>
        <ScanPanel toast={toast} canScan={!!server?.settings.libraryPath} onDone={() => { onLibraryChanged(); loadStatus(); }} />
        <label className="switch-line">
          <input type="checkbox" checked={server?.settings.autoScan ?? false} onChange={(e) => void api.patchSettings({ autoScan: e.target.checked }).then((r) => { import('../serverSettings').then((m) => m.setServerSettings(r)); }, (x) => toast('error', (x as Error).message))} />
          <span>Scan for changes every time JGO starts</span>
        </label>
      </Section>
      <Section id="mobygames" icon="info" title="MobyGames" hint="Covers, descriptions, genres, publishers, years, ratings and screenshots (optional)."><MobyPanel toast={toast} /></Section>
      <Section id="phone" icon="phone" title="Default phone"><PhoneDefaultsForm toast={toast} /></Section>
      <Section id="sound" icon="gamepad" title="Sound & controls"><SoundControlsForm toast={toast} /></Section>
      <Section id="server" icon="sliders" title="Server" hint="Limits that apply to all games."><ServerForm toast={toast} /></Section>
    </div>
  );
}
