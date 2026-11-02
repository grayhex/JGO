import { useEffect, useState } from 'react';
import { api } from '../api';
import { t } from '../i18n';
type Status = Awaited<ReturnType<typeof api.ngageCatalog>>;
/** Settings → Game metadata: how many N-Gage games were recognised, which were not, and why covers may be missing. */
export function NgageCatalogPanel({ toast, onChanged }: { toast: (kind: 'info' | 'error', text: string) => void; onChanged: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  useEffect(() => { let dead = false; let timer: ReturnType<typeof setTimeout>; const poll = async () => { try { const s = await api.ngageCatalog(); if (!dead) { setStatus(s); if (!s.running) onChanged(); } } catch { /* retry */ } if (!dead) timer = setTimeout(poll, 3000); }; void poll(); return () => { dead = true; clearTimeout(timer); }; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const total = (status?.matched ?? 0) + (status?.unmatched.length ?? 0);
  return (
    <div className="catalog-source" data-testid="ngage-catalog">
      <h3>{t('N-Gage games')}</h3>
      <p className="muted small">{t('Genre, publisher, year, multiplayer and the cover of original N-Gage games come from the All About Symbian directory. No key is needed.')}</p>
      <p><strong>{status?.matched ?? 0}</strong> {t('of')} <strong>{total}</strong> {t('N-Gage games recognised')}{status && status.covers > 0 ? ` · ${status.covers} ${t('covers')}` : ''}</p>
      {status && status.unmatched.length > 0 && <details className="more"><summary>{t('Not recognised')}: {status.unmatched.length}</summary><ul className="plain-list">{status.unmatched.map((n) => <li key={n}>{n}</li>)}</ul><p className="muted small">{t('Only games of the original N-Gage (.zip card dumps) are in the directory. Rename the file to the game’s title to be recognised.')}</p></details>}
      {status?.source === 'snapshot' && !status.error && <p className="muted small">{t('Using the list that ships with MGO. Covers are downloaded when the directory is reachable.')}</p>}
      {status?.error && <p className="note warn" role="status">{status.error}</p>}
      <div className="btn-row">
        <button className="btn" disabled={!!status?.running} onClick={() => void api.ngageCatalogRefresh().then(setStatus, e => toast('error', e.message))}>{t(status?.running ? 'Updating…' : 'Update N-Gage metadata')}</button>
        <a href="https://allaboutsymbian.com/n-gage-games/original/" target="_blank" rel="noreferrer">All About Symbian ↗</a>
      </div>
    </div>
  );
}
