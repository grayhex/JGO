/**
 * Which Symbian generation an installation package is built for, read from its first eight bytes the way EKA2L1's own installer
 * identifies it (`identify_sis_type`): a SIS of Symbian 9.x (S60 3rd Edition and later, `.sisx` almost always) cannot be installed on
 * the older EKA1-based systems (S60 1st/2nd Edition, up to Symbian 8.x), and an old SIS is not what a 9.x system expects.
 */
export type PackageFormat = 'sis-legacy' | 'sis9' | 'sis9-stub' | 'unknown';
export type SymbianGeneration = 'legacy' | 'v9';

const UID1_SIS9 = 0x10201a7a;
const UID1_STUB = 0x0000000d; // SISController field id, as EKA2L1 reads it
const UID2_LEGACY = [0x1000006d, 0x10003a12];

export function sisFormatOf(head: Uint8Array): PackageFormat {
  if (head.length < 8) return 'unknown';
  const dv = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const uid1 = dv.getUint32(0, true), uid2 = dv.getUint32(4, true);
  if (uid1 === UID1_STUB) return 'sis9-stub';
  if (uid1 === UID1_SIS9) return 'sis9';
  if (UID2_LEGACY.includes(uid2)) return 'sis-legacy';
  return 'unknown';
}

export function generationOfPackage(format: PackageFormat | undefined): SymbianGeneration | null {
  return format === 'sis-legacy' ? 'legacy' : format === 'sis9' || format === 'sis9-stub' ? 'v9' : null;
}

/** The Symbian generation of a device from the OS name in its profile ("Symbian 8.1a / S60 2nd Edition FP3", "Symbian³"). */
export function generationOfOs(os: string): SymbianGeneration | null {
  if (/Symbian[³3]|Symbian\^3/.test(os) && !/Symbian [0-9]/.test(os)) return 'v9';
  const m = /Symbian (\d+)/.exec(os);
  if (!m) return null;
  return Number(m[1]) >= 9 ? 'v9' : 'legacy';
}

export const PACKAGE_FORMAT_LABEL: Record<PackageFormat, string> = {
  'sis-legacy': 'S60 1st / 2nd Edition (Symbian 6–8)',
  sis9: 'S60 3rd Edition and later (Symbian 9+)',
  'sis9-stub': 'S60 3rd Edition and later (Symbian 9+)',
  unknown: 'unknown package format',
};
