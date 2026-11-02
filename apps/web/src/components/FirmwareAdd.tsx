import { t as translateUI } from '../i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SymbianJob, SymbianStatus } from '@mgo/protocol';
import { api, type ApiError } from '../api';
import { Icon } from './Icon';
import { Hint } from './ui';

type Toaster = (kind: 'info' | 'error', text: string) => void;
const JOB_KEY = 'mgo.symbian.job.v1';
export const mb = (n: number) => `${Math.round(n / 1048576).toLocaleString()} MB`;

/**
 * Follows the firmware job of the Symbian service (install or remove), also after the page was reloaded. `onFinished` runs when
 * the job is over, whatever the result, so the caller can read the device list again.
 */
export function useFirmwareJob(toast: Toaster, onFinished: () => void) {
  const [job, setJob] = useState<SymbianJob | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const jobId = useRef<string | null>(null);
  const alive = useRef(true);
  const timer = useRef<number | null>(null);
  const finished = useRef(onFinished); finished.current = onFinished;

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
          finished.current();
        } else timer.current = window.setTimeout(poll, 2000);
      } catch (e) { if (alive.current) { setJobError((e as Error).message); timer.current = null; } }
    };
    timer.current = window.setTimeout(poll, 500);
  }, [toast]);

  useEffect(() => {
    alive.current = true;
    try {
      const id = localStorage.getItem(JOB_KEY);
      if (id && /^[a-f0-9]{12}$/.test(id)) {
        jobId.current = id;
        api.symbianJob(id).then(follow, e => {
          if (!alive.current) return;
          if ((e as ApiError).status === 404) { jobId.current = null; localStorage.removeItem(JOB_KEY); finished.current(); }
          else setJobError((e as Error).message);
        });
      }
    } catch { /* storage unavailable */ }
    return () => { alive.current = false; if (timer.current) window.clearTimeout(timer.current); };
  }, [follow]);

  const resume = () => { if (jobId.current) void api.symbianJob(jobId.current).then(follow, e => setJobError((e as Error).message)); };
  return { job, jobRunning: job?.state === 'running', jobError, follow, resume, canResume: !!jobId.current };
}

/** One firmware archive in, one device out: choose the archive (or a file of the inbox folder), upload, install. */
export function FirmwareAdd({ st, toast, follow, busy: outerBusy = false, title = 'Add firmware', hint = 'One firmware archive per device. If you have a ROM and its RPKG, or a factory kit (.vpl + .fpsx), pack them into one archive first, or put them in the inbox folder.', compact = false }: { st: SymbianStatus; toast: Toaster; follow: (j: SymbianJob) => void; busy?: boolean; title?: string; hint?: string; compact?: boolean }) {
  const [archive, setArchive] = useState<File | null>(null);
  const [pickVersion, setPickVersion] = useState(0);
  const [working, setWorking] = useState<string | null>(null);
  const [inboxPick, setInboxPick] = useState('');
  const [percent, setPercent] = useState<number | null>(null);
  const uploadAbort = useRef<AbortController | null>(null);
  useEffect(() => () => uploadAbort.current?.abort(), []);
  const busy = outerBusy || st.busy || !!working;

  const install = async () => {
    if (!archive) return;
    try {
      if (archive.size > (st.maxFirmwareBytes ?? 0)) throw new Error(translateUI('The selected file exceeds the server firmware limit. Use the inbox folder or change the server limit.'));
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

  return (
    <div className={`fw-add${compact ? ' compact' : ''}`}>
      {title && <h3>{translateUI(title)} {hint && <Hint text={hint} />}</h3>}
      <div className="sym-add card-pad">
        <label className={`sym-drop${archive ? ' has-file' : ''}`}>
          <input type="file" accept=".zip,.7z,.rar,.rpkg" disabled={busy} onChange={(e) => setArchive(e.target.files?.[0] ?? null)} key={`archive-${pickVersion}`} data-testid="fw-archive" />
          <span className="sym-drop-title"><Icon name="upload" /> {archive ? archive.name : translateUI('Choose a firmware archive')}</span>
          <span className="muted small">{archive ? mb(archive.size) : translateUI('.zip, .7z, .rar or .rpkg')} · {translateUI('up to')} {mb(st.maxFirmwareBytes)}</span>
        </label>
        <button className="btn primary" disabled={!archive || busy} onClick={install} data-testid="fw-install"><Icon name="upload" /> {translateUI('Upload and install')}</button>
      </div>
      {!compact && <p className="muted small">{translateUI('They are sent to the service only and are not kept in MGO or in its image. Installing can take several minutes.')}</p>}
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
    </div>
  );
}

/** Progress and result of the firmware job, under whatever started it. */
export function FirmwareJobStatus({ job, jobError, canResume, resume }: { job: SymbianJob | null; jobError: string | null; canResume: boolean; resume: () => void }) {
  return (
    <>
      {jobError && <div className="note err" role="alert">{translateUI('Monitoring interrupted. The firmware job may still be running.')}{canResume && <button className="btn sm" onClick={resume}>{translateUI('Resume monitoring')}</button>}</div>}
      {job?.state === 'running' && <progress max={1} value={job.progress ?? undefined} aria-label={translateUI('Firmware installation progress')} />}
      {job && <p role="status" className={job.state === 'failed' ? 'note err' : 'muted'}>{translateUI(job.state === 'running' ? 'Working…' : job.state === 'succeeded' ? 'Done' : 'Failed')}{job.state === 'failed' && job.error ? `: ${job.error}` : ''}</p>}
    </>
  );
}
