import java.io.InputStream;
import javax.microedition.lcdui.Canvas;
import javax.microedition.lcdui.Display;
import javax.microedition.lcdui.Graphics;
import javax.microedition.media.Manager;
import javax.microedition.media.Player;
import javax.microedition.media.control.VolumeControl;
import javax.microedition.midlet.MIDlet;

/**
 * CC0 audit probe: tries every media type KEmulator advertises through Manager.createPlayer and
 * prints one machine-readable line per attempt ("PROBE <name> <OK|FAIL> ..."), so the audit runner
 * can compare it with the PCM that arrives on the Bridge audio FIFO.
 */
public class MediaProbe extends MIDlet {
	protected void startApp() {
		Display.getDisplay(this).setCurrent(new Canvas() {
			protected void paint(Graphics g) {
				g.setColor(0x102030);
				g.fillRect(0, 0, getWidth(), getHeight());
				g.setColor(0xffffff);
				g.drawString("media probe", 4, 4, Graphics.TOP | Graphics.LEFT);
			}
		});
		new Thread(new Runnable() {
			public void run() {
				try { Thread.sleep(1500); } catch (InterruptedException e) { }
				try {
					String[] types = Manager.getSupportedContentTypes(null);
					StringBuffer sb = new StringBuffer();
					for (int i = 0; i < types.length; i++) sb.append(types[i]).append(' ');
					System.out.println("PROBE types OK " + sb);
					String[] protos = Manager.getSupportedProtocols(null);
					sb = new StringBuffer();
					for (int i = 0; i < protos.length; i++) sb.append(protos[i]).append(' ');
					System.out.println("PROBE protocols OK " + sb);
				} catch (Throwable t) {
					System.out.println("PROBE types FAIL " + t);
				}
				try {
					System.out.println("PROBE tone START");
					Manager.playTone(69, 900, 100);
					Thread.sleep(1300);
					System.out.println("PROBE tone END OK");
				} catch (Throwable t) {
					System.out.println("PROBE tone END FAIL " + t);
				}
				String[][] items = {
					{"wav", "/a.wav", "audio/x-wav"},
					{"mp3", "/a.mp3", "audio/mpeg"},
					{"amr", "/a.amr", "audio/amr"},
					{"midi", "/a.mid", "audio/midi"},
				};
				for (int i = 0; i < items.length; i++) probe(items[i][0], items[i][1], items[i][2]);
				System.out.println("PROBE done");
			}
		}).start();
	}

	private void probe(String name, String res, String mime) {
		Player p = null;
		try {
			InputStream in = getClass().getResourceAsStream(res);
			if (in == null) { System.out.println("PROBE " + name + " FAIL resource missing"); return; }
			System.out.println("PROBE " + name + " START");
			p = Manager.createPlayer(in, mime);
			p.realize();
			p.prefetch();
			VolumeControl vc = (VolumeControl) p.getControl("VolumeControl");
			if (vc != null) vc.setLevel(100);
			p.start();
			long d = p.getDuration();
			System.out.println("PROBE " + name + " STARTED duration_us=" + d + " volume_control=" + (vc != null));
			Thread.sleep(1700);
			p.stop();
			System.out.println("PROBE " + name + " END OK");
		} catch (Throwable t) {
			System.out.println("PROBE " + name + " END FAIL " + t);
		} finally {
			if (p != null) try { p.close(); } catch (Throwable ignore) { }
		}
	}

	protected void pauseApp() { }
	protected void destroyApp(boolean u) { }
}
