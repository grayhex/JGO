import type { ReactNode } from 'react';
import { GAME_PLATFORM_LABELS, type GamePlatform } from '@mgo/protocol';

/** Short names for tags; the full name (also what a screen reader says) is the platform's label. */
const SHORT: Record<GamePlatform, string> = { j2me: 'Java ME', symbian: 'Symbian', ngage: 'N-Gage', ngage2: 'N-Gage 2.0' };
export const platformName = (p: GamePlatform) => SHORT[p];

/** A small drawing for each platform, in the platform's colour (CSS `--plat`). Drawn with strokes so it stays legible at 14-16 px. */
export function PlatformGlyph({ platform, size = 16 }: { platform: GamePlatform; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false } as const;
  switch (platform) {
    case 'j2me': // a cup of coffee
      return <svg {...common} className="pglyph"><path d="M5 10h11v3.5A4.5 4.5 0 0 1 11.5 18h-2A4.5 4.5 0 0 1 5 13.5z" /><path d="M16 11h1.5a2 2 0 0 1 0 4H16" /><path d="M8 3.5v3M12 3.5v3" /><path d="M4 21h13" /></svg>;
    case 'symbian': // a hexagon with an S
      return <svg {...common} className="pglyph"><path d="M12 2.5l8.5 4.75v9.5L12 21.5l-8.5-4.75v-9.5z" /><path d="M14.5 9.2c-.6-.8-1.5-1.2-2.6-1.2-1.4 0-2.4.7-2.4 1.8 0 2.4 5 1.1 5 3.5 0 1.1-1 1.9-2.5 1.9-1.1 0-2.1-.5-2.7-1.4" /></svg>;
    case 'ngage': // a handheld, seen from the front
      return <svg {...common} className="pglyph"><path d="M3 9.5C3 7.6 4.6 6 6.5 6h11C19.4 6 21 7.6 21 9.5v5c0 1.9-1.6 3.5-3.5 3.5h-11C4.6 18 3 16.4 3 14.5z" /><rect x="9.5" y="8.5" width="5" height="7" rx="1" /><path d="M5.5 12h2M6.5 11v2M17 11.2h.01M18.5 13h.01" /></svg>;
    case 'ngage2':
      return <svg {...common} className="pglyph"><path d="M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /><path d="M8.5 7.5c0-1.2 1-2 2.2-2s2.2.8 2.2 2c0 2.2-4.4 2.8-4.4 5.5h4.4" transform="translate(1.6 1.5)" /><path d="M9 19h6" /></svg>;
  }
}

/** The platform of a game or a phone: a small drawing and its name, in the platform's own colour. */
export function PlatformTag({ platform, size = 'md', glyphOnly = false, className = '' }: { platform: GamePlatform; size?: 'sm' | 'md'; glyphOnly?: boolean; className?: string }) {
  return (
    <span className={`ptag ${size} ${className}`} data-platform={platform} title={GAME_PLATFORM_LABELS[platform]} aria-label={GAME_PLATFORM_LABELS[platform]}>
      <PlatformGlyph platform={platform} size={size === 'sm' ? 13 : 16} />
      {!glyphOnly && <span>{SHORT[platform]}</span>}
    </span>
  );
}

/** A fact with a drawing in front of it: screen size, firmware state. `tone` colours the whole chip (ok / warn / none). */
export function InfoChip({ icon, tone, title, children, testId, dataset }: { icon: ReactNode; tone?: 'ok' | 'warn'; title?: string; children: ReactNode; testId?: string; dataset?: Record<string, string> }) {
  return <span className={`ichip${tone ? ` ${tone}` : ''}`} title={title} data-testid={testId} {...dataset}>{icon}<span>{children}</span></span>;
}
