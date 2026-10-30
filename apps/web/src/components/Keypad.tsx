import type { Action, InputController } from '../input';
import { useHeld } from '../skin/useHeld';

function Key({ input, held, a, label, sub, cls = '' }: { input: InputController; held: Set<Action>; a: Action; label: string; sub?: string; cls?: string }) {
  const release = (id: number) => input.release(`touch:${a}:${id}`);
  return (
    <button
      type="button"
      className={`key ${cls} ${held.has(a) ? 'held' : ''}`}
      aria-label={sub ? `${label} ${sub}` : label}
      onPointerDown={(e) => {
        e.preventDefault();
        try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* synthetic or already-released pointer */ }
        input.press(`touch:${a}:${e.pointerId}`, a);
        navigator.vibrate?.(8);
      }}
      onPointerUp={(e) => release(e.pointerId)}
      onPointerCancel={(e) => release(e.pointerId)}
      onLostPointerCapture={(e) => release(e.pointerId)}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="key-main">{label}</span>
      {sub && <span className="key-sub">{sub}</span>}
    </button>
  );
}

/**
 * External phone controls: soft keys, D-pad with OK, 12-key matrix. Used in the screen close-up (the body has no keys
 * there) and wherever a touch screen needs bigger targets. Every finger is its own input source, so multi-touch works.
 */
export function Keypad({ input, softLeft, softRight }: { input: InputController; softLeft: string; softRight: string }) {
  const held = useHeld(input);
  const k = { input, held };
  return (
    <div className="keypad" aria-label="Phone keypad" data-testid="keypad">
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
