import { GAME_PLATFORM_LABELS, type GamePlatform } from '@mgo/protocol';

/** Square cover art (phones, settings, wizard) and the wide plate used on library cards. Both come from the MGO graphics kit. */
const COVER: Record<GamePlatform, string> = { j2me: 'java-j2me', symbian: 'symbian-s60-3rd', ngage: 'n-gage', ngage2: 'n-gage-2' };
const BANNER: Record<GamePlatform, { file: string; ratio: number }> = {
  j2me: { file: 'java', ratio: 202 / 84 }, symbian: { file: 'symbian', ratio: 280 / 84 }, ngage: { file: 'ngage', ratio: 273 / 84 }, ngage2: { file: 'ngage2', ratio: 263 / 84 },
};
const SHORT: Record<GamePlatform, string> = { j2me: 'Java ME', symbian: 'Symbian S60', ngage: 'N-Gage', ngage2: 'N-Gage 2.0' };

export const platformName = (p: GamePlatform) => SHORT[p];

/** The platform as a picture. The text is the accessible name and the tooltip, so nothing is lost for a screen reader. */
export function PlatformIcon({ platform, variant = 'cover', size = 40, className = '' }: { platform: GamePlatform; variant?: 'cover' | 'banner'; size?: number; className?: string }) {
  const label = GAME_PLATFORM_LABELS[platform];
  if (variant === 'banner') {
    const b = BANNER[platform];
    return <img className={`platform-icon banner ${className}`} src={`/graphics/platforms/banner-${b.file}.png`} alt={label} title={label} height={size} width={Math.round(size * b.ratio)} loading="lazy" data-platform={platform} />;
  }
  return <img className={`platform-icon cover ${className}`} src={`/graphics/platforms/${COVER[platform]}.svg`} alt={label} title={label} width={size} height={size} data-platform={platform} />;
}
