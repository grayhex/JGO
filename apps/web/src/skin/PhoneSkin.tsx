import { t as translateUI } from '../i18n';
import { useCallback, useEffect, useMemo, useRef, useState, type CanvasHTMLAttributes, type ReactNode, type Ref } from 'react';
import type { InputController } from '../input';
import { buzz } from '../serverSettings';
import { fitBox, hitTest, placeRotated, toNormalized, type Rotation } from './geometry';
import { polygonPath } from './hitboxes';
import type { Hitbox, LoadedSkin, SkinViewId } from './types';
import { useHeld } from './useHeld';

export interface SkinDebug { screen?: boolean; hitboxes?: boolean; labels?: boolean }

export interface PhoneSkinProps {
  skin: LoadedSkin;
  view: SkinViewId;
  /** Size of the emulated framebuffer. Never stretched: the picture is centred in the display window with margins. */
  frame: { w: number; h: number };
  /** Turns the picture inside the display window (presentation only). */
  rotation?: Rotation;
  canvasRef?: Ref<HTMLCanvasElement>;
  canvasProps?: CanvasHTMLAttributes<HTMLCanvasElement>;
  /** Snap the framebuffer scale to whole numbers when that costs less than a quarter of the size. */
  integer?: boolean;
  smooth?: boolean;
  /** Receives presses from the physical keys of the body (full view only). */
  input?: InputController;
  /** Hitboxes ignore the pointer while false (nothing is running). */
  interactive?: boolean;
  /** Fires for every press of a body key, including keys with no J2ME binding (action null). Used by /phones. */
  onKey?: (e: { id: string; label: string; action: string | null; phase: 'down' | 'up' }) => void;
  /** Content shown inside the display window (start button, messages). */
  lcdOverlay?: ReactNode;
  debug?: SkinDebug;
  /** Fixed outer box in CSS pixels; without it the skin fills its parent. */
  size?: { w?: number; h?: number };
  className?: string;
  /** Show the optional glass layer (it is empty in all current sets). */
  glass?: boolean;
}

function useBox(ref: React.RefObject<HTMLElement | null>, enabled: boolean): { w: number; h: number } {
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const ro = new ResizeObserver(([e]) => e && setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, enabled]);
  return box;
}

const centroid = (h: Hitbox): [number, number] => [h.points.reduce((a, p) => a + p[0], 0) / h.points.length, h.points.reduce((a, p) => a + p[1], 0) / h.points.length];

/**
 * One handset: body picture over a live canvas, optional glass, SVG hitboxes on top.
 * Stacking (bottom to top): display backplate, Canvas (real KEmulator framebuffer), body (transparent window),
 * glass, hitboxes. The body ignores the pointer so the canvas keeps receiving game pointer events through the window.
 */
export function PhoneSkin({ skin, view, frame, rotation = 0, canvasRef, canvasProps, integer = true, smooth = false, input, interactive = true, onKey, lcdOverlay, debug, size, className = '', glass = true }: PhoneSkinProps) {
  const fit = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const parent = useBox(fit, !size?.w || !size?.h);
  const v = skin.config.views[view];
  const outer = { w: size?.w ?? parent.w, h: size?.h ?? parent.h };
  const dim = useMemo(() => fitBox(outer, v.width / v.height), [outer.w, outer.h, v.width, v.height]); // eslint-disable-line react-hooks/exhaustive-deps
  const place = useMemo(() => placeRotated(v, dim, frame, integer, rotation), [v, dim, frame, integer, rotation]);
  const physical = view === 'full' && v.controls === 'buttons';

  // --- hitboxes: pointer id -> hitbox id; every pointer is its own input source
  const tracked = useRef(new Map<number, { id: string; label: string; action: string | null; source: string }>());
  const dragging = useRef(new Set<number>()); // pointers that went down on a key and are still pressed: they may slide across gaps onto other keys
  const [local, setLocal] = useState<Set<string>>(() => new Set());
  const held = useHeld(input);
  const boxes = skin.hitboxes;

  // The handlers read the latest props through a ref, so their identity never changes: a re-render must not release a held key.
  const live = useRef({ input, onKey, skinId: skin.config.id });
  live.current = { input, onKey, skinId: skin.config.id };
  const syncLocal = useCallback(() => setLocal(new Set([...tracked.current.values()].map((t) => t.id))), []);

  const down = useCallback((pointer: number, h: Hitbox) => {
    const { input: inp, onKey: cb, skinId } = live.current;
    const source = `skin:${skinId}:${h.id}:${pointer}`;
    tracked.current.set(pointer, { id: h.id, label: h.label, action: h.action, source });
    if (h.action) inp?.press(source, h.action);
    cb?.({ id: h.id, label: h.label, action: h.action, phase: 'down' });
    syncLocal();
  }, [syncLocal]);

  const up = useCallback((pointer: number) => {
    const t = tracked.current.get(pointer);
    if (!t) return;
    tracked.current.delete(pointer);
    const { input: inp, onKey: cb } = live.current;
    if (t.action) inp?.release(t.source);
    cb?.({ id: t.id, label: t.label, action: t.action, phase: 'up' });
    syncLocal();
  }, [syncLocal]);

  const releaseLocal = useCallback(() => { dragging.current.clear(); for (const p of [...tracked.current.keys()]) up(p); }, [up]);

  const hit = (e: React.PointerEvent): Hitbox | null => {
    const el = box.current;
    if (!el) return null;
    const n = toNormalized(e.clientX, e.clientY, el.getBoundingClientRect());
    return n ? hitTest(boxes, n[0], n[1]) : null;
  };

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!physical || !interactive || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const h = hit(e);
    if (!h) return;
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic or already released pointer */ }
    dragging.current.add(e.pointerId);
    down(e.pointerId, h);
    if (e.pointerType === 'touch') buzz(8);
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current.has(e.pointerId)) return;
    const cur = tracked.current.get(e.pointerId);
    const h = hit(e);
    if (h?.id === cur?.id) return;
    if (cur) up(e.pointerId); // sliding off a key releases it, onto another key presses that one
    if (h) down(e.pointerId, h);
  };
  const onUp = (e: React.PointerEvent<HTMLDivElement>) => { dragging.current.delete(e.pointerId); up(e.pointerId); };

  // everything held through the body is released when the picture changes, the window loses focus or the component goes away
  useEffect(() => {
    window.addEventListener('blur', releaseLocal);
    const vis = () => { if (document.hidden) releaseLocal(); };
    document.addEventListener('visibilitychange', vis);
    return () => { window.removeEventListener('blur', releaseLocal); document.removeEventListener('visibilitychange', vis); releaseLocal(); };
  }, [releaseLocal]);
  useEffect(() => { releaseLocal(); }, [skin.config.id, view, interactive]); // eslint-disable-line react-hooks/exhaustive-deps

  const pressed = useMemo(() => {
    const s = new Set(local);
    if (physical) for (const b of boxes) if (b.action && held.has(b.action)) s.add(b.id);
    return s;
  }, [local, held, boxes, physical]);

  const crisp = !smooth && place.scale >= 1.5;
  const url = (f: string) => `${skin.base}${f}`;
  const ready = dim.w > 0 && dim.h > 0;
  const c = skin.config;

  return (
    <div ref={fit} className={`skin-fit ${className}`} style={size?.w && size?.h ? { width: size.w, height: size.h } : undefined}>
      {ready && (
        <div
          ref={box}
          className={`skin-box view-${view} ${physical ? 'has-keys' : ''}`}
          style={{ width: dim.w, height: dim.h }}
          role="group"
          aria-label={translateUI(`${c.manufacturer} ${c.model}, ${view === 'full' ? 'full phone' : 'screen close-up'}`)}
          data-skin={c.id}
          data-view={view}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onLostPointerCapture={onUp}
          onContextMenu={(e) => { if (physical) e.preventDefault(); }}
        >
          <div className="skin-lcd" style={{ left: place.lcd.left, top: place.lcd.top, width: place.lcd.width, height: place.lcd.height }} data-testid="skin-lcd">
            <canvas
              {...canvasProps}
              ref={canvasRef}
              width={frame.w}
              height={frame.h}
              className={`skin-canvas ${crisp ? 'crisp' : 'smooth'}`}
              style={{ left: place.canvas.left - place.lcd.left, top: place.canvas.top - place.lcd.top, width: place.canvas.width, height: place.canvas.height, ...(rotation ? { transform: `rotate(${rotation}deg)` } : {}) }}
              data-rotation={rotation}
              aria-label={translateUI("Game screen")}
              data-scale={place.scale.toFixed(3)}
            />
            {lcdOverlay && <div className="skin-lcd-overlay">{lcdOverlay}</div>}
          </div>
          <img className="skin-body" src={url(v.body)} alt="" draggable={false} decoding="async" />
          {glass && v.glass && <img className="skin-glass" src={url(v.glass)} alt="" draggable={false} decoding="async" />}
          {physical && (
            <svg className="skin-hit" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
              {boxes.map((b) => (
                <polygon key={b.id} points={polygonPath(b.points)} data-key={b.id} data-action={b.action ?? ''} className={`${pressed.has(b.id) ? 'pressed' : ''} ${b.action ? '' : 'unbound'} ${debug?.hitboxes ? 'debug' : ''}`}>
                  <title>{translateUI(b.action ? b.label : `${b.label} (no J2ME binding)`)}</title>
                </polygon>
              ))}
            </svg>
          )}
          {debug?.screen && <div className="skin-debug-rect" style={{ left: place.lcd.left, top: place.lcd.top, width: place.lcd.width, height: place.lcd.height }} />}
          {physical && debug?.labels && boxes.map((b) => {
            const [cx, cy] = centroid(b);
            return <span key={b.id} className="skin-debug-label" style={{ left: `${cx * 100}%`, top: `${cy * 100}%` }}>{b.id}</span>;
          })}
        </div>
      )}
    </div>
  );
}
