import { useEffect, useState } from 'react';
import { isPhoneId, resolvePhone, type DevicePreset, type GameMeta } from '@j2me-web/protocol';
import type { Toast } from '../App';
import { api } from '../api';
import { t as translateUI } from '../i18n';
import { navigate } from '../router';
import { useCatalog } from '../skin/registry';

export const LAST_GAME_KEY = 'j2me-web.lastGame';
const lastGameId = (): string | null => { try { return localStorage.getItem(LAST_GAME_KEY); } catch { return null; } };

/**
 * The phones. Choosing one sets the phone of the game opened last (its picture, screen size and keys follow the phone,
 * as in the player's automatic mode); with no such game it becomes the phone new games start with.
 */
export function PhonesPage({ toast }: { toast: (k: Toast['kind'], t: string) => void }) {
  const { skins, error } = useCatalog();
  const [game, setGame] = useState<GameMeta | null>(null);
  const [devices, setDevices] = useState<DevicePreset[]>([]);
  const [defaultSkin, setDefaultSkin] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const id = lastGameId();
    api.games().then((gs) => setGame(gs.find((g) => g.id === id) ?? null), () => undefined);
    api.devices().then((d) => setDevices(d.presets), () => undefined);
    api.settings().then((s) => setDefaultSkin(s.settings.phone.skinId), () => undefined);
  }, []);

  const current = game ? game.settings.skinId : defaultSkin;
  const choose = async (id: string) => {
    if (!isPhoneId(id) || busy) return;
    setBusy(true);
    try {
      if (game) {
        const { preset, layout } = resolvePhone(id, devices);
        const g = await api.patchGame(game.id, { settings: { skinId: id, profileMode: 'auto', device: preset.id, width: preset.width, height: preset.height, layout } });
        setGame(g);
        toast('info', translateUI('{phone} is now the phone of “{game}”', { phone: id, game: game.name }));
        navigate(`/play/${game.id}`);
      } else {
        await api.patchSettings({ phone: { skinId: id } });
        setDefaultSkin(id);
        toast('info', 'This phone is now the default for new games');
      }
    } catch (e) { toast('error', (e as Error).message); } finally { setBusy(false); }
  };

  return (
    <section>
      <h1>{translateUI('Phones')}</h1>
      <p>{game ? translateUI('Click a phone to use it for “{game}”: the picture, screen size and keys follow it.', { game: game.name }) : translateUI('Click a phone to make it the default for new games. Open a game first to change its own phone.')}</p>
      {error && <p role="alert">{error}</p>}
      <div className="phones-models">
        {skins?.map(({ config: c, base }) => (
          <button key={c.id} type="button" className={`card phone-preview phone-pick${current === c.id ? ' on' : ''}`} aria-pressed={current === c.id} disabled={busy || devices.length === 0} onClick={() => void choose(c.id)}>
            <img src={base + c.assets.preview} alt="" height="280" />
            <h2>{c.manufacturer} {c.model}</h2>
            <p>{c.screen.width} × {c.screen.height}</p>
          </button>
        ))}
      </div>
    </section>
  );
}
