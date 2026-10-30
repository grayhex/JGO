import { SCREEN_PRESETS, KEY_LAYOUTS, type GameMeta, type GameSettings, type LayoutId } from '@j2me-web/protocol';
import { useState } from 'react';
import { api } from '../api';
import type { Toast } from '../App';
import { Modal } from './Modal';

export function GameSettingsDialog({ game, toast, onClose, onChanged }: { game: GameMeta; toast: (k: Toast['kind'], t: string) => void; onClose: () => void; onChanged: () => void }) {
  const [s, setS] = useState<GameSettings>(game.settings);
  const [delSaves, setDelSaves] = useState(false);
  const preset = SCREEN_PRESETS.find((p) => p.width === s.width && p.height === s.height);
  const save = async () => {
    try { await api.patchGame(game.id, { settings: s }); toast('info', 'Settings saved'); onChanged(); } catch (e) { toast('error', (e as Error).message); }
  };
  const del = async () => {
    if (!confirm(`Delete “${game.name}” from the library${delSaves ? ' together with its saved data' : ''}?`)) return;
    try { await api.deleteGame(game.id, delSaves); onChanged(); } catch (e) { toast('error', (e as Error).message); }
  };
  return (
    <Modal title={game.name} onClose={onClose}>
      <dl className="facts">
        <dt>Vendor</dt><dd>{game.vendor}</dd>
        <dt>Version</dt><dd>{game.version || '—'}</dd>
        <dt>Size</dt><dd>{(game.sizeBytes / 1024).toFixed(0)} KB · class v{game.classVersion || '?'} · {game.hasJad ? 'with JAD' : 'no JAD'}</dd>
        <dt>SHA-256</dt><dd className="mono">{game.sha256.slice(0, 16)}…</dd>
      </dl>
      {game.warnings.map((w) => <p key={w} className="note warn">{w}</p>)}
      <label className="field">
        <span>Screen resolution</span>
        <select className="select" value={preset ? `${preset.width}x${preset.height}` : 'custom'} onChange={(e) => { const [w, h] = e.target.value.split('x').map(Number); if (w && h) setS({ ...s, width: w, height: h }); }}>
          {SCREEN_PRESETS.map((p) => <option key={p.label} value={`${p.width}x${p.height}`}>{p.label}</option>)}
          {!preset && <option value="custom">{s.width}×{s.height} (custom)</option>}
        </select>
      </label>
      <div className="row">
        <label className="field"><span>Width</span><input className="input" type="number" min={64} max={800} value={s.width} onChange={(e) => setS({ ...s, width: Number(e.target.value) })} /></label>
        <label className="field"><span>Height</span><input className="input" type="number" min={64} max={800} value={s.height} onChange={(e) => setS({ ...s, height: Number(e.target.value) })} /></label>
      </div>
      <label className="field">
        <span>Key layout</span>
        <select className="select" value={s.layout} onChange={(e) => setS({ ...s, layout: e.target.value as LayoutId })}>
          {Object.entries(KEY_LAYOUTS).map(([id, l]) => <option key={id} value={id}>{l.label}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Heap (MB)</span>
        <input className="input" type="number" min={64} max={1024} step={32} value={s.heapMb} onChange={(e) => setS({ ...s, heapMb: Number(e.target.value) })} />
      </label>
      {game.midlets.length > 1 && (
        <label className="field">
          <span>MIDlet</span>
          <select className="select" value={s.midlet ?? ''} onChange={(e) => setS({ ...s, midlet: e.target.value || undefined })}>
            {game.midlets.map((m) => <option key={m.className} value={m.className}>{m.name || m.className}</option>)}
          </select>
        </label>
      )}
      <div className="modal-actions">
        <label className="check"><input type="checkbox" checked={delSaves} onChange={(e) => setDelSaves(e.target.checked)} /> also delete saves</label>
        <button className="btn danger" onClick={del}>Delete</button>
        <span className="spacer" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={save}>Save</button>
      </div>
    </Modal>
  );
}
