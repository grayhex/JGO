import { KEY_LAYOUTS, KEY_NUM0, KEY_POUND, KEY_STAR, type KeyCodes, type LayoutId } from '@j2me-web/protocol';

/** Logical phone keys; the numeric J2ME code is resolved through the selected layout. */
export type Action = 'up' | 'down' | 'left' | 'right' | 'fire' | 'softLeft' | 'softRight' | 'clear' | 'star' | 'pound' | `d${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`;

export const ACTIONS: Action[] = ['up', 'down', 'left', 'right', 'fire', 'softLeft', 'softRight', 'clear', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'd9', 'star', 'd0', 'pound'];

export const ACTION_LABEL: Record<Action, string> = {
  up: 'D-pad up', down: 'D-pad down', left: 'D-pad left', right: 'D-pad right', fire: 'OK / Fire',
  softLeft: 'Left soft key', softRight: 'Right soft key', clear: 'Clear (C)', star: '*', pound: '#',
  d0: '0', d1: '1', d2: '2', d3: '3', d4: '4', d5: '5', d6: '6', d7: '7', d8: '8', d9: '9',
};

export type Bindings = Record<Action, string[]>;

export const DEFAULT_BINDINGS: Bindings = {
  up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
  fire: ['Enter', 'Space'], softLeft: ['KeyQ', 'F1'], softRight: ['KeyW', 'F2'], clear: ['Backspace'],
  star: ['NumpadMultiply', 'KeyX'], pound: ['NumpadDivide', 'KeyZ'],
  d0: ['Digit0', 'Numpad0'], d1: ['Digit1', 'Numpad1'], d2: ['Digit2', 'Numpad2'], d3: ['Digit3', 'Numpad3'], d4: ['Digit4', 'Numpad4'],
  d5: ['Digit5', 'Numpad5'], d6: ['Digit6', 'Numpad6'], d7: ['Digit7', 'Numpad7'], d8: ['Digit8', 'Numpad8'], d9: ['Digit9', 'Numpad9'],
};

const STORE = 'j2me-web.bindings.v1';

export function loadBindings(): Bindings {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? 'null');
    if (raw && typeof raw === 'object') return { ...DEFAULT_BINDINGS, ...raw };
  } catch { /* storage unavailable or corrupt */ }
  return structuredClone(DEFAULT_BINDINGS);
}

export function saveBindings(b: Bindings): void {
  try { localStorage.setItem(STORE, JSON.stringify(b)); } catch { /* ignore */ }
}

export function codeFor(action: Action, layout: LayoutId): number {
  const k: KeyCodes = KEY_LAYOUTS[layout].keys;
  switch (action) {
    case 'up': case 'down': case 'left': case 'right': case 'fire': case 'softLeft': case 'softRight': case 'clear':
      return k[action];
    case 'star': return KEY_STAR;
    case 'pound': return KEY_POUND;
    default: return KEY_NUM0 + Number(action.slice(1));
  }
}

export function prettyKey(code: string): string {
  return code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num ').replace(/^Arrow/, '↔ ').replace('Space', 'Space');
}

type Send = (ev: { t: 'key'; s: 'D' | 'U'; code: number } | { t: 'release-all' }) => void;

/**
 * Tracks every pressed source (keyboard code, gamepad button, touch pointer) and turns it into
 * key down/up events. Multiple simultaneous keys work because each source has its own entry;
 * a J2ME code is held down while at least one source maps to it.
 */
export class InputController {
  private sources = new Map<string, { code: number; action: Action }>();
  private refs = new Map<number, number>();
  private listeners = new Set<() => void>();
  layout: LayoutId = 'nokia';
  bindings: Bindings = loadBindings();
  enabled = true;

  constructor(private send: Send) {}

  setSend(s: Send) { this.send = s; }

  /** Notified after every change of what is held (UI feedback only; never sends anything). */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private emit(): void { for (const l of this.listeners) l(); }

  /** Logical actions currently held by any source (keyboard, gamepad, touch, skin). */
  heldActions(): Set<Action> { return new Set([...this.sources.values()].map((v) => v.action)); }

  press(source: string, action: Action): void {
    if (!this.enabled || this.sources.has(source)) return;
    const code = codeFor(action, this.layout);
    this.sources.set(source, { code, action });
    const n = (this.refs.get(code) ?? 0) + 1;
    this.refs.set(code, n);
    if (n === 1) this.send({ t: 'key', s: 'D', code });
    this.emit();
  }

  release(source: string): void {
    const held = this.sources.get(source);
    if (held === undefined) return;
    const { code } = held;
    this.sources.delete(source);
    const n = (this.refs.get(code) ?? 1) - 1;
    if (n <= 0) { this.refs.delete(code); this.send({ t: 'key', s: 'U', code }); } else this.refs.set(code, n);
    this.emit();
  }

  /** Focus loss, tab hidden, disconnect, a different skin or view: nothing may stay pressed. */
  releaseAll(): void {
    const had = this.sources.size > 0;
    this.sources.clear();
    this.refs.clear();
    this.send({ t: 'release-all' });
    if (had) this.emit();
  }

  heldCodes(): number[] { return [...this.refs.keys()]; }

  actionForKeyboard(code: string): Action | null {
    for (const a of ACTIONS) if (this.bindings[a]?.includes(code)) return a;
    return null;
  }

  onKeyDown = (e: KeyboardEvent): void => {
    if (!this.enabled || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    const a = this.actionForKeyboard(e.code);
    if (!a) return;
    e.preventDefault();
    if (!e.repeat) this.press(`kb:${e.code}`, a);
  };

  onKeyUp = (e: KeyboardEvent): void => {
    if (this.sources.has(`kb:${e.code}`)) { e.preventDefault(); this.release(`kb:${e.code}`); }
  };
}
