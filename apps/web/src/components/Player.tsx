import { t as translateUI } from '../i18n';
import { useDeveloperMode } from '../developer';
import { isPhoneId, resolvePhone } from '@j2me-web/protocol';
import { GamepadPoller, loadPadProfile, type PadAction, type PadState } from '../gamepad';
import { GamepadSettings } from './GamepadSettings';
import { KEY_LAYOUTS, SCREEN_PRESETS, type DevicePreset, type GameMeta, type HealthStatus, type LayoutId, type ServerEvent, type SessionState, type SessionStatus } from '@j2me-web/protocol';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, type JarAnalysisView } from '../api';
import type { Toast } from '../App';
import { PcmAudio } from '../audio';
import { InputController } from '../input';
import { isSkinId, useCatalog, usePrefs } from '../skin/registry';
import { PhoneSkin } from '../skin/PhoneSkin';
import type { LoadedSkin } from '../skin/types';
import { useHeld } from '../skin/useHeld';
import { SessionStream } from '../stream';
import { Icon } from './Icon';
import { KeyMapDialog } from './KeyMapDialog';
import { Keypad } from './Keypad';
import { Modal } from './Modal';
import { SkinPicker, SkinStatus } from './SkinPicker';
import { Meter, Panel, Seg, Spark, Switch } from './ui';
import { audioSettings, buzz, controlSettings } from '../serverSettings';
import { nextRotation, ROTATIONS, unrotatePoint } from '../skin/geometry';
import { useRotation } from '../skin/rotation';

type Conn = 'connecting' | 'open' | 'reconnecting' | 'closed' | 'idle';

const STATE_BADGE: Record<string, string> = { running: 'prod', starting: 'dev', stopping: 'dev', failed: 'danger', exited: '', idle: '' };

function SoftKeys({ input, left, right, live }: { input: InputController; left: string; right: string; live: boolean }) {
  const held = useHeld(input);
  const key = (id: string, action: 'softLeft' | 'softRight', text: string, cls: string) => (
    <button
      className={`softkey ${cls} ${held.has(action) ? 'held' : ''}`}
      disabled={!live}
      onPointerDown={(e) => { try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ } input.press(`ui:${id}:${e.pointerId}`, action); }}
      onPointerUp={(e) => input.release(`ui:${id}:${e.pointerId}`)}
      onPointerCancel={(e) => input.release(`ui:${id}:${e.pointerId}`)}
      onLostPointerCapture={(e) => input.release(`ui:${id}:${e.pointerId}`)}
    >
      {text || '—'}
    </button>
  );
  return <div className="softkeys">{key('sl', 'softLeft', left, '')}{key('sr', 'softRight', right, 'right')}</div>;
}

export function Player({ gameId, toast, onExit, health }: { gameId: string; toast: (k: Toast['kind'], t: string) => void; onExit: () => void; health: HealthStatus | null }) {
  const developer=useDeveloperMode();
  const [game, setGame] = useState<GameMeta | null>(null);
  const [session, setSession] = useState<SessionStatus | null>(null);
  const [state, setState] = useState<SessionState | 'idle'>('idle');
  const [conn, setConn] = useState<Conn>('idle');
  const [softkeys, setSoftkeys] = useState({ left: '', right: '' });
  const [title, setTitle] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [server, setServer] = useState<{ fps: number; dropped: number; latencyMs: number | null }>({ fps: 0, dropped: 0, latencyMs: null });
  const [client, setClient] = useState({ fps: 0, rtt: null as number | null, decode: 0, kbps: 0 });
  const [fpsHist, setFpsHist] = useState<number[]>([]);
  const [cpuHist, setCpuHist] = useState<number[]>([]);
  const [menu, setMenu] = useState<Extract<ServerEvent, { t: 'menu' }> | null>(null);
  const [perm, setPerm] = useState<Extract<ServerEvent, { t: 'permission' }> | null>(null);
  // Automatic mode synchronizes the skin; Advanced keeps presentation independent.
  const [layout, setLayout] = useState<LayoutId>('nokia');
  const [res, setRes] = useState<{ width: number; height: number } | null>(null);
  const [device, setDevice] = useState('');
  const [heapMb, setHeapMb] = useState(256);
  const [devices, setDevices] = useState<DevicePreset[]>([]);
  const [analysis, setAnalysis] = useState<{ analysis: JarAnalysisView; recommendedDevice: string | null } | null>(null);
  // Presentation
  const [prefs, setPrefs] = usePrefs();
  const [smooth, setSmooth] = useState(false);
  const [rotation, setRotation] = useRotation(gameId);
  const [showKeypad, setShowKeypad] = useState(() => { const k = controlSettings().keypad; return k === 'always' || (k === 'auto' && matchMedia('(pointer: coarse)').matches); });
  const [keymap, setKeymap] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [padMenu, setPadMenu] = useState(false);
  const [padState, setPadState] = useState<PadState>({controllers:[],pressed:[]});
  const gamepad = useRef<GamepadPoller | null>(null);
  const [lights, setLights] = useState(() => { try { return localStorage.getItem('j2me-web.lights.v1') === 'true'; } catch { return false; } });
  const [awake, setAwake] = useState(true);
  const [touchControls, setTouchControls] = useState(false);
  const wakeTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(()=>()=>clearTimeout(wakeTimer.current),[]);
  const lightsActive = lights && prefs.view === 'screen';
  const wake = () => { setAwake(true); clearTimeout(wakeTimer.current); wakeTimer.current = setTimeout(() => setAwake(false), 2500); };
  useEffect(() => { try { localStorage.setItem('j2me-web.lights.v1', String(lights)); } catch {} }, [lights]);
  useEffect(() => {
    if (!lightsActive) return;
    wake();
    const key = (e: KeyboardEvent) => { if(e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setLights(false); } };
    const changed = () => { if (!document.fullscreenElement) setLights(false); };
    window.addEventListener('keydown', key, true);document.addEventListener('fullscreenchange',changed);
    return () => { clearTimeout(wakeTimer.current);window.removeEventListener('keydown',key,true);document.removeEventListener('fullscreenchange',changed); };
  }, [lightsActive]);
  useEffect(() => {
    const key=(e:KeyboardEvent)=>{if(e.altKey && e.code==='KeyL' && !e.repeat){e.preventDefault();setPrefs({view:'screen'});setLights(v=>!v);}};
    window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  }, []);
  const [pad, setPad] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [frameSize, setFrameSize] = useState({ w: 240, h: 320 });
  const [vol, setVol] = useState(() => { try { return Number(localStorage.getItem('j2me-web.volume') ?? audioSettings().volume); } catch { return audioSettings().volume; } });
  const [muted, setMuted] = useState(() => !audioSettings().enabled);
  const [audioInfo, setAudioInfo] = useState({ state: 'off' as string, rms: 0, buffered: 0 });
  const audio = useMemo(() => new PcmAudio(), []);
  const { skins } = useCatalog();

  const canvasEl = useRef<HTMLCanvasElement | null>(null);
  const lastFrame = useRef<ImageData | null>(null);
  const card = useRef<HTMLElement>(null);
  const streamRef = useRef<SessionStream | null>(null);
  const sessionRef = useRef<SessionStatus | null>(null);
  const input = useMemo(() => new InputController(() => undefined), []);
  const [bindings, setBindings] = useState(input.bindings);

  const skin: LoadedSkin | null = useMemo(() => skins?.find((s) => s.config.id === prefs.skinId) ?? null, [skins, prefs.skinId]);
  const shownSkin = useRef<LoadedSkin | null>(null);
  if (skin) shownSkin.current = skin;

  // The canvas element is created when the skin box has been measured and re-created when the skin component remounts:
  // whatever the emulator drew last is put back, so a static screen never goes blank.
  const setCanvas = useCallback((el: HTMLCanvasElement | null) => {
    canvasEl.current = el;
    if (el && lastFrame.current && el.width === lastFrame.current.width && el.height === lastFrame.current.height) el.getContext('2d')!.putImageData(lastFrame.current, 0, 0);
  }, []);
  useEffect(() => {
    const el = canvasEl.current;
    const f = lastFrame.current;
    if (el && f && el.width === f.width && el.height === f.height) el.getContext('2d')!.putImageData(f, 0, 0);
  }, [frameSize.w, frameSize.h, prefs.view, prefs.skinId]);

  // ---- game + attach to an already running session (page reload / reconnect)
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const g = (await api.games()).find((x) => x.id === gameId);
        if (!g) { toast('error', 'Game not found'); onExit(); return; }
        if (dead) return;
        setGame(g); setLayout(g.settings.layout); setRes({ width: g.settings.width, height: g.settings.height }); setDevice(g.settings.device ?? ''); setHeapMb(g.settings.heapMb); setAdvanced(g.settings.profileMode === 'advanced'); if (g.settings.skinId && isSkinId(g.settings.skinId)) setPrefs({skinId:g.settings.skinId}); setLoaded(true);
        const running = (await api.sessions()).find((s) => s.gameId === gameId && (s.state === 'running' || s.state === 'starting'));
        if (running && !dead) attach(running);
      } catch (e) { toast('error', (e as Error).message); }
    })();
    api.devices().then((d) => { if (!dead) setDevices(d.presets); }, () => undefined);
    api.analysis(gameId).then((a) => { if (!dead) setAnalysis(a); }, () => undefined);
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  const send = useCallback((ev: Parameters<SessionStream['send']>[0]) => streamRef.current?.send(ev), []);
  useEffect(() => { input.layout = session && (state === 'running' || state === 'starting') ? session.layout : layout; }, [input, layout, session?.layout, state]);

  const onEvent = useCallback((ev: ServerEvent) => {
    switch (ev.t) {
      case 'hello': setState(ev.state); setFrameSize({ w: ev.width, h: ev.height }); break;
      case 'state':
        setState(ev.state);
        if (ev.state === 'exited' || ev.state === 'failed') {
          input.releaseAll();
          if (ev.state === 'failed') toast('error', translateUI('Emulator stopped: {detail}', {detail:ev.detail ?? translateUI('unknown error')}));
        }
        break;
      case 'softkeys': setSoftkeys({ left: ev.left, right: ev.right }); break;
      case 'title': setTitle(ev.title); break;
      case 'log': setLog((l) => [...l.slice(-199), ev.line]); break;
      case 'stats': setServer({ fps: ev.fps, dropped: ev.dropped, latencyMs: ev.latencyMs }); break;
      case 'menu': setMenu(ev); break;
      case 'menu-close': setMenu(null); break;
      case 'permission': setPerm(ev); break;
      case 'vibrate': if (ev.ms > 0) buzz(Math.min(ev.ms, 2000)); else navigator.vibrate?.(0); break;
      case 'displayable': break; // the Bridge draws every screen into the framebuffer (patch 0006): the kind needs no UI
      case 'url': toast('info', translateUI('The game wants to open {url} (blocked)', {url:ev.url})); break;
      default: break;
    }
  }, [input, toast]);

  const attach = useCallback((s: SessionStatus) => {
    streamRef.current?.close();
    sessionRef.current = s;
    setSession(s); setState(s.state); setFrameSize({ w: s.width, h: s.height }); setLog(s.logTail);
    const st = new SessionStream(s.id, {
      onEvent,
      onFrame: (img) => {
        lastFrame.current = img;
        const c = canvasEl.current;
        if (!c) return;
        if (c.width !== img.width || c.height !== img.height) { c.width = img.width; c.height = img.height; setFrameSize({ w: img.width, h: img.height }); }
        c.getContext('2d')!.putImageData(img, 0, 0);
      },
      onAudio: (pcm) => audio.push(pcm),
      onConnection: (cs) => {
        setConn(cs);
        if(cs !== 'open') input.releaseAll();
        if(cs === 'closed') api.session(s.id).then(actual=>setState(actual.state),()=>{setState('exited');toast('info','The previous session ended or the service restarted. Start the game again; only game-written RMS can be restored.');});
      },
    });
    streamRef.current = st;
    input.setSend((ev) => st.send(ev as never));
    st.connect();
  }, [input, onEvent, audio]);

  // audio: needs a user gesture, so resume on the first interaction as well as on Start
  useEffect(() => {
    const go = () => { void audio.resume(); };
    window.addEventListener('pointerdown', go, { once: true });
    window.addEventListener('keydown', go, { once: true });
    return () => { window.removeEventListener('pointerdown', go); window.removeEventListener('keydown', go); audio.close(); };
  }, [audio]);
  useEffect(() => { audio.setVolume(vol / 100); try { localStorage.setItem('j2me-web.volume', String(vol)); } catch { /* ignore */ } }, [audio, vol]);
  useEffect(() => { audio.setMuted(muted); }, [audio, muted]);

  // client stats every second, server-side resources every two
  useEffect(() => {
    const t = window.setInterval(() => {
      const s = streamRef.current?.stats; if (!s) return;
      setClient({ fps: s.fps, rtt: s.rttMs, decode: s.decodeMs, kbps: Math.round((s.bytesPerSec * 8) / 1000) });
      setFpsHist((h) => [...h.slice(-39), s.fps]);
      setAudioInfo({ state: audio.stats.state, rms: audio.stats.rms, buffered: audio.stats.bufferedMs });
    }, 1000);
    return () => window.clearInterval(t);
  }, [audio]);
  const live = state === 'running';
  useEffect(() => {
    if (!sessionRef.current || !(state === 'running' || state === 'starting')) return;
    const t = window.setInterval(() => {
      const id = sessionRef.current?.id; if (!id) return;
      api.session(id).then((s) => { sessionRef.current = s; setSession(s); if (s.resources) setCpuHist((h) => [...h.slice(-39), s.resources!.cpuPercentNow]); }, () => undefined);
    }, 2000);
    return () => window.clearInterval(t);
  }, [state, session?.id]);

  // ---- input wiring: keyboard, focus loss, gamepad
  useEffect(() => { input.enabled = live && conn === 'open' && !keymap && !menu && !perm && !padMenu; if (!input.enabled) input.releaseAll(); }, [input, live, conn, keymap, menu, perm, padMenu]);
  useEffect(() => {
    window.addEventListener('keydown', input.onKeyDown);
    window.addEventListener('keyup', input.onKeyUp);
    const rel = () => input.releaseAll();
    const vis = () => { if (document.hidden) rel(); };
    window.addEventListener('blur', rel);
    document.addEventListener('visibilitychange', vis);
    const gp = new GamepadPoller(input, setPad, loadPadProfile(gameId));
    gamepad.current = gp;
    let previous = '';
    gp.onState = (s) => { const serialized=JSON.stringify(s);if(serialized!==previous){previous=serialized;setPadState(s);} };
    gp.onUi = (action) => uiRef.current(action);
    if (controlSettings().gamepad) gp.start();
    return () => {
      window.removeEventListener('keydown', input.onKeyDown); window.removeEventListener('keyup', input.onKeyUp);
      window.removeEventListener('blur', rel); document.removeEventListener('visibilitychange', vis);
      gp.stop(); input.releaseAll();
    };
  }, [input]);
  const uiRef = useRef<(action: PadAction) => void>(() => undefined);
  uiRef.current = (action) => {
    wake();
    if(action==='ui:menu'){input.releaseAll();setLights(false);setPadMenu(v=>!v);return;}
    if(action==='ui:back'){if(perm){send({t:'perm',id:perm.id,allow:false});setPerm(null);}setMenu(null);setKeymap(false);setPadMenu(false);setLights(false);return;}
    if(action==='ui:lights'){setPrefs({view:'screen'});setLights(v=>!v);return;}
    if(action==='ui:fullscreen'){fullscreen();return;}
    if(action==='up'||action==='down'||action==='left'||action==='right'){
      const root=document.querySelector('[role=dialog]') ?? document.querySelector('.player-grid');
      const controls=[...(root?.querySelectorAll<HTMLElement>('button:not(:disabled),select,input,a[href]')??[])].filter(e=>e.getClientRects().length && getComputedStyle(e).visibility!=='hidden');
      const selected=document.activeElement;
      if((action==='left'||action==='right') && selected instanceof HTMLSelectElement){selected.selectedIndex=Math.max(0,Math.min(selected.options.length-1,selected.selectedIndex+(action==='left'?-1:1)));selected.dispatchEvent(new Event('change',{bubbles:true}));return;}
      const at=controls.indexOf(document.activeElement as HTMLElement), delta=action==='up'||action==='left'?-1:1;
      controls[(at+delta+controls.length)%controls.length]?.focus();
    } else if(action==='fire') (document.activeElement as HTMLElement)?.click();
  };
  useEffect(()=>{if(gamepad.current)gamepad.current.uiMode=padMenu || !live || !!menu || !!perm || keymap;},[padMenu,live,menu,perm,keymap]);
  // the held-key state is shared by every control surface: changing the picture or the view lets go of everything
  useEffect(() => { input.releaseAll(); }, [input, prefs.skinId, prefs.view]);

  useEffect(() => () => { streamRef.current?.close(); }, []);

  useEffect(()=>{
    const release=()=>input.releaseAll();
    const warn=(e:BeforeUnloadEvent)=>{if(sessionRef.current && (state==='running'||state==='starting')){release();e.preventDefault();e.returnValue='';}};
    window.addEventListener('pagehide',release);window.addEventListener('beforeunload',warn);
    return()=>{window.removeEventListener('pagehide',release);window.removeEventListener('beforeunload',warn);};
  },[input,state]);
  const start = async () => {
    if (!game || busy || !loaded || (!advanced && !matched)) return;
    setBusy(true); setLog([]); setMenu(null); setPerm(null); setCpuHist([]); setFpsHist([]);
    void audio.resume(); // inside the click handler: allowed by autoplay policy
    try {
      attach(await api.startSession(game.id, { layout, heapMb, ...(res ?? {}), device: device || null, skinId: prefs.skinId, profileMode: advanced ? 'advanced' : 'auto' }));
    } catch (e) {
      const err = e as ApiError;
      toast('error', err.message);
      setLog(err.message.split('\n'));
    } finally { setBusy(false); }
  };

  const stop = async () => {
    const s = sessionRef.current; if (!s || busy) return false;
    input.releaseAll();
    setBusy(true);
    try {
      const stopped = await api.stopSession(s.id);
      sessionRef.current = stopped;
      setSession(stopped); setLog(stopped.logTail); setState(stopped.state);
      streamRef.current?.close(); setConn('idle');
      if (stopped.state === 'failed') toast('error', 'The game had to be forcibly closed. Progress not written by the game to RMS may be lost.');
      return true;
    } catch (e) {
      // A failed request is not evidence that the process stopped. Keep the viewer attached.
      toast('error', (e as Error).message);
      return false;
    } finally { setBusy(false); }
  };
  const leave = async () => { if (sessionRef.current && (state === 'running' || state === 'starting' || state === 'stopping') && !await stop()) return; onExit(); };
  const fullscreen = () => { const promise = document.fullscreenElement ? document.exitFullscreen() : card.current?.requestFullscreen?.(); promise?.catch(() => toast('info','Fullscreen is unavailable; Lights Out still works in this window.')); };

  const pointer = (s: 'D' | 'M' | 'U') => (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!live) return;
    if (s === 'M' && e.buttons === 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    const [fx, fy] = unrotatePoint((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, rotation);
    const x = Math.round(fx * frameSize.w);
    const y = Math.round(fy * frameSize.h);
    if (s === 'D') { try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ } }
    send({ t: 'pointer', id: 0, s, x, y });
  };

  const applyDevice = (id: string) => {
    setDevice(id);
    const p = devices.find((d) => d.id === id);
    if (p) { setRes({ width: p.width, height: p.height }); setLayout(p.layout); }
  };
  // a game made for the other way up: the picture is turned (only a view) and shown on the phone whose display is landscape
  const landscapeMode = (r: 90 | 270) => { setAdvanced(true); setPrefs({ skinId: 'nokia-e71' }); setRotation(r); };
  const sizeHint = (() => {
    const h = analysis?.analysis.screenHints[0];
    return h && res && (h.width !== res.width || h.height !== res.height) ? h : null;
  })();
  const matched = !advanced && isPhoneId(prefs.skinId) && devices.length ? resolvePhone(prefs.skinId, devices) : null;
  useEffect(() => {
    if (!loaded || advanced || !isPhoneId(prefs.skinId) || !devices.length) return;
    const { preset } = resolvePhone(prefs.skinId, devices);
    setDevice(preset.id); setLayout(preset.layout); setRes({width:preset.width,height:preset.height});
  }, [loaded,advanced,prefs.skinId,devices]);
  useEffect(() => {
    if (!loaded || !res) return;
    if (!advanced && matched && (device !== matched.preset.id || res.width !== matched.preset.width || res.height !== matched.preset.height || layout !== matched.preset.layout)) return;
    api.patchGame(gameId,{settings:{skinId:prefs.skinId,profileMode:advanced?'advanced':'auto',device:device || null,...res,layout,heapMb}}).catch(e=>toast('error',(e as Error).message));
  }, [loaded,prefs.skinId,advanced,device,res?.width,res?.height,layout,heapMb,gameId]);
  const saveDefaults = async () => {
    if (!game || !res) return;
    try { await api.patchGame(game.id, { settings: { ...res, layout, heapMb, device: device || null, skinId:prefs.skinId,profileMode:advanced?'advanced':'auto' } }); toast('info', 'Saved as this game’s defaults'); } catch (e) { toast('error', (e as Error).message); }
  };

  const running = state === 'running' || state === 'starting' || state === 'stopping';
  const canStart = !!game && !running && !busy && health?.ok !== false;
  const resKey = res ? `${res.width}x${res.height}` : '';
  const needRestart = running && res && session && (res.width !== session.width || res.height !== session.height || device !== (session.device ?? '') || layout !== session.layout || heapMb !== session.heapMb);
  const dev = devices.find((d) => d.id === device);
  const diag = session?.diagnostics ?? [];
  const logDiag = log.filter((l) => l.startsWith('⚠'));
  const res_ = session?.resources ?? null;
  const keypadRequired = prefs.view === 'screen' || skin?.config.input?.externalKeypad === true;
  const external = keypadRequired || showKeypad;
  const skinScreen = skin?.config.screen;

  const overlay = !running ? (
    <>
      {game && <h2>{game.name}</h2>}
      {state === 'failed' && <p className="error">{translateUI("The emulator stopped unexpectedly. See the log.")}</p>}
      {game && game.classVersion >= 49 ? <p className="error">{translateUI("Java 5+ class files are not supported.")}</p> : (
        <button className="btn primary" disabled={!canStart} onClick={start}><Icon name="play" /> {translateUI(busy ? 'Starting…' : state === 'idle' ? 'Start' : 'Start again')}</button>
      )}
      {health?.ok === false && <p className="error">{translateUI("Emulator runtime is not ready.")}</p>}
    </>
  ) : undefined;

  return (
    <div className={`player-grid ${lightsActive ? 'lights-out' : ''} ${awake ? 'hud-awake' : ''} ${touchControls ? 'touch-controls' : ''}`} onPointerMove={wake} onPointerDown={wake}>
      <section className={`card stage-card ${prefs.view === 'screen' ? 'is-screen' : ''}`} ref={card} aria-label={translateUI("Phone")}>
        {lightsActive && <div className="lights-hud"><button className="btn" onClick={()=>setLights(false)} aria-label={translateUI("Exit Lights Out")}>{translateUI("☀ Exit · Esc")}</button><button className="btn transient" onClick={fullscreen}>{translateUI("Fullscreen")}</button><button className="btn transient" onClick={()=>setTouchControls(v=>!v)}>{translateUI("Touch controls")}</button></div>}
        <div className="stage-bar">
          <div className="stage-left">
            <button className="btn ghost sm" onClick={leave}><Icon name="back" /> {translateUI("Library")}</button>
            <div className="title">
              <strong>{game?.name ?? '…'}</strong>
              <span>{title || game?.vendor}</span>
            </div>
          </div>
          <div className="stage-actions">
            <span className={`badge ${STATE_BADGE[state] ?? ''} ${live ? 'live' : ''}`} data-testid="state-badge"><span className="dot" />{translateUI(state === 'idle' ? 'stopped' : state)}{translateUI(conn === 'reconnecting' ? ' · reconnecting…' : '')}</span>
            <Seg label={translateUI("View")} value={prefs.view} onChange={(view) => setPrefs({ view })} options={[{ value: 'full', label: <><Icon name="phone" /> {translateUI("Phone")}</>, title: 'Whole phone, body keys active' }, { value: 'screen', label: <><Icon name="zoom" /> {translateUI("Screen")}</>, title: 'Enlarged display; controls below' }]} />
            {prefs.view === 'screen' && <button className="btn ghost sm" onClick={()=>setLights(v=>!v)} aria-label={translateUI("Lights Out")} aria-pressed={lights} title={translateUI("Lights Out · Alt+L")}>{translateUI("☾ Lights Out")}</button>}
            <button className="btn ghost sm icon" onClick={() => setRotation(nextRotation(rotation))} aria-label={translateUI("Rotate the picture")} title={translateUI("Rotate the picture (for games made for landscape)")} data-testid="rotate"><Icon name="rotate" /></button>
            <button className="btn ghost sm icon" onClick={fullscreen} aria-label={translateUI("Toggle fullscreen")} title={translateUI("Fullscreen")}><Icon name="fullscreen" /></button>
          </div>
        </div>

        <div className={`stage ${prefs.view === 'screen' ? 'stage-screen' : ''} ${skin?.config.input?.kind === 'touchscreen' ? 'stage-touchscreen' : ''}`}>
          {shownSkin.current ? (
            <PhoneSkin
              skin={shownSkin.current}
              view={prefs.view}
              frame={frameSize}
              rotation={rotation}
              canvasRef={setCanvas}
              canvasProps={{ onPointerDown: pointer('D'), onPointerMove: pointer('M'), onPointerUp: pointer('U'), onPointerCancel: pointer('U') }}
              integer={prefs.integer}
              smooth={smooth}
              input={input}
              interactive={live}
              lcdOverlay={overlay}
            />
          ) : <p className="muted center">{translateUI("Loading the phone…")}</p>}
        </div>

        <SkinPicker skins={skins} value={prefs.skinId} onChange={(id) => isSkinId(id) && setPrefs({ skinId: id })} />

        {external && (
          <div className="stage-foot">
            <SoftKeys input={input} left={softkeys.left} right={softkeys.right} live={live} />
            <Keypad input={input} softLeft={softkeys.left} softRight={softkeys.right} />
          </div>
        )}
      </section>

      <aside className="ctrl-col" aria-label={translateUI("Emulator controls")}>
        <Panel icon="play" title={translateUI("Session")} right={<span className={`badge ${STATE_BADGE[state] ?? ''}`}>{translateUI(state === 'idle' ? 'stopped' : state)}</span>}>
          <div className="btn-row">
            {!running
              ? <button className="btn primary grow" disabled={!canStart} onClick={start}><Icon name="play" /> {translateUI("Start")}</button>
              : <button className="btn danger grow" onClick={stop} disabled={busy || state === 'stopping'}><Icon name="stop" /> {translateUI("Stop")}</button>}
            {running && <button className="btn" disabled={busy || state === 'stopping'} onClick={async () => { if (await stop()) setTimeout(start, 400); }}><Icon name="restart" /> {translateUI("Restart")}</button>}
          </div>
          {running && <div className="note">{translateUI("Stop requests a safe MIDlet shutdown. An unresponsive game may be forcibly closed after 8 seconds; unsaved in-game progress can be lost. Save inside the game first.")}</div>}
          {state === 'failed' && <div className="note err">{translateUI("The emulator stopped unexpectedly. The log below has the details.")}</div>}
          {health?.ok === false && <div className="note warn">{translateUI("The emulator runtime is not ready on this server.")}</div>}
        </Panel>

        <Panel icon="device" title={translateUI("Emulation profile")}>
          {sizeHint && !running && (
            <div className="note info" data-testid="size-hint">
              {translateUI("This game says it is made for")} {sizeHint.width}×{sizeHint.height} ({sizeHint.source.replace(/^attribute /, '')}). {translateUI("At")} {res?.width}×{res?.height} {translateUI("it may be cropped or laid out wrongly.")}
              <button className="btn sm" style={{ marginTop: 8 }} onClick={() => { setAdvanced(true); setDevice(''); setRes({ width: sizeHint.width, height: sizeHint.height }); }}>{translateUI("Use")} {sizeHint.width}×{sizeHint.height}</button>
            </div>
          )}
          <Switch checked={advanced} onChange={setAdvanced}>{translateUI("Advanced: choose skin and profile independently")}</Switch>
          {matched && <div className={`note ${matched.exact ? 'info':'warn'}`} data-testid="phone-profile-match">{translateUI(matched.exact?'Exact preset':'Generic fallback')}: {matched.preset.name}. {translateUI(matched.reason)}</div>}
          <fieldset disabled={!advanced} style={{border:0,padding:0,margin:0}}>
          <label className="field"><span className="label-caps">{translateUI("Device preset")}</span>
            <select className="select" value={device} onChange={(e) => applyDevice(e.target.value)} aria-label={translateUI("Device preset")}>
              <option value="">{translateUI("None — resolution and layout only")}</option>
              {analysis?.recommendedDevice && <option value={analysis.recommendedDevice}>{translateUI("★ Recommended:")} {devices.find((d) => d.id === analysis.recommendedDevice)?.name ?? analysis.recommendedDevice}</option>}
              {devices.map((d) => <option key={d.id} value={d.id}>{translateUI(d.vendor === 'common' ? '' : `${d.vendor} · `)}{d.name}{translateUI(d.model ? ` (${d.model})` : '')} · {d.width}×{d.height}</option>)}
            </select>
          </label>
          {dev && <dl className="kv"><dt>{translateUI("Resolution")}</dt><dd>{dev.width}×{dev.height}</dd><dt>{translateUI("Keys")}</dt><dd>{dev.layoutName}</dd><dt>{translateUI("Platform")}</dt><dd>{dev.platform ?? 'emulator default'}</dd></dl>}
          {dev?.notes.map((n) => <p className="hint" key={n}>{n}</p>)}
          <label className="field"><span className="label-caps">{translateUI("Resolution")}</span>
            <select className="select" aria-label={translateUI("Resolution")} value={SCREEN_PRESETS.some((p) => `${p.width}x${p.height}` === resKey) ? resKey : 'custom'} onChange={(e) => { const [w, h] = e.target.value.split('x').map(Number); if (w && h) { setRes({ width: w, height: h }); setDevice(''); } }}>
              {SCREEN_PRESETS.map((p) => <option key={p.label} value={`${p.width}x${p.height}`}>{translateUI(p.label)}</option>)}
              {res && !SCREEN_PRESETS.some((p) => `${p.width}x${p.height}` === resKey) && <option value="custom">{res.width}×{res.height}</option>}
            </select>
            <span className="hint">{translateUI("A game that looks cropped or drawn in a corner was probably made for a bigger screen (try 320×480 or 480×800); one that is drawn sideways was made for landscape (use Picture rotation in Display).")}</span>
          </label>

          <label className="field"><span className="label-caps">{translateUI("Key layout")}</span>
            <select className="select" aria-label={translateUI("Key layout")} value={layout} onChange={(e) => { input.releaseAll(); setLayout(e.target.value as LayoutId); }}>
              {Object.entries(KEY_LAYOUTS).map(([id, l]) => <option key={id} value={id}>{translateUI(l.label)}</option>)}
            </select>
          </label>
          <label className="field"><span className="label-caps">{translateUI("Heap (MB)")}</span><input className="input" type="number" min={64} max={1024} step={32} value={heapMb} onChange={(e) => setHeapMb(Number(e.target.value))} aria-label={translateUI("Heap in MB")} /></label>
          </fieldset>
          {needRestart && <div className="note warn" role="status">{translateUI("The running game keeps its current profile. Restart to apply the selected phone/profile.")} <button className="btn sm" disabled={busy || state === 'stopping'} onClick={async()=>{if(await stop())await start();}}>{translateUI("Restart with selected profile")}</button></div>}
          <button className="btn sm" onClick={saveDefaults} disabled={!game || !res}>{translateUI("Save as game defaults")}</button>
        </Panel>

        <Panel icon="layers" title={translateUI("Display")}>
          <div className="statline"><span className="label-caps">{translateUI("Phone model")}</span><span className="small mono">{translateUI(skin ? `${skin.config.manufacturer} ${skin.config.model}` : '…')}</span></div>
          {skin && <div className="statline"><SkinStatus status={skin.config.status} /><span className="hint">{translateUI("display")} {skin.config.screen.width}×{skin.config.screen.height}</span></div>}
          <div className="statline"><span className="label-caps">{translateUI("Emulated picture")}</span><span className="small mono" data-testid="frame-size">{frameSize.w}×{frameSize.h}</span></div>
          {skinScreen && res && (res.width !== skinScreen.width || res.height !== skinScreen.height) && (
            <div className="note info"> {translateUI("This phone’s display is")} {skinScreen.width}×{skinScreen.height}{translateUI("; the game renders")} {res.width}×{res.height}{translateUI(". It is shown whole, with margins, never stretched.")} {!running && advanced && <> <button className="btn sm" style={{ marginTop: 8 }} onClick={() => { setRes({ width: skinScreen.width, height: skinScreen.height }); setDevice(''); }}>{translateUI("Use")} {skinScreen.width}×{skinScreen.height} {translateUI("for the next start")}</button></>}
            </div>
          )}
          <div className="field">
            <span className="label-caps">{translateUI("Picture rotation")}</span>
            <Seg<'0' | '90' | '180' | '270'> label={translateUI("Picture rotation")} value={String(rotation) as '0'} onChange={(v) => setRotation(Number(v) as 0)} options={ROTATIONS.map((d) => ({ value: String(d) as '0', label: `${d}°` }))} />
            <span className="hint">{translateUI("Some games are made for landscape and draw sideways. Turning the picture is only a view; the game is not told.")}</span>
          </div>
          {rotation === 0 && (
            <div className="note info" data-testid="landscape-quick">
              {translateUI("Made for landscape? Turn the picture and switch to the Nokia E71, whose display is landscape.")}
              <div className="btn-row" style={{ marginTop: 8 }}>
                <button className="btn sm" onClick={() => landscapeMode(90)}>{translateUI("Landscape, turn right")} ⟳</button>
                <button className="btn sm" onClick={() => landscapeMode(270)}>{translateUI("Landscape, turn left")} ⟲</button>
              </div>
            </div>
          )}
          {(rotation === 90 || rotation === 270) && skin && skin.config.screen.height > skin.config.screen.width && (
            <div className="note info" data-testid="landscape-hint">
              {translateUI("A landscape picture is small in a portrait display. The Nokia E71 has a landscape display.")}
              <button className="btn sm" style={{ marginTop: 8 }} onClick={() => { setAdvanced(true); setPrefs({ skinId: 'nokia-e71' }); }}>{translateUI("Use the Nokia E71 picture")}</button>
            </div>
          )}
          <Switch checked={prefs.integer} onChange={(integer) => setPrefs({ integer })}>{translateUI("Whole-number scaling")}</Switch>
          <Switch checked={smooth} onChange={setSmooth}>{translateUI("Smooth scaling")}</Switch>
          <p className="hint">{translateUI("The Screen view only enlarges the picture; the game keeps its resolution and keeps running.")}</p>
        </Panel>

        <Panel icon="gamepad" title={translateUI("Controls")}>
          <button className="btn" onClick={()=>{input.releaseAll();setPadMenu(v=>!v);}}>{translateUI("Gamepad settings / UI navigation")}</button>
          {padMenu && <GamepadSettings gameId={gameId} poller={gamepad.current} state={padState} />}
          {!!padState.pressed.length && <div className="note">{translateUI("Held:")} {padState.pressed.join(', ')}</div>}
          <Switch checked={external} disabled={keypadRequired} onChange={setShowKeypad}>{translateUI("On-screen keypad")}</Switch>
          <div className="btn-row"><button className="btn sm" onClick={() => setKeymap(true)}>{translateUI("Remap keyboard")}</button></div>
          <p className="hint">{translateUI("Arrows · Enter = OK · Q/W = soft keys · 0–9 · X = * · Z = #.")} {translateUI(skin?.config.input?.kind === 'touchscreen' ? 'Touch the display; use the keypad below for games that need buttons.' : prefs.view === 'full' ? 'Click or touch the phone’s keys; several at once work.' : 'In the Screen view the keys are below the picture.')}{translateUI(pad ? ` Gamepad: ${pad.slice(0, 28)}.` : '')}</p>
        </Panel>

        <Panel icon="volume" title={translateUI("Audio")} open={false}>
          <label className="field"><span className="label-caps">{translateUI("Volume")}</span><input type="range" min={0} max={100} value={vol} onChange={(e) => setVol(Number(e.target.value))} aria-label={translateUI("Volume")} /></label>
          <Switch checked={muted} onChange={setMuted}>{translateUI("Mute")}</Switch>
          {audioInfo.state !== 'running' && running && <div className="note">{translateUI("Sound is waiting for a click or key press (browser autoplay policy).")}</div>}
          <p className="hint" data-testid="audio-status" data-audio-state={audioInfo.state} data-audio-rms={audioInfo.rms.toFixed(4)}>
            {translateUI(audioInfo.state === 'running' ? `output ${audioInfo.rms > 0.0005 ? 'active' : 'idle'} · level ${(audioInfo.rms * 100).toFixed(1)}% · buffer ${audioInfo.buffered} ms` : `audio ${audioInfo.state}`)}
          </p>
        </Panel>

        {developer && <Panel icon="pulse" title={translateUI("Telemetry")}>
          <div className="metric"><div className="metric-head"><span className="label-caps">{translateUI("Display FPS")}</span><span className="metric-value">{client.fps.toFixed(1)}</span></div><Spark values={fpsHist} label={translateUI("Display frames per second")} /></div>
          <div className="metric"><div className="metric-head"><span className="label-caps">{translateUI("Emulator CPU")}</span><span className="metric-value">{translateUI(res_ ? `${res_.cpuPercentNow.toFixed(0)}%` : '—')}</span></div><Spark values={cpuHist} max={Math.max(100, ...cpuHist)} label={translateUI("CPU use")} /></div>
          <div className="metric"><div className="metric-head"><span className="label-caps">{translateUI("Memory")}</span><span className="small mono">{translateUI(res_ ? `${res_.rssMb.toFixed(0)} MB (peak ${res_.peakRssMb.toFixed(0)})` : '—')}</span></div><Meter value={res_?.rssMb ?? 0} max={Math.max(512, heapMb * 2)} label={translateUI("Memory use")} /></div>
          <dl className="kv stats">
            <dt>{translateUI("Display FPS")}</dt><dd>{client.fps.toFixed(1)}</dd>
            <dt>{translateUI("Emulator FPS")}</dt><dd>{server.fps.toFixed(1)}</dd>
            <dt>{translateUI("Round trip")}</dt><dd>{client.rtt ?? '—'} {translateUI("ms")}</dd>
            <dt>{translateUI("Adapter→API")}</dt><dd>{translateUI(server.latencyMs === null ? '—' : `${server.latencyMs.toFixed(0)} ms`)}</dd>
            <dt>{translateUI("Decode")}</dt><dd>{client.decode} {translateUI("ms")}</dd>
            <dt>{translateUI("Bandwidth")}</dt><dd>{client.kbps} {translateUI("kbit/s")}</dd>
            <dt>{translateUI("Dropped")}</dt><dd>{server.dropped}</dd>
            <dt>{translateUI("First frame")}</dt><dd>{translateUI(session?.firstFrameMs != null ? `${session.firstFrameMs} ms` : '—')}</dd>
            <dt>{translateUI("Sound")}</dt><dd>{translateUI(session ? (session.audioBytes > 0 ? `${(session.audioBytes / 1024).toFixed(0)} KB` : 'none yet') : '—')}</dd>
            <dt>{translateUI("Frame")}</dt><dd>{frameSize.w}×{frameSize.h} · {session?.encoding ?? '—'}</dd>
          </dl>
          {[...new Set([...diag, ...logDiag.map((l) => l.slice(2))])].map((d) => <div className="note warn" key={d}>{d}</div>)}
        </Panel>}

        {developer && analysis && (
          <Panel icon="shield" title={translateUI("Compatibility")} open={false} right={<span className={`badge ${analysis.analysis.risk === 'low' ? 'prod' : analysis.analysis.risk === 'medium' ? 'mock' : 'danger'}`}>{analysis.analysis.risk} {translateUI("risk")}</span>}>
            <dl className="kv"><dt>{translateUI("Platform")}</dt><dd>{analysis.analysis.platform.family}</dd><dt>{translateUI("3D (M3G / Mascot)")}</dt><dd>{translateUI(analysis.analysis.needs3d ? 'yes' : 'no')}</dd><dt>{translateUI("Classes")}</dt><dd>{analysis.analysis.classCount}</dd></dl>
            {analysis.analysis.apis.length > 0 && (
              <div className="table-wrap"><table className="table compact"><thead><tr><th>{translateUI("API")}</th><th>{translateUI("Classes")}</th><th>{translateUI("Missing")}</th></tr></thead>
                <tbody>{analysis.analysis.apis.map((a) => <tr key={a.id}><td>{translateUI(a.label)}</td><td>{a.classes}</td><td>{a.missing.length || '—'}</td></tr>)}</tbody></table></div>
            )}
            {analysis.analysis.findings.map((f) => <div key={f.code + f.message} className={`note ${f.level === 'error' ? 'err' : f.level === 'warn' ? 'warn' : ''}`}>{f.message}</div>)}
            {analysis.recommendedDevice && advanced && !running && device !== analysis.recommendedDevice && <button className="btn sm" onClick={() => applyDevice(analysis.recommendedDevice!)}>{translateUI("Use the recommended device preset")}</button>}
          </Panel>
        )}

        {(developer || state === 'failed') && <Panel icon="log" title={translateUI(`Emulator log (${log.length})`)} open={false}>
          <pre className="log" tabIndex={0}>{log.slice(-120).join('\n') || '—'}</pre>
        </Panel>}
      </aside>

      {keymap && <KeyMapDialog bindings={bindings} onClose={() => setKeymap(false)} onSave={(b) => { input.bindings = b; setBindings(b); }} />}
      {menu && (
        <Modal title={translateUI("Menu")} onClose={() => { setMenu(null); }}>
          <ul className="menu-list">
            {menu.items.map((i) => <li key={i.id}><button className="btn block" onClick={() => { send({ t: 'cmd', id: i.id }); setMenu(null); }}>{translateUI(i.kind === 'radio-selected' ? '◉ ' : i.kind === 'radio' ? '○ ' : '')}{i.text}</button></li>)}
          </ul>
        </Modal>
      )}
      {perm && (
        <Modal title={translateUI("Permission request")} onClose={() => { send({ t: 'perm', id: perm.id, allow: false }); setPerm(null); }}>
          <p>{perm.message}</p>
          <div className="modal-actions">
            <span className="spacer" />
            <button className="btn" onClick={() => { send({ t: 'perm', id: perm.id, allow: false }); setPerm(null); }}>{translateUI("Deny")}</button>
            <button className="btn primary" onClick={() => { send({ t: 'perm', id: perm.id, allow: true }); setPerm(null); }}>{translateUI("Allow")}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

