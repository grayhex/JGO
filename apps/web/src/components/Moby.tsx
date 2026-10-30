import { t as translateUI } from '../i18n';
import type { GameInfo, MetadataJob, MobyCandidate } from '@j2me-web/protocol';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { loadServerSettings, setServerSettings, useServerSettings } from '../serverSettings';
import { Icon } from './Icon';
import { Switch } from './ui';

type Toaster = (kind: 'info' | 'error', text: string) => void;

/** Candidate list for an ambiguous or wrong match: pick one, or search again with other words. */
export function Candidates({ gameId, info, toast, onChanged }: { gameId: string; info: GameInfo; toast: Toaster; onChanged: (i: GameInfo) => void }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<GameInfo>) => {
    setBusy(true);
    try { onChanged(await f()); } catch (e) { toast('error', (e as Error).message); } finally { setBusy(false); }
  };
  const c: MobyCandidate[] = info.candidates;
  return (
    <div className="stack">
      {c.length > 0 ? (
        <ul className="cands" aria-label={translateUI("Possible matches")}>
          {c.map((x) => (
            <li key={x.mobyId} className="cand">
              <div>
                <strong>{x.title}</strong> {x.year ? <span className="muted">({x.year})</span> : null}
                <div className="muted small">{x.platforms.join(', ') || 'unknown platform'}{translateUI(x.genres.length ? ` · ${x.genres.join(', ')}` : '')}</div>
              </div>
              <span className={`badge ${x.j2me ? 'prod' : 'mock'}`} title={translateUI(x.j2me ? 'Listed for J2ME' : 'Not listed for J2ME: may be the original console/PC game')}>{translateUI(x.j2me ? 'J2ME' : 'other platform')}</span>
              <span className="muted small" title={translateUI("Title similarity")}>{Math.round(x.score * 100)}%</span>
              <button className="btn sm primary" disabled={busy} onClick={() => void run(() => api.infoChoose(gameId, x.mobyId))}>{translateUI("This one")}</button>
            </li>
          ))}
        </ul>
      ) : <p className="muted">{translateUI("No candidates.")}</p>}
      <form className="btn-row" onSubmit={(e) => { e.preventDefault(); if (q.trim().length >= 2) void run(() => api.infoSearch(gameId, q.trim())); }}>
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={translateUI("Search MobyGames by another title")} aria-label={translateUI("Search title")} />
        <button className="btn" type="submit" disabled={busy || q.trim().length < 2}><Icon name="search" /> {translateUI("Search")}</button>
      </form>
    </div>
  );
}

const jobText = (j: MetadataJob) => (j.state === 'running' ? `Looking up “${j.current ?? '…'}” (${j.done}/${j.total})` : j.state === 'idle' ? 'Idle' : j.state === 'done' ? `Done: ${j.matched} matched, ${j.ambiguous} to review, ${j.unmatched} not found${j.failed ? `, ${j.failed} failed` : ''}` : j.state === 'cancelled' ? 'Stopped' : `Failed: ${j.error ?? 'unknown error'}`);

export function MobyPanel({ toast }: { toast: Toaster }) {
  const server = useServerSettings();
  const configured = server?.secrets.mobygames.configured ?? false;
  const hint = server?.secrets.mobygames.hint ?? null;
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<string | null>(null);
  const [job, setJob] = useState<Awaited<ReturnType<typeof api.metaJob>> | null>(null);
  const [review, setReview] = useState<Awaited<ReturnType<typeof api.metaReview>>>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [openInfo, setOpenInfo] = useState<GameInfo | null>(null);

  const poll = useCallback(async () => {
    if (!configured && !job) return;
    try { const j = await api.metaJob(); setJob(j); if (j.review) setReview(await api.metaReview()); else setReview([]); } catch { /* offline */ }
  }, [configured, job]);
  useEffect(() => { void poll(); }, [configured]); // eslint-disable-line react-hooks/exhaustive-deps
  const running = job?.job.state === 'running';
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => void poll(), 1500);
    return () => window.clearInterval(t);
  }, [running, poll]);

  const saveKey = async () => {
    setBusy(true);
    try { await api.setMobyKey(key); setKey(''); await loadServerSettings(); setTest(null); toast('info', 'API key saved on the server'); } catch (e) { toast('error', (e as Error).message); } finally { setBusy(false); }
  };
  const removeKey = async () => {
    if (!confirm(translateUI('Remove the MobyGames API key from this server? Already downloaded information is kept.'))) return;
    try { await api.deleteMobyKey(); await loadServerSettings(); setTest(null); } catch (e) { toast('error', (e as Error).message); }
  };
  const runTest = async () => {
    setBusy(true); setTest('Checking…');
    try { const r = await api.testMoby(); setTest(`Key accepted (J2ME platform id ${r.platformId}).`); } catch (e) { setTest(`✘ ${(e as Error).message}`); } finally { setBusy(false); }
  };
  const enrich = async (scope: 'missing' | 'retry' | 'all') => {
    try { await api.metaEnrich(scope); await poll(); } catch (e) { toast('error', (e as Error).message); }
  };
  const toggleAuto = async (v: boolean) => {
    try { setServerSettings(await api.patchSettings({ autoMetadata: v })); } catch (e) { toast('error', (e as Error).message); }
  };
  const clear = async () => {
    if (!confirm(translateUI('Delete all MobyGames descriptions, covers and screenshots stored on this server? Your games are not affected.'))) return;
    try { await api.metaClear(); setReview([]); await poll(); toast('info', 'MobyGames data removed'); window.dispatchEvent(new Event('j2me:library-changed')); } catch (e) { toast('error', (e as Error).message); }
  };
  const openReview = async (gameId: string) => {
    if (open === gameId) { setOpen(null); return; }
    setOpen(gameId);
    try { setOpenInfo(await api.gameInfo(gameId)); } catch (e) { toast('error', (e as Error).message); }
  };

  const wait = job?.job.waitingUntil ? Math.max(0, Math.round((job.job.waitingUntil - Date.now()) / 1000)) : 0;
  return (
    <div className="stack">
      <p className="muted">{translateUI("MobyGames adds covers, descriptions, genres, publishers, years, ratings and screenshots. It is optional: without it the library uses the information inside the JAR files. You need your own API key from your MobyGames account; check which plan and terms apply to it. Only information and pictures are fetched, never games.")}</p>
      <label className="field">
        <span className="label-caps">{translateUI("API key")} {configured && <span className="badge prod">{translateUI("saved")} {translateUI(hint)}</span>}</span>
        <div className="btn-row">
          <input className="input mono" type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} placeholder={translateUI(configured ? 'Enter a new key to replace the saved one' : 'moby_…')} aria-label={translateUI("MobyGames API key")} />
          <button className="btn primary" type="button" disabled={busy || key.trim().length < 8} onClick={() => void saveKey()}>{translateUI("Save key")}</button>
        </div>
      </label>
      <p className="muted small">{translateUI("The key is stored only on the server (file readable by the jgo user only) and is never sent back to the browser.")}</p>
      {configured && (
        <div className="btn-row">
          <button className="btn" type="button" disabled={busy} onClick={() => void runTest()}>{translateUI("Test key")}</button>
          <button className="btn ghost" type="button" onClick={() => void removeKey()}>{translateUI("Remove key")}</button>
          {test && <span className="small" role="status">{test}</span>}
        </div>
      )}
      {configured && (
        <>
          <Switch checked={server?.settings.autoMetadata ?? true} onChange={(v) => void toggleAuto(v)}>{translateUI("Look up new games automatically after a scan")}</Switch>
          <div className="btn-row">
            <button className="btn primary" type="button" disabled={running} onClick={() => void enrich('missing')}>{translateUI("Look up games without information")}</button>
            <button className="btn" type="button" disabled={running} onClick={() => void enrich('retry')}>{translateUI("Retry not found")}</button>
            <button className="btn" type="button" disabled={running} onClick={() => void enrich('all')}>{translateUI("Refresh all")}</button>
            {running && <button className="btn" type="button" onClick={() => void api.metaCancel().then(poll)}>{translateUI("Stop")}</button>}
          </div>
          {job && (
            <div className="scan" data-testid="meta-job">
              {running && <div className="meter" role="progressbar" aria-valuenow={job.job.total ? Math.round((job.job.done / job.job.total) * 100) : 0} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${job.job.total ? (job.job.done / job.job.total) * 100 : 0}%` }} /></div>}
              <p className="small" role="status">{jobText(job.job)}{translateUI(wait > 0 ? ` — waiting ${wait}s for the MobyGames rate limit` : '')}</p>
              <p className="muted small">{translateUI("In the library:")} {job.stats.matched} {translateUI("matched ·")} {job.stats.ambiguous} {translateUI("to review ·")} {job.stats.unmatched} {translateUI("not found ·")} {(job.stats.bytes / 1048576).toFixed(1)} {translateUI("MB of images")}</p>
              <button className="btn ghost sm" type="button" onClick={() => void clear()}><Icon name="trash" /> {translateUI("Delete all MobyGames data")}</button>
            </div>
          )}
          {review.length > 0 && (
            <div className="review" data-testid="review-list">
              <h3>{review.length} {translateUI("game")}{translateUI(review.length === 1 ? '' : 's')} {translateUI("need your decision")}</h3>
              <ul className="plain-list">
                {review.map((r) => (
                  <li key={r.groupKey}>
                    <button className="linklike" type="button" onClick={() => void openReview(r.gameId)} aria-expanded={open === r.gameId}>{r.name} <span className="muted">· {r.vendor}</span> <Icon name="chevron" /></button>
                    {open === r.gameId && openInfo && <Candidates gameId={r.gameId} info={openInfo} toast={toast} onChanged={(i) => { setOpenInfo(i); if (i.status === 'manual') { setOpen(null); void poll(); window.dispatchEvent(new Event('j2me:library-changed')); } }} />}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      <p className="muted small">{translateUI("Data and images from MobyGames are shown with attribution and a link to the game’s MobyGames page, are kept on this server for your own use only, and can be deleted here at any time.")}</p>
    </div>
  );
}
