import { t as translateUI } from '../i18n';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { Modal } from './Modal';

type Toaster = (kind: 'info' | 'error', text: string) => void;

/** Settings → Library: remove the games whose files have disappeared, or empty the whole library. Genres and MobyGames data stay. */
export function CleanupPanel({ toast, onChanged }: { toast: Toaster; onChanged: () => void }) {
  const [gone, setGone] = useState<number | null>(null);
  const [total, setTotal] = useState(0);
  const [saves, setSaves] = useState(false);
  const [busy, setBusy] = useState(false);
  const [askAll, setAskAll] = useState(false);
  const [word, setWord] = useState('');
  const load = useCallback(() => {
    api.games().then((gs) => {
      setGone(gs.filter((g) => g.sourceMissing).length);
      setTotal(gs.length);
    }, () => undefined);
  }, []);
  useEffect(load, [load]);

  const run = async (what: 'missing' | 'all') => {
    setBusy(true);
    try {
      const r = await api.cleanup(what, saves, what === 'all' ? 'DELETE' : undefined);
      toast('info', translateUI('Removed games: {n}', { n: r.removed }) + (r.skipped ? ` · ${translateUI('kept (running now): {n}', { n: r.skipped })}` : ''));
      setAskAll(false); setWord(''); onChanged(); load();
    } catch (e) { toast('error', (e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="cleanup-panel" data-testid="cleanup-panel">
      <p className="hint">{translateUI("Games whose files are no longer in the library folder stay here with their saves (marked \"file gone\"). You can remove them together, or start the library from scratch. Genres and MobyGames data are kept and come back with the same game.")}</p>
      <label className="switch-line">
        <input type="checkbox" checked={saves} onChange={(e) => setSaves(e.target.checked)} />
        <span>{translateUI("Also delete saved data of the removed games")}</span>
      </label>
      <div className="btn-row">
        <button className="btn" disabled={busy || !gone} onClick={() => { if (confirm(translateUI('Remove {n} games whose files are gone?', { n: gone ?? 0 }))) void run('missing'); }} data-testid="cleanup-missing">
          {translateUI("Remove games with missing files")}{gone ? ` (${gone})` : ''}
        </button>
        <button className="btn danger" disabled={busy || total === 0} onClick={() => setAskAll(true)} data-testid="cleanup-all">{translateUI("Empty the library…")}</button>
      </div>
      {askAll && (
        <Modal title={translateUI("Empty the library")} onClose={() => { setAskAll(false); setWord(''); }}>
          <p className="note err">{translateUI("All {n} games will be removed from this server{saves}. The files in your library folder are not touched, and a new scan brings them back.", { n: total, saves: saves ? translateUI(', together with their saved data') : '' })}</p>
          <label className="field">
            <span className="label-caps">{translateUI("Type DELETE to confirm")}</span>
            <input className="input" value={word} onChange={(e) => setWord(e.target.value)} autoFocus data-testid="cleanup-word" aria-label={translateUI("Type DELETE to confirm")} />
          </label>
          <div className="btn-row">
            <button className="btn danger" disabled={busy || word !== 'DELETE'} onClick={() => void run('all')} data-testid="cleanup-confirm">{translateUI("Remove everything")}</button>
            <button className="btn ghost" onClick={() => { setAskAll(false); setWord(''); }}>{translateUI("Cancel")}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
