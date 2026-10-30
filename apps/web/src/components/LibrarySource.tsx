import type { LibraryCheck, LibraryRoot, ScanReport } from '@j2me-web/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type BrowseResult } from '../api';
import { setServerSettings, useServerSettings } from '../serverSettings';
import { Icon } from './Icon';
import { Seg } from './ui';

type Toaster = (kind: 'info' | 'error', text: string) => void;

const fmtBytes = (n: number) => (n > 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : n > 1048576 ? `${(n / 1048576).toFixed(0)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Choosing the folder with the games. Only the locations the server allows are offered; nothing else can be typed in. */
export function LibrarySource({ toast, onSaved, saveLabel = 'Use this folder' }: { toast: Toaster; onSaved?: (path: string | null) => void; saveLabel?: string }) {
  const server = useServerSettings();
  const current = server?.settings.libraryPath ?? null;
  const [roots, setRoots] = useState<LibraryRoot[] | null>(null);
  const [path, setPath] = useState(current ?? '');
  const [browse, setBrowse] = useState<BrowseResult | null>(null);
  const [check, setCheck] = useState<LibraryCheck | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.libRoots().then((r) => { setRoots(r.roots); if (!current) setPath((p) => p || r.roots.find((x) => x.exists)?.path || ''); }, (e) => toast('error', (e as Error).message)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const runCheck = useCallback(async (p: string) => {
    setBusy(true);
    try { setCheck(await api.libCheck(p)); } catch (e) { toast('error', (e as Error).message); } finally { setBusy(false); }
  }, [toast]);

  const open = async (p: string | null) => {
    try { const b = await api.libBrowse(p); setBrowse(b); if (b.path) { setPath(b.path); setCheck(null); } } catch (e) { toast('error', (e as Error).message); }
  };

  const save = async (p: string | null) => {
    setBusy(true);
    try {
      const r = await api.patchSettings({ libraryPath: p });
      setServerSettings(r);
      toast('info', p ? 'Library folder saved' : 'Library folder removed');
      onSaved?.(r.settings.libraryPath);
    } catch (e) { toast('error', (e as Error).message); } finally { setBusy(false); }
  };

  const anyRoot = roots?.some((r) => r.exists) ?? false;
  return (
    <div className="stack">
      {current && <p className="note info">Current folder: <code>{current}</code></p>}
      {roots && !anyRoot && (
        <div className="note warn">
          <p><strong>No game folder is connected to this server yet.</strong> That is fine: you can keep uploading games from the browser. To import a whole collection, share a folder with the container:</p>
          <p>On the Proxmox host (read-only, the games are never modified):</p>
          <pre className="codeblock">pct set &lt;CTID&gt; -mp0 /path/on/host/games,mp=/mnt/jgo-library,ro=1{'\n'}pct reboot &lt;CTID&gt;</pre>
          <p>or copy the files into <code>/var/lib/jgo/import</code> inside the container. Details: <code>docs/PROXMOX.md</code>, “Game library”.</p>
        </div>
      )}
      <div className="root-list" role="list">
        {(roots ?? []).map((r) => (
          <button key={r.path} type="button" role="listitem" className={`root ${path === r.path ? 'on' : ''}`} disabled={!r.exists} onClick={() => void open(r.path)} title={r.note ?? r.path}>
            <Icon name="library" /> <code>{r.path}</code>
            <span className={`badge ${!r.exists ? 'plain' : r.readable ? 'prod' : 'danger'}`}>{!r.exists ? 'not present' : r.readable ? (r.writable ? 'readable · writable' : 'read-only') : 'no access'}</span>
          </button>
        ))}
      </div>
      <label className="field">
        <span className="label-caps">Folder</span>
        <input className="input mono" value={path} onChange={(e) => { setPath(e.target.value); setCheck(null); }} placeholder="/mnt/jgo-library" spellCheck={false} aria-label="Library folder" />
      </label>
      {browse && browse.path && (
        <div className="folder-list" aria-label="Sub-folders">
          {browse.parent && <button type="button" className="folder" onClick={() => void open(browse.parent)}>↑ ..</button>}
          {browse.dirs.map((d) => <button key={d.path} type="button" className="folder" onClick={() => void open(d.path)}>{d.name}/</button>)}
          {browse.dirs.length === 0 && <span className="muted small">No sub-folders.</span>}
          {browse.truncated && <span className="muted small">Only the first 500 are shown.</span>}
        </div>
      )}
      <div className="btn-row">
        <button className="btn" type="button" disabled={busy || !path} onClick={() => void runCheck(path)}>Check access</button>
        <button className="btn primary" type="button" disabled={busy || !path || (check !== null && !check.ok)} onClick={() => void save(path)}>{saveLabel}</button>
        {current && <button className="btn ghost" type="button" disabled={busy} onClick={() => void save(null)}>Stop using a folder</button>}
      </div>
      {check && (
        <div className={`note ${check.ok ? 'info' : 'err'}`} role="status">
          {check.ok
            ? <p><strong>Readable.</strong> {check.jarCount.toLocaleString()} JAR and {check.jadCount.toLocaleString()} JAD files found ({fmtBytes(check.totalBytes)}){check.truncated ? ', at least' : ''}.</p>
            : <p><strong>Cannot use this folder.</strong></p>}
          {[...check.problems, ...check.warnings].map((t) => <p key={t}>{t}</p>)}
        </div>
      )}
    </div>
  );
}

const pct = (r: ScanReport) => (r.jars ? Math.min(100, Math.round(((r.added + r.updated + r.unchanged + r.skipped + 0) / r.jars) * 100)) : 0);

/** Starts and follows a scan; shows what the last one found. */
export function ScanPanel({ toast, onDone, canScan }: { toast: Toaster; onDone?: () => void; canScan: boolean }) {
  const [state, setState] = useState<{ running: boolean; report: ScanReport | null } | null>(null);
  const was = useRef(false);

  const poll = useCallback(async () => {
    try {
      const s = await api.scan();
      setState(s);
      if (was.current && !s.running) onDone?.();
      was.current = s.running;
    } catch { /* offline: try again */ }
  }, [onDone]);
  useEffect(() => { void poll(); }, [poll]);
  useEffect(() => {
    if (!state?.running) return;
    const t = window.setInterval(() => void poll(), 1000);
    return () => window.clearInterval(t);
  }, [state?.running, poll]);

  const start = async (mode: 'update' | 'full') => {
    try { was.current = true; setState(await api.scanStart(mode)); } catch (e) { was.current = false; toast('error', (e as Error).message); }
  };
  const r = state?.report ?? null;
  const [mode, setMode] = useState<'update' | 'full'>('update');
  return (
    <div className="stack">
      <div className="btn-row">
        <Seg<'update' | 'full'> label="Scan mode" value={mode} onChange={setMode} options={[{ value: 'update', label: 'Changes only', title: 'Skips files whose size and date did not change' }, { value: 'full', label: 'Full re-check', title: 'Reads and hashes every file again' }]} />
        <button className="btn primary" type="button" disabled={!canScan || state?.running} onClick={() => void start(mode)}>
          <Icon name="restart" /> {state?.running ? 'Scanning…' : 'Scan library folder'}
        </button>
        {state?.running && <button className="btn" type="button" onClick={() => void api.scanCancel().then(poll)}>Stop</button>}
      </div>
      {!canScan && <p className="muted small">Choose a library folder first.</p>}
      <p className="muted small">Scanning copies new games into JGO’s own library and never changes, moves or deletes anything in your folder. Your games, favourites, settings and saved data are never removed by a scan.</p>
      {r && (
        <div className="scan" data-testid="scan-report">
          {r.state === 'running' && (
            <>
              <div className="meter" role="progressbar" aria-valuenow={pct(r)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${pct(r)}%` }} /></div>
              <p className="muted small mono">{r.current ?? 'Looking for files…'} · {r.filesSeen.toLocaleString()} files found</p>
            </>
          )}
          <dl className="stats">
            <dt>Status</dt><dd><span className={`badge ${r.state === 'done' ? 'prod' : r.state === 'running' ? 'dev' : 'mock'}`}>{r.state}</span> {r.finishedAt ? <span className="muted small">{new Date(r.finishedAt).toLocaleString()}</span> : null}</dd>
            <dt>JAR files</dt><dd>{r.jars.toLocaleString()}</dd>
            <dt>New games</dt><dd>{r.added}</dd>
            <dt>Changed files</dt><dd>{r.updated}</dd>
            <dt>Unchanged</dt><dd>{r.unchanged}</dd>
            <dt>Duplicates</dt><dd>{r.duplicates} <span className="muted small">(same file in several places)</span></dd>
            <dt>Other versions</dt><dd>{r.newVersions} <span className="muted small">(same game, different file)</span></dd>
            <dt>Missing files</dt><dd>{r.missing} <span className="muted small">(kept in the library)</span></dd>
            <dt>Skipped</dt><dd>{r.skipped}</dd>
          </dl>
          {r.error && <p className="note warn">{r.error}</p>}
          {r.duplicateGroups.length > 0 && (
            <details className="more"><summary>{r.duplicateGroups.length} duplicated game(s)</summary>
              <ul className="plain-list">{r.duplicateGroups.map((d) => <li key={d.gameId}><strong>{d.name}</strong><ul>{d.paths.map((p) => <li key={p} className="mono small">{p}</li>)}</ul></li>)}</ul>
            </details>
          )}
          {r.versionGroups.length > 0 && (
            <details className="more"><summary>{r.versionGroups.length} game(s) with several versions</summary>
              <ul className="plain-list">{r.versionGroups.map((g) => <li key={g.groupKey}><strong>{g.name}</strong>: {g.versions.map((v) => v.version || '?').join(', ')}</li>)}</ul>
            </details>
          )}
          {r.errors.length > 0 && (
            <details className="more"><summary>{r.errors.length} file(s) could not be imported</summary>
              <ul className="plain-list">{r.errors.map((e, i) => <li key={`${e.path}${i}`}><span className="mono small">{e.path}</span> — {e.message}</li>)}</ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
