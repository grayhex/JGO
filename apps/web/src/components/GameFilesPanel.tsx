import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameFileEntry } from '@j2me-web/protocol';
import { api } from '../api';
import { t as translateUI } from '../i18n';

const fmt = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`);

/** What the game keeps with JSR-75 (`file:///`): browse it, take files out, put files in, delete. */
export function GameFilesPanel({ gameId, toast, refreshKey }: { gameId: string; toast: (kind: 'info' | 'error', text: string) => void; refreshKey: unknown }) {
  const [dir, setDir] = useState('');
  const [data, setData] = useState<Awaited<ReturnType<typeof api.gameFiles>> | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async (d: string) => {
    try { setData(await api.gameFiles(gameId, d)); setDir(d); } catch (e) { toast('error', (e as Error).message); }
  }, [gameId, toast]);
  useEffect(() => { void load(''); }, [gameId, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const join = (name: string) => (dir ? `${dir}/${name}` : name);
  const up = () => load(dir.split('/').slice(0, -1).join('/'));
  const act = async (job: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try { await job(); if (done) toast('info', done); await load(dir); } catch (e) { toast('error', (e as Error).message); } finally { setBusy(false); }
  };
  const remove = (e: GameFileEntry) => {
    if (window.confirm(translateUI(e.dir ? 'Delete the folder “{name}” with everything in it?' : 'Delete “{name}”?', { name: e.name }))) void act(() => api.deleteGameFile(gameId, join(e.name)));
  };

  return (
    <>
      <div className="statline"><span className="label-caps">{translateUI('Folder')}</span><span className="small mono" data-testid="files-path">/{dir}</span></div>
      <ul className="file-list" data-testid="file-list">
        {dir && <li><button className="btn ghost sm" onClick={() => void up()}>{translateUI('↑ up')}</button></li>}
        {data?.entries.map((e) => (
          <li key={e.name}>
            {e.dir ? <button className="btn ghost sm file-name" onClick={() => void load(join(e.name))}>📁 {e.name}</button>
              : <a className="file-name" href={api.gameFileUrl(gameId, join(e.name))} download={e.name}>{e.name}</a>}
            <span className="muted small">{e.dir ? '' : fmt(e.size)}</span>
            <button className="btn ghost sm icon" aria-label={translateUI('Delete {name}', { name: e.name })} disabled={busy} onClick={() => remove(e)}>✕</button>
          </li>
        ))}
        {data && !data.entries.length && <li className="muted small">{translateUI('Empty. A game writes here with its file API; you can also put files in.')}</li>}
      </ul>
      {data?.truncated && <p className="hint">{translateUI('Only the first entries are shown.')}</p>}
      <div className="btn-row">
        <button className="btn sm" disabled={busy} onClick={() => input.current?.click()}>{translateUI('Upload a file…')}</button>
        <input ref={input} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void act(() => api.uploadGameFile(gameId, dir, f), 'File uploaded.'); if (input.current) input.current.value = ''; }} />
        <button className="btn ghost sm" disabled={busy} onClick={() => void load(dir)}>{translateUI('Refresh')}</button>
      </div>
      {data && <p className="hint">{fmt(data.usedBytes)} / {fmt(data.quotaBytes)} {translateUI('used')}</p>}
    </>
  );
}
