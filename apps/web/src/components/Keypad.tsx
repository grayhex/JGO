import type { Action } from '../input';

type Press = (source: string, a: Action) => void;
type Release = (source: string) => void;

function Key({ a, label, sub, cls = '', press, release }: { a: Action; label: string; sub?: string; cls?: string; press: Press; release: Release }) {
  return (
    <button
      type="button"
      className={`key ${cls}`}
      aria-label={sub ? `${label} ${sub}` : label}
      onPointerDown={(e) => {
        e.preventDefault();
        try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* synthetic or already-released pointer */ }
        press(`touch:${a}:${e.pointerId}`, a);
        navigator.vibrate?.(8);
      }}
      onPointerUp={(e) => release(`touch:${a}:${e.pointerId}`)}
      onPointerCancel={(e) => release(`touch:${a}:${e.pointerId}`)}
      onLostPointerCapture={(e) => release(`touch:${a}:${e.pointerId}`)}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="key-main">{label}</span>
      {sub && <span className="key-sub">{sub}</span>}
    </button>
  );
}

/** On-screen phone keypad: soft keys, D-pad with OK, 12-key matrix. Multi-touch capable. */
export function Keypad({ press, release, softLeft, softRight }: { press: Press; release: Release; softLeft: string; softRight: string }) {
  const k = { press, release };
  return (
    <div className="keypad" aria-label="Phone keypad">
      <div className="keypad-top">
        <Key a="softLeft" label={softLeft || '◂'} sub="soft" cls="soft" {...k} />
        <div className="dpad">
          <Key a="up" label="▲" cls="dp up" {...k} />
          <Key a="left" label="◀" cls="dp left" {...k} />
          <Key a="fire" label="OK" cls="dp ok" {...k} />
          <Key a="right" label="▶" cls="dp right" {...k} />
          <Key a="down" label="▼" cls="dp down" {...k} />
        </div>
        <Key a="softRight" label={softRight || '▸'} sub="soft" cls="soft" {...k} />
      </div>
      <div className="numpad">
        <Key a="d1" label="1" {...k} /><Key a="d2" label="2" sub="abc" {...k} /><Key a="d3" label="3" sub="def" {...k} />
        <Key a="d4" label="4" sub="ghi" {...k} /><Key a="d5" label="5" sub="jkl" {...k} /><Key a="d6" label="6" sub="mno" {...k} />
        <Key a="d7" label="7" sub="pqrs" {...k} /><Key a="d8" label="8" sub="tuv" {...k} /><Key a="d9" label="9" sub="wxyz" {...k} />
        <Key a="star" label="*" {...k} /><Key a="d0" label="0" {...k} /><Key a="pound" label="#" {...k} />
      </div>
    </div>
  );
}
