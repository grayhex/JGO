import { t as translateUI } from '../i18n';
import { SCREEN_PRESETS, KEY_LAYOUTS, type GameMeta, type GameSettings, type LayoutId } from '@j2me-web/protocol';
import { useState } from 'react';
import { api } from '../api';
import type { Toast } from '../App';
import { Modal } from './Modal';
import { Switch } from './ui';

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
    <Modal title={translateUI(game.name)} onClose={onClose}>
      <dl className="facts">
        <dt>{translateUI("Vendor")}</dt><dd>{game.vendor}</dd>
        <dt>{translateUI("Version")}</dt><dd>{game.version || '—'}</dd>
        <dt>{translateUI("Size")}</dt><dd>{(game.sizeBytes / 1024).toFixed(0)} {translateUI("KB · class v")}{game.classVersion || '?'} · {translateUI(game.hasJad ? 'with JAD' : 'no JAD')}</dd>
        <dt>{translateUI("SHA-256")}</dt><dd className="mono">{game.sha256.slice(0, 16)}…</dd>
      </dl>
      {game.warnings.map((w) => <p key={w} className="note warn">{w}</p>)}
      <p className="hint">{translateUI("Editing resolution or key layout enables Advanced mode for this game.")}</p>
      <label className="field">
        <span className="label-caps">{translateUI("Screen resolution")}</span>
        <select className="select" value={preset ? `${preset.width}x${preset.height}` : 'custom'} onChange={(e) => { const [w, h] = e.target.value.split('x').map(Number); if (w && h) setS({ ...s, profileMode: 'advanced', width: w, height: h }); }}>
          {SCREEN_PRESETS.map((p) => <option key={p.label} value={`${p.width}x${p.height}`}>{translateUI(p.label)}</option>)}
          {!preset && <option value="custom">{s.width}×{s.height} {translateUI("(custom)")}</option>}
        </select>
      </label>
      <div className="field-row">
        <label className="field"><span className="label-caps">{translateUI("Width")}</span><input className="input" type="number" min={64} max={800} value={s.width} onChange={(e) => setS({ ...s, profileMode: 'advanced', width: Number(e.target.value) })} /></label>
        <label className="field"><span className="label-caps">{translateUI("Height")}</span><input className="input" type="number" min={64} max={800} value={s.height} onChange={(e) => setS({ ...s, profileMode: 'advanced', height: Number(e.target.value) })} /></label>
      </div>
      <label className="field">
        <span className="label-caps">{translateUI("Key layout")}</span>
        <select className="select" value={s.layout} onChange={(e) => setS({ ...s, profileMode: 'advanced', layout: e.target.value as LayoutId })}>
          {Object.entries(KEY_LAYOUTS).map(([id, l]) => <option key={id} value={id}>{translateUI(l.label)}</option>)}
        </select>
      </label>
      <label className="field">
        <span className="label-caps">{translateUI("Heap (MB)")}</span>
        <input className="input" type="number" min={64} max={1024} step={32} value={s.heapMb} onChange={(e) => setS({ ...s, heapMb: Number(e.target.value) })} />
      </label>
      {game.midlets.length > 1 && (
        <label className="field">
          <span>{translateUI("MIDlet")}</span>
          <select className="select" value={s.midlet ?? ''} onChange={(e) => setS({ ...s, midlet: e.target.value || undefined })}>
            {game.midlets.map((m) => <option key={m.className} value={m.className}>{m.name || m.className}</option>)}
          </select>
        </label>
      )}
      <div className="modal-actions">
        <Switch checked={delSaves} onChange={setDelSaves}>{translateUI("also delete saves")}</Switch>
        <button className="btn danger" onClick={del}>{translateUI("Delete")}</button>
        <span className="spacer" />
        <button className="btn" onClick={onClose}>{translateUI("Cancel")}</button>
        <button className="btn primary" onClick={save}>{translateUI("Save")}</button>
      </div>
    </Modal>
  );
}
