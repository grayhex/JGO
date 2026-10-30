import { KEY_LAYOUTS, type LayoutId } from '@j2me-web/protocol';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { SkinStatus } from '../components/SkinPicker';
import { Seg, Switch } from '../components/ui';
import { codeFor, InputController, type Action } from '../input';
import { PhoneSkin } from '../skin/PhoneSkin';
import { useCatalog } from '../skin/registry';
import type { LoadedSkin } from '../skin/types';

type Bg = 'light' | 'dark' | 'checker';
interface Manifest { checked_at: string; phase: string; images: { model: string; visually_reviewed: boolean; redistribution_permission: string }[] }
interface LogLine { n: number; text: string }

function useManifest(): Manifest | null {
  const [m, setM] = useState<Manifest | null>(null);
  useEffect(() => {
    let dead = false;
    fetch('/phones/reference-manifest.json').then((r) => (r.ok ? r.json() : null)).then((j) => { if (!dead) setM(j); }, () => undefined);
    return () => { dead = true; };
  }, []);
  return m;
}

/** An alignment pattern for the display window. It is a ruler, not a game or menu image. */
function drawPattern(c: HTMLCanvasElement, label: string): void {
  const g = c.getContext('2d');
  if (!g) return;
  const { width: w, height: h } = c;
  g.fillStyle = '#141a17'; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 1;
  const step = Math.max(8, Math.round(Math.min(w, h) / 8));
  for (let x = 0; x <= w; x += step) { g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, h); g.stroke(); }
  for (let y = 0; y <= h; y += step) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(w, y + 0.5); g.stroke(); }
  g.strokeStyle = '#fe6e00'; g.lineWidth = 2; g.strokeRect(1, 1, w - 2, h - 2);
  g.beginPath(); g.moveTo(0, 0); g.lineTo(w, h); g.moveTo(w, 0); g.lineTo(0, h); g.strokeStyle = 'rgba(254,110,0,0.55)'; g.lineWidth = 1; g.stroke();
  const s = Math.max(8, Math.round(w / 14));
  g.fillStyle = '#ff0000'; g.fillRect(0, 0, s, s);
  g.fillStyle = '#00cc44'; g.fillRect(w - s, 0, s, s);
  g.fillStyle = '#3080ff'; g.fillRect(0, h - s, s, s);
  g.fillStyle = '#ffd000'; g.fillRect(w - s, h - s, s, s);
  g.fillStyle = '#fff'; g.font = `600 ${Math.max(9, Math.round(w / 12))}px ui-monospace, monospace`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(`${w}×${h}`, w / 2, h / 2 - 6); g.font = `${Math.max(8, Math.round(w / 18))}px ui-monospace, monospace`; g.fillText(label, w / 2, h / 2 + Math.max(10, w / 10));
}

function PatternCanvasHost({ w, h, label, on, children }: { w: number; h: number; label: string; on: boolean; children: (ref: (el: HTMLCanvasElement | null) => void) => React.ReactNode }) {
  const el = useRef<HTMLCanvasElement | null>(null);
  const paint = () => { if (el.current) { if (on) drawPattern(el.current, label); else { const g = el.current.getContext('2d'); if (g) { g.fillStyle = '#0b100e'; g.fillRect(0, 0, el.current.width, el.current.height); } } } };
  useEffect(paint); // eslint-disable-line react-hooks/exhaustive-deps
  return <>{children((c) => { el.current = c; paint(); })}</>;
}

function PhoneCard({ skin, bg, dbg, pattern, input, layout, onKey }: { skin: LoadedSkin; bg: Bg; dbg: { screen: boolean; hitboxes: boolean; labels: boolean }; pattern: boolean; input: InputController; layout: LayoutId; onKey: (e: { id: string; label: string; action: string | null; phase: 'down' | 'up' }, model: string) => void }) {
  const c = skin.config;
  const manifest = useManifest();
  const refs = manifest?.images.filter((i) => i.model === c.id) ?? [];
  const bound = skin.hitboxes.filter((h) => h.action);
  const unbound = skin.hitboxes.filter((h) => !h.action);
  const sd = skin.config.views.screen;
  return (
    <article className={`card phone-card phones-bg-${bg}`} data-testid={`phone-${c.id}`} aria-label={`${c.manufacturer} ${c.model}`}>
      <header>
        <h2>{c.manufacturer} {c.model}</h2>
        <SkinStatus status={c.status} />
        <span className="badge">{c.year}</span>
        <span className="badge" title="Real display resolution of the handset">{c.screen.width}×{c.screen.height}</span>
      </header>
      <p className="muted small">{c.variant}</p>

      <div className="phone-views">
        {(['full', 'screen'] as const).map((view) => (
          <figure className="phone-view" key={view}>
            <figcaption className="label-caps">{view === 'full' ? 'views.full — whole phone' : 'views.screen — enlarged top'} · {c.views[view].width}×{c.views[view].height}</figcaption>
            <div className="phone-surface">
              <PatternCanvasHost w={c.screen.width} h={c.screen.height} label={`${c.model} · ${view}`} on={pattern}>
                {(ref) => (
                  <PhoneSkin skin={skin} view={view} frame={{ w: c.screen.width, h: c.screen.height }} canvasRef={ref} integer={false} input={view === 'full' ? input : undefined}
                    size={view === 'full' ? { w: 300, h: Math.min(520, 300 / (c.views.full.width / c.views.full.height)) } : { w: 340, h: Math.min(340, 340 / (sd.width / sd.height)) }}
                    debug={dbg} onKey={(e) => onKey(e, c.id)} />
                )}
              </PatternCanvasHost>
            </div>
          </figure>
        ))}
      </div>

      <div className="phone-meta">
        <div className="disclaimer">
          <span className="label-caps">Status</span>
          <p className="small">Generated illustration, <b>review draft</b>. Alignment and hitboxes are machine-checked; historical accuracy of the shape, legends and materials is <b>not</b> confirmed. {refs.length > 0 && <>The research list has {refs.length} images ({refs.filter((r) => r.visually_reviewed).length} viewed); permission to redistribute them is not established, so none is stored here. </>}Independence of the references is still open — see <a href={`/phones/${c.id}/references.md`} target="_blank" rel="noreferrer">references.md</a>.</p>
          {c.notes.map((n) => <p className="hint" key={n}>{n}</p>)}
          {skin.warnings.map((w) => <p className="note warn" key={w}>{w}</p>)}
        </div>
        <div className="disclaimer">
          <span className="label-caps">Keys: {bound.length} bound · {unbound.length} without a J2ME binding</span>
          <p className="hint">A key without a binding is drawn and clickable but sends nothing; no code is invented for it.</p>
          <details>
            <summary className="small">Bindings ({KEY_LAYOUTS[layout].label})</summary>
            <div className="table-wrap"><table className="table compact">
              <thead><tr><th>Key</th><th>Action</th><th>J2ME code</th></tr></thead>
              <tbody>{skin.hitboxes.map((h) => <tr key={h.id}><td>{h.label}</td><td>{h.action ? <span className="bind">{h.action}</span> : <span className="bind none">none</span>}</td><td className="mono">{h.action ? codeFor(h.action as Action, layout) : '—'}</td></tr>)}</tbody>
            </table></div>
          </details>
        </div>
      </div>
    </article>
  );
}

export function PhonesPage() {
  const { skins, error } = useCatalog();
  const [bg, setBg] = useState<Bg>('light');
  const [only, setOnly] = useState('all');
  const [dbg, setDbg] = useState({ screen: true, hitboxes: false, labels: false });
  const [pattern, setPattern] = useState(true);
  const [layout, setLayout] = useState<LayoutId>('nokia');
  const [lines, setLines] = useState<LogLine[]>([]);
  const seq = useRef(0);
  const input = useMemo(() => new InputController(() => undefined), []);
  input.layout = layout;

  const say = (text: string) => setLines((l) => [...l.slice(-60), { n: ++seq.current, text }]);
  useEffect(() => {
    input.enabled = true;
    input.setSend((ev) => { if (ev.t === 'key') say(`${ev.s === 'D' ? 'DOWN' : 'UP  '} J2ME key code ${ev.code}`); else say('RELEASE ALL'); });
    return () => input.releaseAll();
  }, [input]); // eslint-disable-line react-hooks/exhaustive-deps

  const log = useRef<HTMLDivElement>(null);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }); }, [lines]);

  const shown = (skins ?? []).filter((s) => only === 'all' || s.config.id === only);

  return (
    <div className={`phones phones-bg-${bg}`}>
      <div className="page-head">
        <div>
          <h1>Phone lab</h1>
          <p>All five handsets, both views, with their display windows and hitboxes. Use it to check alignment on light and dark backgrounds.</p>
        </div>
      </div>

      <div className="note warn disclaimer" style={{ marginBottom: 'var(--s-xl)' }}>
        <b>Review drafts.</b> These are original generated illustrations informed by photographs; they are not manufacturer artwork. Passing the technical checks (transparent display window, exact proportions, non-overlapping polygons) does not certify historical accuracy. The skin is a picture only: it never changes the emulated device, resolution or key codes.
      </div>

      <div className="card phones-toolbar">
        <div className="group"><span className="label-caps">Model</span>
          <select className="select compact" aria-label="Model filter" value={only} onChange={(e) => setOnly(e.target.value)}>
            <option value="all">All five</option>
            {(skins ?? []).map((s) => <option key={s.config.id} value={s.config.id}>{s.config.manufacturer} {s.config.model}</option>)}
          </select>
        </div>
        <div className="group"><span className="label-caps">Background</span>
          <Seg<Bg> label="Background" value={bg} onChange={setBg} options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'checker', label: 'Checker' }]} />
        </div>
        <div className="group">
          <Switch checked={dbg.screen} onChange={(screen) => setDbg({ ...dbg, screen })}>Display window</Switch>
          <Switch checked={dbg.hitboxes} onChange={(hitboxes) => setDbg({ ...dbg, hitboxes })}>Hitboxes</Switch>
          <Switch checked={dbg.labels} onChange={(labels) => setDbg({ ...dbg, labels })}>Key ids</Switch>
          <Switch checked={pattern} onChange={setPattern}>Test pattern</Switch>
        </div>
        <div className="group"><span className="label-caps">Key codes</span>
          <select className="select compact" aria-label="Key layout" value={layout} onChange={(e) => setLayout(e.target.value as LayoutId)}>
            {Object.entries(KEY_LAYOUTS).map(([id, l]) => <option key={id} value={id}>{l.label}</option>)}
          </select>
        </div>
      </div>

      <div className="card card-pad" style={{ marginBottom: 'var(--s-xl)', display: 'grid', gap: 8 }}>
        <div className="statline"><span className="label-caps"><Icon name="gamepad" /> Press the keys on any phone</span><button className="btn ghost sm" onClick={() => setLines([])}>Clear</button></div>
        <div className="event-log" ref={log} data-testid="key-log" aria-live="off">{lines.length ? lines.map((l) => <div key={l.n}>{l.text}</div>) : <span className="muted">Hold, slide, press several keys with several fingers; every press and release is listed here.</span>}</div>
      </div>

      {error && <div className="note err">Could not load the skins: {error}</div>}
      {skins === null && !error && <p className="muted">Loading the five phones…</p>}
      <div className="phones-grid">
        {shown.map((s) => <PhoneCard key={s.config.id} skin={s} bg={bg} dbg={dbg} pattern={pattern} input={input} layout={layout} onKey={(e, model) => say(`${model} · ${e.phase === 'down' ? 'press  ' : 'release'} ${e.label}${e.action ? ` → ${e.action}` : ' → (no J2ME binding, nothing sent)'}`)} />)}
      </div>
    </div>
  );
}
