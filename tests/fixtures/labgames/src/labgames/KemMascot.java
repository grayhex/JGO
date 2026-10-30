package labgames;

import com.mascotcapsule.micro3d.v3.AffineTrans;
import com.mascotcapsule.micro3d.v3.Effect3D;
import com.mascotcapsule.micro3d.v3.FigureLayout;
import com.mascotcapsule.micro3d.v3.Graphics3D;
import javax.microedition.lcdui.Canvas;
import javax.microedition.lcdui.Display;
import javax.microedition.lcdui.Graphics;
import javax.microedition.midlet.MIDlet;

/** CC0: Mascot Capsule v3 immediate-mode triangles (no .mbac assets needed). */
public class KemMascot extends MIDlet {
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

	static final class C extends Canvas implements Runnable {
		volatile boolean alive = true;
		int angle;
		int frame;
		final Graphics3D g3d = new Graphics3D();
		final FigureLayout layout = new FigureLayout();
		final Effect3D effect = new Effect3D();

		C() {
			setFullScreenMode(true);
		}

		public void run() {
			while (alive) {
				angle = (angle + 24) & 4095;
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
			g.setColor(0x182030);
			g.fillRect(0, 0, w, h);
			try {
				layout.setCenter(w / 2, h / 2);
				layout.setPerspective(100, 8000, 600);
				AffineTrans at = new AffineTrans();
				at.setIdentity();
				at.rotationY(angle);
				at.m03 = 0; at.m13 = 0; at.m23 = 4096;
				layout.setAffineTrans(at);
				int[] verts = {-1500, -1200, 0, 1500, -1200, 0, 0, 1500, 0};
				int[] colors = {0xff8000};
				int[] none = new int[0]; // the API rejects null normal / texture arrays
				g3d.bind(g);
				try {
					g3d.renderPrimitives(null, 0, 0, layout, effect, Graphics3D.PRIMITVE_TRIANGLES | Graphics3D.PDATA_COLOR_PER_FACE, 1, verts, none, none, colors);
					g3d.flush();
				} finally {
					g3d.release(g);
				}
			} catch (Throwable t) {
				System.out.println("MASCOT_FAILED " + t);
				t.printStackTrace();
			}
			g.setColor(0xffffff);
			g.drawString("Mascot v3 " + frame, 2, 2, Graphics.TOP | Graphics.LEFT);
		}
	}
}
