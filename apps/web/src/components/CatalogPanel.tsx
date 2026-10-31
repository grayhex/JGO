import { t as translateUI } from '../i18n';
import { normalizeCatalog, type CatalogReport, type GenreSummary } from '@j2me-web/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';

type Toaster = (kind: 'info' | 'error', text: string) => void;
const MAX_BYTES = 2 * 1024 * 1024;

/** Settings → Library: import a genre catalog (jgo_catalog.json, matched by SHA-256), see the numbers, export. */
export function CatalogPanel({ toast, onChanged }: { toast: Toaster; onChanged: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; json: unknown } | null>(null);
  const [report, setReport] = useState<CatalogReport | null>(null);
  const [applied, setApplied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState<GenreSummary | null>(null);
  const loadStats = useCallback(() => { api.genres().then(setStats, () => undefined); }, []);
  useEffect(loadStats, [loadStats]);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setReport(null); setApplied(false); setFile(null);
    if (f.size > MAX_BYTES) { toast('error', 'The catalog file is larger than 2 MB'); return; }
    let json: unknown;
    try { json = JSON.parse(await f.text()); } catch { toast('error', 'That file is not valid JSON'); return; }
    // only the hash, title, genre and confidence are sent; file names and paths of the collection stay in the browser
    try { json = normalizeCatalog(json); } catch (e) { toast('error', (e as Error).message); return; }
    setBusy(true);
    try { setReport(await api.catalogPreview(json)); setFile({ name: f.name, json }); } catch (e) { toast('error', (e as Error).message); } finally { setBusy(false); }
  };
  const confirm = async () => {
    if (!file) return;
    setBusy(true);
    try { setReport(await api.catalogImport(file.json)); setApplied(true); loadStats(); onChanged(); toast('info', 'Genres imported'); } catch (e) { toast('error', (e as Error).message); } finally { setBusy(false); }
  };
  const shown = (stats?.genres ?? []).filter((g) => g.count > 0);

  return (
    <div className="catalog-panel" data-testid="catalog-panel">
      <p className="hint">{translateUI("A genre catalog (jgo_catalog.json) lists games by SHA-256 hash and genre. Only the hash, title and genre are sent to the server, never file paths. Only games already in the library are changed; nothing is added or deleted, and genres you set by hand are kept.")}</p>
      <div className="btn-row">
        <button className="btn" disabled={busy} onClick={() => input.current?.click()}>{translateUI("Choose catalog file…")}</button>
        <input ref={input} type="file" accept=".json,application/json" hidden data-testid="catalog-file" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
        {report && !applied && file && <button className="btn primary" disabled={busy || report.ok === 0} onClick={() => void confirm()} data-testid="catalog-confirm">{translateUI("Import {n} games", { n: report.ok })}</button>}
        <a className="btn ghost" href="/api/library/catalog/export" download="jgo_catalog.json">{translateUI("Export genres")}</a>
      </div>
      {report && (
        <div className="note info" role="status" data-testid="catalog-report">
          <strong>{file?.name}</strong> — {translateUI(applied ? 'imported' : 'preview, nothing has been changed yet')}
          <ul className="plain-list">
            <li>{translateUI("In the file")}: {report.entries}</li>
            <li>{translateUI(applied ? 'Written' : 'Will be written')}: {applied ? report.applied : report.ok - report.unchanged}{report.unchanged > 0 && ` · ${translateUI('already up to date')}: ${report.unchanged}`}</li>
            <li>{translateUI("Not in the library")}: {report.missing}</li>
            {report.conflict > 0 && <li>{translateUI("Ambiguous (the same game, different genres)")}: {report.conflict}</li>}
            {report.locked > 0 && <li>{translateUI("Kept: genre set by hand")}: {report.locked}</li>}
            {report.protected > 0 && <li>{translateUI("Kept: genre from MobyGames")}: {report.protected}</li>}
            {report.invalid > 0 && <li>{translateUI("Rejected entries")}: {report.invalid}</li>}
          </ul>
          {report.items.filter((i) => i.state === 'invalid' || i.state === 'conflict').slice(0, 5).map((i, n) => <p key={n} className="muted small">{i.title ?? i.sha256.slice(0, 12)}: {i.detail}</p>)}
        </div>
      )}
      {stats && stats.total > 0 && (
        <p className="muted small" data-testid="genre-stats">
          {translateUI("Genres")}: {shown.map((g) => `${translateUI(g.genre)} ${g.count}`).join(' · ') || '—'}{stats.unclassified > 0 && ` · ${translateUI('no genre')} ${stats.unclassified}`}
        </p>
      )}
    </div>
  );
}
