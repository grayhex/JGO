import { t as translateUI } from '../i18n';
import { profilesForSkin, type PhoneSkinId, type SymbianStatus } from '@mgo/protocol';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useServerSettings } from '../serverSettings';
import { useCatalog } from '../skin/registry';
import { FirmwareAdd, FirmwareJobStatus, useFirmwareJob } from './FirmwareAdd';
import { Icon } from './Icon';
import { PlatformTag } from './PlatformTag';
import { currentPhones, PHONE_ROLES } from './MyPhones';

type Toaster = (kind: 'info' | 'error', text: string) => void;
const ROLES = PHONE_ROLES.filter((r) => r.platform !== 'j2me');

/**
 * Wizard step "Firmware": for the Symbian phone and the N-Gage phone that were chosen, add the firmware of exactly that phone.
 * MGO ships no firmware; the files are the user's own and go only to the Symbian service. The step can be skipped (games of
 * these kinds then cannot start until a firmware is added in Settings → Symbian).
 */
export function FirmwareSetup({ toast }: { toast: Toaster }) {
  const server = useServerSettings();
  const { skins } = useCatalog();
  const [st, setSt] = useState<SymbianStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { api.symbianStatus().then((s) => { setSt(s); setError(null); }, (e) => setError((e as Error).message)); }, []);
  const { job, jobRunning, jobError, follow, resume, canResume } = useFirmwareJob(toast, load);
  useEffect(load, [load]);
  const phones = server ? currentPhones(server.settings) : null;

  const rows = ROLES.map((r) => {
    const skin = phones?.defaults[r.platform] ?? null;
    const device = skin ? profilesForSkin(skin as PhoneSkinId, r.platform).find((d) => d.engine === 'eka2l1') : undefined;
    const code = device && device.engine === 'eka2l1' ? device.firmware.product : null;
    const installed = !!code && !!st?.firmware.devices.some((d) => d.code.toLowerCase() === code.toLowerCase());
    return { role: r, skin, device, code, installed };
  });

  // a firmware that fits the chosen phone becomes the device of its kind of games, so nothing else has to be set
  useEffect(() => {
    if (!st) return;
    for (const row of rows) {
      if (row.installed && row.code && st.defaults[row.role.platform]?.toLowerCase() !== row.code.toLowerCase()) void api.symbianDefault(row.role.platform, row.code).then(load, () => undefined);
    }
  }, [st, JSON.stringify(rows.map((r) => [r.code, r.installed]))]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!st) return <p className="muted" role="status">{error ?? translateUI('Checking service and firmware…')}</p>;
  if (!st.reachable) {
    return (
      <div className="stack">
        <img className="state-art" src="/graphics/states/server-offline.svg" alt="" />
        <p className="note warn" data-testid="fw-unavailable">{translateUI(st.configured ? 'The Symbian service does not answer' : 'The Symbian service is not set up on this server.')} {translateUI('Java ME games work without it. You can add firmware later in Settings → Symbian.')}</p>
        <button className="btn sm" type="button" onClick={load}><Icon name="restart" /> {translateUI('Check again')}</button>
      </div>
    );
  }
  const name = (id: string | null) => { const s = skins?.find((k) => k.config.id === id); return s ? `${s.config.manufacturer} ${s.config.model}` : id ?? ''; };
  const others = st.firmware.devices.filter((d) => !rows.some((r) => r.code?.toLowerCase() === d.code.toLowerCase()));
  return (
    <div className="stack fw-setup" data-testid="fw-setup">
      <p className="muted">{translateUI('MGO does not include any firmware. Add the firmware of each phone you chose (your own, legally obtained files). You can skip this and add it later.')}</p>
      {rows.map((row) => (
        <section className={`fw-row card-pad${row.installed ? ' done' : ''}`} key={row.role.platform} data-testid={`fw-${row.role.platform}`}>
          <header>
            <PlatformTag platform={row.role.platform} />
            <div>
              <strong>{name(row.skin)}</strong>
              <div className="muted small">{row.device && row.device.engine === 'eka2l1' ? `${row.device.name} · ${translateUI('firmware')} ${row.code} · ${row.device.os}` : translateUI('No phone chosen for this kind of games.')}</div>
            </div>
            {row.code && <span className={`badge ${row.installed ? 'prod' : 'mock'}`}>{translateUI(row.installed ? 'Firmware installed' : 'Firmware needed')}</span>}
          </header>
          {row.code && !row.installed && <FirmwareAdd st={st} toast={toast} follow={follow} busy={jobRunning} title="" compact />}
        </section>
      ))}
      <FirmwareJobStatus job={job} jobError={jobError} canResume={canResume} resume={resume} />
      {others.length > 0 && rows.some((r) => r.code && !r.installed) && (
        <p className="muted small" data-testid="fw-others">{translateUI('Also installed:')} {others.map((d) => `${d.manufacturer} ${d.model} (${d.code})`).join(', ')} — {translateUI('this is not the firmware of a phone you chose; it stays available in Settings → Symbian.')}</p>
      )}
    </div>
  );
}
