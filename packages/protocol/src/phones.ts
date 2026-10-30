import type { DevicePreset } from './index.js';
/** IDs are actual presets.xml IDs, never generated device names. */
export const PHONE_PROFILES = {
  'nokia-6100': { device: '128x128-common-full-screen', exact: false, reason: 'No Nokia 6100 preset; generic 128×128, emulator platform unchanged.' },
  'nokia-6230i': { device: '208x208-nokia-full-screen', exact: true, reason: 'presets.xml identifies Nokia 6230i.' },
  'nokia-n95': { device: '240x320-common-full-screen', exact: false, reason: 'No N95-1 preset; generic 240×320, emulator platform unchanged.' },
  'nokia-e71': { device: '320x240-common-full-screen', exact: false, reason: 'No E71 preset; generic 320×240, emulator platform unchanged.' },
  'sony-ericsson-k750i': { device: '176x220-common-full-screen', exact: false, reason: 'No exact K750i preset; generic 176×220, emulator platform unchanged.' },
} as const;
export type PhoneId = keyof typeof PHONE_PROFILES;
export function isPhoneId(value: unknown): value is PhoneId { return typeof value === 'string' && Object.hasOwn(PHONE_PROFILES, value); }
export function resolvePhone(id: PhoneId, presets: DevicePreset[]) {
  const match = PHONE_PROFILES[id];
  const preset = presets.find((p) => p.id === match.device);
  if (!preset) throw new Error(`Required KEmulator preset unavailable: ${match.device}`);
  return { ...match, preset };
}
