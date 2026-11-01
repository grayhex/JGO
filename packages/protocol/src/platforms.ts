export const GAME_PLATFORMS = ['j2me', 'symbian', 'ngage', 'ngage2'] as const;
export type GamePlatform = typeof GAME_PLATFORMS[number];
export const isGamePlatform = (value: unknown): value is GamePlatform => typeof value === 'string' && (GAME_PLATFORMS as readonly string[]).includes(value);
export const GAME_PLATFORM_LABELS: Record<GamePlatform, string> = { j2me: 'Java ME', symbian: 'Symbian S60 / Symbian³', ngage: 'N-Gage', ngage2: 'N-Gage 2.0' };

/** Compatibility aliases for the EKA2L1 core protocol. */
export const PLATFORMS = GAME_PLATFORMS;
export type Platform = GamePlatform;
export const isPlatform = isGamePlatform;
export type EmulatorBackend = 'kemulator' | 'eka2l1';
export const backendOf = (p: Platform): EmulatorBackend => (p === 'j2me' ? 'kemulator' : 'eka2l1');
/** The platform of a file, from its name; `null` when the extension says nothing (a .zip needs the user's word). */
export function platformOfFile(name: string): Platform | null {
  const n = name.toLowerCase();
  if (n.endsWith('.jar')) return 'j2me';
  if (n.endsWith('.sis') || n.endsWith('.sisx')) return 'symbian';
  if (n.endsWith('.n-gage')) return 'ngage2';
  return null;
}
