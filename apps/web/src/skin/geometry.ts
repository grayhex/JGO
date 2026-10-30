import type { Rect, SkinView } from './types';

export type Point = [number, number];

/** Ray casting; boundary points count as inside on a best-effort basis. */
export function pointInPolygon(p: Point, poly: Point[]): boolean {
  const [x, y] = p;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function hitTest<T extends { points: Point[] }>(boxes: T[], x: number, y: number): T | null {
  for (const b of boxes) if (pointInPolygon([x, y], b.points)) return b;
  return null;
}

/** Largest box with the given aspect ratio (w/h) that fits in avail. */
export function fitBox(avail: { w: number; h: number }, aspect: number): { w: number; h: number } {
  if (avail.w <= 0 || avail.h <= 0 || !(aspect > 0)) return { w: 0, h: 0 };
  const w = Math.min(avail.w, avail.h * aspect);
  return { w, h: w / aspect };
}

export interface Placement {
  /** CSS pixels, relative to the skin box. */
  lcd: { left: number; top: number; width: number; height: number };
  canvas: { left: number; top: number; width: number; height: number };
  /** Canvas pixels per framebuffer pixel. */
  scale: number;
}

/**
 * Puts a w x h framebuffer into the view's display window without stretching it (contain + centre).
 * `integer` snaps the scale down to a whole number when that does not shrink the picture by more than a quarter.
 */
export function placeScreen(view: Pick<SkinView, 'screenRect'>, box: { w: number; h: number }, frame: { w: number; h: number }, integer: boolean): Placement {
  const r: Rect = view.screenRect;
  const lcd = { left: r.x * box.w, top: r.y * box.h, width: r.width * box.w, height: r.height * box.h };
  if (frame.w <= 0 || frame.h <= 0 || lcd.width <= 0 || lcd.height <= 0) return { lcd, canvas: { left: lcd.left, top: lcd.top, width: 0, height: 0 }, scale: 0 };
  let scale = Math.min(lcd.width / frame.w, lcd.height / frame.h);
  if (integer && scale >= 1) {
    const whole = Math.floor(scale);
    if (whole >= scale * 0.75) scale = whole;
  }
  const width = frame.w * scale;
  const height = frame.h * scale;
  return { lcd, canvas: { left: lcd.left + (lcd.width - width) / 2, top: lcd.top + (lcd.height - height) / 2, width, height }, scale };
}

/** Pointer position on the skin box to normalised coordinates (0..1), or null for a degenerate box. */
export function toNormalized(clientX: number, clientY: number, box: { left: number; top: number; width: number; height: number }): Point | null {
  if (box.width <= 0 || box.height <= 0) return null;
  return [(clientX - box.left) / box.width, (clientY - box.top) / box.height];
}

/** Presentation-only turn of the picture, clockwise degrees. The emulated framebuffer is never changed. */
export type Rotation = 0 | 90 | 180 | 270;
export const ROTATIONS: Rotation[] = [0, 90, 180, 270];
export const nextRotation = (r: Rotation): Rotation => ROTATIONS[(ROTATIONS.indexOf(r) + 1) % 4]!;

/**
 * Like `placeScreen`, for a picture that is turned by `rotation`. The returned `canvas` box is the element's own
 * (unturned) box, centred where the turned picture sits, so that `transform: rotate()` lands it in the window.
 * `visual` is the box the picture occupies on screen.
 */
export function placeRotated(view: Pick<SkinView, 'screenRect'>, box: { w: number; h: number }, frame: { w: number; h: number }, integer: boolean, rotation: Rotation): Placement & { visual: Placement['canvas'] } {
  const sideways = rotation === 90 || rotation === 270;
  const p = placeScreen(view, box, sideways ? { w: frame.h, h: frame.w } : frame, integer);
  if (!sideways) return { ...p, visual: p.canvas };
  const cx = p.canvas.left + p.canvas.width / 2;
  const cy = p.canvas.top + p.canvas.height / 2;
  const width = p.canvas.height;
  const height = p.canvas.width;
  return { ...p, canvas: { left: cx - width / 2, top: cy - height / 2, width, height }, visual: p.canvas };
}

/** A point on the turned picture, as fractions (0..1) of its on-screen box, to fractions of the framebuffer. */
export function unrotatePoint(u: number, v: number, rotation: Rotation): Point {
  if (rotation === 90) return [v, 1 - u];
  if (rotation === 180) return [1 - u, 1 - v];
  if (rotation === 270) return [1 - v, u];
  return [u, v];
}
