import type { ClientEvent } from '@j2me-web/protocol';

/** What a recording keeps: the player's input. Audio, pause and visibility are not input. */
export type RecordedEvent = Extract<ClientEvent, { t: 'key' } | { t: 'pointer' } | { t: 'cmd' } | { t: 'text' }>;

export interface Recording {
  format: 'jgo-input-recording';
  version: 1;
  gameId: string;
  gameName: string;
  /** Frame size the input was recorded at: pointer coordinates only make sense for the same size. */
  width: number;
  height: number;
  durationMs: number;
  events: { at: number; ev: RecordedEvent }[];
}

export const MAX_RECORDED_EVENTS = 200_000;

export function isRecordable(ev: ClientEvent): ev is RecordedEvent {
  return ev.t === 'key' || ev.t === 'pointer' || ev.t === 'cmd' || ev.t === 'text';
}

/** Collects input events with the time since the recording started. */
export class Recorder {
  private t0: number | null = null;
  private events: Recording['events'] = [];

  get active(): boolean { return this.t0 !== null; }
  get count(): number { return this.events.length; }

  start(now = performance.now()): void { this.t0 = now; this.events = []; }

  push(ev: ClientEvent, now = performance.now()): void {
    if (this.t0 === null || !isRecordable(ev) || this.events.length >= MAX_RECORDED_EVENTS) return;
    this.events.push({ at: Math.max(0, Math.round(now - this.t0)), ev });
  }

  stop(meta: Pick<Recording, 'gameId' | 'gameName' | 'width' | 'height'>, now = performance.now()): Recording {
    const durationMs = this.t0 === null ? 0 : Math.round(now - this.t0);
    this.t0 = null;
    return { format: 'jgo-input-recording', version: 1, ...meta, durationMs, events: this.events };
  }
}

/** Plays a recording back with the original timing. Events are sent as they fall due; a late timer sends several at once. */
export class Replayer {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;

  get active(): boolean { return this.running; }

  play(rec: Recording, send: (ev: ClientEvent) => void, onDone: () => void): void {
    this.stop();
    this.running = true;
    const start = performance.now();
    let i = 0;
    const tick = () => {
      const elapsed = performance.now() - start;
      while (i < rec.events.length && rec.events[i]!.at <= elapsed) send(rec.events[i++]!.ev);
      if (i >= rec.events.length) {
        this.running = false;
        onDone();
        return;
      }
      this.timer = setTimeout(tick, Math.max(0, rec.events[i]!.at - (performance.now() - start)));
    };
    tick();
  }

  /** Stops the playback and lets go of every key it still holds down. */
  stop(send?: (ev: ClientEvent) => void): void {
    clearTimeout(this.timer);
    if (this.running) send?.({ t: 'release-all' });
    this.running = false;
  }
}

/** Parses a saved recording; throws a message the user can read. */
export function parseRecording(text: string, gameId: string): Recording {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error('This is not a recording file'); }
  const r = raw as Partial<Recording> | null;
  if (!r || r.format !== 'jgo-input-recording' || r.version !== 1 || !Array.isArray(r.events)) throw new Error('This is not a recording file');
  if (r.gameId !== gameId) throw new Error(`This recording belongs to another game (${String(r.gameName ?? r.gameId).slice(0, 60)})`);
  if (r.events.length > MAX_RECORDED_EVENTS) throw new Error('The recording is too long');
  let last = 0;
  for (const e of r.events) {
    const ev = e?.ev as RecordedEvent | undefined;
    if (!e || typeof e.at !== 'number' || !Number.isFinite(e.at) || e.at < last || !ev || typeof ev !== 'object' || !isRecordable(ev)) throw new Error('The recording file is damaged');
    last = e.at;
  }
  if (![r.width, r.height, r.durationMs].every((n) => typeof n === 'number' && Number.isFinite(n))) throw new Error('The recording file is damaged');
  return r as Recording;
}
