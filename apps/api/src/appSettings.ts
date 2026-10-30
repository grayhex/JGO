import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { DevicePreset, KeyCodes } from '@j2me-web/protocol';

/**
 * KEmulator keeps per-application settings in <userpath>/midlets.ini, one `[<jarhash>:<jarpath>]`
 * section per JAR (AppSettings.loadIni matches sections by the `:<canonical jar path>]` suffix).
 * We write that file ourselves before every launch, so the emulator sees the device preset exactly
 * as if the user had picked it in the desktop settings dialog: no emulator patch needed.
 */
export interface AppSettingsInput {
  jarPath: string;
  width: number;
  height: number;
  keys: KeyCodes;
  preset?: DevicePreset | undefined;
}

function esc(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

export function renderMidletsIni(i: AppSettingsInput): string {
  const canonical = realpathSync(i.jarPath);
  const kv: [string, string][] = [
    ['ScreenWidth', String(i.width)],
    ['ScreenHeight', String(i.height)],
    ['KeyLeftSoft', String(i.keys.softLeft)],
    ['KeyRightSoft', String(i.keys.softRight)],
    ['KeyFire', String(i.keys.fire)],
    ['KeyUp', String(i.keys.up)],
    ['KeyDown', String(i.keys.down)],
    ['KeyLeft', String(i.keys.left)],
    ['KeyRight', String(i.keys.right)],
  ];
  if (i.preset) {
    kv.push(['DevicePreset', i.preset.name], ['IgnoreFullScreenMode', String(i.preset.forceFullscreen)]);
    if (i.preset.platform) kv.push(['MIDPPlatform', i.preset.platform]);
  }
  kv.sort((a, b) => a[0].localeCompare(b[0]));
  return `[j2meweb:${canonical}]\n${kv.map(([k, v]) => `${k}=${esc(v)}`).join('\n')}\n`;
}

export function writeMidletsIni(userPath: string, i: AppSettingsInput): string {
  mkdirSync(userPath, { recursive: true });
  const file = path.join(userPath, 'midlets.ini');
  writeFileSync(file, renderMidletsIni(i), { mode: 0o600 });
  return file;
}
