import { AUDIO_RATE } from '@j2me-web/protocol';

export interface AudioStats { state: AudioContextState | 'off'; rms: number; bufferedMs: number; chunks: number; bytes: number }

/**
 * Plays the emulator's PCM stream (s16le stereo, 44.1 kHz) through an AudioWorklet.
 * Browsers only allow audio after a user gesture, so call resume() from a click/keydown.
 *
 * AudioWorklet exists only in secure contexts (HTTPS or localhost). A self-hosted install is
 * normally opened as http://<LAN IP>:8080, which is not one, so there the same jitter buffer
 * runs on the main thread behind a ScriptProcessorNode (deprecated, but available everywhere).
 */
/**
 * The emulator mixes game sound with little headroom, so at "100 %" it was
 * much quieter than a video in another tab. The volume curve now reaches +9.5 dB, and a limiter after it keeps loud
 * passages from clipping instead of turning the volume down for the quiet ones.
 */
export const LOUDNESS = 3;

class PcmRing {
  private cap = AUDIO_RATE * 2;
  private l = new Float32Array(this.cap);
  private r = new Float32Array(this.cap);
  private rd = 0;
  private wr = 0;
  fill = 0;
  private playing = false;
  private frac = 0;
  private sum = 0;
  private n = 0;
  constructor(private rate: number) {}
  private get ratio(): number { return AUDIO_RATE / this.rate; }

  push(s16: Int16Array): void {
    const frames = s16.length >> 1;
    for (let i = 0; i < frames; i++) {
      if (this.fill >= this.cap) { this.rd = (this.rd + 1) % this.cap; this.fill--; }
      this.l[this.wr] = s16[i * 2]! / 32768;
      this.r[this.wr] = s16[i * 2 + 1]! / 32768;
      this.wr = (this.wr + 1) % this.cap;
      this.fill++;
    }
    if (this.fill > Math.round(this.rate * 0.4 * this.ratio)) { // too far behind: skip ahead, keep ~150 ms
      const drop = this.fill - Math.round(this.rate * 0.15 * this.ratio);
      this.rd = (this.rd + drop) % this.cap;
      this.fill -= drop;
    }
  }

  render(L: Float32Array, R: Float32Array): void {
    if (!this.playing && this.fill >= this.rate * 0.08 * this.ratio) this.playing = true;
    for (let i = 0; i < L.length; i++) {
      if (this.playing && this.fill > 1) {
        const nx = (this.rd + 1) % this.cap;
        const l = this.l[this.rd]! + (this.l[nx]! - this.l[this.rd]!) * this.frac;
        const r = this.r[this.rd]! + (this.r[nx]! - this.r[this.rd]!) * this.frac;
        L[i] = l; R[i] = r;
        this.sum += l * l; this.n++;
        this.frac += this.ratio;
        while (this.frac >= 1 && this.fill > 1) { this.frac -= 1; this.rd = (this.rd + 1) % this.cap; this.fill--; }
      } else {
        L[i] = 0; R[i] = 0;
        if (this.playing && this.fill <= 1) this.playing = false; // underrun: re-buffer
      }
    }
  }

  /** RMS of what was rendered since the last call, and the buffered time in seconds. */
  take(): { rms: number; buffered: number } {
    const out = { rms: this.n ? Math.sqrt(this.sum / this.n) : 0, buffered: this.fill / this.ratio / this.rate };
    this.sum = 0; this.n = 0;
    return out;
  }
}

export class PcmAudio {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private ring: PcmRing | null = null;
  private proc: ScriptProcessorNode | null = null;
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
      const gain = ctx.createGain();
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -3; limiter.knee.value = 3; limiter.ratio.value = 20; limiter.attack.value = 0.002; limiter.release.value = 0.12;
      gain.connect(limiter).connect(ctx.destination);
      let node: AudioWorkletNode | null = null;
      if (ctx.audioWorklet) {
        await ctx.audioWorklet.addModule('/audio-worklet.js');
        node = new AudioWorkletNode(ctx, 'pcm-player', { numberOfInputs: 0, outputChannelCount: [2] });
        node.connect(gain);
        node.port.onmessage = (e: MessageEvent<{ rms: number; buffered: number }>) => {
          this.stats.rms = e.data.rms;
          this.stats.bufferedMs = Math.round(e.data.buffered * 1000);
        };
      } else {
        const ring = new PcmRing(ctx.sampleRate);
        const proc = ctx.createScriptProcessor(2048, 0, 2);
        let blocks = 0;
        proc.onaudioprocess = (e) => {
          ring.render(e.outputBuffer.getChannelData(0), e.outputBuffer.getChannelData(1));
          if (++blocks % 8 === 0) {
            const t = ring.take();
            this.stats.rms = t.rms;
            this.stats.bufferedMs = Math.round(t.buffered * 1000);
          }
        };
        proc.connect(gain);
        this.ring = ring; this.proc = proc;
      }
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
    if (this.ctx?.state !== 'running') return;
    if (this.node) this.node.port.postMessage(pcm, [pcm]);
    else this.ring?.push(new Int16Array(pcm));
  }

  setVolume(v: number): void { this.volume = Math.max(0, Math.min(1, v)); this.apply(); }
  setMuted(m: boolean): void { this.muted = m; this.apply(); }
  private apply(): void { if (this.gain) this.gain.gain.value = this.muted ? 0 : this.volume * this.volume * LOUDNESS; }

  close(): void {
    void this.ctx?.close();
    this.proc?.disconnect();
    this.ctx = null; this.node = null; this.gain = null; this.ring = null; this.proc = null; this.ready = null;
    this.stats.state = 'off';
  }
}
