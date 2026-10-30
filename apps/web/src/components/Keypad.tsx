import { t as translateUI } from '../i18n';
import type { Action, InputController } from '../input';
import { buzz } from '../serverSettings';
import { useHeld } from '../skin/useHeld';

function Key({ input, held, a, label, sub, cls = '' }: { input: InputController; held: Set<Action>; a: Action; label: string; sub?: string; cls?: string }) {
  const release = (id: number) => input.release(`touch:${a}:${id}`);
  return (
    <button
      type="button"
      className={`key ${cls} ${held.has(a) ? 'held' : ''}`}
      aria-label={translateUI(sub ? `${label} ${sub}` : label)}
      onPointerDown={(e) => {
        e.preventDefault();
        try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* synthetic or already-released pointer */ }
        input.press(`touch:${a}:${e.pointerId}`, a);
        buzz(8);
      }}
      onPointerUp={(e) => release(e.pointerId)}
      onPointerCancel={(e) => release(e.pointerId)}
      onLostPointerCapture={(e) => release(e.pointerId)}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="key-main">{translateUI(label)}</span>
      {sub && <span className="key-sub">{translateUI(sub)}</span>}
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
    <div className="keypad" aria-label={translateUI("Phone keypad")} data-testid="keypad">
      <div className="keypad-top">
        <Key a="softLeft" label={translateUI(softLeft || '◂')} sub="soft" cls="soft" {...k} />
        <div className="dpad">
          <Key a="up" label={translateUI("▲")} cls="dp up" {...k} />
          <Key a="left" label={translateUI("◀")} cls="dp left" {...k} />
          <Key a="fire" label={translateUI("OK")} cls="dp ok" {...k} />
          <Key a="right" label={translateUI("▶")} cls="dp right" {...k} />
          <Key a="down" label={translateUI("▼")} cls="dp down" {...k} />
        </div>
        <Key a="softRight" label={translateUI(softRight || '▸')} sub="soft" cls="soft" {...k} />
      </div>
      <div className="numpad">
        <Key a="d1" label={translateUI("1")} {...k} /><Key a="d2" label={translateUI("2")} sub="abc" {...k} /><Key a="d3" label={translateUI("3")} sub="def" {...k} />
        <Key a="d4" label={translateUI("4")} sub="ghi" {...k} /><Key a="d5" label={translateUI("5")} sub="jkl" {...k} /><Key a="d6" label={translateUI("6")} sub="mno" {...k} />
        <Key a="d7" label={translateUI("7")} sub="pqrs" {...k} /><Key a="d8" label={translateUI("8")} sub="tuv" {...k} /><Key a="d9" label={translateUI("9")} sub="wxyz" {...k} />
        <Key a="star" label={translateUI("*")} {...k} /><Key a="d0" label={translateUI("0")} {...k} /><Key a="pound" label={translateUI("#")} {...k} />
      </div>
    </div>
  );
}
