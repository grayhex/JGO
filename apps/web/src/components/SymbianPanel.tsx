import { t as translateUI } from '../i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { EMULATED_DEVICES, GAME_PLATFORM_LABELS, PHONE_COMPATIBILITY, type EmulatedDevice, type SymbianJob, type SymbianStatus } from '@mgo/protocol';
import { api } from '../api';
import { FirmwareAdd, FirmwareJobStatus, useFirmwareJob } from './FirmwareAdd';
import { Icon } from './Icon';
import { PlatformIcon } from './PlatformIcon';
import { Hint } from './ui';

type Toaster = (kind: 'info' | 'error', text: string) => void;
const gb = (n: number) => `${(n / 1024 ** 3).toFixed(1)} GB`;
type Native = Extract<EmulatedDevice, { engine: 'eka2l1' }>;
type DefaultPlatform = 'ngage' | 'ngage2' | 'symbian';

/** What each platform's default means, in words: the hint next to the choice. */
const PLATFORM_HELP: Record<DefaultPlatform, { title: string; hint: string }> = {
  ngage: {
    title: 'N-Gage 1.0 (game cards)',
    hint: 'Games from a dump of an N-Gage 1.0 game card (a .zip with system/apps). They need N-Gage or N-Gage QD firmware (Symbian 6.1). Used for every such game that has no device of its own.',
  },
  ngage2: {
    title: 'N-Gage 2.0 (.n-gage)',
    hint: '.n-gage packages were made for S60 3rd Edition phones (Symbian 9.x), for example Nokia N95 or 5320 XpressMusic. Used for every such game that has no device of its own.',
  },
  symbian: {
    title: 'S60 applications (.sis / .sisx)',
    hint: 'An old .sis (S60 1st/2nd Edition) needs N70 or N-Gage firmware; a .sisx (S60 3rd Edition and later) needs N95, 5320, E71, 5800 or N8 firmware. MGO reads which one a package is and refuses a firmware that cannot install it.',
  },
};

/** The catalog entry of an installed firmware, by its product code (null for firmware MGO does not know). */
const catalogOf = (code: string): Native | null => EMULATED_DEVICES.flatMap(d => (d.engine === 'eka2l1' && d.firmware.product.toLowerCase() === code.toLowerCase() ? [d] : []))[0] ?? null;
const skinOf = (device: Native | null): string | null => (device ? (Object.entries(PHONE_COMPATIBILITY).find(([, ids]) => ids.includes(device.id))?.[0] ?? null) : null);

/**
 * Settings → Symbian (experimental): the optional mgo-symbian service and the user's own firmware. One way to add firmware: a firmware
 * archive (or a file from the inbox folder). The files are streamed to the service; they are neither kept in the repository nor in MGO's data.
 */
export function SymbianPanel({ toast }: { toast: Toaster }) {
  const [st, setSt] = useState<SymbianStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const alive = useRef(true);

  const load = useCallback(() => {
    api.symbianStatus().then(value => { if (alive.current) { setSt(value); setLoadError(null); } }, e => { if (alive.current) setLoadError((e as Error).message); });
  }, []);
  const { job, jobRunning, jobError, follow, resume, canResume } = useFirmwareJob(toast, load);
  useEffect(() => { alive.current = true; load(); return () => { alive.current = false; }; }, [load]);

  const setDefault = async (platform: DefaultPlatform, code: string) => {
    try { await api.symbianDefault(platform, code || null); load(); } catch (err) { toast('error', (err as Error).message); }
  };

  if (!st) return <div role="status"><p>{loadError ?? translateUI('Checking service and firmware…')}</p><button className="btn sm" onClick={load}>{translateUI('Refresh status')}</button></div>;
  const busy = st.busy || jobRunning;
  const lowDisk = !!st.disk && st.disk.free < 5 * 1024 ** 3;
  const diskUsed = st.disk ? Math.max(0, Math.min(100, Math.round(100 * (1 - st.disk.free / st.disk.total)))) : 0;

  return (
    <div className="symbian-panel" data-testid="symbian-panel">
      {loadError && <p className="note err" role="alert">{loadError}</p>}

      <div className="sym-status card-pad" data-testid="symbian-status">
        <div className="sym-status-main">
          {st.reachable
            ? <span className="badge ok">{translateUI('Service connected')}</span>
            : <span className={`badge ${st.configured ? 'mock' : 'plain'}`}>{translateUI(st.configured ? 'Service not answering' : 'Service not set up')}</span>}
          {st.emulator && <span className="muted small">EKA2L1 <code>{st.emulator}</code></span>}
          {st.busy && <span className="badge plain">{translateUI('busy')}</span>}
          <span className="spacer" />
          <button className="btn sm" onClick={load}><Icon name="restart" /> {translateUI('Refresh status')}</button>
          <a className="btn sm" href="/api/symbian/diagnostics" download data-testid="symbian-diagnostics" title={translateUI("Versions, devices, the service log and the emulator's last words: attach it to a bug report.")}>{translateUI('Download Symbian diagnostics')}</a>
        </div>
        {!st.reachable && <img className="state-art" src="/graphics/states/server-offline.svg" alt="" />}
        {!st.configured && <p className="note">{translateUI('The Symbian service is not set up on this server (SYMBIAN_AGENT_URL is empty). See docs/SYMBIAN.md to enable it.')}</p>}
        {st.configured && !st.reachable && <p className="note err">{translateUI('The Symbian service does not answer')}: {st.message}</p>}
        {st.disk && (
          <div className="sym-disk" data-testid="symbian-disk">
            <div className="sym-disk-text"><span>{translateUI('Free space in the service volume')}</span><strong>{gb(st.disk.free)} / {gb(st.disk.total)}</strong></div>
            <div className={`sym-meter${lowDisk ? ' low' : ''}`} role="img" aria-label={`${diskUsed}%`}><span style={{ width: `${diskUsed}%` }} /></div>
            {lowDisk && <p className="note warn">{translateUI('a firmware needs about twice its size while it is installed; free some space first')}</p>}
          </div>
        )}
      </div>

      {st.reachable && (
        <>
          <p className="note warn">{translateUI('Experimental. Symbian S60 and N-Gage games run in EKA2L1, which MGO does not ship with firmware: you add your own, legally obtained device firmware here. Not every game works.')}</p>

          <h3>{translateUI('Installed devices')} <Hint text="A device is one firmware installed in the service. A game runs on exactly one of them; MGO shows here which phone each firmware belongs to." /></h3>
          {st.firmware.devices.length === 0
            ? <div className="sym-empty" data-testid="no-devices"><p><strong>{translateUI('No firmware yet')}</strong></p><p className="muted">{translateUI('Symbian and N-Gage games cannot start until you add a firmware archive below.')}</p></div>
            : <ul className="sym-devices" data-testid="devices">{st.firmware.devices.map((d) => {
              const cat = catalogOf(d.code);
              const skin = skinOf(cat);
              const defaultsOf = (['ngage', 'ngage2', 'symbian'] as const).filter(pl => st.defaults[pl]?.toLowerCase() === d.code.toLowerCase());
              return (
                <li key={d.code} className="sym-device card-pad" data-testid={`device-${d.code}`}>
                  <div className="sym-thumb">{skin ? <img src={`/phones/${skin}/preview.webp`} alt="" loading="lazy" draggable={false} /> : <Icon name="phone" />}</div>
                  <div className="sym-device-body">
                    <h4>{cat?.name ?? `${d.manufacturer} ${d.model}`}</h4>
                    <p className="muted small">{cat ? cat.os : translateUI('Not in the MGO phone catalog: MGO cannot tell which games it runs.')}</p>
                    <div className="chips">
                      <span className="chip"><code>{d.code}</code></span>
                      {cat && cat.platforms.map(p => <span key={p} className="chip icon-chip"><PlatformIcon platform={p} size={20} /></span>)}
                      {defaultsOf.map(pl => <span key={pl} className="chip on" title={translateUI('This device is the default for this kind of game')}>★ {PLATFORM_HELP[pl].title.split(' (')[0]}</span>)}
                    </div>
                  </div>
                  <button className="btn sm danger" disabled={busy} onClick={async () => { if (confirm(translateUI('Remove this device and its firmware from the service?'))) { try { follow(await api.symbianRemove(d.code)); } catch (e) { toast('error', (e as Error).message); } } }}>{translateUI('Remove')}</button>
                </li>
              );
            })}</ul>}

          {st.firmware.devices.length > 0 && (
            <>
              <h3>{translateUI('Default device per platform')} <Hint text="MGO does not guess which firmware fits a game. Pick here the device used for every game of a platform that has no device of its own (a game's own choice is made in its player)." /></h3>
              <ul className="sym-defaults" data-testid="defaults">
                {(['ngage', 'ngage2', 'symbian'] as const).map((pl) => {
                  const fits = st.firmware.devices.filter(d => { const c = catalogOf(d.code); return !c || c.platforms.includes(pl); });
                  const current = st.defaults[pl] ?? '';
                  const auto = !current && fits.length === 1 ? fits[0] : null;
                  return (
                    <li key={pl} className="sym-default">
                      <div>
                        <strong>{translateUI(PLATFORM_HELP[pl].title)}</strong> <Hint text={PLATFORM_HELP[pl].hint} />
                        <p className="muted small">{translateUI(PLATFORM_HELP[pl].hint)}</p>
                      </div>
                      <div className="sym-default-pick">
                        <select className="select" value={current} data-testid={`default-${pl}`} aria-label={translateUI(PLATFORM_HELP[pl].title)} disabled={busy || fits.length === 0} onChange={(e) => void setDefault(pl, e.target.value)}>
                          <option value="">{translateUI(fits.length === 1 ? 'Automatic (the only suitable device)' : '— not set (ask per game) —')}</option>
                          {fits.map((d) => { const c = catalogOf(d.code); return <option key={d.code} value={d.code}>{c?.name ?? `${d.manufacturer} ${d.model}`} ({d.code})</option>; })}
                        </select>
                        {fits.length === 0 && <span className="note warn">{translateUI('No installed firmware can run these games.')}</span>}
                        {auto && <span className="muted small">{translateUI('Used automatically')}: {catalogOf(auto.code)?.name ?? auto.code}</span>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          <FirmwareAdd st={st} toast={toast} follow={follow} busy={busy} />
          <FirmwareJobStatus job={job} jobError={jobError} canResume={canResume} resume={resume} />
        </>
      )}
    </div>
  );
}
