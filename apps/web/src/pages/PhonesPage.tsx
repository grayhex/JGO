import { useEffect, useMemo, useRef, useState } from 'react';
import { isPhoneId, resolvePhone, selectPhone, profilesForSkin, skinSupportsPlatform, EMULATED_DEVICES, PHONE_COMPATIBILITY, PACKAGE_FORMAT_LABEL, GAME_PLATFORMS, GAME_PLATFORM_LABELS, type DevicePreset, type GameMeta, type GamePlatform, type PhoneCatalog, type PhoneSkinId } from '@mgo/protocol';
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
  const thumbnail = useMemo(() => ({ ...skin, config: { ...c, views: { ...c.views, full: { ...c.views.full, body: c.assets.preview ?? c.views.full.body } } } }), [skin]);
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
  return (
    <button type="button" className={`card phone-preview phone-pick${current ? ' on' : ''}${fit.native ? (fit.compatible ? ' fits' : ' no-fit') : ''}`} aria-pressed={current} disabled={disabled} onClick={onPick} aria-label={`${c.manufacturer} ${c.model}`} data-fit={fit.native ? (fit.compatible ? 'yes' : 'no') : undefined}>
      <div className="phone-pick-skin" data-testid={`phone-card-${c.id}`} data-live={frame ? '1' : '0'}>
        <PhoneSkin skin={thumbnail} view="full" frame={size} canvasRef={(el) => { canvas.current = el; }} interactive={false} integer={false} />
      </div>
      <h2>{c.manufacturer} {c.model}</h2>
      <p>{c.screen.width} × {c.screen.height}</p>
      <p className="chips phone-platforms">{platforms.map(p => <span key={p} className={`chip${fit.native === p ? ' on' : ''}`}>{({ j2me: 'Java ME', symbian: 'Symbian', ngage: 'N-Gage', ngage2: 'N-Gage 2' })[p]}</span>)}</p>
      {fw.devices.length > 0 && (
        <p className={`phone-firmware ${fw.loaded.length ? 'loaded' : 'missing'}`} data-testid={`phone-firmware-${c.id}`} data-loaded={fw.loaded.length ? '1' : '0'}
          title={translateUI(fw.loaded.length ? 'The firmware for this phone is installed in the Symbian service, so its games can run here.' : 'No firmware for this phone is installed. Add it in Settings → Symbian; the picture alone cannot run Symbian games.')}>
          <span className="dot" aria-hidden />{fw.loaded.length
            ? `${translateUI('Firmware loaded')} · ${fw.loaded.map(d => d.firmware.product).join(', ')}`
            : `${translateUI('Firmware not loaded')} · ${fw.devices.map(d => d.firmware.product).join(', ')}`}
        </p>
      )}


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
          const loaded = nativeFirmware(id, catalog).loaded.filter(d => d.platforms.includes(game.platform!));
          const profile = loaded.find(d => d.engine === 'eka2l1' && d.firmware.product.toLowerCase() === game.settings.symbianDevice?.toLowerCase()) ?? (loaded.length === 1 ? loaded[0] : null);
          const desired = profile ?? (loaded.length === 0 ? selection.device : null);
          const g = await api.patchGame(game.id, { settings: { skinId: id, symbianDevice: desired?.engine === 'eka2l1' ? desired.firmware.product : null, emulatedDeviceId: desired?.engine === 'eka2l1' ? desired.id : null } });
          if (!desired) toast('info', translateUI('Several firmware variants are installed. Choose one in the player.'));
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
      <p className="note phones-intro" data-testid="phones-native-note">{game
        ? nativePlatform
          ? translateUI('Choose a phone for “{game}” ({format}). An installed firmware is selected with the phone; unavailable or incompatible models are marked below.', { game: game.name, format: game.packageFormat && game.packageFormat !== 'unknown' ? PACKAGE_FORMAT_LABEL[game.packageFormat] : GAME_PLATFORM_LABELS[nativePlatform] })
          : translateUI('Choose a phone for “{game}”. Its screen and controls will be used for this Java ME game.', { game: game.name })
        : translateUI('Choose the default phone for new Java ME games. Defaults for other platforms are in Settings.')}</p>
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
