import { useEffect, useState } from 'react';
import { ACTION_LABEL, ACTIONS, DEFAULT_BINDINGS, prettyKey, saveBindings, type Action, type Bindings } from '../input';
import { Modal } from './Modal';

export function KeyMapDialog({ bindings, onSave, onClose }: { bindings: Bindings; onSave: (b: Bindings) => void; onClose: () => void }) {
  const [b, setB] = useState<Bindings>(structuredClone(bindings));
  const [capturing, setCapturing] = useState<Action | null>(null);

  useEffect(() => {
    if (!capturing) return;
    const f = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation();
      if (e.code === 'Escape') { setCapturing(null); return; }
      setB((cur) => {
        const next = structuredClone(cur);
        for (const a of ACTIONS) next[a] = next[a].filter((c) => c !== e.code); // a physical key maps to one action
        next[capturing] = [...next[capturing], e.code].slice(-3);
        return next;
      });
      setCapturing(null);
    };
    window.addEventListener('keydown', f, true);
    return () => window.removeEventListener('keydown', f, true);
  }, [capturing]);

  return (
    <Modal title="Keyboard mapping" onClose={onClose} wide>
      <p className="muted">Click “+” and press the key you want to use. Up to three keys per phone button. J2ME key codes depend on the selected layout (Nokia, Sony Ericsson, …).</p>
      <div className="keymap">
        {ACTIONS.map((a) => (
          <div className="keymap-row" key={a}>
            <span>{ACTION_LABEL[a]}</span>
            <span className="keymap-keys">
              {b[a].map((c) => (
                <button key={c} className="chip on" title="Remove" onClick={() => setB({ ...b, [a]: b[a].filter((x) => x !== c) })}>{prettyKey(c)} ×</button>
              ))}
              <button className={`chip ${capturing === a ? 'on' : ''}`} onClick={() => setCapturing(capturing === a ? null : a)}>{capturing === a ? 'press a key…' : '+'}</button>
            </span>
          </div>
        ))}
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={() => setB(structuredClone(DEFAULT_BINDINGS))}>Reset to defaults</button>
        <span className="spacer" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={() => { saveBindings(b); onSave(b); onClose(); }}>Save</button>
      </div>
    </Modal>
  );
}
