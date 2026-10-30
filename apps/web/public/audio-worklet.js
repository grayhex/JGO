// AudioWorklet: jitter buffer for s16le stereo PCM chunks pushed from the main thread.
class PcmPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.cap = 44100 * 2; // 2 s ring, stereo frames
    this.l = new Float32Array(this.cap);
    this.r = new Float32Array(this.cap);
    this.rd = 0;
    this.wr = 0;
    this.fill = 0;
    this.playing = false;
    this.prebuffer = Math.round(sampleRate * 0.08); // start after 80 ms
    this.maxLatency = Math.round(sampleRate * 0.4); // never lag more than 400 ms behind
    this.ratio = 44100 / sampleRate; // source frames per output frame
    this.frac = 0;
    this.sum = 0;
    this.n = 0;
    this.sent = 0;
    this.port.onmessage = (e) => this.push(new Int16Array(e.data));
  }
  push(s16) {
    const frames = s16.length >> 1;
    for (let i = 0; i < frames; i++) {
      if (this.fill >= this.cap) { this.rd = (this.rd + 1) % this.cap; this.fill--; }
      this.l[this.wr] = s16[i * 2] / 32768;
      this.r[this.wr] = s16[i * 2 + 1] / 32768;
      this.wr = (this.wr + 1) % this.cap;
      this.fill++;
    }
    const srcMax = Math.round(this.maxLatency * this.ratio);
    if (this.fill > srcMax) { // too far behind: skip ahead, keep ~150 ms
      const drop = this.fill - Math.round(sampleRate * 0.15 * this.ratio);
      this.rd = (this.rd + drop) % this.cap;
      this.fill -= drop;
    }
  }
  process(_in, out) {
    const L = out[0][0], R = out[0][1] || out[0][0];
    const need = L.length;
    if (!this.playing && this.fill >= this.prebuffer * this.ratio) this.playing = true;
    for (let i = 0; i < need; i++) {
      if (this.playing && this.fill > 1) {
        const n = (this.rd + 1) % this.cap;
        const t = this.frac;
        const l = this.l[this.rd] + (this.l[n] - this.l[this.rd]) * t;
        const r = this.r[this.rd] + (this.r[n] - this.r[this.rd]) * t;
        L[i] = l; R[i] = r;
        this.sum += l * l; this.n++;
        this.frac += this.ratio;
        while (this.frac >= 1 && this.fill > 1) { this.frac -= 1; this.rd = (this.rd + 1) % this.cap; this.fill--; }
      } else {
        L[i] = 0; R[i] = 0;
        if (this.playing && this.fill <= 1) this.playing = false; // underrun: re-buffer
      }
    }
    this.sent += need;
    if (this.sent >= sampleRate / 10) {
      this.port.postMessage({ rms: this.n ? Math.sqrt(this.sum / this.n) : 0, buffered: this.fill / this.ratio / sampleRate });
      this.sum = 0; this.n = 0; this.sent = 0;
    }
    return true;
  }
}
registerProcessor('pcm-player', PcmPlayer);
