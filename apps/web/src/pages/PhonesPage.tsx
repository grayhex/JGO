import { useEffect, useRef, useState } from 'react';
import { isPhoneId, resolvePhone, selectPhone, profilesForSkin, skinSupportsPlatform, EMULATED_DEVICES, PHONE_COMPATIBILITY, PACKAGE_FORMAT_LABEL, GAME_PLATFORMS, GAME_PLATFORM_LABELS, type DevicePreset, type GameMeta, type GamePlatform, type PhoneCatalog, type PhoneSkinId } from '@j2me-web/protocol';
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

interface Fit { /** the game being opened is a Symbian / N-Gage one */ native: GamePlatform | null; compatible: boolean }

/** What a phone can run, and whether the firmware for it is loaded: this is read from the installed firmware, never from the picture. */
function nativeFirmware(id: PhoneSkinId, catalog: PhoneCatalog | null) {
  const devices = EMULATED_DEVICES.flatMap(d => (d.engine === 'eka2l1' && PHONE_COMPATIBILITY[id].includes(d.id) ? [d] : []));
  const loaded = devices.filter(d => catalog?.availability.find(a => a.deviceId === d.id)?.available);
  return { devices, loaded };
}

function PhoneCard({ skin, frame, current, disabled, onPick, catalog, fit }: { skin: NonNullable<ReturnType<typeof useCatalog>['skins']>[number]; frame: ImageData | null; current: boolean; disabled: boolean; onPick: () => void; catalog: PhoneCatalog | null; fit: Fit }) {
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
  const id = c.id as PhoneSkinId;
  const known = isPhoneId(c.id);
  const fw = known ? nativeFirmware(id, catalog) : { devices: [], loaded: [] };
  const platforms = known ? GAME_PLATFORMS.filter(p => profilesForSkin(id, p).length) : [];
  const incompatible = !!fit.native && !fit.compatible;
  return (
    <button type="button" className={`card phone-preview phone-pick${current ? ' on' : ''}${fit.native ? (fit.compatible ? ' fits' : ' no-fit') : ''}`} aria-pressed={current} disabled={disabled} onClick={onPick} aria-label={`${c.manufacturer} ${c.model}`} data-fit={fit.native ? (fit.compatible ? 'yes' : 'no') : undefined}>
      <div className="phone-pick-skin" data-testid={`phone-card-${c.id}`} data-live={frame ? '1' : '0'}>
        <PhoneSkin skin={skin} view="full" frame={size} canvasRef={(el) => { canvas.current = el; }} interactive={false} integer={false} />
      </div>
      <h2>{c.manufacturer} {c.model}</h2>
      <p>{c.screen.width} × {c.screen.height}</p>
      <p className="chips phone-platforms">{platforms.map(p => <span key={p} className={`chip${fit.native === p ? ' on' : ''}`}>{GAME_PLATFORM_LABELS[p]}</span>)}</p>
      {fw.devices.length > 0 && (
        <p className={`phone-firmware ${fw.loaded.length ? 'loaded' : 'missing'}`} data-testid={`phone-firmware-${c.id}`} data-loaded={fw.loaded.length ? '1' : '0'}
          title={translateUI(fw.loaded.length ? 'The firmware for this phone is installed in the Symbian service, so its games can run here.' : 'No firmware for this phone is installed. Add it in Settings → Symbian; the picture alone cannot run Symbian games.')}>
          <span className="dot" aria-hidden />{fw.loaded.length
            ? `${translateUI('Firmware loaded')} · ${fw.loaded.map(d => d.firmware.product).join(', ')}`
            : `${translateUI('Firmware not loaded')} · ${fw.devices.map(d => d.firmware.product).join(', ')}`}
        </p>
      )}
      {incompatible && <p className="phone-nofit" data-testid={`phone-incompatible-${c.id}`}>{translateUI('Cannot run {platform} games', { platform: GAME_PLATFORM_LABELS[fit.native!] })}</p>}
      {fit.native && fit.compatible && <p className="phone-fit" data-testid={`phone-compatible-${c.id}`}>{translateUI('Runs {platform} games', { platform: GAME_PLATFORM_LABELS[fit.native] })}</p>}
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
  const [catalog, setCatalog] = useState<PhoneCatalog | null>(null);
  const [gamesLoaded, setGamesLoaded] = useState(false); // until then it is not known whose phone a click changes

  useEffect(() => {
    const id = getLastGame()?.id ?? null;
    api.games().then((gs) => setGame(gs.find((g) => g.id === id) ?? null), () => undefined).finally(() => setGamesLoaded(true));
    api.devices().then((d) => setDevices(d.presets), () => undefined);
    api.phones().then(setCatalog, () => undefined);
    api.settings().then((s) => setDefaultSkin(s.settings.phone.skinId), () => undefined);
  }, []);
  const frame = useGameFrame(game?.id ?? null);

  const current = game ? game.settings.skinId : defaultSkin;
  const nativePlatform: GamePlatform | null = game && game.platform && game.platform !== 'j2me' ? game.platform : null;
  const choose = async (id: string) => {
    if (!isPhoneId(id) || busy) return;
    setBusy(true);
    try {
      if (game) {
        if ((game.platform ?? 'j2me') !== 'j2me') {
          const selection = selectPhone({ platform: game.platform!, skinId: id });
          if (!selection.ok) throw new Error(selection.message);
          const g = await api.patchGame(game.id, { settings: { skinId: id } });
          setGame(g); navigate(`/play/${game.id}`); return;
        }
        // advanced mode keeps the profile the user chose; automatic mode follows the phone (screen size, keys, platform)
        const { preset, layout } = resolvePhone(id, devices);
        const g = await api.patchGame(game.id, { settings: game.settings.profileMode === 'advanced' ? { skinId: id } : { skinId: id, emulatedDeviceId: null, profileMode: 'auto', device: preset.id, width: preset.width, height: preset.height, layout } });
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
      <p>{game ? translateUI('Click a phone to use it for “{game}”: Java ME follows the phone; native games keep their selected firmware.', { game: game.name }) : translateUI('Click a phone to make it the default for new games. Open a game first to change its own phone.')}</p>
      {nativePlatform && game?.packageFormat && game.packageFormat !== 'unknown' && <p className="note warn" data-testid="phones-package-note">{translateUI('The package of this game was built for {generation}: only phones of that generation can install it.', { generation: PACKAGE_FORMAT_LABEL[game.packageFormat] })}</p>}
      {nativePlatform && <p className="note" data-testid="phones-native-note">{translateUI('“{game}” is a {platform} game: only phones that have a matching Symbian / N-Gage profile can run it. The others are dimmed; a green “Firmware loaded” means the firmware for that phone is installed.', { game: game!.name, platform: GAME_PLATFORM_LABELS[nativePlatform] })}</p>}
      {error && <p role="alert">{error}</p>}
      <div className="phones-models">
        {skins?.map((s) => (
          <PhoneCard key={s.config.id} skin={s} frame={frame} current={current === s.config.id} catalog={catalog}
            fit={{ native: nativePlatform, compatible: !nativePlatform || (isPhoneId(s.config.id) && skinSupportsPlatform(s.config.id, nativePlatform, game?.packageFormat)) }}
            disabled={busy || !gamesLoaded || (nativePlatform ? !isPhoneId(s.config.id) || !skinSupportsPlatform(s.config.id, nativePlatform, game?.packageFormat) : devices.length === 0)} onPick={() => void choose(s.config.id)} />
        ))}
      </div>
    </section>
  );
}
