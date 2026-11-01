import { t as translateUI } from '../i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { EMULATED_DEVICES, GAME_PLATFORM_LABELS, PHONE_COMPATIBILITY, type EmulatedDevice, type SymbianJob, type SymbianStatus } from '@j2me-web/protocol';
import { api, type ApiError } from '../api';
import { Icon } from './Icon';
import { Hint } from './ui';

type Toaster = (kind: 'info' | 'error', text: string) => void;
const JOB_KEY = 'jgo.symbian.job.v1';
const mb = (n: number) => `${Math.round(n / 1048576).toLocaleString()} MB`;
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
  const [archive, setArchive] = useState<File | null>(null);
  const [pickVersion, setPickVersion] = useState(0);
  const [working, setWorking] = useState<string | null>(null);
  const [job, setJob] = useState<SymbianJob | null>(null);
  const [inboxPick, setInboxPick] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const jobId = useRef<string | null>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const uploadAbort = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const timer = useRef<number | null>(null);

  const load = useCallback(() => {
    api.symbianStatus().then(value => { if (alive.current) { setSt(value); setLoadError(null); } }, e => { if (alive.current) setLoadError((e as Error).message); });
  }, []);

  const follow = useCallback((j: SymbianJob) => {
    jobId.current = j.id;
    try { localStorage.setItem(JOB_KEY, j.id); } catch { /* storage unavailable */ }
    if (!alive.current) return;
    setJob(j); setJobError(null);
    if (timer.current) window.clearTimeout(timer.current);
    const poll = async () => {
      try {
        const cur = await api.symbianJob(j.id);
        if (!alive.current) return;
        setJob(cur);
        if (cur.state !== 'running') {
          timer.current = null; jobId.current = null;
          try { localStorage.removeItem(JOB_KEY); } catch { /* storage unavailable */ }
          toast(cur.state === 'succeeded' ? 'info' : 'error', cur.state === 'succeeded' ? translateUI('Firmware installed') : `${translateUI('Firmware job failed')}: ${cur.error ?? ''}`);
          load();
        } else timer.current = window.setTimeout(poll, 2000);
      } catch (e) { if (alive.current) { setJobError((e as Error).message); timer.current = null; } }
    };
    timer.current = window.setTimeout(poll, 500);
  }, [load, toast]);

  useEffect(() => {
    alive.current = true;
    load();
    try {
      const id = localStorage.getItem(JOB_KEY);
      if (id && /^[a-f0-9]{12}$/.test(id)) {
        jobId.current = id;
        api.symbianJob(id).then(follow, e => {
          if (!alive.current) return;
          if ((e as ApiError).status === 404) { jobId.current = null; localStorage.removeItem(JOB_KEY); load(); }
          else setJobError((e as Error).message);
        });
      }
    } catch { /* storage unavailable */ }
    return () => { alive.current = false; if (timer.current) window.clearTimeout(timer.current); uploadAbort.current?.abort(); };
  }, [load, follow]);

  const install = async () => {
    if (!archive) return;
    try {
      if (archive.size > (st?.maxFirmwareBytes ?? 0)) throw new Error(translateUI('The selected file exceeds the server firmware limit. Use the inbox folder or change the server limit.'));
      const controller = new AbortController(); uploadAbort.current = controller;
      setPercent(0); setWorking(`${translateUI('Uploading')} ${archive.name}…`);
      const stored = await api.symbianUpload('archive', archive, { progress: setPercent, signal: controller.signal });
      uploadAbort.current = null; setPercent(null); setWorking(translateUI('Starting firmware job…'));
      follow(await api.symbianInstall({ archive: stored.file }));
      setWorking(null); setArchive(null); setPickVersion(v => v + 1);
    } catch (e) {
      uploadAbort.current = null; setPercent(null); setWorking(null);
      if ((e as ApiError).code === 'cancelled') { toast('info', translateUI('Upload cancelled')); return; }
      const status = (e as ApiError).status;
      toast('error', status === 413 || status === 0
        ? `${(e as Error).message} — ${translateUI('a proxy or tunnel in front of MGO may be refusing large files; see docs/SYMBIAN.md, "Upload limits", or put the files into the inbox folder')}`
        : (e as Error).message);
    }
  };

  const installFromInbox = async () => {
    setWorking(translateUI('Starting firmware job…'));
    try { follow(await api.symbianInstall({ archive: inboxPick, source: 'inbox' })); }
    catch (e) { toast('error', (e as Error).message); }
    finally { setWorking(null); }
  };

  const setDefault = async (platform: DefaultPlatform, code: string) => {
    try { await api.symbianDefault(platform, code || null); load(); } catch (err) { toast('error', (err as Error).message); }
  };

  if (!st) return <div role="status"><p>{loadError ?? translateUI('Checking service and firmware…')}</p><button className="btn sm" onClick={load}>{translateUI('Refresh status')}</button></div>;
  const jobRunning = job?.state === 'running';
  const busy = st.busy || jobRunning || !!working;
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
                      {cat && cat.platforms.map(p => <span key={p} className="chip">{GAME_PLATFORM_LABELS[p]}</span>)}
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

          <h3>{translateUI('Add firmware')} <Hint text="One firmware archive per device. If you have a ROM and its RPKG, or a factory kit (.vpl + .fpsx), pack them into one archive first, or put them in the inbox folder." /></h3>
          <div className="sym-add card-pad">
            <label className={`sym-drop${archive ? ' has-file' : ''}`}>
              <input type="file" accept=".zip,.7z,.rar,.rpkg" disabled={busy} onChange={(e) => setArchive(e.target.files?.[0] ?? null)} key={`archive-${pickVersion}`} data-testid="fw-archive" />
              <span className="sym-drop-title"><Icon name="upload" /> {archive ? archive.name : translateUI('Choose a firmware archive')}</span>
              <span className="muted small">{archive ? mb(archive.size) : translateUI('.zip, .7z, .rar or .rpkg')} · {translateUI('up to')} {mb(st.maxFirmwareBytes)}</span>
            </label>
            <button className="btn primary" disabled={!archive || busy} onClick={install} data-testid="fw-install"><Icon name="upload" /> {translateUI('Upload and install')}</button>
          </div>
          <p className="muted small">{translateUI('They are sent to the service only and are not kept in MGO or in its image. Installing can take several minutes.')}</p>
          {working && <div role="status"><p className="muted">{working} {percent !== null ? `${percent}%` : ''}</p><progress max={100} value={percent ?? undefined} aria-label={translateUI('Firmware upload progress')} />{uploadAbort.current && <button className="btn sm" onClick={() => uploadAbort.current?.abort()}>{translateUI('Cancel upload')}</button>}</div>}

          {st.inbox.length > 0 && (
            <div className="sym-inbox card-pad" data-testid="inbox">
              <h4>{translateUI('Firmware from a folder')} <Hint text="Files found in the service's inbox folder. They are read in place, never uploaded through the browser and never deleted. Use it for very large firmware or when a proxy blocks big uploads." /></h4>
              <label className="field"><span className="label-caps">{translateUI('Archive')}</span>
                <select className="select" value={inboxPick} data-testid="inbox-archive" onChange={(e) => setInboxPick(e.target.value)}>
                  <option value="">—</option>
                  {st.inbox.map((f) => <option key={f.name} value={f.name}>{f.name} ({mb(f.size)})</option>)}
                </select>
              </label>
              <button className="btn" disabled={!inboxPick || busy} onClick={installFromInbox} data-testid="inbox-install">{translateUI('Install from the folder')}</button>
            </div>)}

          {jobError && <div className="note err" role="alert">{translateUI('Monitoring interrupted. The firmware job may still be running.')}{jobId.current && <button className="btn sm" onClick={() => { void api.symbianJob(jobId.current!).then(follow, e => setJobError((e as Error).message)); }}>{translateUI('Resume monitoring')}</button>}</div>}
          {jobRunning && <progress max={1} value={job.progress ?? undefined} aria-label={translateUI('Firmware installation progress')} />}
          {job && <p role="status" className={job.state === 'failed' ? 'note err' : 'muted'}>{translateUI(job.state === 'running' ? 'Working…' : job.state === 'succeeded' ? 'Done' : 'Failed')}{job.state === 'failed' && job.error ? `: ${job.error}` : ''}</p>}
        </>
      )}
    </div>
  );
}
