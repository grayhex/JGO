import { decodeFrameHeader, FRAME_ENC_DEFLATE_RAW, type ClientEvent, type ServerEvent, WS_BIN_AUDIO, WS_BIN_FRAME, WS_FRAME_HEADER_BYTES } from '@j2me-web/protocol';

export interface StreamHandlers {
  onEvent(ev: ServerEvent): void;
  onFrame(img: ImageData): void;
  /** s16le stereo PCM chunk (transferable). */
  onAudio?(pcm: ArrayBuffer): void;
  onConnection(state: 'connecting' | 'open' | 'reconnecting' | 'closed'): void;
}

export interface StreamStats { fps: number; rttMs: number | null; decodeMs: number; bytesPerSec: number; shown: number }

async function inflateRaw(src: Uint8Array): Promise<ArrayBuffer> {
  const ds = new DecompressionStream('deflate-raw');
  const w = ds.writable.getWriter();
  void w.write(src as BufferSource).then(() => w.close());
  return new Response(ds.readable).arrayBuffer();
}

/**
 * WebSocket client for one session. Reconnects with back-off while the session lives, drops
 * decoded frames that arrive while a newer one is already waiting (latest-frame-wins).
 */
export class SessionStream {
  private ws: WebSocket | null = null;
  private closedByUs = false;
  private retry = 0;
  private reconnectTimer = 0;
  private generation = 0;
  private lastMessage = 0;
  private pending: { u8: Uint8Array } | null = null;
  private busy = false;
  private pingTimer = 0;
  private statTimer = 0;
  private shownWindow: number[] = [];
  private bytesWindow: { t: number; n: number }[] = [];
  stats: StreamStats = { fps: 0, rttMs: null, decodeMs: 0, bytesPerSec: 0, shown: 0 };

  private transportLost = () => {
    if(this.closedByUs)return;
    ++this.generation;this.pending=null;
    clearInterval(this.pingTimer);clearInterval(this.statTimer);clearTimeout(this.reconnectTimer);
    this.ws?.close(4000,'transport interrupted');this.ws=null;
    this.h.onConnection('reconnecting');
    const delay=Math.min(5000,400*2**this.retry++);
    this.reconnectTimer=window.setTimeout(()=>{if(!this.closedByUs)this.connect();},delay);
  };
  private offline = () => this.transportLost();
  private online = () => { if(!this.closedByUs && this.ws?.readyState !== WebSocket.OPEN) this.connect(); };
  constructor(private sessionId: string, private h: StreamHandlers) {}

  connect(): void {
    this.closedByUs = false;
    window.addEventListener('offline',this.offline);window.addEventListener('online',this.online);
    this.h.onConnection(this.retry ? 'reconnecting' : 'connecting');
    clearTimeout(this.reconnectTimer);
    clearInterval(this.pingTimer);clearInterval(this.statTimer);this.pending=null;
    const generation = ++this.generation;
    this.ws?.close();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/api/sessions/${this.sessionId}/stream`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      if (generation !== this.generation || this.closedByUs) { ws.close(); return; }
      this.retry = 0;
      this.lastMessage = performance.now();
      this.h.onConnection('open');
      this.send({ t: 'release-all' }); // a fresh connection starts with nothing pressed
      this.send({ t: 'audio', on: true });
      this.pingTimer = window.setInterval(() => { if (performance.now()-this.lastMessage>12000) this.transportLost(); else this.send({ t:'ping',ts:performance.now() }); }, 2000);
      this.statTimer = window.setInterval(() => this.updateStats(), 500);
    };
    ws.onmessage = (m) => {
      if(generation !== this.generation || this.closedByUs) return;
      this.lastMessage = performance.now();
      if (typeof m.data === 'string') {
        let ev: ServerEvent; try { ev=JSON.parse(m.data); } catch { return; }
        if (ev.t === 'pong') this.stats.rttMs = Math.round(performance.now() - ev.ts);
        this.h.onEvent(ev);
        return;
      }
      const u8 = new Uint8Array(m.data as ArrayBuffer);
      if (u8[0] === WS_BIN_AUDIO) {
        this.h.onAudio?.((m.data as ArrayBuffer).slice(1));
        return;
      }
      if (u8[0] !== WS_BIN_FRAME || u8.length < WS_FRAME_HEADER_BYTES) return;
      this.bytesWindow.push({ t: performance.now(), n: u8.length });
      this.pending = { u8 }; // overwrite: stale frames are never rendered
      void this.pump();
    };
    ws.onclose = (e) => {
      if(generation !== this.generation) return;
      ++this.generation;this.pending=null;
      clearTimeout(this.reconnectTimer);
      window.clearInterval(this.pingTimer);
      window.clearInterval(this.statTimer);
      if (this.closedByUs || e.code === 4404 || e.code === 4401) { this.closedByUs=true;window.removeEventListener('offline',this.offline);window.removeEventListener('online',this.online);this.h.onConnection('closed'); return; }
      const delay = Math.min(5000, 400 * 2 ** this.retry++);
      this.h.onConnection('reconnecting');
      this.reconnectTimer = window.setTimeout(() => { if (!this.closedByUs) this.connect(); }, delay);
    };
  }

  private async pump(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.pending) {
        const { u8 } = this.pending;
        this.pending = null;
        const generation = this.generation;
        const t0 = performance.now();
        const hd = decodeFrameHeader(u8);
        const body = u8.subarray(WS_FRAME_HEADER_BYTES);
        const px = hd.enc === FRAME_ENC_DEFLATE_RAW ? new Uint8ClampedArray(await inflateRaw(body)) : new Uint8ClampedArray(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength));
        if(this.closedByUs || generation !== this.generation) continue;
        if (px.length !== hd.w * hd.h * 4) continue;
        this.stats.decodeMs = Math.round((performance.now() - t0) * 10) / 10;
        this.shownWindow.push(performance.now());
        this.stats.shown++;
        this.h.onFrame(new ImageData(px as unknown as Uint8ClampedArray<ArrayBuffer>, hd.w, hd.h));
      }
    } finally {
      this.busy = false;
    }
  }

  private updateStats(): void {
    const now = performance.now();
    this.shownWindow = this.shownWindow.filter((t) => now - t < 2000);
    this.bytesWindow = this.bytesWindow.filter((b) => now - b.t < 2000);
    this.stats.fps = Math.round((this.shownWindow.length / 2) * 10) / 10;
    this.stats.bytesPerSec = Math.round(this.bytesWindow.reduce((a, b) => a + b.n, 0) / 2);
  }

  send(ev: ClientEvent): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(ev));
  }

  close(): void {
    this.closedByUs = true;
    window.removeEventListener('offline',this.offline);window.removeEventListener('online',this.online);
    ++this.generation;
    clearTimeout(this.reconnectTimer);
    this.pending=null;
    window.clearInterval(this.pingTimer);
    window.clearInterval(this.statTimer);
    this.ws?.close(1000);
  }
}
