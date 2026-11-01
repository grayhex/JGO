import type { Action } from '../input';

export type { SkinRect as Rect, PhoneSkinView as SkinView } from '@mgo/protocol';
export type SkinConfig = import('@mgo/protocol').PhoneSkin;
export type SkinButton = SkinConfig['buttons'][number];

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
