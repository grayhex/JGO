import { t as translateUI } from '../i18n';
import { PHONE_SKIN_IDS, profilesForSkin, skinSupportsPlatform, type GamePlatform, type PhoneSkinId, type PublicSettings } from '@mgo/protocol';
import { useMemo, useRef } from 'react';
import { api } from '../api';
import { getServerSettings, setServerSettings, useServerSettings } from '../serverSettings';
import { useCatalog } from '../skin/registry';
import { Hint } from './ui';
import { PlatformTag } from './PlatformTag';

type Toaster = (kind: 'info' | 'error', text: string) => void;

/** The three things somebody plays: Java ME, Symbian S60 programs (.sis/.sisx) and N-Gage. N-Gage 2.0 follows the Symbian phone when it can. */
export const PHONE_ROLES = [
  { platform: 'j2me', title: 'Java ME', hint: 'Games in .jar files. Any phone can show them; the choice only sets the look and the default screen size.' },
  { platform: 'symbian', title: 'Symbian S60', hint: 'Programs in .sis and .sisx files. Old .sis (S60 1st/2nd Edition) need a phone like the N70, newer .sisx need an S60 3rd Edition or later phone. Needs a firmware of this phone.' },
  { platform: 'ngage', title: 'N-Gage', hint: 'Original N-Gage games (game card dumps). They run on N-Gage and N-Gage QD. Needs a firmware of this phone.' },
] as const satisfies readonly { platform: GamePlatform; title: string; hint: string }[];
export type PhoneRole = (typeof PHONE_ROLES)[number]['platform'];

const supports = (skin: PhoneSkinId, platform: GamePlatform) => platform === 'j2me' || skinSupportsPlatform(skin, platform);
const SHOWN: GamePlatform[] = ['j2me', 'symbian', 'ngage', 'ngage2'];

/** What the saved settings say now: the phones that are in "my phones" and the default of each role. */
export function currentPhones(settings: PublicSettings): { mine: PhoneSkinId[]; chosen: boolean; defaults: Record<PhoneRole, PhoneSkinId | null> } {
  const n = settings.nativePhones ?? {};
  const guess = [settings.phone.skinId, n.symbian, n.ngage, n.ngage2].filter((x): x is PhoneSkinId => !!x && (PHONE_SKIN_IDS as readonly string[]).includes(x));
  const mine = settings.myPhones ?? [...new Set(guess)];
  const pick = (platform: PhoneRole, saved: string | null | undefined) => {
    const ok = (id: string | null | undefined): id is PhoneSkinId => !!id && (mine as readonly string[]).includes(id) && supports(id as PhoneSkinId, platform);
    return ok(saved) ? saved : mine.find((id) => supports(id, platform)) ?? null;
  };
  return { mine, chosen: settings.myPhones != null, defaults: { j2me: pick('j2me', settings.phone.skinId), symbian: pick('symbian', n.symbian), ngage: pick('ngage', n.ngage) } };
}

/** The roles that have no phone among `mine`: the wizard does not go on until each of them has one. */
export const missingRoles = (settings: PublicSettings): PhoneRole[] => {
  const { mine } = currentPhones(settings);
  return PHONE_ROLES.filter((r) => !mine.some((id) => supports(id, r.platform))).map((r) => r.platform);
};

/** N-Gage 2.0 (.n-gage) runs on S60 3rd Edition phones: the Symbian phone when it is one, else the first chosen phone that is. */
export function ngage2Phone(mine: readonly PhoneSkinId[], symbian: PhoneSkinId | null): PhoneSkinId | null {
  if (symbian && skinSupportsPlatform(symbian, 'ngage2')) return symbian;
  return mine.find((id) => skinSupportsPlatform(id, 'ngage2')) ?? null;
}

/** Writes "my phones" and keeps every default pointing at a phone that is still chosen and still fits. */
export async function savePhones(settings: PublicSettings, mine: PhoneSkinId[], defaults: Partial<Record<PhoneRole, PhoneSkinId | null>> = {}) {
  const base = currentPhones({ ...settings, myPhones: mine });
  const next = { ...base.defaults, ...Object.fromEntries(Object.entries(defaults).filter(([, v]) => v && (mine as readonly string[]).includes(v))) } as Record<PhoneRole, PhoneSkinId | null>;
  return api.patchSettings({
    myPhones: mine as never,
    ...(next.j2me ? { phone: { skinId: next.j2me } } : {}),
    nativePhones: { symbian: next.symbian, ngage: next.ngage, ngage2: ngage2Phone(mine, next.symbian) } as never,
  });
}

/**
 * "My phones": a handful of the catalog's phones (at least one for Java ME, one for Symbian S60 and one for N-Gage) and which of them
 * each kind of game starts on. The pickers in the player show only these.
 */
export function MyPhones({ toast, wizard = false }: { toast: Toaster; wizard?: boolean }) {
  const server = useServerSettings();
  const { skins } = useCatalog();
  const view = useMemo(() => (server ? currentPhones(server.settings) : null), [server]);
  if (!server || !view) return <p className="muted">{translateUI('Loading…')}</p>;
  const { mine, defaults } = view;
  const missing = missingRoles(server.settings);
  // Clicks come faster than the server answers: each one builds on the selection of the click before it (not on what was last saved),
  // and the saves go one after another, so two quick clicks never undo each other.
  const latest = useRef<PhoneSkinId[] | null>(null);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const current = () => latest.current ?? mine;
  const run = (mineNext: PhoneSkinId[], d?: Partial<Record<PhoneRole, PhoneSkinId | null>>) => {
    latest.current = mineNext;
    chain.current = chain.current
      .then(() => savePhones(getServerSettings()!.settings, mineNext, d))
      .then(setServerSettings, (e) => toast('error', (e as Error).message))
      .finally(() => { if (latest.current === mineNext) latest.current = null; });
  };
  const toggle = (id: PhoneSkinId) => { const cur = current(); run(cur.includes(id) ? cur.filter((x) => x !== id) : PHONE_SKIN_IDS.filter((x) => x === id || cur.includes(x))); };
  const label = (id: PhoneSkinId) => { const s = skins?.find((k) => k.config.id === id); return s ? `${s.config.manufacturer} ${s.config.model}` : id; };

  return (
    <div className="stack my-phones" data-testid="my-phones">
      <p className="muted">{translateUI('Pick the phones you want to play on. Choose at least one for Java ME, one for Symbian S60 and one for N-Gage; the rest of the catalog stays available on the Phones page.')}</p>
      <div className="phone-grid" role="group" aria-label={translateUI('My phones')}>
        {PHONE_SKIN_IDS.map((id) => {
          const skin = skins?.find((k) => k.config.id === id);
          const on = mine.includes(id);
          const native = profilesForSkin(id, 'symbian')[0] ?? profilesForSkin(id, 'ngage')[0];
          return (
            <button key={id} type="button" role="checkbox" aria-checked={on} className={`phone-card${on ? ' on' : ''}`} onClick={() => toggle(id)} data-testid={`phone-${id}`} title={native ? `${native.name} · ${native.os}` : undefined}>
              <img src={`/phones/${id}/${skin?.config.assets.preview ?? 'preview.webp'}`} alt="" loading="lazy" draggable={false} />
              <strong>{skin?.config.model ?? id}</strong>
              <span className="muted small">{skin?.config.manufacturer ?? ''}</span>
              <span className="phone-platforms">{SHOWN.filter((p) => supports(id, p)).map((p) => <PlatformTag key={p} platform={p} size="sm" />)}</span>
              {on && <span className="phone-tick" aria-hidden="true">✓</span>}
            </button>
          );
        })}
      </div>
      {missing.length > 0 && (
        <p className="note warn" role="alert" data-testid="phones-missing">
          {translateUI('Still needed: a phone for')} {missing.map((p) => PHONE_ROLES.find((r) => r.platform === p)!.title).join(', ')}.
        </p>
      )}
      <h3>{translateUI('Which phone starts what')}</h3>
      <div className="role-grid">
        {PHONE_ROLES.map((r) => {
          const fits = mine.filter((id) => supports(id, r.platform));
          return (
            <label className="field role" key={r.platform}>
              <span className="label-caps role-title"><PlatformTag platform={r.platform} /> <Hint text={r.hint} /></span>
              <select className="select" value={defaults[r.platform] ?? ''} disabled={fits.length === 0} aria-label={translateUI(`Phone for ${r.title}`)} data-testid={`default-phone-${r.platform}`} onChange={(e) => run(current(), { [r.platform]: e.target.value as PhoneSkinId })}>
                {fits.length === 0 && <option value="">{translateUI('— choose a phone above —')}</option>}
                {fits.map((id) => <option key={id} value={id}>{label(id)}{fits.length > 1 && id === defaults[r.platform] ? ` · ${translateUI('default')}` : ''}</option>)}
              </select>
              {!wizard && fits.length > 1 && <span className="muted small">{translateUI('Used for new games of this kind; each game can use another of your phones.')}</span>}
            </label>
          );
        })}
      </div>
      {defaults.symbian && !skinSupportsPlatform(defaults.symbian, 'ngage2') && <p className="muted small">{translateUI('N-Gage 2.0 (.n-gage) needs an S60 3rd Edition phone such as the Nokia N95 or 5320. Add one if you have such games.')}</p>}
    </div>
  );
}
