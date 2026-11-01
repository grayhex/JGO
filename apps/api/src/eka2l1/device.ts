import type { Platform } from '@j2me-web/protocol';

export interface InstalledDevice { code: string; manufacturer: string; model: string }
export type DeviceDefaults = Partial<Record<'symbian' | 'ngage' | 'ngage2', string>>;

export class DeviceChoiceError extends Error {
  constructor(message: string, readonly code: 'device_missing' | 'device_required' | 'no_firmware') {
    super(message);
  }
}

const label = (d: InstalledDevice) => `${d.manufacturer} ${d.model} (${d.code})`;

/**
 * Which installed firmware a game runs on. EKA2L1's control API does not say which Symbian version a device is, so JGO does not
 * guess it from names: the game's own choice wins, then the default for its platform, and only when exactly one device is installed
 * is that one used. With several devices and no choice the start is refused with a message that says what to set.
 */
export function pickDevice(o: { requested: string | null | undefined; defaults: DeviceDefaults; platform: Exclude<Platform, 'j2me'>; devices: InstalledDevice[] }): InstalledDevice {
  const { devices } = o;
  if (devices.length === 0) throw new DeviceChoiceError('No Symbian device is installed in the emulator service. Add your own firmware in Settings → Symbian first.', 'no_firmware');
  const find = (code: string) => devices.find((d) => d.code.toLowerCase() === code.toLowerCase());
  if (o.requested) {
    const d = find(o.requested);
    if (!d) throw new DeviceChoiceError(`This game is set to run on device ${o.requested}, which is not installed (installed: ${devices.map(label).join(', ')}). Choose another in the game's settings.`, 'device_missing');
    return d;
  }
  const def = o.defaults[o.platform];
  if (def) {
    const d = find(def);
    if (d) return d;
    // a stale default (the device was removed) must not silently fall back to another firmware
    throw new DeviceChoiceError(`The default device for this platform (${def}) is not installed any more (installed: ${devices.map(label).join(', ')}). Choose a device in Settings → Symbian.`, 'device_missing');
  }
  if (devices.length === 1) return devices[0]!;
  throw new DeviceChoiceError(`Several devices are installed (${devices.map(label).join(', ')}) and none is chosen for this game. Pick one in the game's settings, or set a default for this platform in Settings → Symbian.`, 'device_required');
}
