package cc.j2meweb.audio;

import javax.sound.sampled.AudioFormat;
import javax.sound.sampled.DataLine;
import javax.sound.sampled.LineEvent;
import javax.sound.sampled.LineUnavailableException;
import javax.sound.sampled.SourceDataLine;

/** Streaming line (used by the Gervill MIDI synthesizer and javazoom MP3). write() is paced by the mixer. */
final class WebSourceDataLine extends BaseLine implements SourceDataLine, WebAudio.Voice {
	private AudioFormat format;
	private float[] ring; // stereo frames at source rate
	private int ringFrames;
	private int rd, wr, fill;
	private volatile boolean running;
	private volatile boolean flushing;
	private long consumedFrames; // source frames pulled by the mixer
	private double srcPos; // fractional read position between ring[rd] and ring[rd+1]
	private float lastL, lastR;
	private int bufferBytes;
	private final Object lock = new Object();

	WebSourceDataLine(DataLine.Info info) {
		super(info);
	}

	public void open(AudioFormat f, int bufferSize) throws LineUnavailableException {
		if (open) throw new IllegalStateException("line is already open");
		if (!PcmUtil.supported(f)) throw new IllegalArgumentException("Unsupported format " + f);
		format = f;
		bufferBytes = bufferSize > 0 ? bufferSize : (int) (f.getFrameRate() * 0.25) * f.getFrameSize();
		ringFrames = Math.max(bufferBytes / Math.max(1, f.getFrameSize()), 1024);
		ring = new float[ringFrames * 2];
		rd = wr = fill = 0;
		open = true;
		WebAudio.add(this); // registered right away so the 10 ms clock exists even before start()
		fire(LineEvent.Type.OPEN, 0);
	}

	public void open(AudioFormat f) throws LineUnavailableException {
		open(f, 0);
	}

	public void open() throws LineUnavailableException {
		open(new AudioFormat(44100f, 16, 2, true, false));
	}

	public int write(byte[] b, int off, int len) {
		if (!open) return 0;
		int frameSize = format.getFrameSize();
		len -= len % frameSize;
		float[] tmp = new float[Math.min(len / frameSize, 4096) * 2 + 2];
		int done = 0;
		while (done < len && open) {
			int chunkFrames = Math.min((len - done) / frameSize, tmp.length / 2);
			if (chunkFrames == 0) break;
			PcmUtil.toStereo(format, b, off + done, chunkFrames * frameSize, tmp, 0);
			int i = 0;
			synchronized (lock) {
				while (i < chunkFrames && open) {
					if (flushing) { done = len; i = chunkFrames; break; }
					if (fill >= ringFrames) {
						try {
							lock.wait(20);
						} catch (InterruptedException e) {
							Thread.currentThread().interrupt();
							return done;
						}
						continue;
					}
					ring[wr * 2] = tmp[i * 2];
					ring[wr * 2 + 1] = tmp[i * 2 + 1];
					wr = (wr + 1) % ringFrames;
					fill++;
					i++;
				}
			}
			done += chunkFrames * frameSize;
		}
		return done;
	}

	public boolean mix(float[] acc, int frames) {
		if (!open) return false;
		if (!running) return true;
		double step = format.getFrameRate() / (double) WebAudio.RATE;
		float g = gain;
		synchronized (lock) {
			for (int i = 0; i < frames; i++) {
				if (fill <= 0) { // underrun: output nothing, keep clock
					break;
				}
				int n = (rd + 1) % ringFrames;
				float l0 = ring[rd * 2], r0 = ring[rd * 2 + 1];
				float l1 = fill > 1 ? ring[n * 2] : l0, r1 = fill > 1 ? ring[n * 2 + 1] : r0;
				float t = (float) srcPos;
				acc[i * 2] += (l0 + (l1 - l0) * t) * g;
				acc[i * 2 + 1] += (r0 + (r1 - r0) * t) * g;
				srcPos += step;
				while (srcPos >= 1.0 && fill > 0) {
					srcPos -= 1.0;
					rd = (rd + 1) % ringFrames;
					fill--;
					consumedFrames++;
				}
			}
			lock.notifyAll();
		}
		return true;
	}

	public void drain() {
		long t0 = System.nanoTime();
		synchronized (lock) {
			while (open && running && fill > 0 && System.nanoTime() - t0 < 5_000_000_000L) {
				try {
					lock.wait(10);
				} catch (InterruptedException e) {
					Thread.currentThread().interrupt();
					return;
				}
			}
		}
	}

	public void flush() {
		synchronized (lock) {
			flushing = true;
			rd = wr = fill = 0;
			srcPos = 0;
			flushing = false;
			lock.notifyAll();
		}
	}

	public void start() {
		if (!open || running) return;
		running = true;
		fire(LineEvent.Type.START, consumedFrames);
	}

	public void stop() {
		if (!running) return;
		running = false;
		fire(LineEvent.Type.STOP, consumedFrames);
	}

	public void close() {
		if (!open) return;
		open = false;
		running = false;
		WebAudio.remove(this);
		synchronized (lock) {
			lock.notifyAll();
		}
		fire(LineEvent.Type.CLOSE, consumedFrames);
	}

	public int available() {
		synchronized (lock) {
			return (ringFrames - fill) * format.getFrameSize();
		}
	}

	public int getBufferSize() {
		return ringFrames * (format != null ? format.getFrameSize() : 4);
	}

	public AudioFormat getFormat() {
		return format;
	}

	public int getFramePosition() {
		return (int) consumedFrames;
	}

	public long getLongFramePosition() {
		return consumedFrames;
	}

	public long getMicrosecondPosition() {
		return (long) (consumedFrames * 1_000_000.0 / format.getFrameRate());
	}

	public float getLevel() {
		return -1f;
	}

	public boolean isRunning() {
		return running;
	}

	public boolean isActive() {
		return running && fill > 0;
	}
}
