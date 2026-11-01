import { inflateSync } from 'node:zlib';

/**
 * A small PNG decoder for what EKA2L1's `/v1/screenshot` returns: 8-bit RGBA, no interlacing (it writes IHDR with colour type 6
 * itself). Anything else is refused instead of guessed. Filters 0-4 are handled; checksums are not verified (the data comes from our
 * own container, and a bad frame only costs one frame).
 */
export interface Rgba { width: number; height: number; data: Buffer }

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const MAX_PIXELS = 2048 * 2048;

export function decodePng(png: Buffer): Rgba {
  if (png.length < 33 || !png.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');
  let off = 8;
  let width = 0, height = 0, depth = 0, color = -1, interlace = 0;
  const idat: Buffer[] = [];
  while (off + 8 <= png.length) {
    const len = png.readUInt32BE(off);
    const type = png.toString('latin1', off + 4, off + 8);
    const body = png.subarray(off + 8, off + 8 + len);
    if (body.length < len) throw new Error('truncated PNG');
    if (type === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      depth = body[8]!; color = body[9]!; interlace = body[12]!;
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (!width || !height) throw new Error('PNG without a header');
  if (width * height > MAX_PIXELS) throw new Error('PNG too large');
  if (depth !== 8 || (color !== 6 && color !== 2) || interlace !== 0) throw new Error(`unsupported PNG (depth ${depth}, colour type ${color}, interlace ${interlace})`);
  const bpp = color === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length < (stride + 1) * height) throw new Error('PNG data too short');
  const out = Buffer.alloc(width * height * 4);
  const prev = Buffer.alloc(stride);
  const cur = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]!;
    raw.copy(cur, 0, y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp]! : 0;
      const b = prev[i]!;
      const c = i >= bpp ? prev[i - bpp]! : 0;
      let v = cur[i]!;
      switch (f) {
        case 0: break;
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: {
          const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
        default: throw new Error(`bad PNG filter ${f}`);
      }
      cur[i] = v & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const s = x * bpp, d = (y * width + x) * 4;
      out[d] = cur[s]!; out[d + 1] = cur[s + 1]!; out[d + 2] = cur[s + 2]!;
      out[d + 3] = bpp === 4 ? cur[s + 3]! : 255;
    }
    cur.copy(prev);
  }
  return { width, height, data: out };
}
