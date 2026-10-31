import { EMULATION_DEFAULTS, EMULATION_LIMITS, type EmulationTweaks } from '@j2me-web/protocol';
import { t as translateUI } from '../i18n';
import { Hint, Switch } from './ui';

type Size = 'small' | 'medium' | 'large';

/**
 * The per-game options that change what the game sees (see EmulationTweaks). An empty field means "the emulator's
 * default", which is shown as the placeholder; nothing here is stored unless the user changes it.
 */
export function EmulationTweaksForm({ value, onChange, disabled }: { value: EmulationTweaks; onChange: (v: EmulationTweaks) => void; disabled?: boolean }) {
  const set = (patch: Partial<EmulationTweaks>) => {
    const next: EmulationTweaks = { ...value, ...patch };
    for (const k of Object.keys(next) as (keyof EmulationTweaks)[]) if (next[k] === undefined) delete next[k];
    onChange(next);
  };
  const fonts = value.fontSizes ?? EMULATION_DEFAULTS.fontSizes;
  const setFont = (k: Size, raw: string) => {
    const n = Math.round(Number(raw));
    if (!raw || !Number.isFinite(n)) return;
    set({ fontSizes: { ...fonts, [k]: Math.min(EMULATION_LIMITS.fontSize[1], Math.max(EMULATION_LIMITS.fontSize[0], n)) } });
  };
  const empty = Object.keys(value).length === 0;
  return (
    <fieldset className="tweaks" disabled={disabled}>
      <label className="field">
        <span className="label-caps">{translateUI('Frame limit (fps)')}</span>
        <input className="input" type="number" min={EMULATION_LIMITS.frameRate[0]} max={EMULATION_LIMITS.frameRate[1]} placeholder={String(EMULATION_DEFAULTS.frameRate)} value={value.frameRate ?? ''}
          onChange={(e) => set({ frameRate: e.target.value === '' ? undefined : Math.min(EMULATION_LIMITS.frameRate[1], Math.max(EMULATION_LIMITS.frameRate[0], Math.round(Number(e.target.value)))) })} aria-label={translateUI('Frame limit (fps)')} />
      </label>
      <label className="field">
        <span className="label-caps">{translateUI('Language of the phone')} <Hint text="What the game reads as microedition.locale, for example en-US or ru-RU. Some games pick their language from it." /></span>
        <input className="input" type="text" maxLength={8} placeholder={EMULATION_DEFAULTS.locale} value={value.locale ?? ''}
          onChange={(e) => set({ locale: e.target.value === '' ? undefined : e.target.value })} aria-label={translateUI('Language of the phone')} />
      </label>
      <div className="field">
        <span className="label-caps">{translateUI('Font sizes (small / medium / large, pixels)')} <Hint text="Raise them if the text of a game looks tiny or lowers into the next line." /></span>
        <div className="field-row three">
          {(['small', 'medium', 'large'] as Size[]).map((k) => (
            <input key={k} className="input" type="number" min={EMULATION_LIMITS.fontSize[0]} max={EMULATION_LIMITS.fontSize[1]} value={fonts[k]} onChange={(e) => setFont(k, e.target.value)} aria-label={translateUI(`Font size ${k}`)} />
          ))}
        </div>
      </div>
      <Switch checked={value.pointerEvents ?? EMULATION_DEFAULTS.pointerEvents} onChange={(v) => set({ pointerEvents: v === EMULATION_DEFAULTS.pointerEvents ? undefined : v })}>{translateUI('Tell the game the phone has a touch screen')}</Switch>
      <Switch checked={value.startAppOnResume ?? EMULATION_DEFAULTS.startAppOnResume} onChange={(v) => set({ startAppOnResume: v === EMULATION_DEFAULTS.startAppOnResume ? undefined : v })}>{translateUI('Call pauseApp and startApp when the game is paused and resumed')}</Switch>
      <div className="btn-row"><button className="btn ghost sm" disabled={empty} onClick={() => onChange({})}>{translateUI('Back to the emulator defaults')}</button><Hint text="Applied when the game is started the next time." /></div>
    </fieldset>
  );
}
