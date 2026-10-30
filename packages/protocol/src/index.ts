/**
 * Wire protocol shared by the API and the web client. It is provider-neutral:
 * nothing here knows about Docker, Cloudflare or KEmulator internals.
 */

// ---- REST types -------------------------------------------------------------------------

export interface GameSettings {
  /** Emulated screen size; the game sees exactly this canvas. */
  width: number;
  height: number;
  /** Key layout id, see KEY_LAYOUTS. */
  layout: LayoutId;
  /** JVM heap for the emulator process, MB. */
  heapMb: number;
  /** Optional MIDlet class when the JAR declares several. */
  midlet?: string;
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
}

export type SessionState = 'starting' | 'running' | 'stopping' | 'exited' | 'failed';

export interface SessionStatus {
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
  | { t: 'log'; line: string }
  | { t: 'stats'; fps: number; frames: number; dropped: number; latencyMs: number | null }
  | { t: 'pong'; ts: number };

// ---- WebSocket: client -> server ----------------------------------------------------------

export type ClientEvent =
  | { t: 'key'; s: 'D' | 'U' | 'R'; code: number }
  | { t: 'pointer'; id: number; s: 'D' | 'M' | 'U'; x: number; y: number }
  | { t: 'cmd'; id: number }
  | { t: 'perm'; id: number; allow: boolean }
  /** Release every key the server believes is held (focus loss, reconnect). */
  | { t: 'release-all' }
  | { t: 'audio'; on: boolean }
  | { t: 'ping'; ts: number };

// ---- Keys ----------------------------------------------------------------------------------

export type LayoutId = 'nokia' | 'sonyericsson' | 'siemens' | 'motorola';

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
  { label: '360×640', width: 360, height: 640 },
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
