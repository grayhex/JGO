import { t as translateUI } from '../i18n';
import { GENRES, type GameMeta, type Genre } from '@j2me-web/protocol';
import { useState } from 'react';
import { api } from '../api';
import type { Toast } from '../App';
import { Modal } from './Modal';

/** The genre of a game (shared by all its versions). Saving it by hand locks it: scans, MobyGames and catalogs leave it alone. */
export function GenreDialog({ game, toast, onClose, onChanged }: { game: GameMeta; toast: (k: Toast['kind'], t: string) => void; onClose: () => void; onChanged: () => void }) {
  const c = game.classification;
  const [genre, setGenre] = useState<Genre>(c?.primaryGenre ?? 'Other');
  const [tags, setTags] = useState((c?.tags ?? []).join(', '));
  const run = async (fn: () => Promise<unknown>, done: string) => {
    try { await fn(); toast('info', done); onChanged(); } catch (e) { toast('error', (e as Error).message); }
  };
  const save = () => run(() => api.setClassification(game.groupKey, {
    primaryGenre: genre,
    tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
  }), 'Genre saved');
  return (
    <Modal title={translateUI(game.name)} onClose={onClose}>
      {(!c || c.unconfirmed) && <p className="note info" data-testid="genre-unconfirmed">{translateUI("The genre of this game is not confirmed. Choose the right one.")}</p>}
      <label className="field">
        <span className="label-caps">{translateUI("Genre")}</span>
        <select className="select" value={genre} onChange={(e) => setGenre(e.target.value as Genre)} aria-label={translateUI("Genre")}>
          {GENRES.map((g) => <option key={g} value={g}>{translateUI(g)}</option>)}
        </select>
      </label>
      <label className="field">
        <span className="label-caps">{translateUI("Tags")}</span>
        <input className="input" value={tags} maxLength={400} onChange={(e) => setTags(e.target.value)} placeholder={translateUI("3D, licensed, two players")} aria-label={translateUI("Tags")} />
      </label>
      <p className="hint">{translateUI("Applies to every version of this game. A genre you choose here is never changed by scans, MobyGames or catalog imports.")}</p>
      {c && <p className="muted small">{translateUI("Source")}: {translateUI(c.source === 'manual' ? 'you' : c.source === 'mobygames' ? 'MobyGames' : c.source === 'curator' ? 'catalog' : 'guess')}{c.locked ? ` · ${translateUI('locked')}` : ''}</p>}
      <div className="btn-row">
        <button className="btn primary" onClick={() => void save()}>{translateUI("Save")}</button>
        {c?.locked && <button className="btn" onClick={() => void run(() => api.setClassification(game.groupKey, { locked: false }), 'Back to automatic genres')}>{translateUI("Unlock")}</button>}
        {c && <button className="btn ghost" onClick={() => void run(() => api.clearClassification(game.groupKey), 'Genre removed')}>{translateUI("Remove genre")}</button>}
        <span className="spacer" />
        <button className="btn ghost" onClick={onClose}>{translateUI("Close")}</button>
      </div>
    </Modal>
  );
}
