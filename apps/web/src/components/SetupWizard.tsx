import { t as translateUI } from '../i18n';
import type { SystemStatus } from '@mgo/protocol';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { setServerSettings, useServerSettings } from '../serverSettings';
import { FirmwareSetup } from './FirmwareSetup';
import { LibraryFolders } from './LibraryFolders';
import { currentPhones, missingRoles, MyPhones, PHONE_ROLES } from './MyPhones';
import { PlatformTag } from './PlatformTag';
import { MobyPanel } from './Moby';
import { Modal } from './Modal';
import { SoundControlsForm, SystemChecks } from './SettingsForms';

type Toaster = (kind: 'info' | 'error', text: string) => void;

const STEPS = [
  { id: 'welcome', title: 'Welcome' },
  { id: 'library', title: 'Games' },
  { id: 'phones', title: 'Phones' },
  { id: 'firmware', title: 'Firmware' },
  { id: 'mobygames', title: 'Covers' },
  { id: 'sound', title: 'Sound' },
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

  const paths = server?.settings.libraryPaths;
  const hasLibrary = !!server?.settings.libraryPath || !!(paths?.j2me || paths?.ngage || paths?.symbian);
  const missing = server ? missingRoles(server.settings) : [];
  const phones = server ? currentPhones(server.settings) : null;
  const hasKey = server?.secrets.mobygames.configured ?? false;
  const finish = async () => {
    try {
      await api.setupAction('complete');
      const s = await api.settings();
      setServerSettings(s);
      onFinished(scanNow && (!!s.settings.libraryPath || Object.values(s.settings.libraryPaths ?? {}).some(Boolean)));
    } catch (e) { toast('error', (e as Error).message); }
  };
  const skip = async () => {
    try { await api.setupAction('skip'); } catch { /* the wizard is closed either way */ }
    onClose('skip');
  };

  return (
    <Modal title={translateUI("Set up MGO")} onClose={() => void skip()} wide>
      <ol className="steps" aria-label={translateUI("Setup steps")}>
        {STEPS.map((s, n) => <li key={s.id} className={n === i ? 'on' : n < i ? 'past' : ''} aria-current={n === i ? 'step' : undefined}><span>{n + 1}</span> {translateUI(s.title)}</li>)}
      </ol>
      <div className="wizard-body" data-step={step.id}>
        {step.id === 'welcome' && (
          <div className="stack">
            <h3>{translateUI("Welcome to MGO")}</h3>
            <p>{translateUI("A few quick choices and you are ready to play. Every step is optional — skip what you do not need; everything can be changed later in")} <strong>{translateUI("Settings")}</strong>{translateUI(", and your games and saves are never touched.")}</p>
            <SystemChecks status={status} onReload={loadStatus} />
          </div>
        )}
        {step.id === 'library' && (
          <div className="stack">
            <h3>{translateUI("Where are your games?")}</h3>
            <p>{translateUI("Choose a folder for each kind of games you have: Java ME (.jar), N-Gage and Symbian (.sis). MGO only reads them. Skip a kind you do not have, or upload games from the browser instead.")}</p>
            <LibraryFolders toast={toast} wizard />
          </div>
        )}
        {step.id === 'phones' && (
          <div className="stack">
            <h3>{translateUI("Your phones")}</h3>
            <MyPhones toast={toast} wizard />
          </div>
        )}
        {step.id === 'firmware' && (
          <div className="stack">
            <h3>{translateUI("Firmware for Symbian and N-Gage")}</h3>
            <FirmwareSetup toast={toast} />
          </div>
        )}
        {step.id === 'mobygames' && (
          <div className="stack">
            <h3>{translateUI("Covers and descriptions (optional)")}</h3>
            <MobyPanel toast={toast} />
          </div>
        )}
        {step.id === 'sound' && <SoundControlsForm toast={toast} auto />}
        {step.id === 'done' && (
          <div className="stack">
            <h3>{translateUI("All set")}</h3>
            <ul className="plain-list">
              <li>{translateUI("Game folders:")} <strong>{hasLibrary ? [paths?.j2me ?? server?.settings.libraryPath ? 'Java ME' : '', paths?.ngage ? 'N-Gage' : '', paths?.symbian ? 'Symbian' : ''].filter(Boolean).join(', ') : translateUI('not used (uploads only)')}</strong></li>
              {phones && PHONE_ROLES.map((r) => <li key={r.platform}><PlatformTag platform={r.platform} size="sm" /> <strong>{phones.defaults[r.platform]?.replace(/-/g, ' ') ?? '—'}</strong></li>)}
              <li>{translateUI("MobyGames:")} <strong>{translateUI(hasKey ? 'API key saved' : 'not used')}</strong></li>
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
          ? <button className="btn primary" type="button" disabled={step.id === 'phones' && missing.length > 0} onClick={() => setI(i + 1)} data-testid="wizard-next">{translateUI(step.id === 'welcome' ? 'Start' : step.id === 'firmware' ? 'Next / skip' : 'Next')}</button>
          : <button className="btn primary" type="button" onClick={() => void finish()}>{translateUI("Finish")}</button>}
      </div>
    </Modal>
  );
}
