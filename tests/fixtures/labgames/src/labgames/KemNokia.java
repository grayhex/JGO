package labgames;

import com.nokia.mid.ui.DeviceControl;
import com.nokia.mid.ui.DirectGraphics;
import com.nokia.mid.ui.DirectUtils;
import com.nokia.mid.ui.FullCanvas;
import javax.microedition.lcdui.Display;
import javax.microedition.lcdui.Graphics;
import javax.microedition.midlet.MIDlet;

/** CC0: Nokia UI API usage (FullCanvas, DirectGraphics alpha polygons, DeviceControl lights/vibra). */
public class KemNokia extends MIDlet {
	private C c;

	protected void startApp() {
		if (c == null) {
			c = new C();
			Display.getDisplay(this).setCurrent(c);
			new Thread(c).start();
		}
	}

	protected void pauseApp() {
	}

	protected void destroyApp(boolean u) {
		if (c != null) c.alive = false;
	}

	static final class C extends FullCanvas implements Runnable {
		volatile boolean alive = true;
		int frame;

		C() {
			try {
				DeviceControl.setLights(0, 100);
				DeviceControl.startVibra(50, 100);
				System.out.println("NOKIA_DEVICECONTROL_OK");
			} catch (Throwable t) {
				System.out.println("NOKIA_DEVICECONTROL_FAILED " + t);
			}
		}

		public void run() {
			while (alive) {
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
			g.setColor(0x101820);
			g.fillRect(0, 0, w, h);
			try {
				DirectGraphics dg = DirectUtils.getDirectGraphics(g);
				dg.setARGBColor(0x80ff2020); // 50% red
				dg.fillTriangle(10, 10 + frame % 20, w - 10, 40, w / 2, h - 30, 0);
				dg.setARGBColor(0xc020ff20);
				dg.fillPolygon(new int[] {20, w - 20, w - 40, 40}, 0, new int[] {h / 2, h / 2, h / 2 + 50, h / 2 + 50}, 0, 4, 0);
			} catch (Throwable t) {
				g.setColor(0xff0000);
				g.drawString("DirectGraphics failed " + t, 2, 20, Graphics.TOP | Graphics.LEFT);
			}
			g.setColor(0xffffff);
			g.drawString("Nokia FullCanvas " + frame, 2, 2, Graphics.TOP | Graphics.LEFT);
		}

		protected void keyPressed(int k) {
			System.out.println("NOKIA_KEY " + k + (k == KEY_SOFTKEY1 ? " SOFT1" : k == KEY_SOFTKEY2 ? " SOFT2" : ""));
		}
	}
}
