import { KEY_LAYOUTS, SCREEN_PRESETS, type GameMeta, type HealthStatus, type LayoutId, type ServerEvent, type SessionState, type SessionStatus } from '@j2me-web/protocol';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import type { Toast } from '../App';
import { PcmAudio } from '../audio';
import { GamepadPoller, InputController } from '../input';
import { SessionStream } from '../stream';
import { KeyMapDialog } from './KeyMapDialog';
import { Keypad } from './Keypad';
import { Modal } from './Modal';

type ScaleMode = 'fit' | 'int' | '1' | '2' | '3';
type Conn = 'connecting' | 'open' | 'reconnecting' | 'closed' | 'idle';

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
  const [menu, setMenu] = useState<Extract<ServerEvent, { t: 'menu' }> | null>(null);
  const [perm, setPerm] = useState<Extract<ServerEvent, { t: 'permission' }> | null>(null);
  const [layout, setLayout] = useState<LayoutId>('nokia');
  const [res, setRes] = useState<{ width: number; height: number } | null>(null);
  const [scale, setScale] = useState<ScaleMode>('fit');
  const [smooth, setSmooth] = useState(false);
  const [showKeypad, setShowKeypad] = useState(() => matchMedia('(pointer: coarse)').matches);
  const [panel, setPanel] = useState(true);
  const [keymap, setKeymap] = useState(false);
  const [pad, setPad] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [boxSize, setBoxSize] = useState({ w: 320, h: 480 });
  const [frameSize, setFrameSize] = useState({ w: 240, h: 320 });
  const [vol, setVol] = useState(() => { try { return Number(localStorage.getItem('j2me-web.volume') ?? 80); } catch { return 80; } });
  const [muted, setMuted] = useState(false);
  const [audioInfo, setAudioInfo] = useState({ state: 'off' as string, rms: 0, kbps: 0, buffered: 0 });
  const audio = useMemo(() => new PcmAudio(), []);

  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const streamRef = useRef<SessionStream | null>(null);
  const sessionRef = useRef<SessionStatus | null>(null);
  const input = useMemo(() => new InputController(() => undefined), []);
  const [bindings, setBindings] = useState(input.bindings);

  // ---- game + attach to an already running session (page reload / reconnect)
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const g = (await api.games()).find((x) => x.id === gameId);
        if (!g) { toast('error', 'Game not found'); onExit(); return; }
        if (dead) return;
        setGame(g); setLayout(g.settings.layout); setRes({ width: g.settings.width, height: g.settings.height });
        const running = (await fetch('/api/sessions').then((r) => r.json()) as SessionStatus[]).find((s) => s.gameId === gameId && (s.state === 'running' || s.state === 'starting'));
        if (running && !dead) attach(running);
      } catch (e) { toast('error', (e as Error).message); }
    })();
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  const send = useCallback((ev: Parameters<SessionStream['send']>[0]) => streamRef.current?.send(ev), []);
  useEffect(() => { input.setSend(send as never); }, [input, send]);
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
        const c = canvas.current; if (!c) return;
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

  // client stats
  useEffect(() => {
    const t = window.setInterval(() => {
      const s = streamRef.current?.stats; if (!s) return;
      setClient({ fps: s.fps, rtt: s.rttMs, decode: s.decodeMs, kbps: Math.round((s.bytesPerSec * 8) / 1000) });
      setAudioInfo({ state: audio.stats.state, rms: audio.stats.rms, kbps: 0, buffered: audio.stats.bufferedMs });
    }, 1000);
    return () => window.clearInterval(t);
  }, []);

  // ---- input wiring: keyboard, focus loss, gamepad
  const live = state === 'running';
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

  useEffect(() => () => { streamRef.current?.close(); }, []);

  // ---- layout / scaling
  useEffect(() => {
    if (!stage.current) return;
    const ro = new ResizeObserver(([e]) => e && setBoxSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(stage.current);
    return () => ro.disconnect();
  }, []);
  const cssSize = useMemo(() => {
    const fit = Math.min(boxSize.w / frameSize.w, boxSize.h / frameSize.h);
    const k = scale === 'fit' ? fit : scale === 'int' ? Math.max(1, Math.floor(fit)) : Number(scale);
    const f = Math.max(0.1, k);
    return { w: Math.floor(frameSize.w * f), h: Math.floor(frameSize.h * f) };
  }, [boxSize, frameSize, scale]);

  const start = async () => {
    if (!game || busy) return;
    setBusy(true); setLog([]); setMenu(null); setPerm(null);
    void audio.resume(); // inside the click handler: allowed by autoplay policy
    try {
      const s = await api.startSession(game.id, { layout, ...(res ?? {}) });
      attach(s);
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

  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void shell.current?.requestFullscreen?.();
  };

  const pointer = (s: 'D' | 'M' | 'U') => (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!live) return;
    if (s === 'M' && e.buttons === 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.round(((e.clientX - r.left) / r.width) * frameSize.w);
    const y = Math.round(((e.clientY - r.top) / r.height) * frameSize.h);
    if (s === 'D') { try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ } }
    send({ t: 'pointer', id: 0, s, x, y });
  };

  const running = state === 'running' || state === 'starting' || state === 'stopping';
  const canStart = !!game && !running && !busy && health?.ok !== false;
  const diag = session?.diagnostics ?? [];
  const logDiag = log.filter((l) => l.startsWith('⚠'));
  const resKey = res ? `${res.width}x${res.height}` : '';
  const needRestart = running && res && session && (res.width !== session.width || res.height !== session.height);

  return (
    <div className={`player ${panel ? 'with-panel' : ''}`} ref={shell}>
      <section className="stage-col">
        <div className="stage-head">
          <button className="btn ghost" onClick={leave}>← Library</button>
          <div className="stage-title">
            <strong>{game?.name ?? '…'}</strong>
            <span className="muted">{title || game?.vendor}</span>
          </div>
          <span className="spacer" />
          <span className={`pill ${state === 'running' ? 'ok' : state === 'failed' ? 'warn' : ''}`}>{state === 'idle' ? 'stopped' : state}{conn === 'reconnecting' ? ' · reconnecting…' : ''}</span>
          <button className="btn ghost" onClick={fullscreen} aria-label="Toggle fullscreen">⛶</button>
          <button className="btn ghost panel-toggle" onClick={() => setPanel((p) => !p)} aria-label="Toggle panel" aria-pressed={panel}>☰</button>
        </div>

        <div className="stage" ref={stage}>
          <div className="phone-screen" style={{ width: cssSize.w, height: cssSize.h }}>
            <canvas
              ref={canvas}
              width={frameSize.w}
              height={frameSize.h}
              className={smooth ? 'smooth' : 'crisp'}
              style={{ width: '100%', height: '100%' }}
              onPointerDown={pointer('D')} onPointerMove={pointer('M')} onPointerUp={pointer('U')} onPointerCancel={pointer('U')}
              aria-label="Game screen"
            />
            {!running && (
              <div className="screen-overlay">
                {game && <h2>{game.name}</h2>}
                {state === 'failed' && <p className="error">The emulator stopped unexpectedly. See the log in the panel.</p>}
                {game && game.classVersion >= 49 ? <p className="error">Java 5+ class files are not supported.</p> : (
                  <button className="btn primary big" disabled={!canStart} onClick={start}>{busy ? 'Starting…' : state === 'idle' ? '▶ Start' : '▶ Start again'}</button>
                )}
                {health?.ok === false && <p className="error">Emulator runtime is not ready on this server.</p>}
              </div>
            )}
          </div>
        </div>

        <div className="softkeys">
          <button className="softkey" disabled={!live} onPointerDown={() => input.press('ui:sl', 'softLeft')} onPointerUp={() => input.release('ui:sl')} onPointerLeave={() => input.release('ui:sl')}>{softkeys.left || '—'}</button>
          <button className="softkey right" disabled={!live} onPointerDown={() => input.press('ui:sr', 'softRight')} onPointerUp={() => input.release('ui:sr')} onPointerLeave={() => input.release('ui:sr')}>{softkeys.right || '—'}</button>
        </div>
        {showKeypad && <Keypad press={(s, a) => input.press(s, a)} release={(s) => input.release(s)} softLeft={softkeys.left} softRight={softkeys.right} />}
      </section>

      {panel && (
        <aside className="panel" aria-label="Controls">
          <div className="panel-sec">
            <div className="btn-row">
              {!running ? <button className="btn primary grow" disabled={!canStart} onClick={start}>Start</button> : <button className="btn danger grow" onClick={stop} disabled={state === 'stopping'}>Stop</button>}
              {running && <button className="btn" onClick={async () => { await stop(); setTimeout(start, 400); }}>Restart</button>}
            </div>
          </div>

          <div className="panel-sec">
            <h4>Display</h4>
            <label className="field"><span>Resolution</span>
              <select className="select" value={SCREEN_PRESETS.some((p) => `${p.width}x${p.height}` === resKey) ? resKey : 'custom'} onChange={(e) => { const [w, h] = e.target.value.split('x').map(Number); if (w && h) setRes({ width: w, height: h }); }}>
                {SCREEN_PRESETS.map((p) => <option key={p.label} value={`${p.width}x${p.height}`}>{p.label}</option>)}
                {res && !SCREEN_PRESETS.some((p) => `${p.width}x${p.height}` === resKey) && <option value="custom">{res.width}×{res.height}</option>}
              </select>
            </label>
            {needRestart && <p className="note">Resolution changes apply after a restart.</p>}
            <label className="field"><span>Scale</span>
              <select className="select" value={scale} onChange={(e) => setScale(e.target.value as ScaleMode)}>
                <option value="fit">Fit window</option><option value="int">Integer fit</option><option value="1">1×</option><option value="2">2×</option><option value="3">3×</option>
              </select>
            </label>
            <label className="check"><input type="checkbox" checked={smooth} onChange={(e) => setSmooth(e.target.checked)} /> Smooth scaling</label>
          </div>

          <div className="panel-sec">
            <h4>Controls</h4>
            <label className="field"><span>Phone layout</span>
              <select className="select" value={layout} onChange={(e) => { input.releaseAll(); setLayout(e.target.value as LayoutId); }}>
                {Object.entries(KEY_LAYOUTS).map(([id, l]) => <option key={id} value={id}>{l.label}</option>)}
              </select>
            </label>
            <div className="btn-row">
              <button className="btn" onClick={() => setKeymap(true)}>Remap keys</button>
              <label className="check"><input type="checkbox" checked={showKeypad} onChange={(e) => setShowKeypad(e.target.checked)} /> On-screen keypad</label>
            </div>
            <p className="muted small">Arrows · Enter = OK · Q/W = soft keys · 0–9 · X = * · Z = #{pad ? ` · gamepad: ${pad.slice(0, 28)}` : ''}</p>
          </div>

          <div className="panel-sec">
            <h4>Audio</h4>
            <label className="field"><span>Volume</span><input type="range" min={0} max={100} value={vol} onChange={(e) => setVol(Number(e.target.value))} aria-label="Volume" /></label>
            <label className="check"><input type="checkbox" checked={muted} onChange={(e) => setMuted(e.target.checked)} /> Mute</label>
            {audioInfo.state !== 'running' && running && <p className="note">Sound is waiting for a click or key press (browser autoplay policy).</p>}
            <p className="muted small" data-testid="audio-status" data-audio-state={audioInfo.state} data-audio-rms={audioInfo.rms.toFixed(4)}>
              {audioInfo.state === 'running' ? `output ${audioInfo.rms > 0.0005 ? 'active' : 'idle'} · level ${(audioInfo.rms * 100).toFixed(1)}% · buffer ${audioInfo.buffered} ms` : `audio ${audioInfo.state}`}
            </p>
          </div>

          <div className="panel-sec">
            <h4>Diagnostics</h4>
            <dl className="stats">
              <dt>Display FPS</dt><dd>{client.fps.toFixed(1)}</dd>
              <dt>Emulator FPS</dt><dd>{server.fps.toFixed(1)}</dd>
              <dt>Round trip</dt><dd>{client.rtt ?? '—'} ms</dd>
              <dt>Adapter→API</dt><dd>{server.latencyMs === null ? '—' : `${server.latencyMs.toFixed(0)} ms`}</dd>
              <dt>Decode</dt><dd>{client.decode} ms</dd>
              <dt>Bandwidth</dt><dd>{client.kbps} kbit/s</dd>
              <dt>Dropped</dt><dd>{server.dropped}</dd>
              <dt>Frame</dt><dd>{frameSize.w}×{frameSize.h} · {session?.encoding ?? '—'}</dd>
            </dl>
            {[...new Set([...diag, ...logDiag.map((l) => l.slice(2))])].map((d) => <p className="note warn" key={d}>{d}</p>)}
            <details>
              <summary>Emulator log ({log.length})</summary>
              <pre className="log" tabIndex={0}>{log.slice(-120).join('\n')}</pre>
            </details>
          </div>
        </aside>
      )}

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
