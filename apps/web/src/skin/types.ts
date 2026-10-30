import type { Action } from '../input';

/** Fractions (0..1) of one view's asset dimensions. */
export interface Rect { x: number; y: number; width: number; height: number }

export interface SkinView {
  body: string;
  glass?: string;
  /** Pixel size of the view's asset; the on-screen box always keeps this ratio. */
  width: number;
  height: number;
  /** Where the live Canvas goes. */
  screenRect: Rect;
  /** `buttons`: the body has physical controls (hitboxes); `external`: controls live outside the picture. */
  controls: 'buttons' | 'external';
}

export interface SkinButton { id: string; label: string; polygon: [number, number][] }

export interface SkinConfig {
  id: string;
  manufacturer: string;
  model: string;
  year: number;
  variant?: string;
  /** `review-draft`: validated geometry, not a certified historical likeness. */
  status: string;
  /** Display resolution of the real handset; the emulated framebuffer is chosen separately. */
  screen: { width: number; height: number };
  /** Physical controls of the skin, independent of the selected emulation profile. */
  input?: { kind: 'keypad' | 'touchscreen'; pointer: boolean; externalKeypad: boolean };
  buttons: SkinButton[];
  /** Logical game binding per button id; null means the physical key has no J2ME binding (no code is ever sent). */
  keyMappings: Record<string, string | null>;
  assets: { preview?: string; hitboxes?: string };
  notes: string[];
  views: { full: SkinView; screen: SkinView };
}

export interface Hitbox {
  id: string;
  label: string;
  /** Normalised 0..1 in the full view. */
  points: [number, number][];
  /** Logical action the key sends, or null when the config binds nothing (the key is shown but silent). */
  action: Action | null;
}

export interface LoadedSkin {
  config: SkinConfig;
  /** URL prefix of the model's files, with trailing slash. */
  base: string;
  hitboxes: Hitbox[];
  /** Non-fatal problems found while loading (shown on /phones). */
  warnings: string[];
}

export type SkinViewId = 'full' | 'screen';
