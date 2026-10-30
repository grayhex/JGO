import { t as translateUI } from '../i18n';
import type { SystemStatus } from '@j2me-web/protocol';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { setServerSettings, useServerSettings } from '../serverSettings';
import { LibrarySource } from './LibrarySource';
import { MobyPanel } from './Moby';
import { Modal } from './Modal';
import { PhoneDefaultsForm, ServerForm, SoundControlsForm, SystemChecks } from './SettingsForms';

type Toaster = (kind: 'info' | 'error', text: string) => void;

const STEPS = [
  { id: 'welcome', title: 'Welcome' },
  { id: 'library', title: 'Game library' },
  { id: 'mobygames', title: 'MobyGames' },
  { id: 'phone', title: 'Default phone' },
  { id: 'sound', title: 'Sound & controls' },
  { id: 'server', title: 'Server' },
  { id: 'done', title: 'Finish' },
] as const;

/**
 * First-run wizard. Every step is optional and saves as it goes, so closing the window at any point keeps
 * what was done; the same pieces are available later in Settings.
 */
export function SetupWizard({ toast, onClose, onFinished }: { toast: Toaster; onClose: (how: 'skip' | 'complete') => void; onFinished: (scanNow: boolean) => void }) {
  const server = useServerSettings();
  const [i, setI] = useState(0);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [scanNow, setScanNow] = useState(true);
  const step = STEPS[i]!;
  const loadStatus = useCallback(() => { setStatus(null); api.systemStatus().then(setStatus, () => setStatus({ version: '?', checks: [], storage: { totalBytes: 0, freeBytes: 0, libraryBytes: 0, quotaBytes: 0 } })); }, []);
  useEffect(() => { loadStatus(); }, [loadStatus]);

  const hasLibrary = !!server?.settings.libraryPath;
  const hasKey = server?.secrets.mobygames.configured ?? false;
  const finish = async () => {
    try {
      await api.setupAction('complete');
      const s = await api.settings();
      setServerSettings(s);
      onFinished(scanNow && !!s.settings.libraryPath);
    } catch (e) { toast('error', (e as Error).message); }
  };
  const skip = async () => {
    try { await api.setupAction('skip'); } catch { /* the wizard is closed either way */ }
    onClose('skip');
  };

  return (
    <Modal title={translateUI("Set up JGO")} onClose={() => void skip()} wide>
      <ol className="steps" aria-label={translateUI("Setup steps")}>
        {STEPS.map((s, n) => <li key={s.id} className={n === i ? 'on' : n < i ? 'past' : ''} aria-current={n === i ? 'step' : undefined}><span>{n + 1}</span> {s.title}</li>)}
      </ol>
      <div className="wizard-body" data-step={step.id}>
        {step.id === 'welcome' && (
          <div className="stack">
            <h3>{translateUI("Welcome to JGO")}</h3>
            <p>{translateUI("A few quick choices and you are ready to play. Every step is optional — skip what you do not need; everything can be changed later in")} <strong>{translateUI("Settings")}</strong>{translateUI(", and your games and saves are never touched.")}</p>
            <SystemChecks status={status} onReload={loadStatus} />
          </div>
        )}
        {step.id === 'library' && (
          <div className="stack">
            <h3>{translateUI("Where are your games?")}</h3>
            <p>{translateUI("Point JGO at a folder with")} <code>{translateUI(".jar")}</code>/<code>{translateUI(".jad")}</code> {translateUI("files (searched recursively), shared read-only with the container. Or skip this and upload games from the browser.")}</p>
            <LibrarySource toast={toast} saveLabel="Use this folder" />
          </div>
        )}
        {step.id === 'mobygames' && (
          <div className="stack">
            <h3>{translateUI("Covers and descriptions (optional)")}</h3>
            <MobyPanel toast={toast} />
          </div>
        )}
        {step.id === 'phone' && (
          <div className="stack">
            <h3>{translateUI("Your usual phone")}</h3>
            <PhoneDefaultsForm toast={toast} auto />
          </div>
        )}
        {step.id === 'sound' && <SoundControlsForm toast={toast} auto />}
        {step.id === 'server' && (
          <div className="stack">
            <h3>{translateUI("Server limits")}</h3>
            <ServerForm toast={toast} auto />
          </div>
        )}
        {step.id === 'done' && (
          <div className="stack">
            <h3>{translateUI("All set")}</h3>
            <ul className="plain-list">
              <li>{translateUI("Game library folder:")} <strong>{translateUI(hasLibrary ? server?.settings.libraryPath : 'not used (uploads only)')}</strong></li>
              <li>{translateUI("MobyGames:")} <strong>{translateUI(hasKey ? 'API key saved' : 'not used')}</strong></li>
              <li>{translateUI("Default phone:")} <strong>{server?.settings.phone.skinId.replace(/-/g, ' ')}</strong>, {server?.settings.phone.width}×{server?.settings.phone.height}</li>
            </ul>
            {hasLibrary && <label className="switch-line"><input type="checkbox" checked={scanNow} onChange={(e) => setScanNow(e.target.checked)} /><span>{translateUI("Import the games from the folder now")}{translateUI(hasKey ? ' and look them up on MobyGames' : '')}</span></label>}
          </div>
        )}
      </div>
      <div className="modal-actions">
        <button className="btn ghost" type="button" onClick={() => void skip()}>{translateUI("Skip setup")}</button>
        <span className="spacer" />
        {i > 0 && <button className="btn" type="button" onClick={() => setI(i - 1)}>{translateUI("Back")}</button>}
        {step.id !== 'done'
          ? <button className="btn primary" type="button" onClick={() => setI(i + 1)}>{translateUI(step.id === 'welcome' ? 'Start' : 'Next')}</button>
          : <button className="btn primary" type="button" onClick={() => void finish()}>{translateUI("Finish")}</button>}
      </div>
    </Modal>
  );
}
