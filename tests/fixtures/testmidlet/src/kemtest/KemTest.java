package kemtest;

import javax.microedition.lcdui.Canvas;
import javax.microedition.lcdui.Display;
import javax.microedition.lcdui.Font;
import javax.microedition.lcdui.Graphics;
import javax.microedition.media.Manager;
import javax.microedition.media.Player;
import javax.microedition.midlet.MIDlet;
import javax.microedition.rms.RecordStore;

/**
 * Free test MIDlet for the J2ME Web project (CC0 / public domain).
 * Draws colour reference blocks (to verify framebuffer channel order), a bouncing
 * square, a frame counter, the last key code, and a persistent RMS launch counter.
 */
public class KemTest extends MIDlet {
	private TestCanvas canvas;
	private volatile boolean running;

	protected void startApp() {
		if (canvas == null) {
			canvas = new TestCanvas();
			canvas.launches = bumpLaunchCounter();
			System.out.println("LAUNCHES " + canvas.launches);
			System.out.println("PLATFORM " + System.getProperty("microedition.platform"));
			Display.getDisplay(this).setCurrent(canvas);
			running = true;
			new Thread(canvas).start();
		}
	}

	protected void pauseApp() {
	}

	protected void destroyApp(boolean unconditional) {
		running = false;
		if (canvas != null) canvas.stop();
	}

	private static int bumpLaunchCounter() {
		int n = 0;
		try {
			RecordStore rs = RecordStore.openRecordStore("kemtest", true);
			if (rs.getNumRecords() == 0) {
				rs.addRecord(new byte[]{0}, 0, 1);
			}
			byte[] d = rs.getRecord(1);
			n = (d[0] & 0xff) + 1;
			rs.setRecord(1, new byte[]{(byte) n}, 0, 1);
			rs.closeRecordStore();
		} catch (Exception e) {
			System.out.println("RMS error: " + e);
		}
		return n;
	}

	static final class TestCanvas extends Canvas implements Runnable {
		int launches;
		int frame;
		int x = 40, y = 60, dx = 3, dy = 2;
		int lastKey = 0, lastAction = 0;
		boolean down;
		int px = 0, py = 0; // pointer
		volatile boolean alive = true;
		String status = "idle";

		void stop() {
			alive = false;
		}

		public void run() {
			while (alive) {
				int w = getWidth(), h = getHeight();
				x += dx;
				y += dy;
				if (x < 0 || x > w - 16) dx = -dx;
				if (y < 30 || y > h - 16) dy = -dy;
				frame++;
				repaint();
				serviceRepaints();
				try {
					Thread.sleep(33);
				} catch (InterruptedException e) {
					return;
				}
			}
		}

		protected void paint(Graphics g) {
			int w = getWidth(), h = getHeight();
			g.setColor(0x202020);
			g.fillRect(0, 0, w, h);
			// reference blocks: pure R, G, B, white in the corners
			g.setColor(0xFF0000);
			g.fillRect(0, 0, 8, 8);
			g.setColor(0x00FF00);
			g.fillRect(w - 8, 0, 8, 8);
			g.setColor(0x0000FF);
			g.fillRect(0, h - 8, 8, 8);
			g.setColor(0xFFFFFF);
			g.fillRect(w - 8, h - 8, 8, 8);
			// moving square (colour flips while a key is held)
			g.setColor(down ? 0xFFFF00 : 0x00C0FF);
			g.fillRect(x, y, 16, 16);
			g.setColor(0xFFFFFF);
			Font f = Font.getDefaultFont();
			g.setFont(f);
			g.drawString("KEM TEST " + w + "x" + h, 12, 2, Graphics.TOP | Graphics.LEFT);
			g.drawString("frame " + frame, 12, 2 + f.getHeight(), Graphics.TOP | Graphics.LEFT);
			g.drawString("key " + lastKey + " act " + lastAction + (down ? " DOWN" : " up"), 4, h - 12 - 2 * f.getHeight(), Graphics.TOP | Graphics.LEFT);
			g.drawString("launches " + launches, 4, h - 12 - f.getHeight(), Graphics.TOP | Graphics.LEFT);
		}

		/** 1 s, 440 Hz, 22.05 kHz mono 16-bit WAV generated in memory. */
		static byte[] sineWav() {
			int rate = 22050, n = rate;
			byte[] w = new byte[44 + n * 2];
			put(w, 0, "RIFF"); le32(w, 4, 36 + n * 2); put(w, 8, "WAVE"); put(w, 12, "fmt "); le32(w, 16, 16);
			w[20] = 1; w[22] = 1; le32(w, 24, rate); le32(w, 28, rate * 2); w[32] = 2; w[34] = 16;
			put(w, 36, "data"); le32(w, 40, n * 2);
			for (int i = 0; i < n; i++) {
				int v = (int) (Math.sin(2 * Math.PI * 440 * i / rate) * 12000);
				w[44 + i * 2] = (byte) v;
				w[45 + i * 2] = (byte) (v >> 8);
			}
			return w;
		}

		static void put(byte[] b, int o, String s) { for (int i = 0; i < s.length(); i++) b[o + i] = (byte) s.charAt(i); }
		static void le32(byte[] b, int o, int v) { b[o] = (byte) v; b[o + 1] = (byte) (v >> 8); b[o + 2] = (byte) (v >> 16); b[o + 3] = (byte) (v >> 24); }

		void playAudio(int k) {
			try {
				if (k == KEY_NUM1) {
					Player p = Manager.createPlayer(new java.io.ByteArrayInputStream(sineWav()), "audio/x-wav");
					p.realize();
					p.prefetch();
					p.start();
					System.out.println("AUDIO_WAV_STARTED");
				} else if (k == KEY_NUM3) {
					Class.forName("com.vendor.MissingApi"); // simulates a game using an API the emulator lacks
				} else if (k == KEY_NUM2) {
					Manager.playTone(69, 1000, 100); // A4 via the MIDI synthesizer
					System.out.println("AUDIO_TONE_STARTED");
				}
			} catch (Throwable t) {
				if (k == KEY_NUM3) t.printStackTrace();
				else System.out.println("AUDIO_FAILED " + t);
			}
		}

		protected void keyPressed(int k) {
			playAudio(k);
			lastKey = k;
			try { lastAction = getGameAction(k); } catch (Exception e) { lastAction = -99; }
			down = true;
			System.out.println("KEY_DOWN " + k);
			System.out.println("ACTION " + k + " " + lastAction);
			switch (lastAction) {
				case LEFT: dx = -Math.abs(dx); break;
				case RIGHT: dx = Math.abs(dx); break;
				case UP: dy = -Math.abs(dy); break;
				case DOWN: dy = Math.abs(dy); break;
				default: break;
			}
		}

		protected void keyReleased(int k) {
			down = false;
			System.out.println("KEY_UP " + k);
		}

		protected void keyRepeated(int k) {
			System.out.println("KEY_REPEAT " + k);
		}

		protected void pointerPressed(int a, int b) {
			px = a; py = b; down = true;
			System.out.println("POINTER_DOWN " + a + "," + b);
		}

		protected void pointerReleased(int a, int b) {
			down = false;
			System.out.println("POINTER_UP " + a + "," + b);
		}
	}
}
