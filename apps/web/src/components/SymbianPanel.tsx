import { t as translateUI } from '../i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SymbianJob, SymbianStatus } from '@j2me-web/protocol';
import { api } from '../api';
import { Icon } from './Icon';

type Toaster = (kind: 'info' | 'error', text: string) => void;
const mb = (n: number) => `${Math.round(n / 1048576).toLocaleString()} MB`;

/**
 * Settings → Symbian (experimental): state of the optional jgo-symbian service and the user's own firmware. The files are streamed
 * to the service and are neither stored in the repository nor in JGO's data directory.
 */
export function SymbianPanel({ toast }: { toast: Toaster }) {
  const [st, setSt] = useState<SymbianStatus | null>(null);
  const [mode, setMode] = useState<'rom' | 'archive'>('rom');
  const [files, setFiles] = useState<{ rom?: File; rpkg?: File; archive?: File }>({});
  const [working, setWorking] = useState<string | null>(null);
  const [job, setJob] = useState<SymbianJob | null>(null);
  const timer = useRef<number | null>(null);

  const load = useCallback(() => { api.symbianStatus().then(setSt, (e) => toast('error', (e as Error).message)); }, [toast]);
  useEffect(() => { load(); return () => { if (timer.current) window.clearInterval(timer.current); }; }, [load]);

  const follow = useCallback((j: SymbianJob) => {
    setJob(j);
    if (timer.current) window.clearInterval(timer.current);
    timer.current = window.setInterval(async () => {
      try {
        const cur = await api.symbianJob(j.id);
        setJob(cur);
        if (cur.state !== 'running') {
          if (timer.current) window.clearInterval(timer.current);
          timer.current = null;
          toast(cur.state === 'succeeded' ? 'info' : 'error', cur.state === 'succeeded' ? translateUI('Firmware installed') : `${translateUI('Firmware job failed')}: ${cur.error ?? ''}`);
          load();
        }
      } catch (e) { toast('error', (e as Error).message); if (timer.current) window.clearInterval(timer.current); }
    }, 2000);
  }, [load, toast]);

  const install = async () => {
    try {
      const sel = mode === 'rom' ? [['rom', files.rom], ['rpkg', files.rpkg]] as const : [['archive', files.archive]] as const;
      const names: Record<string, string> = {};
      for (const [slot, f] of sel) {
        if (!f) continue;
        setWorking(`${translateUI('Uploading')} ${f.name}…`);
        names[slot] = (await api.symbianUpload(slot, f)).file;
      }
      setWorking(null);
      follow(await api.symbianInstall(names));
      setFiles({});
    } catch (e) { setWorking(null); toast('error', (e as Error).message); }
  };

  if (!st) return <p className="muted">…</p>;
  const ready = mode === 'rom' ? !!files.rom : !!files.archive;
  const jobRunning = job?.state === 'running';
  return (
    <div className="symbian-panel" data-testid="symbian-panel">
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
          <h3>{translateUI("Installed devices")}</h3>
          {st.firmware.devices.length === 0
            ? <p className="muted">{translateUI("No firmware yet: Symbian and N-Gage games cannot start.")}</p>
            : <ul className="plain-list">{st.firmware.devices.map((d) => (
              <li key={d.code}>
                <strong>{d.manufacturer} {d.model}</strong> <code>{d.code}</code>{' '}
                <button className="btn sm danger" disabled={st.busy || jobRunning} onClick={async () => { if (confirm(translateUI('Remove this device and its firmware from the service?'))) { try { follow(await api.symbianRemove(d.code)); } catch (e) { toast('error', (e as Error).message); } } }}>{translateUI("Remove")}</button>
              </li>))}</ul>}
          <h3>{translateUI("Add firmware")}</h3>
          <div className="btn-row" role="radiogroup" aria-label={translateUI("Firmware format")}>
            <button className={`btn sm${mode === 'rom' ? ' primary' : ''}`} onClick={() => setMode('rom')} aria-pressed={mode === 'rom'}>{translateUI("ROM + RPKG")}</button>
            <button className={`btn sm${mode === 'archive' ? ' primary' : ''}`} onClick={() => setMode('archive')} aria-pressed={mode === 'archive'}>{translateUI("Firmware archive")}</button>
          </div>
          {mode === 'rom'
            ? (<>
              <label className="field"><span className="label-caps">{translateUI("ROM file")}</span><input type="file" onChange={(e) => setFiles((f) => ({ ...f, ...(e.target.files?.[0] ? { rom: e.target.files[0] } : {}) }))} data-testid="fw-rom" /></label>
              <label className="field"><span className="label-caps">{translateUI("RPKG file (optional)")}</span><input type="file" accept=".rpkg" onChange={(e) => setFiles((f) => ({ ...f, ...(e.target.files?.[0] ? { rpkg: e.target.files[0] } : {}) }))} data-testid="fw-rpkg" /></label>
            </>)
            : <label className="field"><span className="label-caps">{translateUI("Archive (.zip, .7z, .rar, .rpkg)")}</span><input type="file" accept=".zip,.7z,.rar,.rpkg" onChange={(e) => setFiles((f) => ({ ...f, ...(e.target.files?.[0] ? { archive: e.target.files[0] } : {}) }))} data-testid="fw-archive" /></label>}
          <p className="muted small">{translateUI("Files up to")} {mb(st.maxFirmwareBytes)}. {translateUI("They are sent to the service only and are not kept in JGO or in its image. Installing can take several minutes.")}</p>
          <button className="btn primary" disabled={!ready || !!working || jobRunning || st.busy} onClick={install} data-testid="fw-install"><Icon name="upload" /> {translateUI("Upload and install")}</button>
          {working && <p className="muted" role="status">{working}</p>}
          {job && <p role="status" className={job.state === 'failed' ? 'note err' : 'muted'}>{translateUI(job.state === 'running' ? 'Working…' : job.state === 'succeeded' ? 'Done' : 'Failed')}{job.state === 'failed' && job.error ? `: ${job.error}` : ''}</p>}
        </>
      )}
    </div>
  );
}
