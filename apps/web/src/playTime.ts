/** Splits seconds of play into what the card shows: nothing, "less than a minute", or hours and minutes. */
export type PlayTime = { kind: 'none' } | { kind: 'short' } | { kind: 'time'; h: number; m: number };

export function splitPlayTime(seconds: number | undefined): PlayTime {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return { kind: 'none' };
  const min = Math.floor(seconds / 60);
  if (min < 1) return { kind: 'short' };
  return { kind: 'time', h: Math.floor(min / 60), m: min % 60 };
}
