package kemtest3d;

import javax.microedition.lcdui.Canvas;
import javax.microedition.lcdui.Display;
import javax.microedition.lcdui.Graphics;
import javax.microedition.m3g.Appearance;
import javax.microedition.m3g.Background;
import javax.microedition.m3g.Camera;
import javax.microedition.m3g.Graphics3D;
import javax.microedition.m3g.PolygonMode;
import javax.microedition.m3g.Transform;
import javax.microedition.m3g.TriangleStripArray;
import javax.microedition.m3g.VertexArray;
import javax.microedition.m3g.VertexBuffer;
import javax.microedition.midlet.MIDlet;

/** Free (CC0) M3G smoke test: a spinning vertex-coloured triangle rendered through Graphics3D. */
public class Kem3D extends MIDlet {
	private C canvas;

	protected void startApp() {
		if (canvas == null) {
			canvas = new C();
			Display.getDisplay(this).setCurrent(canvas);
			new Thread(canvas).start();
		}
	}

	protected void pauseApp() {
	}

	protected void destroyApp(boolean u) {
		if (canvas != null) canvas.alive = false;
	}

	static final class C extends Canvas implements Runnable {
		volatile boolean alive = true;
		float angle;
		int frame;
		String err = "";
		VertexBuffer vb;
		TriangleStripArray tris;
		Appearance ap = new Appearance();
		Background bg = new Background();

		C() {
			setFullScreenMode(true);
			try {
				VertexArray pos = new VertexArray(3, 3, 2);
				pos.set(0, 3, new short[] {-100, -80, 0, 100, -80, 0, 0, 100, 0});
				VertexArray col = new VertexArray(3, 3, 1);
				col.set(0, 3, new byte[] {(byte) 255, 0, 0, 0, (byte) 255, 0, 0, 0, (byte) 255});
				vb = new VertexBuffer();
				vb.setPositions(pos, 1.0f, null);
				vb.setColors(col);
				tris = new TriangleStripArray(0, new int[] {3});
				PolygonMode pm = new PolygonMode();
				pm.setCulling(PolygonMode.CULL_NONE);
				ap.setPolygonMode(pm);
				bg.setColor(0x102030);
			} catch (Throwable t) {
				err = "init: " + t;
				System.out.println("M3G_INIT_FAILED " + t);
			}
		}

		public void run() {
			while (alive) {
				angle += 4;
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
			if (vb == null) {
				g.setColor(0x400000);
				g.fillRect(0, 0, w, h);
				g.setColor(0xffffff);
				g.drawString("M3G unavailable " + err, 2, 2, Graphics.TOP | Graphics.LEFT);
				return;
			}
			Graphics3D g3d = Graphics3D.getInstance();
			try {
				g3d.bindTarget(g);
				g3d.setViewport(0, 0, w, h);
				g3d.clear(bg);
				Camera cam = new Camera();
				cam.setPerspective(60f, (float) w / h, 1f, 1000f);
				Transform ct = new Transform();
				ct.postTranslate(0f, 0f, 300f);
				g3d.setCamera(cam, ct);
				Transform m = new Transform();
				m.postRotate(angle, 0f, 1f, 0f);
				g3d.render(vb, tris, ap, m);
			} catch (Throwable t) {
				System.out.println("M3G_RENDER_FAILED " + t);
			} finally {
				try {
					g3d.releaseTarget();
				} catch (Throwable t) {
					System.out.println("M3G_RELEASE_FAILED " + t);
				}
			}
			g.setColor(0xffffff);
			g.drawString("M3G frame " + frame, 2, 2, Graphics.TOP | Graphics.LEFT);
		}
	}
}
