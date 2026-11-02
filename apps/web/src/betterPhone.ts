import { PHONE_SKIN_IDS, skinSupportsPlatform, type GamePlatform, type PackageFormat, type PhoneSkinId } from '@mgo/protocol';

export interface PhoneOption { id: string; label: string; width: number; height: number }

/**
 * A phone that shows this game better than the current one, or null. "Better" is only ever about the picture (the resolution):
 *  - a Java ME game that names the screen it was made for: a phone with exactly that screen;
 *  - a Symbian / N-Gage game: a phone that can run it (its kind, its package generation, firmware installed) with a larger screen.
 * `options` are the phones to choose from (the owner's phones, or all of them); a phone that cannot run the game is never offered.
 */
export function betterPhone(input: {
  platform: GamePlatform;
  packageFormat?: PackageFormat | undefined;
  current: string | null;
  options: readonly PhoneOption[];
  /** Java ME: the screen the game was made for. */
  wanted?: { width: number; height: number } | null;
  /** Native games: has this phone a firmware installed that runs the game? */
  hasFirmware?: (id: PhoneSkinId) => boolean;
}): PhoneOption | null {
  const cur = input.options.find((o) => o.id === input.current);
  if (!cur) return null;
  if (input.platform === 'j2me') {
    const w = input.wanted;
    if (!w || (cur.width === w.width && cur.height === w.height)) return null;
    return input.options.find((o) => o.width === w.width && o.height === w.height) ?? null;
  }
  const runs = (o: PhoneOption) => (PHONE_SKIN_IDS as readonly string[]).includes(o.id) && skinSupportsPlatform(o.id as PhoneSkinId, input.platform, input.packageFormat) && (input.hasFirmware?.(o.id as PhoneSkinId) ?? true);
  let best: PhoneOption | null = null;
  for (const o of input.options) {
    if (o.id === cur.id || !runs(o)) continue;
    if (o.width * o.height <= cur.width * cur.height) continue;
    if (!best || o.width * o.height > best.width * best.height) best = o;
  }
  return best;
}
