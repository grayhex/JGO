import { useEffect, useState } from 'react';
import { api } from '../api';
import { t } from '../i18n';
export function NgageCatalogPanel({ toast, onChanged }: { toast: (kind: 'info' | 'error', text: string) => void; onChanged: () => void }) {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.ngageCatalog>> | null>(null);
  useEffect(() => { let dead = false; let timer: ReturnType<typeof setTimeout>; const poll = async () => { try { const s = await api.ngageCatalog(); if (!dead) { setStatus(s); if (!s.running) onChanged(); } } catch { /* retry */ } if (!dead) timer = setTimeout(poll, 3000); }; void poll(); return () => { dead = true; clearTimeout(timer); }; }, []);
  return <div className="catalog-source"><h3>N-Gage · All About Symbian</h3><p>{t('Original N-Gage covers, genres, publishers, release dates and multiplayer information. No API key is needed.')}</p><p className="muted">{status?.entries ?? 0} {t('catalog entries')} · {status?.matched ?? 0} {t('matched games')}</p>{status?.error && <p className="note warn" role="status">{status.error}</p>}<button className="btn" disabled={!!status?.running} onClick={() => void api.ngageCatalogRefresh().then(setStatus, e => toast('error', e.message))}>{t(status?.running ? 'Updating…' : 'Update N-Gage metadata')}</button> <a href="https://allaboutsymbian.com/n-gage-games/original/" target="_blank" rel="noreferrer">All About Symbian ↗</a></div>;
}
