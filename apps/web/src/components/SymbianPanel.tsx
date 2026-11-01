import { t as translateUI } from '../i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SymbianJob, SymbianStatus } from '@j2me-web/protocol';
import { api, type ApiError } from '../api';
import { checkFactoryFiles, parseFactoryVpl, readFactoryVpl, type FactoryVariant } from '../factoryKit';
import { Icon } from './Icon';

type Toaster = (kind: 'info' | 'error', text: string) => void;
const JOB_KEY = 'jgo.symbian.job.v1';
const mb = (n: number) => `${Math.round(n / 1048576).toLocaleString()} MB`;

/**
 * Settings → Symbian (experimental): state of the optional jgo-symbian service and the user's own firmware. The files are streamed
 * to the service and are neither stored in the repository nor in JGO's data directory.
 */
export function SymbianPanel({ toast }: { toast: Toaster }) {
  const [st, setSt] = useState<SymbianStatus | null>(null);
  const [mode, setMode] = useState<'rom' | 'archive' | 'factory'>('rom');
  const [files, setFiles] = useState<{ rom?: File; rpkg?: File; archive?: File }>({});
  const [pickVersion, setPickVersion] = useState(0);
  const [factoryFiles, setFactoryFiles] = useState<File[]>([]);
  const [variants, setVariants] = useState<FactoryVariant[]>([]);
  const [variant, setVariant] = useState('');
  const [factoryError, setFactoryError] = useState<string | null>(null);
  const [inboxVariant, setInboxVariant] = useState('');
  const kitRevision = useRef(0);
  const bundleRef = useRef<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [job, setJob] = useState<SymbianJob | null>(null);
  const [inboxPick, setInboxPick] = useState<{ rom?: string; rpkg?: string; archive?: string; vpl?: string }>({});
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

  const chooseFactory = async (selected: File[]) => {
    const revision = ++kitRevision.current;
    setFactoryFiles(selected); setFactoryError(null); setVariants([]); setVariant('');
    try {
      checkFactoryFiles(selected);
      const manifest = selected.find(f => /\.vpl$/i.test(f.name))!;
      if (manifest.size > 4 * 1024 * 1024) throw new Error('The VPL manifest is limited to 4 MB.');
      const parsed = parseFactoryVpl(await readFactoryVpl(manifest));
      if (revision !== kitRevision.current) return;
      setVariants(parsed); setVariant(parsed.length === 1 ? '0' : '');
    } catch (e) { if (revision === kitRevision.current) setFactoryError((e as Error).message); }
  };
  const chosenVariant = variants.find(v => String(v.index) === variant);
  const missingImages = chosenVariant?.files.filter(name => !factoryFiles.some(f => f.name === name)) ?? [];

  const install = async () => {
    try {
      if (mode === 'factory') {
        if (!chosenVariant || missingImages.length || factoryError) throw new Error('Select a complete factory kit and a VPL variant.');
        if (factoryFiles.some(f => f.size > (st?.maxFirmwareBytes ?? 0))) throw new Error(translateUI('The selected file exceeds the server firmware limit. Use the inbox folder or change the server limit.'));
        const bundle = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join(''); bundleRef.current = bundle;
        const controller = new AbortController(); uploadAbort.current = controller;
        for (const [index, file] of factoryFiles.entries()) {
          setWorking(`${translateUI('Uploading')} ${index + 1}/${factoryFiles.length}: ${file.name}`); setPercent(0);
          await api.symbianUpload(/\.vpl$/i.test(file.name) ? 'vpl' : 'fpsx', file, { progress: setPercent, signal: controller.signal, bundle });
        }
        uploadAbort.current = null; setPercent(null); setWorking(translateUI('Starting firmware job…'));
        follow(await api.symbianInstall({ vpl: factoryFiles.find(f => /\.vpl$/i.test(f.name))!.name, bundle, variant: chosenVariant.index }));
        bundleRef.current = null; setWorking(null); setFactoryFiles([]); setVariants([]); setVariant(''); setPickVersion(v => v + 1);
        return;
      }
      const sel = mode === 'rom' ? [['rom', files.rom], ['rpkg', files.rpkg]] as const : [['archive', files.archive]] as const;
      if (sel.some(([, f]) => f && f.size > (st?.maxFirmwareBytes ?? 0))) throw new Error(translateUI('The selected file exceeds the server firmware limit. Use the inbox folder or change the server limit.'));
      const controller = new AbortController(); uploadAbort.current = controller;
      const names: Record<string, string> = {};
      for (const [slot, f] of sel) {
        if (!f) continue;
        setPercent(0); setWorking(`${translateUI('Uploading')} ${f.name}…`);
        names[slot] = (await api.symbianUpload(slot, f, { progress: setPercent, signal: controller.signal })).file;
      }
      uploadAbort.current = null; setPercent(null); setWorking(translateUI('Starting firmware job…'));
      follow(await api.symbianInstall(names));
      setWorking(null);
      setFiles({}); setPickVersion(v => v + 1);
    } catch (e) {
      if (bundleRef.current) { void api.symbianDiscardBundle(bundleRef.current).catch(() => undefined); bundleRef.current = null; }
      uploadAbort.current = null; setPercent(null); setWorking(null);
      if ((e as ApiError).code === 'cancelled') { toast('info', translateUI('Upload cancelled')); return; }
      const status = (e as ApiError).status;
      toast('error', status === 413 || status === 0
        ? `${(e as Error).message} — ${translateUI('a proxy or tunnel in front of JGO may be refusing large files; see docs/SYMBIAN.md, "Upload limits", or put the files into the inbox folder')}`
        : (e as Error).message);
    }
  };

  const installFromInbox = async () => {
    setWorking(translateUI('Starting firmware job…'));
    try {
      const request = mode === 'factory'
        ? { vpl: inboxPick.vpl!, ...(inboxVariant !== '' ? { variant: Number(inboxVariant) } : {}) }
        : mode === 'archive' ? { archive: inboxPick.archive! } : { rom: inboxPick.rom!, ...(inboxPick.rpkg ? { rpkg: inboxPick.rpkg } : {}) };
      follow(await api.symbianInstall({ ...request, source: 'inbox' }));
    } catch (e) { toast('error', (e as Error).message); }
    finally { setWorking(null); }
  };

  if (!st) return <div role="status"><p>{loadError ?? translateUI('Checking service and firmware…')}</p><button className="btn sm" onClick={load}>{translateUI('Refresh status')}</button></div>;
  const ready = mode === 'factory' ? !!chosenVariant && !missingImages.length && !factoryError : mode === 'rom' ? !!files.rom : !!files.archive;
  const jobRunning = job?.state === 'running';
  return (
    <div className="symbian-panel" data-testid="symbian-panel">
      <button className="btn sm" onClick={load}>{translateUI('Refresh status')}</button>
      {loadError && <p className="note err" role="alert">{loadError}</p>}
      <div className="note warn">{translateUI("Experimental. Symbian S60 and N-Gage games run in EKA2L1, which JGO does not ship with firmware: you add your own, legally obtained device firmware here. Not every game works.")}</div>
      {!st.configured && <div className="note">{translateUI("The Symbian service is not set up on this server (SYMBIAN_AGENT_URL is empty). See docs/SYMBIAN.md to enable it.")}</div>}
      {st.configured && !st.reachable && <div className="note err">{translateUI("The Symbian service does not answer")}: {st.message}</div>}
      {st.reachable && (
        <>
          <p>
            <span className="badge ok">{translateUI("Service connected")}</span>{' '}
            {st.emulator && <span className="muted small">EKA2L1 {st.emulator}</span>}
            {st.busy && <span className="badge plain">{translateUI("busy")}</span>}
          </p>
          {st.disk && (
            <p className={st.disk.free < 5 * 1024 ** 3 ? 'note warn' : 'muted small'} data-testid="symbian-disk">
              {translateUI("Free space in the service volume")}: {(st.disk.free / 1024 ** 3).toFixed(1)} GB / {(st.disk.total / 1024 ** 3).toFixed(1)} GB
              {st.disk.free < 5 * 1024 ** 3 ? ` — ${translateUI("a firmware needs about twice its size while it is installed; free some space first")}` : ''}
            </p>)}
          <h3>{translateUI("Installed devices")}</h3>
          {st.firmware.devices.length === 0
            ? <p className="muted">{translateUI("No firmware yet: Symbian and N-Gage games cannot start.")}</p>
            : <ul className="plain-list">{st.firmware.devices.map((d) => (
              <li key={d.code}>
                <strong>{d.manufacturer} {d.model}</strong> <code>{d.code}</code>{' '}
                <button className="btn sm danger" disabled={st.busy || jobRunning || !!working} onClick={async () => { if (confirm(translateUI('Remove this device and its firmware from the service?'))) { try { follow(await api.symbianRemove(d.code)); } catch (e) { toast('error', (e as Error).message); } } }}>{translateUI("Remove")}</button>
              </li>))}</ul>}
          {st.firmware.devices.length > 1 && (
            <>
              <h3>{translateUI("Default device per platform")}</h3>
              <p className="muted small">{translateUI("JGO does not guess which firmware fits a game. With several devices, choose one here for every game of a platform (a game can still have its own in its settings).")}</p>
              {(['ngage', 'ngage2', 'symbian'] as const).map((pl) => (
                <label className="field" key={pl}><span className="label-caps">{pl === 'ngage' ? 'N-Gage 1.0' : pl === 'ngage2' ? 'N-Gage 2.0' : 'S60'}</span>
                  <select className="select" value={st.defaults[pl] ?? ''} data-testid={`default-${pl}`} onChange={async (e) => { try { await api.symbianDefault(pl, e.target.value || null); load(); } catch (err) { toast('error', (err as Error).message); } }}>
                    <option value="">{translateUI("— not set —")}</option>
                    {st.firmware.devices.map((d) => <option key={d.code} value={d.code}>{d.manufacturer} {d.model} ({d.code})</option>)}
                  </select>
                </label>))}
            </>)}
          <h3>{translateUI("Add firmware")}</h3>
          <div className="btn-row" role="radiogroup" aria-label={translateUI("Firmware format")}>
            <button className={`btn sm${mode === 'rom' ? ' primary' : ''}`} disabled={!!working || jobRunning || st.busy} onClick={() => setMode('rom')} aria-pressed={mode === 'rom'}>{translateUI("ROM + RPKG")}</button>
            <button className={`btn sm${mode === 'archive' ? ' primary' : ''}`} disabled={!!working || jobRunning || st.busy} onClick={() => setMode('archive')} aria-pressed={mode === 'archive'}>{translateUI("Firmware archive")}</button>
            <button className={`btn sm${mode === 'factory' ? ' primary' : ''}`} disabled={!!working || jobRunning || st.busy} onClick={() => setMode('factory')} aria-pressed={mode === 'factory'} data-testid="factory-mode">{translateUI('Factory kit (.vpl + .fpsx)')}</button>
          </div>
          {mode === 'factory' ? <div data-testid="factory-kit">
            <label className="field"><span className="label-caps">{translateUI('VPL manifest and FPSX images')}</span><input type="file" accept=".vpl,.fpsx" multiple disabled={!!working || jobRunning || st.busy} onChange={e => void chooseFactory([...(e.target.files ?? [])])} key={`factory-${pickVersion}`} data-testid="fw-factory" /></label>
            {st.emulator && !st.emulator.includes('+jgo-vpl') && <p className="note warn">{translateUI('Factory installation requires the VPL-enabled Symbian service. Rebuild an older service before uploading a large kit.')}</p>}
            <p className="hint">{translateUI('Select one .vpl and its .fpsx images together. Original filenames are preserved; no prior ROM dump is needed.')}</p>
            {factoryError && <p className="note err" role="alert">{translateUI(factoryError)}</p>}
            {variants.length > 0 && <label className="field"><span className="label-caps">{translateUI('Firmware variant')}</span><select className="select" value={variant} disabled={!!working || jobRunning} onChange={e => setVariant(e.target.value)} data-testid="fw-variant"><option value="">{translateUI('Choose a variant')}</option>{variants.map(v => <option value={v.index} key={v.index}>{v.label}</option>)}</select></label>}
            {missingImages.length > 0 && <p className="note err" role="alert">{translateUI('Missing FPSX images (filenames are case-sensitive):')} {missingImages.join(', ')}</p>}
            {factoryFiles.length > 0 && <details><summary>{factoryFiles.length} {translateUI('files selected')}</summary><ul>{factoryFiles.map(f => <li key={f.name}>{f.name} · {mb(f.size)}</li>)}</ul></details>}
          </div> : mode === 'rom'
            ? (<>
              <label className="field"><span className="label-caps">{translateUI("ROM file")}</span><input type="file" disabled={!!working || jobRunning || st.busy} onChange={(e) => setFiles((f) => ({ ...f, ...(e.target.files?.[0] ? { rom: e.target.files[0] } : {}) }))} key={`rom-${pickVersion}`} data-testid="fw-rom" /></label>
              <label className="field"><span className="label-caps">{translateUI("RPKG file (optional)")}</span><input type="file" disabled={!!working || jobRunning || st.busy} accept=".rpkg" onChange={(e) => setFiles((f) => ({ ...f, ...(e.target.files?.[0] ? { rpkg: e.target.files[0] } : {}) }))} key={`rpkg-${pickVersion}`} data-testid="fw-rpkg" /></label>
            </>)
            : <label className="field"><span className="label-caps">{translateUI("Archive (.zip, .7z, .rar, .rpkg)")}</span><input type="file" disabled={!!working || jobRunning || st.busy} accept=".zip,.7z,.rar,.rpkg" onChange={(e) => setFiles((f) => ({ ...f, ...(e.target.files?.[0] ? { archive: e.target.files[0] } : {}) }))} key={`archive-${pickVersion}`} data-testid="fw-archive" /></label>}
          <p className="muted small">{translateUI("Files up to")} {mb(st.maxFirmwareBytes)}. {translateUI("They are sent to the service only and are not kept in JGO or in its image. Installing can take several minutes.")}</p>
          <p><a className="btn sm" href="/api/symbian/diagnostics" download data-testid="symbian-diagnostics">{translateUI("Download Symbian diagnostics")}</a> <span className="muted small">{translateUI("Versions, devices, the service log and the emulator's last words: attach it to a bug report.")}</span></p>
          <button className="btn primary" disabled={!ready || !!working || jobRunning || st.busy} onClick={install} data-testid="fw-install"><Icon name="upload" /> {translateUI("Upload and install")}</button>
          {working && <div role="status"><p className="muted">{working} {percent !== null ? `${percent}%` : ''}</p><progress max={100} value={percent ?? undefined} aria-label={translateUI('Firmware upload progress')} />{uploadAbort.current && <button className="btn sm" onClick={() => uploadAbort.current?.abort()}>{translateUI('Cancel upload')}</button>}</div>}
          {st.inbox.length > 0 && (
            <div data-testid="inbox">
              <h3>{translateUI("Firmware from a folder")}</h3>
              <p className="muted small">{translateUI("Files found in the service's inbox folder. They are read in place, never uploaded through the browser and never deleted.")}</p>
              {(mode === 'factory' ? ['vpl'] as const : mode === 'archive' ? ['archive'] as const : ['rom', 'rpkg'] as const).map((slot) => (
                <label className="field" key={slot}><span className="label-caps">{slot === 'rom' ? 'ROM' : slot === 'rpkg' ? 'RPKG' : slot === 'vpl' ? 'VPL' : translateUI('Archive')}</span>
                  <select className="select" value={inboxPick[slot] ?? ''} data-testid={`inbox-${slot}`} onChange={(e) => setInboxPick((p) => ({ ...p, [slot]: e.target.value || undefined }))}>
                    <option value="">—</option>
                    {st.inbox.map((f) => <option key={f.name} value={f.name}>{f.name} ({mb(f.size)})</option>)}
                  </select>
                </label>))}
              {mode === 'factory' && <label className="field"><span className="label-caps">{translateUI('VPL variant index (0-based; blank for a single variant)')}</span><input className="input" type="number" min={0} max={65535} value={inboxVariant} onChange={e => setInboxVariant(e.target.value)} data-testid="inbox-variant" /><span className="hint">{translateUI('Keep the VPL and all referenced FPSX images together in the inbox with their original filenames.')}</span></label>}
              <button className="btn" disabled={!(mode === 'factory' ? inboxPick.vpl : mode === 'archive' ? inboxPick.archive : inboxPick.rom) || !!working || jobRunning || st.busy} onClick={installFromInbox} data-testid="inbox-install">{translateUI("Install from the folder")}</button>
            </div>)}
          {jobError && <div className="note err" role="alert">{translateUI('Monitoring interrupted. The firmware job may still be running.')}{jobId.current && <button className="btn sm" onClick={() => {
            void api.symbianJob(jobId.current!).then(follow, e => setJobError((e as Error).message));
          }}>{translateUI('Resume monitoring')}</button>}</div>}
          {jobRunning && <progress max={1} value={job.progress ?? undefined} aria-label={translateUI('Firmware installation progress')} />}
          {job && <p role="status" className={job.state === 'failed' ? 'note err' : 'muted'}>{translateUI(job.state === 'running' ? 'Working…' : job.state === 'succeeded' ? 'Done' : 'Failed')}{job.state === 'failed' && job.error ? `: ${job.error}` : ''}</p>}
        </>
      )}
    </div>
  );
}
