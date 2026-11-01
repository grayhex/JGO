import type { DevicePreset, GameSettings, LayoutId, SymbianStatus } from './index.js';
import { PHONE_SKIN_IDS, type PhoneSkinId } from './phoneSkins.js';
import { OWN_LAYOUT, PHONE_PROFILES } from './phones.js';
import { GAME_PLATFORM_LABELS, type GamePlatform } from './platforms.js';
import { PACKAGE_FORMAT_LABEL, generationOfOs, generationOfPackage, type PackageFormat } from './packageFormat.js';

interface DeviceBase {
  id: string;
  name: string;
  os: string;
  screen: { width: number; height: number };
  platforms: readonly GamePlatform[];
}
/** Actual execution requirements. Never inferred from a body image or a model label. */
export type EmulatedDevice = DeviceBase & (
  | { engine: 'kemulator'; layout: LayoutId; presetId: string }
  | { engine: 'eka2l1'; layout: 's60-keypad' | 's60-qwerty' | 's60-touch' | 'ngage'; firmware: { product: string; os: string } }
);

export function javaDeviceId(skinId: PhoneSkinId): string {
  return `j2me-${PHONE_PROFILES[skinId].device}-${OWN_LAYOUT[skinId] ?? 'nokia'}`;
}

const javaDevices = new Map<string, EmulatedDevice>();
for (const id of PHONE_SKIN_IDS) {
  const profile = PHONE_PROFILES[id];
  const [width, height] = profile.device.split('-')[0]!.split('x').map(Number);
  javaDevices.set(javaDeviceId(id), { id: javaDeviceId(id), name: profile.device, os: 'Java ME (KEmulator)', engine: 'kemulator', layout: OWN_LAYOUT[id] ?? 'nokia', presetId: profile.device, screen: { width: width!, height: height! }, platforms: ['j2me'] });
}
function native(id: string, name: string, os: string, product: string, width: number, height: number, layout: 's60-keypad' | 's60-qwerty' | 's60-touch' | 'ngage', platforms: readonly GamePlatform[]): EmulatedDevice {
  return { id, name, os, engine: 'eka2l1', screen: { width, height }, layout, firmware: { product, os }, platforms };
}

export const EMULATED_DEVICES: readonly EmulatedDevice[] = [
  ...javaDevices.values(),
  native('eka2l1-ngage-classic', 'Nokia N-Gage Classic', 'Symbian 6.1 / S60 1st Edition', 'NEM-4', 176, 208, 'ngage', ['symbian', 'ngage']),
  native('eka2l1-ngage-qd', 'Nokia N-Gage QD', 'Symbian 6.1 / S60 1st Edition', 'RH-29', 176, 208, 'ngage', ['symbian', 'ngage']),
  native('eka2l1-n70', 'Nokia N70', 'Symbian 8.1a / S60 2nd Edition FP3', 'RM-84', 176, 208, 's60-keypad', ['symbian']),
  native('eka2l1-5320', 'Nokia 5320 XpressMusic', 'Symbian 9.3 / S60 3rd Edition FP2', 'RM-409', 240, 320, 's60-keypad', ['symbian', 'ngage2']),
  native('eka2l1-n95', 'Nokia N95-1', 'Symbian 9.2 / S60 3rd Edition FP1', 'RM-159', 240, 320, 's60-keypad', ['symbian', 'ngage2']),
  native('eka2l1-e71', 'Nokia E71', 'Symbian 9.2 / S60 3rd Edition FP1', 'RM-346', 320, 240, 's60-qwerty', ['symbian']),
  native('eka2l1-5800', 'Nokia 5800 XpressMusic', 'Symbian 9.4 / S60 5th Edition', 'RM-356', 360, 640, 's60-touch', ['symbian']),
  native('eka2l1-n8', 'Nokia N8', 'Symbian³', 'RM-596', 360, 640, 's60-touch', ['symbian']),
];
export const emulatedDevice = (id: string): EmulatedDevice | undefined => EMULATED_DEVICES.find(d => d.id === id);
export const isEmulatedDeviceId = (id: unknown): id is string => typeof id === 'string' && !!emulatedDevice(id);

const NATIVE_PROFILES: Partial<Record<PhoneSkinId, string>> = {
  'nokia-n-gage-classic': 'eka2l1-ngage-classic', 'nokia-n-gage-qd': 'eka2l1-ngage-qd', 'nokia-n70': 'eka2l1-n70',
  'nokia-5320-xpressmusic': 'eka2l1-5320', 'nokia-n95': 'eka2l1-n95', 'nokia-e71': 'eka2l1-e71', 'nokia-5800': 'eka2l1-5800', 'nokia-n8': 'eka2l1-n8',
};
/** A relation, not a property of the artwork. One skin serves several platforms. */
export const PHONE_COMPATIBILITY: Readonly<Record<PhoneSkinId, readonly string[]>> = Object.fromEntries(
  PHONE_SKIN_IDS.map(id => [id, [javaDeviceId(id), ...(NATIVE_PROFILES[id] ? [NATIVE_PROFILES[id]!] : [])]]),
) as unknown as Record<PhoneSkinId, readonly string[]>;

export function profilesForSkin(id: PhoneSkinId, platform: GamePlatform): EmulatedDevice[] {
  return EMULATED_DEVICES.filter(d => d.platforms.includes(platform) && PHONE_COMPATIBILITY[id].includes(d.id));
}

/** A skin can host a native (Symbian / N-Gage) game only when some EKA2L1 profile for that platform is compatible with it. */
export function skinSupportsPlatform(skin: PhoneSkinId, platform: GamePlatform, packageFormat?: PackageFormat): boolean {
  const need = generationOfPackage(packageFormat);
  return EMULATED_DEVICES.some(d => d.engine === 'eka2l1' && d.platforms.includes(platform) && PHONE_COMPATIBILITY[skin].includes(d.id) && (!need || generationOfOs(d.os) === need));
}
/** Skins that may host the platform's games, in catalog order. */
export function skinsForPlatform(platform: GamePlatform): PhoneSkinId[] {
  return PHONE_SKIN_IDS.filter(id => skinSupportsPlatform(id, platform));
}
const skinLabel = (id: string): string => id.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

export interface PhoneSelectionRequest {
  platform: GamePlatform;
  skinId?: PhoneSkinId;
  emulatedDeviceId?: string;
  /** Used only to rank defaults. Never substitutes a firmware by resolution. */
  screen?: { width: number; height: number };
}
export type PhoneSelection = { ok: true; skinId: PhoneSkinId; device: EmulatedDevice } | { ok: false; code: 'unknown_profile' | 'incompatible_profile' | 'incompatible_skin'; message: string };

export function selectPhone(request: PhoneSelectionRequest): PhoneSelection {
  const explicit = request.emulatedDeviceId ? emulatedDevice(request.emulatedDeviceId) : undefined;
  if (request.emulatedDeviceId && !explicit) return { ok: false, code: 'unknown_profile', message: 'Unknown emulated device profile.' };
  if (explicit && !explicit.platforms.includes(request.platform)) return { ok: false, code: 'incompatible_profile', message: 'The emulated device does not support the selected game platform.' };
  const candidates = EMULATED_DEVICES.filter(d => d.platforms.includes(request.platform) && (!request.skinId || PHONE_COMPATIBILITY[request.skinId].includes(d.id)) && (!explicit || d.id === explicit.id));
  const device = candidates.find(d => d.screen.width === request.screen?.width && d.screen.height === request.screen?.height) ?? candidates[0];
  if (!device) return { ok: false, code: 'incompatible_skin', message: 'This phone skin has no compatible profile for the selected game platform.' };
  const skinId = request.skinId ?? PHONE_SKIN_IDS.find(id => PHONE_COMPATIBILITY[id].includes(device.id))!;
  return { ok: true, skinId, device };
}

export interface DeviceAvailability { deviceId: string; available: boolean; code?: string; message?: string }
export interface PhoneCatalog { devices: readonly EmulatedDevice[]; compatibility: typeof PHONE_COMPATIBILITY; availability: DeviceAvailability[] }

export interface NativePhonePlan {
  ready: boolean;
  code: string | null;
  message: string;
  firmwareCode: string | null;
  deviceId: string | null;
  skinId: PhoneSkinId | null;
  source: 'game' | 'platform' | 'only' | 'compatible' | null;
  warnings: string[];
}

/** Product codes identify firmware; screen size and the artwork never do. */
export function nativePhonePlan(platform: Exclude<GamePlatform, 'j2me'>, settings: GameSettings, status: SymbianStatus, packageFormat?: PackageFormat): NativePhonePlan {
  const sameCode = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const plan: NativePhonePlan = { ready: false, code: null, message: '', firmwareCode: null, deviceId: null, skinId: null, source: null, warnings: [] };
  const fail = (code: string, message: string) => ({ ...plan, code, message });
  if (!status.configured) return fail('symbian_unavailable', 'The Symbian service is not configured. Open Settings → Symbian.');
  if (!status.reachable) return fail('symbian_unavailable', 'The Symbian service is not reachable. Refresh its status or open Settings → Symbian.');
  if (!status.firmware.installed || !status.firmware.devices.length) return fail('no_firmware', 'No firmware is installed. A phone skin cannot replace an EKA2L1 firmware. Open Settings → Symbian.');
  const explicit = settings.emulatedDeviceId ? emulatedDevice(settings.emulatedDeviceId) : undefined;
  if (settings.emulatedDeviceId && (!explicit || explicit.engine !== 'eka2l1' || !explicit.platforms.includes(platform))) return fail('incompatible_profile', 'The selected emulation profile does not support this game platform.');
  const profileCode = explicit?.engine === 'eka2l1' ? explicit.firmware.product : null;
  const catalogFor = (code: string) => EMULATED_DEVICES.find(d => d.engine === 'eka2l1' && sameCode(d.firmware.product, code));
  const need = generationOfPackage(packageFormat);
  const genOf = (code: string) => { const d = catalogFor(code); return d ? generationOfOs(d.os) : null; };
  /** An installed firmware whose generation is known and different from the package's cannot install it; an unknown one is not judged. */
  const fits = (code: string) => !need || genOf(code) === null || genOf(code) === need;
  let requested = settings.symbianDevice || profileCode || status.defaults[platform];
  plan.source = settings.symbianDevice || profileCode ? 'game' : status.defaults[platform] ? 'platform' : 'only';
  if (!requested && need) {
    // the package says which Symbian generation it needs: when exactly one installed firmware is of that generation, that is the one
    const fitting = status.firmware.devices.filter(d => fits(d.code));
    if (fitting.length === 0 && status.firmware.devices.length > 1) return fail('no_compatible_firmware', `${PACKAGE_FORMAT_LABEL[packageFormat!]}: none of the installed firmware (${status.firmware.devices.map(d => d.code).join(', ')}) can install this package. Add firmware of that generation in Settings → Symbian, or use the other build of the game.`);
    if (fitting.length === 1) { requested = fitting[0]!.code; plan.source = 'compatible'; }
  }
  if (!requested && status.firmware.devices.length !== 1) return fail('device_required', 'Several firmware devices are installed. Choose one for this game; MGO will not guess.');
  const installed = requested ? status.firmware.devices.find(d => sameCode(d.code, requested)) : status.firmware.devices[0];
  if (!installed) return fail('device_missing', 'The selected firmware is not installed. Choose an installed device or add its firmware in Settings → Symbian.');
  if (!fits(installed.code)) {
    const d = catalogFor(installed.code)!;
    return { ...plan, firmwareCode: installed.code, deviceId: d.id, code: 'incompatible_package', message: `This game is a ${PACKAGE_FORMAT_LABEL[packageFormat!]} package. ${d.name} (${d.os}) cannot install it: ${need === 'v9' ? 'a Symbian 9 package is not installable on Symbian 8.x or older' : 'an older package is not what a Symbian 9 system installs'}. Choose firmware of the right generation${need === 'v9' ? ' (for example a Nokia N95, 5320 or E71)' : ' (for example a Nokia N70 or an N-Gage)'}, or another build of the game.` };
  }
  plan.firmwareCode = installed.code;
  if (profileCode && !sameCode(installed.code, profileCode)) return fail('firmware_mismatch', 'The selected firmware does not match the emulated device profile. Changing the skin cannot change the firmware.');
  const device = explicit ?? EMULATED_DEVICES.find(d => d.engine === 'eka2l1' && sameCode(d.firmware.product, installed.code));
  if (device) {
    plan.deviceId = device.id;
    if (!device.platforms.includes(platform)) return fail('incompatible_profile', 'The installed firmware profile does not support this game platform.');
    plan.skinId = PHONE_SKIN_IDS.find(id => PHONE_COMPATIBILITY[id].includes(device.id)) ?? null;
    if (settings.skinId && !PHONE_COMPATIBILITY[settings.skinId].includes(device.id)) return { ...plan, code: 'incompatible_skin', message: `${skinLabel(settings.skinId)} cannot run ${GAME_PLATFORM_LABELS[platform]} games on ${device.name}. Pick a compatible phone${plan.skinId ? ` (for example ${skinLabel(plan.skinId)})` : ''}; a Java ME phone is not a Symbian or N-Gage device.` };
  } else {
    if (settings.skinId && !skinSupportsPlatform(settings.skinId, platform)) return { ...plan, code: 'incompatible_skin', message: `${skinLabel(settings.skinId)} is a Java ME phone and cannot run ${GAME_PLATFORM_LABELS[platform]} games. Pick a Nokia that has a Symbian / N-Gage profile.` };
    plan.warnings.push('The firmware model and OS are not in the MGO profile catalog. Verify compatibility yourself; MGO does not infer it from the skin.');
  }
  if (status.busy) return fail('symbian_busy', 'The Symbian service is busy. Stop its running game or wait for the firmware job to finish.');
  return { ...plan, ready: true, message: 'Ready for an experimental EKA2L1 test.' };
}

/** A Java profile must exist in the actual installed presets.xml, not merely in this catalog. */
export function javaPreset(device: EmulatedDevice, presets: readonly DevicePreset[]): DevicePreset | undefined {
  return device.engine === 'kemulator' ? presets.find(p => p.id === device.presetId) : undefined;
}

/**
 * What a newly imported Symbian / N-Gage game starts with. The phone picture and the firmware are left unset on purpose: the player
 * picks the phone that matches the installed firmware, so a default J2ME phone (for example a Sony Ericsson) is never pinned to a game
 * that cannot run on it.
 */
export function nativeGameDefaults(platform: Exclude<GamePlatform, 'j2me'>): Pick<GameSettings, 'width' | 'height' | 'layout' | 'heapMb'> {
  const typical = EMULATED_DEVICES.find(d => d.engine === 'eka2l1' && d.platforms.includes(platform));
  return { width: typical?.screen.width ?? 176, height: typical?.screen.height ?? 208, layout: 'nokia', heapMb: 256 };
}
