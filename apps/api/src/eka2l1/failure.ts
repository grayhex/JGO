import type { StartFailure, StartFailureCause } from '@j2me-web/protocol';

export type ScreenshotProbe =
  | { kind: 'ok'; frame: number }
  | { kind: 'none'; httpStatus: number; code: string | null }
  | { kind: 'error'; httpStatus: number | null; code: string | null; message: string };

export interface SessionSample { state: string; screenVisible: boolean | null; lastExit: unknown }

/** Remembers what EKA2L1 answered while a game was starting, keeping only the changes so a minute of polling stays readable. */
export class FailureRecorder {
  private readonly t0 = Date.now();
  readonly timeline: StartFailure['timeline'] = [];
  readonly screenshots: StartFailure['screenshots'] = [];
  launch: StartFailure['launch'] = null;
  status: unknown = null;
  uid: string | null = null;
  appName: string | null = null;

  private at(): number { return Date.now() - this.t0; }
  elapsed(): number { return this.at(); }

  session(s: SessionSample): void {
    const last = this.timeline.at(-1);
    if (last && last.state === s.state && last.screenVisible === s.screenVisible && JSON.stringify(last.lastExit) === JSON.stringify(s.lastExit)) return;
    if (this.timeline.length < 40) this.timeline.push({ atMs: this.at(), state: s.state, screenVisible: s.screenVisible, lastExit: s.lastExit ?? null });
  }

  screenshot(p: ScreenshotProbe): void {
    const entry: StartFailure['screenshots'][number] =
      p.kind === 'ok' ? { atMs: this.at(), result: 'ok', httpStatus: 200, code: null, frame: p.frame }
      : p.kind === 'none' ? { atMs: this.at(), result: p.httpStatus === 409 ? 'no_screen' : 'unavailable', httpStatus: p.httpStatus, code: p.code, frame: null }
      : { atMs: this.at(), result: 'error', httpStatus: p.httpStatus, code: p.code ?? p.message.slice(0, 80), frame: null };
    const last = this.screenshots.at(-1);
    if (last && last.result === entry.result && last.httpStatus === entry.httpStatus && last.code === entry.code) return;
    if (this.screenshots.length < 40) this.screenshots.push(entry);
  }
}

const level = (line: string) => /^(?:\[eka2l1\] )?(?:EKA2L1\.log: )?([A-Z]) \//.exec(line)?.[1] ?? null;

/** Error-level lines and font lines of EKA2L1's log, without the endless kernel/chunk chatter. */
export function classifyLog(lines: string[]): { errors: string[]; fonts: string[] } {
  const errors: string[] = [], fonts: string[] = [];
  const seen = new Set<string>();
  for (const raw of lines) {
    const line = raw.replace(/^\[eka2l1\] (?:emulator: |EKA2L1\.log: )?/, '');
    if (seen.has(line)) continue;
    const lv = level(raw) ?? /^([A-Z]) \//.exec(line)?.[1] ?? null;
    if (/font|freetype|gdr/i.test(line)) { seen.add(line); if (fonts.length < 20) fonts.push(line); }
    if ((lv === 'E' || lv === 'C') || /panic|unhandled|fatal|abort|assert/i.test(line)) { seen.add(line); if (errors.length < 30) errors.push(line); }
  }
  return { errors, fonts };
}

export interface HintInput {
  cause: StartFailureCause;
  message: string;
  platform: string;
  firmwareOs: string | null;
  launchCode: string | null;
  lastExit: unknown;
  fonts: string[];
  errors: string[];
  screenshotErrors: string[];
}

/** Human explanations derived from the facts. They state what is known and what is not; they never turn a guess into a diagnosis. */
export function hintsFor(i: HintInput): { hints: string[]; likelyIncompatibleGame: boolean } {
  const hints: string[] = [];
  let incompatible = false;
  const eka1 = !!i.firmwareOs && /(?:Symbian|EPOC) (?:6|7|8)\./.test(i.firmwareOs);
  switch (i.cause) {
    case 'launch_rejected':
      incompatible = true;
      hints.push('EKA2L1 accepted the installation but refused to start the application (launch_failed): it could not create the application\'s process. The usual reasons are an executable built for another Symbian generation than this firmware, a component the firmware lacks, or an EKA1 (S60 1st/2nd edition) application that EKA2L1 does not run yet.');
      break;
    case 'app_crashed': {
      incompatible = true;
      const fatal = (i.lastExit as { fatal?: string } | null)?.fatal;
      hints.push(`The application crashed on start${fatal ? ` with the Symbian panic ${fatal}` : ''} before it drew anything. This is a compatibility problem between this game and EKA2L1 (or this firmware), not an MGO setting: try another firmware generation or another game.`);
      break;
    }
    case 'app_exited':
      incompatible = true;
      hints.push('The application ended by itself before it showed a picture. Typical causes: an unsupported feature, a missing dependency, or a licence/DRM check. Try the firmware generation the game was made for.');
      break;
    case 'no_picture':
      hints.push('The application is running, but EKA2L1 did not give MGO a picture within the time limit (/v1/screenshot kept answering "no screen"). The game may be waiting for something, draws to a surface EKA2L1 does not expose, or hangs while starting.');
      break;
    case 'screenshot_error':
      hints.push('EKA2L1 answered /v1/screenshot with an error instead of "no screen yet": the picture could not be read. The exact answer is listed below.');
      break;
    case 'install_failed':
      incompatible = true;
      hints.push('EKA2L1 could not install the package on this firmware (the installer ran, but no application appeared). The package may need a different Symbian version or components this firmware does not have.');
      break;
    case 'no_firmware':
    case 'device':
      hints.push('Firmware selection stopped the start; see the message. Nothing was run.');
      break;
    case 'service':
      hints.push('The Symbian service did not answer. Check that the mgo-symbian container is running (Settings → Symbian).');
      break;
  }
  if (eka1 && (i.cause === 'launch_rejected' || i.cause === 'app_crashed' || i.cause === 'app_exited' || i.cause === 'no_picture')) {
    hints.push(`The firmware is ${i.firmwareOs}: EKA1-based Symbian (before 9.x) is the least complete part of EKA2L1, so a game of this generation failing here is not unusual.`);
  }
  if (i.fonts.some((f) => /FreeType/i.test(f))) {
    const loaded = i.fonts.some((f) => /Loaded font file/i.test(f));
    hints.push(`Font note: EKA2L1 logged "FreeType failed to query face count ... unknown file format" for a file in the firmware's font folder. It first tries FreeType for fonts whose extension is not .ttf/.gdr and then its own GDR reader, so this line alone does not mean failure${loaded ? ' (a font was loaded by content afterwards)' : ' (but no later "Loaded font file" line was found: if text is missing in the game, this firmware\'s fonts are not readable)'}. It is not the reason the game did not start unless the log shows nothing else.`);
  }
  if (i.screenshotErrors.length) hints.push(`Screenshot answers: ${i.screenshotErrors.join('; ')}.`);
  return { hints, likelyIncompatibleGame: incompatible };
}

export function oneLine(f: Pick<StartFailure, 'cause' | 'message' | 'uid'>): string {
  return `${f.message}${f.uid ? ` (application ${f.uid})` : ''}`;
}
