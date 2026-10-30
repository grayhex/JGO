import type { PublicSettings, SettingsResponse } from '@j2me-web/protocol';
import { useSyncExternalStore } from 'react';
import { api } from './api';

/**
 * The server-side settings as the page sees them. They are *defaults*: what a person chose on this device
 * (skin, volume, ...) is kept in the browser and wins; the server value is used until then (skin/registry.ts and the player read it).
 */
let state: SettingsResponse | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function setServerSettings(r: SettingsResponse): void {
  state = r;
  emit();
}

export async function loadServerSettings(): Promise<SettingsResponse | null> {
  try {
    setServerSettings(await api.settings());
  } catch { /* not signed in yet, or an older server: keep the built-in defaults */ }
  return state;
}

export function getServerSettings(): SettingsResponse | null {
  return state;
}

export function useServerSettings(): SettingsResponse | null {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => state);
}

export const DEFAULT_CONTROLS: PublicSettings['controls'] = { keypad: 'auto', haptics: true, gamepad: true };
export const DEFAULT_AUDIO: PublicSettings['audio'] = { enabled: true, volume: 80 };
export const controlSettings = (): PublicSettings['controls'] => state?.settings.controls ?? DEFAULT_CONTROLS;
export const audioSettings = (): PublicSettings['audio'] => state?.settings.audio ?? DEFAULT_AUDIO;

/** navigator.vibrate, unless vibration is switched off in Settings. */
export function buzz(ms: number): void {
  if (controlSettings().haptics) navigator.vibrate?.(ms);
}
