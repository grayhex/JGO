/** Presentation IDs are independent of emulator profiles and game platforms. */
export const PHONE_SKIN_IDS = [
  'nokia-6100', 'nokia-6230i', 'sony-ericsson-k750i', 'nokia-n95', 'nokia-e71',
  'sony-ericsson-w995', 'sony-ericsson-k790i', 'motorola-razr-v3', 'nokia-5800', 'samsung-s5230',
  'nokia-n-gage-classic', 'nokia-n-gage-qd', 'nokia-n70', 'nokia-5320-xpressmusic', 'nokia-n8',
] as const;
export type PhoneSkinId = typeof PHONE_SKIN_IDS[number];
export const isPhoneSkinId = (value: unknown): value is PhoneSkinId => typeof value === 'string' && (PHONE_SKIN_IDS as readonly string[]).includes(value);

/** Fractions of the artwork dimensions. Never framebuffer pixels. */
export interface SkinRect { x: number; y: number; width: number; height: number }
export interface PhoneSkinView {
  body: string;
  glass?: string;
  width: number;
  height: number;
  screenRect: SkinRect;
  controls: 'buttons' | 'external';
}
/** Artwork and physical controls only. Compatibility lives in PHONE_COMPATIBILITY. */
export interface PhoneSkin {
  id: string;
  manufacturer: string;
  model: string;
  year: number;
  variant?: string;
  status: string;
  screen: { width: number; height: number };
  input?: { kind: 'keypad' | 'touchscreen'; pointer: boolean; externalKeypad: boolean };
  buttons: { id: string; label: string; polygon: [number, number][] }[];
  keyMappings: Record<string, string | null>;
  assets: { preview?: string; hitboxes?: string };
  notes: string[];
  views: { full: PhoneSkinView; screen: PhoneSkinView };
}
