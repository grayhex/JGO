package cc.j2meweb.audio;

import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Headless audio engine for the Bridge runtime. There is no sound card in the container, so
 * Java Sound has no mixers; this provides one. Every open Clip / SourceDataLine is a Voice.
 * A single real-time thread mixes all voices into 44.1 kHz / 16-bit / stereo / little-endian
 * PCM and writes it to the FIFO named by -Dkem.audio.out (read by the kem-adapter).
 * The 10 ms tick doubles as the "device clock", so games and the MIDI synthesizer are paced
 * exactly as with a real sound card.
 */
final class WebAudio {
	static final int RATE = 44100;
	static final int TICK_FRAMES = 441; // 10 ms
	private static final List<Voice> voices = new CopyOnWriteArrayList<Voice>();
	private static volatile OutputStream out;
	private static Thread thread;
	private static volatile boolean outFailed;

	interface Voice {
		/** Adds up to {@code frames} stereo frames into acc (interleaved L,R). Returns false when finished. */
		boolean mix(float[] acc, int frames);
	}

	static synchronized void add(Voice v) {
		if (!voices.contains(v)) voices.add(v);
		if (thread == null) {
			thread = new Thread(new Runnable() {
				public void run() {
					loop();
				}
			}, "web-audio-mixer");
			thread.setDaemon(true);
			thread.setPriority(Thread.MAX_PRIORITY - 1);
			thread.start();
		}
	}

	static void remove(Voice v) {
		voices.remove(v);
	}

	private static OutputStream sink() {
		if (out != null || outFailed) return out;
		String path = System.getProperty("kem.audio.out");
		if (path == null || path.isEmpty()) {
			outFailed = true;
			return null;
		}
		try {
			out = new FileOutputStream(path);
		} catch (IOException e) {
			outFailed = true;
			System.out.println("[web-audio] cannot open " + path + ": " + e);
		}
		return out;
	}

	private static void loop() {
		float[] acc = new float[TICK_FRAMES * 2];
		byte[] pcm = new byte[TICK_FRAMES * 4];
		long next = System.nanoTime();
		int silentTicks = 0;
		for (;;) {
			next += 10_000_000L;
			java.util.Arrays.fill(acc, 0f);
			for (Voice v : voices) {
				try {
					if (!v.mix(acc, TICK_FRAMES)) voices.remove(v);
				} catch (Throwable t) {
					voices.remove(v);
				}
			}
			// Stay silent on the wire when nothing audible plays (the MIDI synthesizer keeps writing
			// zeros while idle). Judge by signal energy, keep a short tail so releases are not cut.
			float peak = 0f;
			for (int i = 0; i < acc.length; i++) {
				float a = acc[i] < 0 ? -acc[i] : acc[i];
				if (a > peak) peak = a;
			}
			silentTicks = peak > 1.0e-4f ? 0 : silentTicks + 1;
			if (silentTicks < 5) {
				for (int i = 0; i < acc.length; i++) {
					float f = acc[i];
					int s = (int) (f * 32767f);
					if (s > 32767) s = 32767;
					else if (s < -32768) s = -32768;
					pcm[i * 2] = (byte) s;
					pcm[i * 2 + 1] = (byte) (s >> 8);
				}
				OutputStream o = sink();
				if (o != null) {
					try {
						o.write(pcm);
					} catch (IOException e) {
						out = null;
						outFailed = true;
					}
				}
			}
			long sleep = next - System.nanoTime();
			if (sleep > 0) {
				try {
					Thread.sleep(sleep / 1_000_000L, (int) (sleep % 1_000_000L));
				} catch (InterruptedException e) {
					return;
				}
			} else if (sleep < -200_000_000L) {
				next = System.nanoTime(); // fell badly behind: resync instead of bursting
			}
		}
	}
}
