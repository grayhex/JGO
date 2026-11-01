import type { EventEmitter } from 'node:events';
import type { AdapterEvents, AdapterState, ExitInfo } from './kemulator/adapter.js';

export type { AdapterEvents, AdapterState, ExitInfo, FrameMsg } from './kemulator/adapter.js';

/** What a session needs from an emulator. KEmulatorAdapter (J2ME) and Eka2l1Adapter (Symbian, N-Gage) both implement it. */
export interface AdapterStatus {
  state: AdapterState;
  frames: number;
  fps: number;
  exit: ExitInfo | null;
  /** Process id on this host, when there is one (an emulator in another container has none). */
  pid: number | null;
  firstFrameAt: number | null;
  heldKeys: number[];
}

export interface EmulatorAdapter extends Pick<EventEmitter<AdapterEvents>, 'on' | 'once' | 'off' | 'emit'> {
  readonly kind: 'kemulator' | 'eka2l1';
  start(): Promise<void>;
  stop(): Promise<ExitInfo>;
  getStatus(): AdapterStatus;
  /** J2ME key codes (digits, -1..-8 for the navigation keys, soft keys, fire). */
  keyDown(code: number): void;
  keyUp(code: number): void;
  releaseAll(): void;
  pointerEvent(id: number, s: 'D' | 'M' | 'U', x: number, y: number): void;
  invokeCommand(id: number): void;
  setPaused(on: boolean): void;
  setSpeed(modifier: number): void;
  setText(text: string): void;
  answerPermission(id: number, allow: boolean): void;
}
