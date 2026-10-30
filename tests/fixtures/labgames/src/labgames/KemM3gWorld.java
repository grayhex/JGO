package labgames;

import javax.microedition.lcdui.Canvas;
import javax.microedition.lcdui.Display;
import javax.microedition.lcdui.Graphics;
import javax.microedition.m3g.Appearance;
import javax.microedition.m3g.Background;
import javax.microedition.m3g.Camera;
import javax.microedition.m3g.Graphics3D;
import javax.microedition.m3g.Image2D;
import javax.microedition.m3g.Light;
import javax.microedition.m3g.Material;
import javax.microedition.m3g.Mesh;
import javax.microedition.m3g.PolygonMode;
import javax.microedition.m3g.Texture2D;
import javax.microedition.m3g.TriangleStripArray;
import javax.microedition.m3g.VertexArray;
import javax.microedition.m3g.VertexBuffer;
import javax.microedition.m3g.World;
import javax.microedition.midlet.MIDlet;

/**
 * CC0 test MIDlet for M3G retained mode: a World with a Camera, a directional Light, and a textured, lit quad
 * (red/blue checker Texture2D, Material), drawn with Graphics3D.render(World). Most games use this scene graph,
 * the other fixtures only use immediate mode.
 */
public class KemM3gWorld extends MIDlet {
	protected void startApp() {
		final C c = new C();
		Display.getDisplay(this).setCurrent(c);
		new Thread(c).start();
	}

	protected void pauseApp() {
	}

	protected void destroyApp(boolean u) {
	}

	static final class C extends Canvas implements Runnable {
		World world;
		Mesh mesh;
		String err;
		int frames;

		C() {
			setFullScreenMode(true);
			try {
				world = new World();
				Background bg = new Background();
				bg.setColor(0x203040);
				world.setBackground(bg);

				Camera cam = new Camera();
				cam.setPerspective(60f, 240f / 320f, 1f, 50f);
				cam.setTranslation(0f, 0f, 4f);
				world.addChild(cam);
				world.setActiveCamera(cam);

				Light light = new Light();
				light.setMode(Light.DIRECTIONAL);
				light.setColor(0xffffff);
				light.setIntensity(1.3f);
				world.addChild(light);
				Light amb = new Light();
				amb.setMode(Light.AMBIENT);
				amb.setColor(0x808080);
				world.addChild(amb);

				VertexArray pos = new VertexArray(4, 3, 2);
				pos.set(0, 4, new short[] {-100, -100, 0, 100, -100, 0, -100, 100, 0, 100, 100, 0});
				VertexArray nrm = new VertexArray(4, 3, 1);
				nrm.set(0, 4, new byte[] {0, 0, 127, 0, 0, 127, 0, 0, 127, 0, 0, 127});
				VertexArray uv = new VertexArray(4, 2, 2);
				uv.set(0, 4, new short[] {0, 1, 1, 1, 0, 0, 1, 0});
				VertexBuffer vb = new VertexBuffer();
				vb.setPositions(pos, 0.02f, null);
				vb.setNormals(nrm);
				vb.setTexCoords(0, uv, 1f, null);

				byte[] px = new byte[8 * 8 * 3];
				for (int y = 0; y < 8; y++) {
					for (int x = 0; x < 8; x++) {
						boolean red = ((x / 2) + (y / 2)) % 2 == 0;
						int o = (y * 8 + x) * 3;
						px[o] = (byte) (red ? 255 : 0);
						px[o + 1] = 0;
						px[o + 2] = (byte) (red ? 0 : 255);
					}
				}
				Texture2D tex = new Texture2D(new Image2D(Image2D.RGB, 8, 8, px));
				tex.setFiltering(Texture2D.FILTER_NEAREST, Texture2D.FILTER_NEAREST);
				tex.setWrapping(Texture2D.WRAP_CLAMP, Texture2D.WRAP_CLAMP);
				tex.setBlending(Texture2D.FUNC_MODULATE);

				Material mat = new Material();
				mat.setColor(Material.DIFFUSE, 0xffffffff);
				mat.setColor(Material.AMBIENT, 0xffffffff);
				mat.setVertexColorTrackingEnable(false);
				PolygonMode pm = new PolygonMode();
				pm.setCulling(PolygonMode.CULL_NONE);
				Appearance ap = new Appearance();
				ap.setMaterial(mat);
				ap.setTexture(0, tex);
				ap.setPolygonMode(pm);

				mesh = new Mesh(vb, new TriangleStripArray(0, new int[] {4}), ap);
				world.addChild(mesh);
			} catch (Throwable t) {
				err = "M3GW_FAILED setup " + t;
				System.out.println(err);
			}
		}

		protected void paint(Graphics g) {
			g.setColor(0x000000);
			g.fillRect(0, 0, getWidth(), getHeight());
			if (world == null) return;
			Graphics3D g3d = Graphics3D.getInstance();
			try {
				g3d.bindTarget(g);
				g3d.render(world);
				if (frames++ == 3) System.out.println("M3GW_OK");
			} catch (Throwable t) {
				System.out.println("M3GW_FAILED render " + t);
			} finally {
				g3d.releaseTarget();
			}
		}

		public void run() {
			while (true) {
				if (mesh != null) mesh.postRotate(4f, 0f, 1f, 0f);
				repaint();
				serviceRepaints();
				try {
					Thread.sleep(40);
				} catch (InterruptedException e) {
					return;
				}
			}
		}
	}
}
