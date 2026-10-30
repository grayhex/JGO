export * from './phones.js';
/**
 * Wire protocol shared by the API and the web client. It is provider-neutral:
 * nothing here knows about Docker, Cloudflare or KEmulator internals.
 */

// ---- REST types -------------------------------------------------------------------------

export interface GameSettings {
  skinId?: import('./phones.js').PhoneId;
  profileMode?: 'auto' | 'advanced';
  /** Emulated screen size; the game sees exactly this canvas. */
  width: number;
  height: number;
  /** Key layout id, see KEY_LAYOUTS. */
  layout: LayoutId;
  /** JVM heap for the emulator process, MB. */
  heapMb: number;
  /** Optional MIDlet class when the JAR declares several. */
  midlet?: string;
  /** Id of a KEmulator device preset (see GET /api/devices); sets key codes, fullscreen policy, platform string. */
  device?: string;
}

export interface GameMeta {
  id: string;
  sha256: string;
  name: string;
  vendor: string;
  version: string;
  midlets: { name: string; className: string }[];
  /** Class-file major version found in the JAR (KEmulator accepts <= 48). */
  classVersion: number;
  sizeBytes: number;
  hasIcon: boolean;
  hasJad: boolean;
  favorite: boolean;
  createdAt: string;
  lastPlayedAt: string | null;
  /** Other uploaded versions of the same (vendor, name). */
  groupKey: string;
  settings: GameSettings;
  warnings: string[];
  /** 'upload' (web upload) or 'import' (scanned from the library directory). */
  origin?: 'upload' | 'import';
  /** True when every file this game was imported from has disappeared from the library directory (the game itself is kept). */
  sourceMissing?: boolean;
  /** Short MobyGames summary, when the game has been matched. */
  info?: GameInfoSummary;
}

export type MetaStatus = 'none' | 'matched' | 'ambiguous' | 'unmatched' | 'manual' | 'error';

export interface GameInfoSummary {
  status: MetaStatus;
  title?: string;
  year?: number | null;
  genres?: string[];
  hasCover?: boolean;
}

export interface MobyCandidate {
  mobyId: number;
  title: string;
  year: number | null;
  platforms: string[];
  genres: string[];
  url: string | null;
  /** 0..1 similarity between the library title and the candidate. */
  score: number;
  /** True when the candidate has the J2ME platform. */
  j2me: boolean;
  thumb: string | null;
}

export interface GameInfo {
  status: MetaStatus;
  groupKey: string;
  mobyId: number | null;
  title: string | null;
  description: string | null;
  genres: string[];
  publishers: string[];
  developers: string[];
  year: number | null;
  /** MobyGames score on a 0..10 scale. */
  score: number | null;
  mobyUrl: string | null;
  officialUrl: string | null;
  hasCover: boolean;
  screenshots: number;
  candidates: MobyCandidate[];
  fetchedAt: string | null;
  /** Text that must be displayed wherever this data is shown. */
  attribution: string;
  error: string | null;
}

export type SetupStatus = 'pending' | 'completed' | 'skipped';

export interface PublicSettings {
  /** Absolute path of the library directory (always inside one of the server's library roots) or null. */
  libraryPath: string | null;
  autoScan: boolean;
  /** Look the games up on MobyGames after a scan (only when a key is configured). */
  autoMetadata: boolean;
  phone: { skinId: string; view: 'full' | 'screen'; device: string | null; layout: LayoutId; width: number; height: number; heapMb: number };
  audio: { enabled: boolean; volume: number };
  controls: { keypad: 'auto' | 'always' | 'never'; haptics: boolean; gamepad: boolean };
  server: { maxSessions: number; sessionMaxMinutes: number; sessionIdleMinutes: number; libraryQuotaMb: number; frameEncoding: 'raw' | 'deflate' };
}

export interface SettingsResponse {
  settings: PublicSettings;
  /** Secrets are never returned: only whether they are set. */
  secrets: { mobygames: { configured: boolean; hint: string | null } };
  /** Values that come from /etc/jgo/jgo.env and cannot be changed from the web UI. */
  readonly: { host: string; port: number; auth: 'none' | 'token'; dataDirName: string };
  /** Environment defaults the server settings fall back to. */
  envDefaults: PublicSettings['server'];
  setup: { status: SetupStatus; completedAt: string | null; legacy: boolean };
}

export type CheckState = 'ok' | 'warn' | 'error';

export interface SystemCheck {
  id: string;
  label: string;
  state: CheckState;
  detail: string;
  hint?: string;
}

export interface SystemStatus {
  version: string;
  checks: SystemCheck[];
  storage: { totalBytes: number; freeBytes: number; libraryBytes: number; quotaBytes: number };
}

export interface LibraryRoot {
  path: string;
  exists: boolean;
  readable: boolean;
  writable: boolean;
  /** Free-form note, e.g. "mounted read-only". */
  note: string | null;
}

export interface LibraryCheck {
  ok: boolean;
  path: string;
  exists: boolean;
  isDirectory: boolean;
  readable: boolean;
  /** A writable library directory is allowed but not needed: the import never writes there. */
  writable: boolean;
  insideRoot: boolean;
  jarCount: number;
  jadCount: number;
  totalBytes: number;
  /** True when the count stopped at the safety limit. */
  truncated: boolean;
  problems: string[];
  warnings: string[];
}

export interface ScanReport {
  id: string;
  mode: 'update' | 'full';
  state: 'running' | 'done' | 'cancelled' | 'failed';
  root: string;
  startedAt: string;
  finishedAt: string | null;
  filesSeen: number;
  jars: number;
  added: number;
  updated: number;
  unchanged: number;
  /** Same bytes (SHA-256) found at another path. */
  duplicates: number;
  /** Same vendor+name but different bytes: kept as separate versions. */
  newVersions: number;
  missing: number;
  skipped: number;
  errors: { path: string; code: string; message: string }[];
  /** Relative paths of the duplicate files, grouped by the game they duplicate. */
  duplicateGroups: { gameId: string; name: string; paths: string[] }[];
  versionGroups: { groupKey: string; name: string; versions: { gameId: string; version: string; path: string }[] }[];
  current: string | null;
  error: string | null;
}

export interface MetadataJob {
  state: 'idle' | 'running' | 'cancelled' | 'done' | 'failed';
  total: number;
  done: number;
  matched: number;
  ambiguous: number;
  unmatched: number;
  failed: number;
  current: string | null;
  /** Epoch ms until which the job waits because of rate limiting (null when not waiting). */
  waitingUntil: number | null;
  error: string | null;
}

export type SessionState = 'starting' | 'running' | 'stopping' | 'exited' | 'failed';

/** Resource usage of the emulator process tree (adapter + JVM), sampled by the API. */
export interface ResourceUsage {
  rssMb: number;
  peakRssMb: number;
  /** Cumulative CPU time of the tree, seconds. */
  cpuSeconds: number;
  /** Average CPU use since the session started, in % of one core. */
  cpuPercentAvg: number;
  /** CPU use over the last sampling interval, in % of one core. */
  cpuPercentNow: number;
}

export interface SessionStatus {
  layout: LayoutId;
  heapMb: number;
  id: string;
  gameId: string;
  state: SessionState;
  width: number;
  height: number;
  startedAt: string;
  uptimeMs: number;
  framesReceived: number;
  framesDropped: number;
  fps: number;
  exitCode: number | null;
  exitDetail: string | null;
  title: string | null;
  softkeys: { left: string; right: string };
  logTail: string[];
  /** Human-readable findings extracted from the emulator log (unsupported APIs, load failures). */
  diagnostics: string[];
  /** Milliseconds from session creation to the first frame (null until one arrives). */
  firstFrameMs: number | null;
  resources: ResourceUsage | null;
  /** Effective device preset id, if any. */
  device: string | null;
  /** PCM bytes the emulator has produced so far (0 = the game never made a sound). */
  audioBytes: number;
  /** Width/height of frames actually produced. */
  encoding: 'raw' | 'deflate';
}

export interface HealthStatus {
  ok: boolean;
  version: string;
  kemulator: { commit: string | null; jarPresent: boolean };
  adapter: { present: boolean };
  java: { present: boolean; version: string | null };
  activeSessions: number;
  maxSessions: number;
  auth: 'none' | 'token';
  dataDir: string;
}

export interface ApiError {
  error: string;
  message: string;
}

// ---- WebSocket: server -> client ----------------------------------------------------------

/** Binary message kinds (first byte). */
export const WS_BIN_FRAME = 0x01;
export const FRAME_ENC_RGBA = 0;
export const FRAME_ENC_DEFLATE_RAW = 1;
/** Audio chunk: kind u8 | s16le stereo PCM @ AUDIO_RATE (any length, multiple of 4 bytes). */
export const WS_BIN_AUDIO = 0x02;
export const AUDIO_RATE = 44100;
export const AUDIO_CHANNELS = 2;
/** Binary frame layout: kind u8 | seq u32 | enc u8 | width u16 | height u16 | serverTs u32 (ms, wraps) | pixels. */
export const WS_FRAME_HEADER_BYTES = 1 + 4 + 1 + 2 + 2 + 4;

/**
 * The text area the game currently lets the user edit (a focused `TextField` or a `TextBox`).
 * `x/y/w/h` are in framebuffer pixels; `constraints` are the MIDP `TextField` constraint bits
 * (see {@link TEXT_CONSTRAINT}).
 */
export interface TextArea {
  kind: 'field' | 'box';
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  maxSize: number;
  constraints: number;
}

/** MIDP `TextField` constraint values. */
export const TEXT_CONSTRAINT = {
  ANY: 0,
  EMAILADDR: 1,
  NUMERIC: 2,
  PHONENUMBER: 3,
  URL: 4,
  DECIMAL: 5,
  MASK: 0xffff,
  PASSWORD: 0x10000,
  UNEDITABLE: 0x20000,
  SENSITIVE: 0x40000,
} as const;

/** The longest text the server forwards to the game in one `text` event. */
export const TEXT_INPUT_MAX = 4096;

export type ServerEvent =
  | { t: 'hello'; sessionId: string; width: number; height: number; state: SessionState }
  | { t: 'state'; state: SessionState; exitCode?: number | null; detail?: string | null }
  | { t: 'softkeys'; left: string; right: string }
  | { t: 'title'; title: string }
  | { t: 'displayable'; kind: 'canvas' | 'textbox' | 'list' }
  | { t: 'menu'; items: { id: number; kind: 'normal' | 'radio' | 'radio-selected'; text: string }[] }
  | { t: 'menu-close' }
  | { t: 'permission'; id: number; message: string }
  | { t: 'vibrate'; ms: number }
  | { t: 'url'; url: string }
  /** The editable text area of the current screen, or `null` when nothing is being edited. */
  | { t: 'text'; area: TextArea | null }
  | { t: 'log'; line: string }
  | { t: 'stats'; fps: number; frames: number; dropped: number; latencyMs: number | null }
  | { t: 'pong'; ts: number };

// ---- WebSocket: client -> server ----------------------------------------------------------

export type ClientEvent =
  | { t: 'key'; s: 'D' | 'U' | 'R'; code: number }
  | { t: 'pointer'; id: number; s: 'D' | 'M' | 'U'; x: number; y: number }
  | { t: 'cmd'; id: number }
  | { t: 'perm'; id: number; allow: boolean }
  /** The new full text of the focused text area (the game may shorten or filter it and answers with `text`). */
  | { t: 'text'; text: string }
  /** Release every key the server believes is held (focus loss, reconnect). */
  | { t: 'release-all' }
  | { t: 'audio'; on: boolean }
  | { t: 'ping'; ts: number };

// ---- Keys ----------------------------------------------------------------------------------

export type LayoutId = 'nokia' | 'sonyericsson' | 'siemens' | 'motorola' | 'motorola-triplets' | 'motorola-v8' | 'motorola-i670' | 'motorola-v300' | 'lg' | 'sagem' | 'sharp';

export interface KeyCodes {
  up: number;
  down: number;
  left: number;
  right: number;
  fire: number;
  softLeft: number;
  softRight: number;
  clear: number;
}

/** Soft/navigation key codes differ per vendor; digits, * and # are the same everywhere. */
export const KEY_LAYOUTS: Record<LayoutId, { label: string; keys: KeyCodes }> = {
  nokia: { label: 'Nokia / S40·S60', keys: { up: -1, down: -2, left: -3, right: -4, fire: -5, softLeft: -6, softRight: -7, clear: -8 } },
  sonyericsson: { label: 'Sony Ericsson', keys: { up: -1, down: -2, left: -3, right: -4, fire: -5, softLeft: -6, softRight: -7, clear: -8 } },
  siemens: { label: 'Siemens', keys: { up: -59, down: -60, left: -61, right: -62, fire: -26, softLeft: -1, softRight: -4, clear: -8 } },
  motorola: { label: 'Motorola', keys: { up: -1, down: -6, left: -2, right: -5, fire: -20, softLeft: -21, softRight: -22, clear: -8 } },
  // The layouts below are taken verbatim from KEmulator's presets.xml (<layout> blocks).
  'motorola-triplets': { label: 'Motorola Triplets', keys: { up: -1, down: -6, left: -2, right: -5, fire: -8, softLeft: -21, softRight: -22, clear: -8 } },
  'motorola-v8': { label: 'Motorola Motomagx', keys: { up: -1, down: -2, left: -3, right: -4, fire: -5, softLeft: -21, softRight: -22, clear: -8 } },
  'motorola-i670': { label: 'Motorola i670', keys: { up: -10, down: -11, left: -13, right: -14, fire: -23, softLeft: -20, softRight: -21, clear: -8 } },
  'motorola-v300': { label: 'Motorola V300', keys: { up: 1, down: 6, left: 2, right: 5, fire: 8, softLeft: 21, softRight: 22, clear: -8 } },
  lg: { label: 'LG', keys: { up: -1, down: -2, left: -3, right: -4, fire: -5, softLeft: -202, softRight: -203, clear: -8 } },
  sagem: { label: 'Sagem', keys: { up: -1, down: -2, left: -3, right: -4, fire: -5, softLeft: -7, softRight: -6, clear: -8 } },
  sharp: { label: 'Sharp / DoCoMo', keys: { up: -1, down: -6, left: -2, right: -5, fire: -20, softLeft: -21, softRight: -22, clear: -8 } },
};

export const KEY_NUM0 = 48;
export const KEY_STAR = 42;
export const KEY_POUND = 35;

export const SCREEN_PRESETS: { label: string; width: number; height: number }[] = [
  { label: '128×128', width: 128, height: 128 },
  { label: '128×160', width: 128, height: 160 },
  { label: '176×208', width: 176, height: 208 },
  { label: '176×220', width: 176, height: 220 },
  { label: '240×320', width: 240, height: 320 },
  { label: '320×240', width: 320, height: 240 },
  { label: '240×400', width: 240, height: 400 },
  { label: '320×480', width: 320, height: 480 },
  { label: '360×640', width: 360, height: 640 },
  { label: '480×800', width: 480, height: 800 },
];

export const DEFAULT_SETTINGS: GameSettings = { width: 240, height: 320, layout: 'nokia', heapMb: 256 };

/** Encodes a frame header (see WS_FRAME_HEADER_BYTES). */
export function encodeFrameHeader(seq: number, enc: number, w: number, h: number, tsMs: number): Uint8Array {
  const b = new Uint8Array(WS_FRAME_HEADER_BYTES);
  const dv = new DataView(b.buffer);
  b[0] = WS_BIN_FRAME;
  dv.setUint32(1, seq >>> 0);
  b[5] = enc;
  dv.setUint16(6, w);
  dv.setUint16(8, h);
  dv.setUint32(10, tsMs >>> 0);
  return b;
}

export function decodeFrameHeader(b: ArrayBuffer | Uint8Array): { seq: number; enc: number; w: number; h: number; tsMs: number } {
  const u8 = b instanceof Uint8Array ? b : new Uint8Array(b);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  return { seq: dv.getUint32(1), enc: u8[5]!, w: dv.getUint16(6), h: dv.getUint16(8), tsMs: dv.getUint32(10) };
}

// ---- Device presets (parsed from KEmulator's own res/presets.xml) ---------------------------

export interface DevicePreset {
  /** Stable id: slug of the preset name. */
  id: string;
  /** Exact KEmulator preset name (what `DevicePreset=` in midlets.ini expects). */
  name: string;
  /** Phone model from the comment preceding the preset in presets.xml (may be empty). */
  model: string;
  vendor: 'nokia' | 'sonyericsson' | 'samsung' | 'motorola' | 'siemens' | 'lg' | 'sharp' | 'softbank' | 'common' | 'other';
  width: number;
  height: number;
  /** KEmulator's FORCE_FULLSCREEN: ignore Canvas.setFullScreenMode(false). */
  forceFullscreen: boolean;
  layout: LayoutId;
  /** KEmulator layout name as written in presets.xml. */
  layoutName: string;
  keys: KeyCodes;
  /** microedition.platform presented to the game, when we know a conventional value (else the emulator default). */
  platform: string | null;
  /** Free-text platform notes for the UI/report. */
  notes: string[];
}
