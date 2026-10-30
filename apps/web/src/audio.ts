import { AUDIO_RATE } from '@j2me-web/protocol';

export interface AudioStats { state: AudioContextState | 'off'; rms: number; bufferedMs: number; chunks: number; bytes: number }

/**
 * Plays the emulator's PCM stream (s16le stereo, 44.1 kHz) through an AudioWorklet.
 * Browsers only allow audio after a user gesture, so call resume() from a click/keydown.
 */
export class PcmAudio {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private gain: GainNode | null = null;
  private ready: Promise<void> | null = null;
  private volume = 0.8;
  private muted = false;
  stats: AudioStats = { state: 'off', rms: 0, bufferedMs: 0, chunks: 0, bytes: 0 };

  private init(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx({ sampleRate: AUDIO_RATE, latencyHint: 'interactive' });
      await ctx.audioWorklet.addModule('/audio-worklet.js');
      const node = new AudioWorkletNode(ctx, 'pcm-player', { numberOfInputs: 0, outputChannelCount: [2] });
      const gain = ctx.createGain();
      node.connect(gain).connect(ctx.destination);
      node.port.onmessage = (e: MessageEvent<{ rms: number; buffered: number }>) => {
        this.stats.rms = e.data.rms;
        this.stats.bufferedMs = Math.round(e.data.buffered * 1000);
      };
      ctx.onstatechange = () => { this.stats.state = ctx.state; };
      this.ctx = ctx; this.node = node; this.gain = gain;
      this.stats.state = ctx.state;
      this.apply();
    })();
    return this.ready;
  }

  async resume(): Promise<void> {
    try {
      await this.init();
      if (this.ctx && this.ctx.state !== 'running') await this.ctx.resume();
      this.stats.state = this.ctx?.state ?? 'off';
    } catch {
      this.stats.state = 'off';
    }
  }

  push(pcm: ArrayBuffer): void {
    this.stats.chunks++;
    this.stats.bytes += pcm.byteLength;
    if (this.node && this.ctx?.state === 'running') this.node.port.postMessage(pcm, [pcm]);
  }

  setVolume(v: number): void { this.volume = Math.max(0, Math.min(1, v)); this.apply(); }
  setMuted(m: boolean): void { this.muted = m; this.apply(); }
  private apply(): void { if (this.gain) this.gain.gain.value = this.muted ? 0 : this.volume * this.volume; }

  close(): void {
    void this.ctx?.close();
    this.ctx = null; this.node = null; this.gain = null; this.ready = null;
    this.stats.state = 'off';
  }
}
