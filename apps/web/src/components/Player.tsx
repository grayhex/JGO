import { KEY_LAYOUTS, SCREEN_PRESETS, type DevicePreset, type GameMeta, type HealthStatus, type LayoutId, type ServerEvent, type SessionState, type SessionStatus } from '@j2me-web/protocol';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, type JarAnalysisView } from '../api';
import type { Toast } from '../App';
import { PcmAudio } from '../audio';
import { GamepadPoller, InputController } from '../input';
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
  // Emulation profile: independent of the skin (the picture only)
  const [layout, setLayout] = useState<LayoutId>('nokia');
  const [res, setRes] = useState<{ width: number; height: number } | null>(null);
  const [device, setDevice] = useState('');
  const [heapMb, setHeapMb] = useState(256);
  const [devices, setDevices] = useState<DevicePreset[]>([]);
  const [analysis, setAnalysis] = useState<{ analysis: JarAnalysisView; recommendedDevice: string | null } | null>(null);
  // Presentation
  const [prefs, setPrefs] = usePrefs();
  const [smooth, setSmooth] = useState(false);
  const [showKeypad, setShowKeypad] = useState(() => matchMedia('(pointer: coarse)').matches);
  const [keymap, setKeymap] = useState(false);
  const [pad, setPad] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [frameSize, setFrameSize] = useState({ w: 240, h: 320 });
  const [vol, setVol] = useState(() => { try { return Number(localStorage.getItem('j2me-web.volume') ?? 80); } catch { return 80; } });
  const [muted, setMuted] = useState(false);
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
        setGame(g); setLayout(g.settings.layout); setRes({ width: g.settings.width, height: g.settings.height }); setDevice(g.settings.device ?? ''); setHeapMb(g.settings.heapMb);
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
  useEffect(() => { input.layout = layout; }, [input, layout]);

  const onEvent = useCallback((ev: ServerEvent) => {
    switch (ev.t) {
      case 'hello': setState(ev.state); setFrameSize({ w: ev.width, h: ev.height }); break;
      case 'state':
        setState(ev.state);
        if (ev.state === 'exited' || ev.state === 'failed') {
          input.releaseAll();
          if (ev.state === 'failed') toast('error', `Emulator stopped: ${ev.detail ?? 'unknown error'}`);
        }
        break;
      case 'softkeys': setSoftkeys({ left: ev.left, right: ev.right }); break;
      case 'title': setTitle(ev.title); break;
      case 'log': setLog((l) => [...l.slice(-199), ev.line]); break;
      case 'stats': setServer({ fps: ev.fps, dropped: ev.dropped, latencyMs: ev.latencyMs }); break;
      case 'menu': setMenu(ev); break;
      case 'menu-close': setMenu(null); break;
      case 'permission': setPerm(ev); break;
      case 'vibrate': if (ev.ms > 0) navigator.vibrate?.(Math.min(ev.ms, 2000)); else navigator.vibrate?.(0); break;
      case 'displayable': if (ev.kind !== 'canvas') toast('error', `This game opened a ${ev.kind} screen, which the Bridge frontend cannot show yet.`); break;
      case 'url': toast('info', `The game wants to open ${ev.url} (blocked)`); break;
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
      onConnection: (cs) => setConn(cs),
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
  useEffect(() => { input.enabled = live && !keymap && !menu && !perm; if (!input.enabled) input.releaseAll(); }, [input, live, keymap, menu, perm]);
  useEffect(() => {
    window.addEventListener('keydown', input.onKeyDown);
    window.addEventListener('keyup', input.onKeyUp);
    const rel = () => input.releaseAll();
    const vis = () => { if (document.hidden) rel(); };
    window.addEventListener('blur', rel);
    document.addEventListener('visibilitychange', vis);
    const gp = new GamepadPoller(input, setPad);
    gp.start();
    return () => {
      window.removeEventListener('keydown', input.onKeyDown); window.removeEventListener('keyup', input.onKeyUp);
      window.removeEventListener('blur', rel); document.removeEventListener('visibilitychange', vis);
      gp.stop(); input.releaseAll();
    };
  }, [input]);
  // the held-key state is shared by every control surface: changing the picture or the view lets go of everything
  useEffect(() => { input.releaseAll(); }, [input, prefs.skinId, prefs.view]);

  useEffect(() => () => { streamRef.current?.close(); }, []);

  const start = async () => {
    if (!game || busy) return;
    setBusy(true); setLog([]); setMenu(null); setPerm(null); setCpuHist([]); setFpsHist([]);
    void audio.resume(); // inside the click handler: allowed by autoplay policy
    try {
      attach(await api.startSession(game.id, { layout, heapMb, ...(res ?? {}), ...(device ? { device } : {}) }));
    } catch (e) {
      const err = e as ApiError;
      toast('error', err.message);
      setLog(err.message.split('\n'));
    } finally { setBusy(false); }
  };

  const stop = async () => {
    const s = sessionRef.current; if (!s) return;
    input.releaseAll();
    try { await api.stopSession(s.id); } catch (e) { toast('error', (e as Error).message); }
    streamRef.current?.close();
    setState('exited'); setConn('idle');
  };
  const leave = async () => { if (sessionRef.current && (state === 'running' || state === 'starting')) await stop(); onExit(); };
  const fullscreen = () => { if (document.fullscreenElement) void document.exitFullscreen(); else void card.current?.requestFullscreen?.(); };

  const pointer = (s: 'D' | 'M' | 'U') => (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!live) return;
    if (s === 'M' && e.buttons === 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.round(((e.clientX - r.left) / r.width) * frameSize.w);
    const y = Math.round(((e.clientY - r.top) / r.height) * frameSize.h);
    if (s === 'D') { try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ } }
    send({ t: 'pointer', id: 0, s, x, y });
  };

  const applyDevice = (id: string) => {
    setDevice(id);
    const p = devices.find((d) => d.id === id);
    if (p) { setRes({ width: p.width, height: p.height }); setLayout(p.layout); }
  };
  const saveDefaults = async () => {
    if (!game || !res) return;
    try { await api.patchGame(game.id, { settings: { ...res, layout, heapMb, ...(device ? { device } : {}) } }); toast('info', 'Saved as this game’s defaults'); } catch (e) { toast('error', (e as Error).message); }
  };

  const running = state === 'running' || state === 'starting' || state === 'stopping';
  const canStart = !!game && !running && !busy && health?.ok !== false;
  const resKey = res ? `${res.width}x${res.height}` : '';
  const needRestart = running && res && session && (res.width !== session.width || res.height !== session.height);
  const dev = devices.find((d) => d.id === device);
  const diag = session?.diagnostics ?? [];
  const logDiag = log.filter((l) => l.startsWith('⚠'));
  const res_ = session?.resources ?? null;
  const external = prefs.view === 'screen' || showKeypad;
  const skinScreen = skin?.config.screen;

  const overlay = !running ? (
    <>
      {game && <h2>{game.name}</h2>}
      {state === 'failed' && <p className="error">The emulator stopped unexpectedly. See the log.</p>}
      {game && game.classVersion >= 49 ? <p className="error">Java 5+ class files are not supported.</p> : (
        <button className="btn primary" disabled={!canStart} onClick={start}><Icon name="play" /> {busy ? 'Starting…' : state === 'idle' ? 'Start' : 'Start again'}</button>
      )}
      {health?.ok === false && <p className="error">Emulator runtime is not ready.</p>}
    </>
  ) : undefined;

  return (
    <div className="player-grid">
      <section className="card stage-card" ref={card} aria-label="Phone">
        <div className="stage-bar">
          <button className="btn ghost sm" onClick={leave}><Icon name="back" /> Library</button>
          <div className="title">
            <strong>{game?.name ?? '…'}</strong>
            <span>{title || game?.vendor}</span>
          </div>
          <span className={`badge ${STATE_BADGE[state] ?? ''} ${live ? 'live' : ''}`} data-testid="state-badge"><span className="dot" />{state === 'idle' ? 'stopped' : state}{conn === 'reconnecting' ? ' · reconnecting…' : ''}</span>
          <Seg label="View" value={prefs.view} onChange={(view) => setPrefs({ view })} options={[{ value: 'full', label: <><Icon name="phone" /> Phone</>, title: 'Whole phone, body keys active' }, { value: 'screen', label: <><Icon name="zoom" /> Screen</>, title: 'Enlarged display; controls below' }]} />
          <button className="btn ghost sm icon" onClick={fullscreen} aria-label="Toggle fullscreen" title="Fullscreen"><Icon name="fullscreen" /></button>
        </div>

        <div className={`stage ${prefs.view === 'screen' ? 'stage-screen' : ''}`}>
          {shownSkin.current ? (
            <PhoneSkin
              skin={shownSkin.current}
              view={prefs.view}
              frame={frameSize}
              canvasRef={setCanvas}
              canvasProps={{ onPointerDown: pointer('D'), onPointerMove: pointer('M'), onPointerUp: pointer('U'), onPointerCancel: pointer('U') }}
              integer={prefs.integer}
              smooth={smooth}
              input={input}
              interactive={live}
              lcdOverlay={overlay}
            />
          ) : <p className="muted center">Loading the phone…</p>}
        </div>

        <SkinPicker skins={skins} value={prefs.skinId} onChange={(id) => isSkinId(id) && setPrefs({ skinId: id })} />

        {external && (
          <div className="stage-foot">
            <SoftKeys input={input} left={softkeys.left} right={softkeys.right} live={live} />
            <Keypad input={input} softLeft={softkeys.left} softRight={softkeys.right} />
          </div>
        )}
      </section>

      <aside className="ctrl-col" aria-label="Emulator controls">
        <Panel icon="play" title="Session" right={<span className={`badge ${STATE_BADGE[state] ?? ''}`}>{state === 'idle' ? 'stopped' : state}</span>}>
          <div className="btn-row">
            {!running
              ? <button className="btn primary grow" disabled={!canStart} onClick={start}><Icon name="play" /> Start</button>
              : <button className="btn danger grow" onClick={stop} disabled={state === 'stopping'}><Icon name="stop" /> Stop</button>}
            {running && <button className="btn" onClick={async () => { await stop(); setTimeout(start, 400); }}><Icon name="restart" /> Restart</button>}
          </div>
          {state === 'failed' && <div className="note err">The emulator stopped unexpectedly. The log below has the details.</div>}
          {health?.ok === false && <div className="note warn">The emulator runtime is not ready on this server.</div>}
        </Panel>

        <Panel icon="device" title="Emulation profile">
          <p className="hint">What the game sees. The phone picture below does not change any of this.</p>
          <label className="field"><span className="label-caps">Device preset</span>
            <select className="select" value={device} onChange={(e) => applyDevice(e.target.value)} aria-label="Device preset">
              <option value="">None — resolution and layout only</option>
              {analysis?.recommendedDevice && <option value={analysis.recommendedDevice}>★ Recommended: {devices.find((d) => d.id === analysis.recommendedDevice)?.name ?? analysis.recommendedDevice}</option>}
              {devices.map((d) => <option key={d.id} value={d.id}>{d.vendor === 'common' ? '' : `${d.vendor} · `}{d.name}{d.model ? ` (${d.model})` : ''} · {d.width}×{d.height}</option>)}
            </select>
          </label>
          {dev && <dl className="kv"><dt>Resolution</dt><dd>{dev.width}×{dev.height}</dd><dt>Keys</dt><dd>{dev.layoutName}</dd><dt>Platform</dt><dd>{dev.platform ?? 'emulator default'}</dd></dl>}
          {dev?.notes.map((n) => <p className="hint" key={n}>{n}</p>)}
          <label className="field"><span className="label-caps">Resolution</span>
            <select className="select" aria-label="Resolution" value={SCREEN_PRESETS.some((p) => `${p.width}x${p.height}` === resKey) ? resKey : 'custom'} onChange={(e) => { const [w, h] = e.target.value.split('x').map(Number); if (w && h) { setRes({ width: w, height: h }); setDevice(''); } }}>
              {SCREEN_PRESETS.map((p) => <option key={p.label} value={`${p.width}x${p.height}`}>{p.label}</option>)}
              {res && !SCREEN_PRESETS.some((p) => `${p.width}x${p.height}` === resKey) && <option value="custom">{res.width}×{res.height}</option>}
            </select>
          </label>
          {needRestart && <div className="note warn">Resolution changes apply after a restart.</div>}
          <label className="field"><span className="label-caps">Key layout</span>
            <select className="select" aria-label="Key layout" value={layout} onChange={(e) => { input.releaseAll(); setLayout(e.target.value as LayoutId); }}>
              {Object.entries(KEY_LAYOUTS).map(([id, l]) => <option key={id} value={id}>{l.label}</option>)}
            </select>
          </label>
          <label className="field"><span className="label-caps">Heap (MB)</span><input className="input" type="number" min={64} max={1024} step={32} value={heapMb} onChange={(e) => setHeapMb(Number(e.target.value))} aria-label="Heap in MB" /></label>
          <button className="btn sm" onClick={saveDefaults} disabled={!game || !res}>Save as game defaults</button>
        </Panel>

        <Panel icon="layers" title="Display">
          <div className="statline"><span className="label-caps">Phone model</span><span className="small mono">{skin ? `${skin.config.manufacturer} ${skin.config.model}` : '…'}</span></div>
          {skin && <div className="statline"><SkinStatus status={skin.config.status} /><span className="hint">display {skin.config.screen.width}×{skin.config.screen.height}</span></div>}
          <div className="statline"><span className="label-caps">Emulated picture</span><span className="small mono" data-testid="frame-size">{frameSize.w}×{frameSize.h}</span></div>
          {skinScreen && res && (res.width !== skinScreen.width || res.height !== skinScreen.height) && (
            <div className="note info">
              This phone’s display is {skinScreen.width}×{skinScreen.height}; the game renders {res.width}×{res.height}. It is shown whole, with margins, never stretched.
              {!running && <> <button className="btn sm" style={{ marginTop: 8 }} onClick={() => { setRes({ width: skinScreen.width, height: skinScreen.height }); setDevice(''); }}>Use {skinScreen.width}×{skinScreen.height} for the next start</button></>}
            </div>
          )}
          <Switch checked={prefs.integer} onChange={(integer) => setPrefs({ integer })}>Whole-number scaling</Switch>
          <Switch checked={smooth} onChange={setSmooth}>Smooth scaling</Switch>
          <p className="hint">The Screen view only enlarges the picture; the game keeps its resolution and keeps running.</p>
        </Panel>

        <Panel icon="gamepad" title="Controls">
          <Switch checked={showKeypad} onChange={setShowKeypad}>On-screen keypad</Switch>
          <div className="btn-row"><button className="btn sm" onClick={() => setKeymap(true)}>Remap keyboard</button></div>
          <p className="hint">Arrows · Enter = OK · Q/W = soft keys · 0–9 · X = * · Z = #. {prefs.view === 'full' ? 'Click or touch the phone’s keys; several at once work.' : 'In the Screen view the keys are below the picture.'}{pad ? ` Gamepad: ${pad.slice(0, 28)}.` : ''}</p>
        </Panel>

        <Panel icon="volume" title="Audio" open={false}>
          <label className="field"><span className="label-caps">Volume</span><input type="range" min={0} max={100} value={vol} onChange={(e) => setVol(Number(e.target.value))} aria-label="Volume" /></label>
          <Switch checked={muted} onChange={setMuted}>Mute</Switch>
          {audioInfo.state !== 'running' && running && <div className="note">Sound is waiting for a click or key press (browser autoplay policy).</div>}
          <p className="hint" data-testid="audio-status" data-audio-state={audioInfo.state} data-audio-rms={audioInfo.rms.toFixed(4)}>
            {audioInfo.state === 'running' ? `output ${audioInfo.rms > 0.0005 ? 'active' : 'idle'} · level ${(audioInfo.rms * 100).toFixed(1)}% · buffer ${audioInfo.buffered} ms` : `audio ${audioInfo.state}`}
          </p>
        </Panel>

        <Panel icon="pulse" title="Telemetry">
          <div className="metric"><div className="metric-head"><span className="label-caps">Display FPS</span><span className="metric-value">{client.fps.toFixed(1)}</span></div><Spark values={fpsHist} label="Display frames per second" /></div>
          <div className="metric"><div className="metric-head"><span className="label-caps">Emulator CPU</span><span className="metric-value">{res_ ? `${res_.cpuPercentNow.toFixed(0)}%` : '—'}</span></div><Spark values={cpuHist} max={Math.max(100, ...cpuHist)} label="CPU use" /></div>
          <div className="metric"><div className="metric-head"><span className="label-caps">Memory</span><span className="small mono">{res_ ? `${res_.rssMb.toFixed(0)} MB (peak ${res_.peakRssMb.toFixed(0)})` : '—'}</span></div><Meter value={res_?.rssMb ?? 0} max={Math.max(512, heapMb * 2)} label="Memory use" /></div>
          <dl className="kv stats">
            <dt>Display FPS</dt><dd>{client.fps.toFixed(1)}</dd>
            <dt>Emulator FPS</dt><dd>{server.fps.toFixed(1)}</dd>
            <dt>Round trip</dt><dd>{client.rtt ?? '—'} ms</dd>
            <dt>Adapter→API</dt><dd>{server.latencyMs === null ? '—' : `${server.latencyMs.toFixed(0)} ms`}</dd>
            <dt>Decode</dt><dd>{client.decode} ms</dd>
            <dt>Bandwidth</dt><dd>{client.kbps} kbit/s</dd>
            <dt>Dropped</dt><dd>{server.dropped}</dd>
            <dt>First frame</dt><dd>{session?.firstFrameMs != null ? `${session.firstFrameMs} ms` : '—'}</dd>
            <dt>Sound</dt><dd>{session ? (session.audioBytes > 0 ? `${(session.audioBytes / 1024).toFixed(0)} KB` : 'none yet') : '—'}</dd>
            <dt>Frame</dt><dd>{frameSize.w}×{frameSize.h} · {session?.encoding ?? '—'}</dd>
          </dl>
          {[...new Set([...diag, ...logDiag.map((l) => l.slice(2))])].map((d) => <div className="note warn" key={d}>{d}</div>)}
        </Panel>

        {analysis && (
          <Panel icon="shield" title="Compatibility" open={false} right={<span className={`badge ${analysis.analysis.risk === 'low' ? 'prod' : analysis.analysis.risk === 'medium' ? 'mock' : 'danger'}`}>{analysis.analysis.risk} risk</span>}>
            <dl className="kv"><dt>Platform</dt><dd>{analysis.analysis.platform.family}</dd><dt>3D (M3G / Mascot)</dt><dd>{analysis.analysis.needs3d ? 'yes' : 'no'}</dd><dt>Classes</dt><dd>{analysis.analysis.classCount}</dd></dl>
            {analysis.analysis.apis.length > 0 && (
              <div className="table-wrap"><table className="table compact"><thead><tr><th>API</th><th>Classes</th><th>Missing</th></tr></thead>
                <tbody>{analysis.analysis.apis.map((a) => <tr key={a.id}><td>{a.label}</td><td>{a.classes}</td><td>{a.missing.length || '—'}</td></tr>)}</tbody></table></div>
            )}
            {analysis.analysis.findings.map((f) => <div key={f.code + f.message} className={`note ${f.level === 'error' ? 'err' : f.level === 'warn' ? 'warn' : ''}`}>{f.message}</div>)}
            {analysis.recommendedDevice && !running && device !== analysis.recommendedDevice && <button className="btn sm" onClick={() => applyDevice(analysis.recommendedDevice!)}>Use the recommended device preset</button>}
          </Panel>
        )}

        <Panel icon="log" title={`Emulator log (${log.length})`} open={false}>
          <pre className="log" tabIndex={0}>{log.slice(-120).join('\n') || '—'}</pre>
        </Panel>
      </aside>

      {keymap && <KeyMapDialog bindings={bindings} onClose={() => setKeymap(false)} onSave={(b) => { input.bindings = b; setBindings(b); }} />}
      {menu && (
        <Modal title="Menu" onClose={() => { setMenu(null); }}>
          <ul className="menu-list">
            {menu.items.map((i) => <li key={i.id}><button className="btn block" onClick={() => { send({ t: 'cmd', id: i.id }); setMenu(null); }}>{i.kind === 'radio-selected' ? '◉ ' : i.kind === 'radio' ? '○ ' : ''}{i.text}</button></li>)}
          </ul>
        </Modal>
      )}
      {perm && (
        <Modal title="Permission request" onClose={() => { send({ t: 'perm', id: perm.id, allow: false }); setPerm(null); }}>
          <p>{perm.message}</p>
          <div className="modal-actions">
            <span className="spacer" />
            <button className="btn" onClick={() => { send({ t: 'perm', id: perm.id, allow: false }); setPerm(null); }}>Deny</button>
            <button className="btn primary" onClick={() => { send({ t: 'perm', id: perm.id, allow: true }); setPerm(null); }}>Allow</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

