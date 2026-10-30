/** Cheap, dependency-free frame statistics used by the lab to tell "alive" pictures from dead ones. */
export interface FrameStats {
  /** FNV-1a hash of every 7th pixel: equal pictures give equal hashes. */
  hash: number;
  /** Share of pixels equal to the most common colour (0..1). */
  dominantShare: number;
  /** Number of distinct colours in a 1/16 sample, capped at 4096. */
  colors: number;
  /** Share of pixels brighter than near-black (0..1). */
  litShare: number;
}

export function frameStats(rgba: Uint8Array): FrameStats {
  let h = 0x811c9dc5;
  const counts = new Map<number, number>();
  const sampled = new Set<number>();
  let lit = 0, n = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const px = (rgba[i]! << 16) | (rgba[i + 1]! << 8) | rgba[i + 2]!;
    const idx = i >> 2;
    if (idx % 7 === 0) h = Math.imul(h ^ px, 0x01000193) >>> 0;
    if (idx % 16 === 0) {
      counts.set(px, (counts.get(px) ?? 0) + 1);
      if (sampled.size < 4096) sampled.add(px);
      n++;
      if (rgba[i]! > 24 || rgba[i + 1]! > 24 || rgba[i + 2]! > 24) lit++;
    }
  }
  let max = 0;
  for (const c of counts.values()) if (c > max) max = c;
  return { hash: h, dominantShare: n ? max / n : 1, colors: sampled.size, litShare: n ? lit / n : 0 };
}
