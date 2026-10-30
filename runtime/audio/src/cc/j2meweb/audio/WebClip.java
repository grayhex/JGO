package cc.j2meweb.audio;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import javax.sound.sampled.AudioFormat;
import javax.sound.sampled.AudioInputStream;
import javax.sound.sampled.Clip;
import javax.sound.sampled.DataLine;
import javax.sound.sampled.LineEvent;
import javax.sound.sampled.LineUnavailableException;

/** In-memory sample playback (WAV, AMR, ...). Fires START/STOP so MIDP players see end-of-media. */
final class WebClip extends BaseLine implements Clip, WebAudio.Voice {
	private AudioFormat format;
	private float[] data = new float[0]; // stereo frames at source rate
	private int frames;
	private volatile boolean running;
	private volatile double pos; // source frames
	private int loopStart, loopEnd = -1;
	private int loopsLeft;
	private boolean stopNotified;

	WebClip(DataLine.Info info) {
		super(info);
	}

	public void open(AudioFormat f, byte[] b, int off, int len) throws LineUnavailableException {
		if (open) throw new IllegalStateException("line is already open");
		if (!PcmUtil.supported(f)) throw new IllegalArgumentException("Unsupported format " + f);
		format = f;
		int fs = f.getFrameSize();
		frames = len / fs;
		data = new float[frames * 2];
		PcmUtil.toStereo(f, b, off, frames * fs, data, 0);
		pos = 0;
		loopStart = 0;
		loopEnd = -1;
		open = true;
		fire(LineEvent.Type.OPEN, 0);
	}

	public void open(AudioInputStream ais) throws LineUnavailableException, IOException {
		AudioFormat f = ais.getFormat();
		ByteArrayOutputStream bo = new ByteArrayOutputStream();
		byte[] buf = new byte[8192];
		int n;
		while ((n = ais.read(buf, 0, buf.length)) > 0) bo.write(buf, 0, n);
		byte[] all = bo.toByteArray();
		open(f, all, 0, all.length);
	}

	public void open() throws LineUnavailableException {
		throw new IllegalArgumentException("Clip needs data");
	}

	public boolean mix(float[] acc, int outFrames) {
		if (!open) return false;
		if (!running) return true;
		double step = format.getFrameRate() / (double) WebAudio.RATE;
		float g = gain;
		int end = loopEnd >= 0 ? loopEnd + 1 : frames;
		for (int i = 0; i < outFrames; i++) {
			int p = (int) pos;
			if (p >= end) {
				if (loopsLeft != 0 && frames > 0) {
					if (loopsLeft > 0) loopsLeft--;
					pos = loopStart;
					p = loopStart;
				} else {
					running = false;
					pos = frames;
					fire(LineEvent.Type.STOP, frames);
					return true;
				}
			}
			float t = (float) (pos - p);
			int n = Math.min(p + 1, frames - 1);
			acc[i * 2] += (data[p * 2] + (data[n * 2] - data[p * 2]) * t) * g;
			acc[i * 2 + 1] += (data[p * 2 + 1] + (data[n * 2 + 1] - data[p * 2 + 1]) * t) * g;
			pos += step;
		}
		return true;
	}

	public void start() {
		if (!open || running) return;
		if (pos >= frames) pos = 0;
		running = true;
		WebAudio.add(this);
		fire(LineEvent.Type.START, (long) pos);
	}

	public void stop() {
		if (!running) return;
		running = false;
		fire(LineEvent.Type.STOP, (long) pos);
	}

	public void loop(int count) {
		loopsLeft = count;
		start();
	}

	public void setLoopPoints(int s, int e) {
		if (s < 0 || s >= frames || e < -1 || e >= frames || (e != -1 && e < s)) throw new IllegalArgumentException("illegal loop points");
		loopStart = s;
		loopEnd = e;
	}

	public void setFramePosition(int f) {
		pos = Math.max(0, Math.min(f, frames));
	}

	public void setMicrosecondPosition(long us) {
		setFramePosition((int) (us * format.getFrameRate() / 1_000_000.0));
	}

	public int getFrameLength() {
		return frames;
	}

	public long getMicrosecondLength() {
		return (long) (frames * 1_000_000.0 / format.getFrameRate());
	}

	public void drain() {
		long t0 = System.nanoTime();
		while (running && System.nanoTime() - t0 < 10_000_000_000L) {
			try {
				Thread.sleep(5);
			} catch (InterruptedException e) {
				Thread.currentThread().interrupt();
				return;
			}
		}
	}

	public void flush() {
	}

	public void close() {
		if (!open) return;
		running = false;
		open = false;
		WebAudio.remove(this);
		fire(LineEvent.Type.CLOSE, (long) pos);
	}

	public int available() {
		return 0;
	}

	public int getBufferSize() {
		return frames * (format != null ? format.getFrameSize() : 4);
	}

	public AudioFormat getFormat() {
		return format;
	}

	public int getFramePosition() {
		return (int) pos;
	}

	public long getLongFramePosition() {
		return (long) pos;
	}

	public long getMicrosecondPosition() {
		return (long) (pos * 1_000_000.0 / format.getFrameRate());
	}

	public float getLevel() {
		return -1f;
	}

	public boolean isRunning() {
		return running;
	}

	public boolean isActive() {
		return running;
	}
}
