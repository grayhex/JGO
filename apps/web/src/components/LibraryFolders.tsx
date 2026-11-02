import { t as translateUI } from '../i18n';
import type { GameMeta, LibraryCheck, LibraryRoot, ScanReport } from '@mgo/protocol';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type BrowseResult, type LibraryKind } from '../api';
import { setServerSettings, useServerSettings } from '../serverSettings';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { PlatformGlyph } from './PlatformTag';

type Toaster = (kind: 'info' | 'error', text: string) => void;

export const LIBRARY_KINDS: { kind: LibraryKind; platform: 'j2me' | 'ngage' | 'symbian'; title: string; files: string }[] = [
  { kind: 'j2me', platform: 'j2me', title: 'Java ME', files: '.jar / .jad' },
  { kind: 'ngage', platform: 'ngage', title: 'N-Gage', files: '.zip / .n-gage' },
  { kind: 'symbian', platform: 'symbian', title: 'Symbian S60', files: '.sis / .sisx' },
];
const KIND_PLATFORMS: Record<LibraryKind, string[]> = { j2me: ['j2me'], ngage: ['ngage', 'ngage2'], symbian: ['symbian'] };

const fmtBytes = (n: number) => (n > 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : n > 1048576 ? `${(n / 1048576).toFixed(0)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** The folder a kind of games is read from. The older single folder counts as the Java ME one. */
export function useKindPaths(): Record<LibraryKind, string | null> {
  const server = useServerSettings();
  const s = server?.settings;
  return { j2me: s?.libraryPaths?.j2me ?? s?.libraryPath ?? null, ngage: s?.libraryPaths?.ngage ?? null, symbian: s?.libraryPaths?.symbian ?? null };
}

/**
 * Chooses one folder for one kind of games. Only folders below the locations the server shares can be picked, so there is no path to type:
 * start at a shared location, open sub-folders, and see what is inside before using it.
 */
function FolderPicker({ kind, current, onClose, onPick, toast }: { kind: LibraryKind; current: string | null; onClose: () => void; onPick: (path: string) => void; toast: Toaster }) {
  const [roots, setRoots] = useState<LibraryRoot[] | null>(null);
  const [view, setView] = useState<BrowseResult | null>(null);
  const [check, setCheck] = useState<LibraryCheck | null>(null);
  const seq = useRef(0);
  const info = LIBRARY_KINDS.find((k) => k.kind === kind)!;

  const open = useCallback(async (p: string | null) => {
    const my = ++seq.current;
    try {
      const b = await api.libBrowse(p);
      if (my !== seq.current) return;
      setView(b); setCheck(null);
      if (b.path) { const c = await api.libCheck(b.path); if (my === seq.current) setCheck(c); }
    } catch (e) { toast('error', (e as Error).message); }
  }, [toast]);

  useEffect(() => {
    api.libRoots().then((r) => {
      setRoots(r.roots);
      const usable = r.roots.filter((x) => x.exists && x.readable);
      if (current) void open(current);
      else if (usable.length === 1) void open(usable[0]!.path);
      else void open(null);
    }, (e) => toast('error', (e as Error).message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const found = kind === 'j2me' ? check?.jarCount ?? 0 : check?.packageCount ?? 0;
  const anyRoot = roots?.some((r) => r.exists) ?? false;
  return (
    <Modal title={translateUI('Folder for {kind} games', { kind: info.title })} onClose={onClose} wide>
      <div className="stack folder-picker" data-testid="folder-picker">
        {roots && !anyRoot && (
          <div className="note warn">
            <p><strong>{translateUI('No game folder is shared with MGO yet.')}</strong> {translateUI('You can still add games from the browser. To import a collection, share a folder with the server (it is only read, never changed):')}</p>
            <p><span className="muted small">Docker</span> <code>MGO_LIBRARY=/path/to/games docker compose up -d</code></p>
            <p><span className="muted small">Proxmox</span> <code>pct set &lt;CTID&gt; -mp0 /path/on/host,mp=/mnt/mgo-library,ro=1</code></p>
          </div>
        )}
        {view && (
          <>
            <nav className="crumbs" aria-label={translateUI('Current folder')}>
              {view.parent !== null || view.path ? <button type="button" className="folder" onClick={() => void open(view.parent)} disabled={!view.path} aria-label={translateUI('Up')}>↑</button> : null}
              <code className="crumb-path">{view.path ?? translateUI('Shared folders')}</code>
            </nav>
            <div className="folder-list pick" role="list">
              {view.dirs.map((d) => <button key={d.path} type="button" role="listitem" className="folder" onClick={() => void open(d.path)}><Icon name="library" /> {view.path ? d.name : d.path}</button>)}
              {view.dirs.length === 0 && <span className="muted small">{translateUI(view.path ? 'No sub-folders.' : 'Nothing is shared.')}</span>}
              {view.truncated && <span className="muted small">{translateUI('Only the first 500 are shown.')}</span>}
            </div>
          </>
        )}
        {check && (
          <div className={`note ${check.ok ? (found ? 'info' : 'warn') : 'err'}`} role="status" data-testid="folder-check">
            {check.ok
              ? <p><strong>{found.toLocaleString()}</strong> {kind === 'j2me' ? 'JAR' : kind === 'ngage' ? translateUI('N-Gage files') : 'SIS/SISX'} {translateUI('here')} · {fmtBytes(check.totalBytes)}{check.truncated ? ` (${translateUI('at least')})` : ''}{found === 0 ? ` — ${translateUI('no {kind} files in this folder (sub-folders are searched too).', { kind: info.files })}` : ''}</p>
              : <p><strong>{translateUI('Cannot use this folder.')}</strong></p>}
            {check.problems.map((t) => <p key={t}>{t}</p>)}
          </div>
        )}
        <div className="modal-actions">
          {current && <button className="btn ghost" type="button" onClick={() => onPick('')} data-testid="folder-forget">{translateUI('Stop using a folder')}</button>}
          <span className="spacer" />
          <button className="btn" type="button" onClick={onClose}>{translateUI('Cancel')}</button>
          <button className="btn primary" type="button" disabled={!check?.ok} onClick={() => check && onPick(check.path)} data-testid="folder-use">{translateUI('Use this folder')}</button>
        </div>
      </div>
    </Modal>
  );
}

function ClearDialog({ kind, count, onClose, onDone, toast }: { kind: LibraryKind; count: number; onClose: () => void; onDone: () => void; toast: Toaster }) {
  const [saves, setSaves] = useState(false);
  const [busy, setBusy] = useState(false);
  const info = LIBRARY_KINDS.find((k) => k.kind === kind)!;
  const run = async () => {
    setBusy(true);
    try {
      const r = await api.cleanup('kind', saves, undefined, kind);
      toast('info', translateUI('Removed games: {n}', { n: r.removed }) + (r.skipped ? ` · ${translateUI('kept (running now): {n}', { n: r.skipped })}` : ''));
      onDone(); onClose();
    } catch (e) { toast('error', (e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal title={translateUI('Clear {kind} games', { kind: info.title })} onClose={onClose}>
      <div className="stack">
        <p className="note err">{translateUI('{n} games will be removed from MGO. The files in your folder are not touched, and a new scan brings the games back.', { n: count })}</p>
        <label className="switch-line"><input type="checkbox" checked={saves} onChange={(e) => setSaves(e.target.checked)} /><span>{translateUI('Also delete saved data of the removed games')}</span></label>
        <div className="modal-actions">
          <span className="spacer" />
          <button className="btn ghost" type="button" onClick={onClose}>{translateUI('Cancel')}</button>
          <button className="btn danger" type="button" disabled={busy} onClick={() => void run()} data-testid="clear-confirm">{translateUI('Remove games')}</button>
        </div>
      </div>
    </Modal>
  );
}

const pct = (r: ScanReport) => (r.jars ? Math.min(100, Math.round(((r.added + r.updated + r.unchanged + r.skipped) / r.jars) * 100)) : 0);

/**
 * Settings → Game library, and the same choice in the first-run wizard: three folders (Java ME, N-Gage, Symbian), each with its
 * own Scan and Clear. Scanning only reads the folder; clearing only forgets the games in MGO.
 */
export function LibraryFolders({ toast, onChanged, wizard = false }: { toast: Toaster; onChanged?: () => void; wizard?: boolean }) {
  const server = useServerSettings();
  const paths = useKindPaths();
  const [games, setGames] = useState<GameMeta[]>([]);
  const [picking, setPicking] = useState<LibraryKind | null>(null);
  const [clearing, setClearing] = useState<LibraryKind | null>(null);
  const [scan, setScan] = useState<{ running: boolean; report: ScanReport | null } | null>(null);
  const was = useRef(false);

  const loadGames = useCallback(() => { api.games().then(setGames, () => undefined); }, []);
  useEffect(loadGames, [loadGames]);
  const counts = useMemo(() => Object.fromEntries(LIBRARY_KINDS.map((k) => [k.kind, games.filter((g) => KIND_PLATFORMS[k.kind].includes(g.platform ?? 'j2me')).length])) as Record<LibraryKind, number>, [games]);

  const poll = useCallback(async () => {
    try {
      const s = await api.scan(); setScan(s);
      if (was.current && !s.running) { loadGames(); onChanged?.(); }
      was.current = s.running;
    } catch { /* offline: try again */ }
  }, [loadGames, onChanged]);
  useEffect(() => { void poll(); }, [poll]);
  useEffect(() => { if (!scan?.running) return; const t = window.setInterval(() => void poll(), 1000); return () => window.clearInterval(t); }, [scan?.running, poll]);

  const start = async (kinds?: LibraryKind[]) => {
    try { was.current = true; setScan(await api.scanStart('update', kinds)); } catch (e) { was.current = false; toast('error', (e as Error).message); }
  };
  const choose = async (kind: LibraryKind, p: string) => {
    try {
      const r = await api.patchSettings({ libraryPaths: { j2me: null, ngage: null, symbian: null, ...server?.settings.libraryPaths, [kind]: p || null }, ...(kind === 'j2me' ? { libraryPath: null } : {}) });
      setServerSettings(r); setPicking(null);
      toast('info', p ? 'Library folder saved' : 'Library folder removed');
      if (p && !wizard) void start([kind]);
    } catch (e) { toast('error', (e as Error).message); }
  };

  const any = Object.values(paths).some(Boolean);
  const running = !!scan?.running;
  const report = scan?.report ?? null;
  return (
    <div className="stack lib-folders" data-testid="library-folders">
      <div className="lib-rows" role="list">
        {LIBRARY_KINDS.map((k) => (
          <div className={`lib-row ${paths[k.kind] ? 'set' : ''}`} role="listitem" key={k.kind} data-kind={k.kind}>
            <span className="lib-glyph" data-platform={k.platform}><PlatformGlyph platform={k.platform} size={24} /></span>
            <div className="lib-main">
              <div className="lib-title"><strong>{k.title}</strong><span className="muted small">{k.files}</span></div>
              {paths[k.kind]
                ? <code className="lib-path" title={paths[k.kind]!}>{paths[k.kind]}</code>
                : <span className="muted small">{translateUI('No folder selected')}</span>}
              {!wizard && <span className="muted small" data-testid={`count-${k.kind}`}>{translateUI('{n} games in the library', { n: counts[k.kind] })}</span>}
            </div>
            <div className="lib-actions">
              <button className="btn" type="button" onClick={() => setPicking(k.kind)} data-testid={`choose-${k.kind}`}>{translateUI(paths[k.kind] ? 'Change' : 'Choose folder')}</button>
              {!wizard && <button className="btn" type="button" disabled={!paths[k.kind] || running} onClick={() => void start([k.kind])} data-testid={`scan-${k.kind}`}><Icon name="restart" /> {translateUI('Scan')}</button>}
              {!wizard && <button className="btn ghost danger-text" type="button" disabled={!counts[k.kind] || running} onClick={() => setClearing(k.kind)} data-testid={`clear-${k.kind}`}><Icon name="trash" /> {translateUI('Clear')}</button>}
            </div>
          </div>
        ))}
      </div>
      {!wizard && (
        <div className="lib-footer">
          <button className="btn primary" type="button" disabled={!any || running} onClick={() => void start()} data-testid="scan-all"><Icon name="restart" /> {translateUI(running ? 'Scanning…' : 'Scan all folders')}</button>
          {running && <button className="btn" type="button" onClick={() => void api.scanCancel().then(poll)}>{translateUI('Stop')}</button>}
          <label className="switch-line"><input type="checkbox" checked={server?.settings.autoScan ?? false} onChange={(e) => void api.patchSettings({ autoScan: e.target.checked }).then(setServerSettings, (x) => toast('error', (x as Error).message))} /><span>{translateUI('Scan every time MGO starts')}</span></label>
        </div>
      )}
      {!wizard && !any && <p className="muted small">{translateUI('Choose a folder for each kind of games you have. Uploading from the browser works without any folder.')}</p>}
      {!wizard && report && (
        <div className="scan-summary" data-testid="scan-report">
          {report.state === 'running'
            ? <><div className="meter" role="progressbar" aria-valuenow={pct(report)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${pct(report)}%` }} /></div><p className="muted small mono">{report.current ?? translateUI('Looking for files…')} · {report.filesSeen.toLocaleString()} {translateUI('files found')}</p></>
            : <p className="small"><span className={`badge ${report.state === 'done' ? 'prod' : 'mock'}`}>{translateUI(report.state === 'done' ? 'Scan finished' : report.state)}</span> {translateUI('New')}: <strong>{report.added}</strong> · {translateUI('Changed')}: {report.updated} · {translateUI('Unchanged')}: {report.unchanged}{report.duplicates ? ` · ${translateUI('Duplicates')}: ${report.duplicates}` : ''}{report.missing ? ` · ${translateUI('Missing')}: ${report.missing}` : ''}{report.skipped ? ` · ${translateUI('Skipped')}: ${report.skipped}` : ''} {report.finishedAt ? <span className="muted">· {new Date(report.finishedAt).toLocaleString()}</span> : null}</p>}
          {report.error && <p className="note warn">{report.error}</p>}
          {report.errors.length > 0 && (
            <details className="more"><summary>{report.errors.length} {translateUI('file(s) could not be imported')}</summary>
              <ul className="plain-list">{report.errors.map((e, i) => <li key={`${e.path}${i}`}><span className="mono small">{e.path}</span> — {e.message}</li>)}</ul>
            </details>
          )}
        </div>
      )}
      {picking && <FolderPicker kind={picking} current={paths[picking]} toast={toast} onClose={() => setPicking(null)} onPick={(p) => void choose(picking, p)} />}
      {clearing && <ClearDialog kind={clearing} count={counts[clearing]} toast={toast} onClose={() => setClearing(null)} onDone={() => { loadGames(); onChanged?.(); }} />}
    </div>
  );
}
