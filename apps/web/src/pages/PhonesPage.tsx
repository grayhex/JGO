import { useEffect, useRef, useState } from 'react';
import { isPhoneId, resolvePhone, type DevicePreset, type GameMeta } from '@j2me-web/protocol';
import type { Toast } from '../App';
import { api } from '../api';
import { t as translateUI } from '../i18n';
import { getLastGame } from '../lastGame';
import { navigate } from '../router';
import { PhoneSkin } from '../skin/PhoneSkin';
import { useCatalog } from '../skin/registry';
import { SessionStream } from '../stream';

/**
 * What the phones show: the current frame of the game that is running, otherwise a dark display, as if the phone were switched off.
 * One viewer is attached to the running session (no input, no sound) and every card draws its latest frame.
 */
function useGameFrame(gameId: string | null): ImageData | null {
  const [frame, setFrame] = useState<ImageData | null>(null);
  useEffect(() => {
    if (!gameId) return;
    let stream: SessionStream | null = null;
    let dead = false;
    let last = 0;
    api.sessions().then((list) => {
      const s = list.find((x) => x.gameId === gameId && x.state === 'running');
      if (!s || dead) return;
      stream = new SessionStream(s.id, {
        onEvent: (ev) => { if (ev.t === 'state' && ev.state !== 'running') setFrame(null); },
        onFrame: (img) => { const now = performance.now(); if (now - last > 90) { last = now; setFrame(img); } },
        onAudio: () => undefined,
        onConnection: () => undefined,
      });
      stream.connect();
    }, () => undefined);
    return () => { dead = true; stream?.close(); };
  }, [gameId]);
  return frame;
}

function PhoneCard({ skin, frame, current, disabled, onPick }: { skin: NonNullable<ReturnType<typeof useCatalog>['skins']>[number]; frame: ImageData | null; current: boolean; disabled: boolean; onPick: () => void }) {
  const { config: c } = skin;
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const size = frame ? { w: frame.width, h: frame.height } : { w: c.screen.width, h: c.screen.height };
  useEffect(() => {
    const el = canvas.current;
    const g = el?.getContext('2d');
    if (!el || !g) return;
    if (el.width !== size.w || el.height !== size.h) { el.width = size.w; el.height = size.h; }
    if (frame) g.putImageData(frame, 0, 0);
    else { g.fillStyle = '#000'; g.fillRect(0, 0, size.w, size.h); }
  });
  return (
    <button type="button" className={`card phone-preview phone-pick${current ? ' on' : ''}`} aria-pressed={current} disabled={disabled} onClick={onPick} aria-label={`${c.manufacturer} ${c.model}`}>
      <div className="phone-pick-skin" data-testid={`phone-card-${c.id}`} data-live={frame ? '1' : '0'}>
        <PhoneSkin skin={skin} view="full" frame={size} canvasRef={(el) => { canvas.current = el; }} interactive={false} integer={false} />
      </div>
      <h2>{c.manufacturer} {c.model}</h2>
      <p>{c.screen.width} × {c.screen.height}</p>
    </button>
  );
}

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
  const [gamesLoaded, setGamesLoaded] = useState(false); // until then it is not known whose phone a click changes

  useEffect(() => {
    const id = getLastGame()?.id ?? null;
    api.games().then((gs) => setGame(gs.find((g) => g.id === id) ?? null), () => undefined).finally(() => setGamesLoaded(true));
    api.devices().then((d) => setDevices(d.presets), () => undefined);
    api.settings().then((s) => setDefaultSkin(s.settings.phone.skinId), () => undefined);
  }, []);
  const frame = useGameFrame(game?.id ?? null);

  const current = game ? game.settings.skinId : defaultSkin;
  const choose = async (id: string) => {
    if (!isPhoneId(id) || busy) return;
    setBusy(true);
    try {
      if (game) {
        // advanced mode keeps the profile the user chose; automatic mode follows the phone (screen size, keys, platform)
        const { preset, layout } = resolvePhone(id, devices);
        const g = await api.patchGame(game.id, { settings: game.settings.profileMode === 'advanced' ? { skinId: id } : { skinId: id, profileMode: 'auto', device: preset.id, width: preset.width, height: preset.height, layout } });
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
        {skins?.map((s) => (
          <PhoneCard key={s.config.id} skin={s} frame={frame} current={current === s.config.id} disabled={busy || !gamesLoaded || devices.length === 0} onPick={() => void choose(s.config.id)} />
        ))}
      </div>
    </section>
  );
}
