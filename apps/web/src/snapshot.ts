import type { Rotation } from './skin/geometry';

/** PNG of the game's frame at its own size (not the window's), turned like the picture on screen. */
export function framePng(canvas: HTMLCanvasElement, rotation: Rotation = 0): Promise<Blob> {
  const turned = rotation === 90 || rotation === 270;
  const out = document.createElement('canvas');
  out.width = turned ? canvas.height : canvas.width;
  out.height = turned ? canvas.width : canvas.height;
  const g = out.getContext('2d')!;
  g.translate(out.width / 2, out.height / 2);
  g.rotate((rotation * Math.PI) / 180);
  g.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return new Promise((res, rej) => out.toBlob((b) => (b ? res(b) : rej(new Error('The picture could not be encoded'))), 'image/png'));
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const fileSafe = (s: string): string => s.replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'game';
