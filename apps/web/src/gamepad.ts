import { ACTIONS, type Action, type InputController } from './input';
export type PadAction = Action | 'ui:menu' | 'ui:back' | 'ui:fullscreen' | 'ui:lights';
export type PadBinding = { kind: 'button'; index: number } | { kind: 'axis'; index: number; direction: -1 | 1 };
export interface PadProfile { deadzone: number; bindings: Partial<Record<PadAction, PadBinding[]>> }
export interface PadState { controllers: { id: string; index: number; mapping: string }[]; pressed: string[] }
export const PAD_ACTIONS: PadAction[] = [...ACTIONS, 'ui:menu', 'ui:back', 'ui:fullscreen', 'ui:lights'];
const button = (index: number): PadBinding => ({ kind: 'button', index });
const axis = (index: number, direction: -1 | 1): PadBinding => ({ kind: 'axis', index, direction });
export const DEFAULT_PAD: PadProfile = { deadzone: .35, bindings: {
  up: [button(12), axis(1,-1)], down: [button(13), axis(1,1)], left: [button(14), axis(0,-1)], right: [button(15), axis(0,1)],
  fire: [button(0)], softLeft: [button(2)], softRight: [button(1)], d5: [button(3)], star: [button(4)], pound: [button(5)], 'ui:menu': [button(9)], 'ui:back': [button(8)],
} };
export function sanitizeProfile(raw: unknown): PadProfile {
  const p = raw as Partial<PadProfile> | null;
  const bindings: PadProfile['bindings'] = {};
  for (const action of PAD_ACTIONS) {
    const entries = p?.bindings?.[action]; if (!Array.isArray(entries)) continue;
    bindings[action] = entries.filter((b) => Number.isInteger(b?.index) && b.index >= 0 && b.index < 128 && (b.kind === 'button' || (b.kind === 'axis' && (b.direction === 1 || b.direction === -1))));
  }
  return { deadzone: Math.min(.9, Math.max(.1, typeof p?.deadzone === 'number' && Number.isFinite(p.deadzone) ? p.deadzone : .35)), bindings };
}
const key = (game?: string) => `j2me-web.gamepad.v1${game ? ':' + game : ''}`;
export function loadPadProfile(game?: string): PadProfile {
  try { const raw = localStorage.getItem(key(game)); if (raw) return sanitizeProfile(JSON.parse(raw)); } catch { /* fallback */ }
  if (game) return loadPadProfile();
  return structuredClone(DEFAULT_PAD);
}
export function savePadProfile(p: PadProfile, game?: string): void { try { localStorage.setItem(key(game), JSON.stringify(sanitizeProfile(p))); } catch { /* unavailable */ } }
export function clearPadOverride(game: string): void { try { localStorage.removeItem(key(game)); } catch { /* unavailable */ } }
export function bindingOn(p: Gamepad, b: PadBinding, deadzone: number): boolean {
  return b.kind === 'button' ? !!(p.buttons[b.index]?.pressed || (p.buttons[b.index]?.value ?? 0) > .5) : (p.axes[b.index] ?? 0) * b.direction > deadzone;
}
/** Manual tick supports deterministic tests. Never holds a key while unfocused or disabled. */
export class GamepadPoller {
  private raf = 0;
  private active = new Map<string, PadAction>();
  private blocked = new Set<string>();
  private suspended = false;
  profile: PadProfile;
  uiMode = false;
  onUi?: (action: PadAction) => void;
  onState?: (state: PadState) => void;
  capture?: (binding: PadBinding) => void;
  constructor(private input: InputController, private onName?: (name: string | null) => void, profile = loadPadProfile()) { this.profile = profile; }
  private blur = () => { this.suspended = true; for(const source of this.active.keys())this.blocked.add(source); this.release(); };
  private focus = () => { this.suspended = false; };
  private visibility = () => { if (document.hidden) this.blur(); else this.focus(); };
  release(): void { for (const source of this.active.keys()) this.input.release(source); this.active.clear(); }
  setProfile(profile: PadProfile): void { this.release(); this.profile = sanitizeProfile(profile); }
  tick(pads: readonly (Gamepad | null)[], focused = true): void {
    const capturing=!!this.capture; const now = new Map<string, PadAction>(); const present = new Set<string>();
    const controllers = pads.filter((p): p is Gamepad => !!p?.connected).map((p) => ({ id:p.id,index:p.index,mapping:p.mapping }));
    this.onName?.(controllers[0]?.id ?? null);
    for (const p of pads) {
      if (!p?.connected) continue;
      const found: PadBinding[] = [];
      p.buttons.forEach((b,i) => { if(b.pressed || b.value > .5) found.push(button(i)); });
      p.axes.forEach((a,i) => { if(Math.abs(a) > Math.max(.6,this.profile.deadzone)) found.push(axis(i,a < 0 ? -1 : 1)); });
      if (this.capture && found[0] && focused && !this.suspended) { const cb=this.capture; this.capture=undefined; cb(found[0]); this.release(); }
      for (const action of PAD_ACTIONS) for (const b of this.profile.bindings[action] ?? []) {
        const source=`pad:${p.index}:${action}:${b.kind}:${b.index}:${b.kind === 'axis' ? b.direction : ''}`;
        if (!bindingOn(p,b,this.profile.deadzone)) continue;
        present.add(source);
        if (!focused || this.suspended || (!this.input.enabled && !this.uiMode) || capturing) { this.blocked.add(source); continue; }
        if (!this.blocked.has(source)) now.set(source,action);
      }
    }
    for(const source of this.blocked) if(!present.has(source)) this.blocked.delete(source);
    for (const source of this.active.keys()) if (!now.has(source)) this.input.release(source);
    for (const [source,action] of now) {
      if (action.startsWith('ui:') || this.uiMode) {
        this.input.release(source);
        if (!this.active.has(source)) this.onUi?.(action);
      } else if (this.input.enabled) this.input.press(source,action as Action);
    }
    this.active=now;
    this.onState?.({controllers,pressed:[...new Set(now.values())]});
  }
  start(): void {
    window.addEventListener('blur',this.blur); window.addEventListener('focus',this.focus); document.addEventListener('visibilitychange',this.visibility);
    const run=()=>{ this.tick(navigator.getGamepads?.() ?? [], document.hasFocus() && !document.hidden);this.raf=requestAnimationFrame(run); };
    this.raf=requestAnimationFrame(run);
  }
  stop(): void { cancelAnimationFrame(this.raf);window.removeEventListener('blur',this.blur);window.removeEventListener('focus',this.focus);document.removeEventListener('visibilitychange',this.visibility);this.release(); }
}
