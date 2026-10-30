import type { GameInfo, GameMeta } from '@j2me-web/protocol';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useServerSettings } from '../serverSettings';
import { Candidates } from './Moby';
import { Modal } from './Modal';

export function GameInfoDialog({ game, toast, onClose, onChanged }: { game: GameMeta; toast: (k: 'info' | 'error', t: string) => void; onClose: () => void; onChanged: () => void }) {
  const server = useServerSettings();
  const hasKey = server?.secrets.mobygames.configured ?? false;
  const [info, setInfo] = useState<GameInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [change, setChange] = useState(false);
  useEffect(() => { api.gameInfo(game.id).then(setInfo, (e) => toast('error', (e as Error).message)); }, [game.id, toast]);

  const act = async (f: () => Promise<GameInfo>) => {
    setBusy(true);
    try { setInfo(await f()); onChanged(); } catch (e) { toast('error', (e as Error).message); } finally { setBusy(false); }
  };
  const has = info && (info.status === 'matched' || info.status === 'manual');
  return (
    <Modal title={info?.title ?? game.name} onClose={onClose} wide>
      {!info && <p className="muted">Loading…</p>}
      {info && has && (
        <div className="info-grid">
          {info.hasCover && <img className="info-cover" src={api.coverUrl(game.id)} alt={`Cover of ${info.title}`} />}
          <div className="stack">
            <dl className="facts">
              {info.year && <><dt>Year</dt><dd>{info.year}</dd></>}
              {info.genres.length > 0 && <><dt>Genre</dt><dd>{info.genres.join(', ')}</dd></>}
              {info.publishers.length > 0 && <><dt>Publisher</dt><dd>{info.publishers.join(', ')}</dd></>}
              {info.developers.length > 0 && <><dt>Developer</dt><dd>{info.developers.join(', ')}</dd></>}
              {info.score !== null && <><dt>MobyScore</dt><dd>{info.score.toFixed(1)} / 10</dd></>}
              <dt>In the JAR</dt><dd>{game.vendor}{game.version ? ` · v${game.version}` : ''}</dd>
            </dl>
            {info.description && <p className="desc">{info.description}</p>}
          </div>
        </div>
      )}
      {info && has && info.screenshots > 0 && (
        <div className="shots" aria-label="Screenshots">
          {Array.from({ length: info.screenshots }, (_, i) => <a key={i} href={api.shotUrl(game.id, i + 1)} target="_blank" rel="noreferrer"><img src={api.shotUrl(game.id, i + 1)} alt={`Screenshot ${i + 1}`} loading="lazy" /></a>)}
        </div>
      )}
      {info && !has && (
        <div className="stack">
          <dl className="facts"><dt>Name</dt><dd>{game.name}</dd><dt>Vendor</dt><dd>{game.vendor}</dd><dt>Version</dt><dd>{game.version || '—'}</dd></dl>
          <p className="muted">{info.status === 'ambiguous' ? 'MobyGames has several possible matches. Choose the right one:' : info.status === 'unmatched' ? 'MobyGames has no clear match for this title.' : hasKey ? 'No information from MobyGames yet.' : 'This game only has the information inside its JAR file. Add a MobyGames API key in Settings to fetch covers and descriptions.'}</p>
        </div>
      )}
      {info && hasKey && (!has || change) && (info.status !== 'none' || change) && <Candidates gameId={game.id} info={info} toast={toast} onChanged={(i) => { setInfo(i); if (i.status === 'manual') { setChange(false); onChanged(); } }} />}
      {info && info.error && <p className="note warn">{info.error}</p>}
      {info && has && (
        <p className="attrib small">
          {info.attribution} {info.mobyUrl && <a href={info.mobyUrl} target="_blank" rel="noreferrer noopener">View “{info.title}” on MobyGames</a>}
          {info.fetchedAt && <span className="muted"> · fetched {new Date(info.fetchedAt).toLocaleDateString()}</span>}
        </p>
      )}
      <div className="modal-actions">
        {hasKey && <button className="btn" disabled={busy} onClick={() => void act(() => api.infoRefresh(game.id))}>{has ? 'Look up again' : 'Look up now'}</button>}
        {hasKey && has && <button className="btn" disabled={busy} onClick={() => setChange((c) => !c)}>Wrong game?</button>}
        {has && <button className="btn ghost" disabled={busy} onClick={() => void act(() => api.infoUnlink(game.id))}>Remove information</button>}
        <span className="spacer" />
        <button className="btn primary" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}
