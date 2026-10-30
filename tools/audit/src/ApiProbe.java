import javax.microedition.io.Connector;
import javax.microedition.lcdui.Canvas;
import javax.microedition.lcdui.Display;
import javax.microedition.lcdui.Graphics;
import javax.microedition.midlet.MIDlet;

/**
 * CC0 audit probe: optional JSRs a J2ME game may touch (WMA/SMS, FileConnection, PIM, Location, Sensors,
 * Bluetooth, camera capture) plus the device properties the MIDlet can read. One "API <name> <OK|FAIL>" line each.
 * Classes are looked up by name, so the probe itself runs even where an API is missing.
 */
public class ApiProbe extends MIDlet {
	private static final String[] PROPS = {
		"microedition.platform", "microedition.profiles", "microedition.configuration", "microedition.locale",
		"microedition.encoding", "microedition.io.file.FileConnection.version", "microedition.pim.version",
		"microedition.location.version", "microedition.sensor.version", "microedition.media.version",
		"supports.mixing", "supports.audio.capture", "supports.video.capture", "supports.recording",
		"video.snapshot.encodings", "fileconn.dir.photos", "fileconn.dir.memorycard",
		"bluetooth.api.version", "microedition.m3g.version", "wireless.messaging.sms.smsc",
	};

	protected void startApp() {
		final Canvas c = new Canvas() {
			protected void paint(Graphics g) {
				g.setColor(0x103010);
				g.fillRect(0, 0, getWidth(), getHeight());
				g.setColor(0xffffff);
				g.drawString("api probe", 4, 4, Graphics.TOP | Graphics.LEFT);
			}
		};
		Display.getDisplay(this).setCurrent(c);
		new Thread(new Runnable() {
			public void run() {
				try { Thread.sleep(1500); } catch (InterruptedException e) { }
				System.out.println("API canvas hasPointerEvents=" + c.hasPointerEvents() + " hasPointerMotionEvents=" + c.hasPointerMotionEvents() + " hasRepeatEvents=" + c.hasRepeatEvents());
				for (int i = 0; i < PROPS.length; i++) System.out.println("API prop " + PROPS[i] + "=" + System.getProperty(PROPS[i]));
				try {
					javax.wireless.messaging.MessageConnection mc = (javax.wireless.messaging.MessageConnection) Connector.open("sms://+10000000000");
					javax.wireless.messaging.TextMessage m = (javax.wireless.messaging.TextMessage) mc.newMessage(javax.wireless.messaging.MessageConnection.TEXT_MESSAGE);
					m.setPayloadText("audit");
					mc.send(m);
					System.out.println("API sms-send OK");
				} catch (Throwable t) { System.out.println("API sms-send FAIL " + t); }
				try {
					javax.microedition.io.file.FileConnection fc = (javax.microedition.io.file.FileConnection) Connector.open("file:///root1/audit.txt", Connector.READ_WRITE);
					if (!fc.exists()) fc.create();
					java.io.OutputStream o = fc.openOutputStream();
					o.write(65);
					o.close();
					System.out.println("API file-write OK size=" + fc.fileSize() + " url=" + fc.getURL());
					fc.close();
				} catch (Throwable t) { System.out.println("API file-write FAIL " + t); }
				try {
					java.util.Enumeration e = javax.microedition.io.file.FileSystemRegistry.listRoots();
					StringBuffer sb = new StringBuffer();
					while (e.hasMoreElements()) sb.append(e.nextElement()).append(' ');
					System.out.println("API file-roots OK " + sb);
				} catch (Throwable t) { System.out.println("API file-roots FAIL " + t); }
				try {
					Object l = Class.forName("javax.microedition.location.LocationProvider").getMethod("getInstance", new Class[] { Class.forName("javax.microedition.location.Criteria") }).invoke(null, new Object[] { null });
					System.out.println("API location " + (l == null ? "FAIL no provider" : "OK " + l));
				} catch (Throwable t) { System.out.println("API location FAIL " + t); }
				try {
					Object infos = Class.forName("javax.microedition.sensor.SensorManager").getMethod("findSensors", new Class[] { Class.forName("java.lang.String"), Class.forName("java.lang.String") }).invoke(null, new Object[] { "acceleration", null });
					System.out.println("API sensor-acceleration " + (infos == null ? "FAIL null" : "OK found=" + ((Object[]) infos).length));
				} catch (Throwable t) { System.out.println("API sensor-acceleration FAIL " + t); }
				try {
					Object lp = Class.forName("javax.bluetooth.LocalDevice").getMethod("getLocalDevice", new Class[0]).invoke(null, new Object[0]);
					System.out.println("API bluetooth OK " + lp);
				} catch (Throwable t) { System.out.println("API bluetooth FAIL " + t); }
				try {
					Object pim = Class.forName("javax.microedition.pim.PIM").getMethod("getInstance", new Class[0]).invoke(null, new Object[0]);
					System.out.println("API pim OK " + pim);
				} catch (Throwable t) { System.out.println("API pim FAIL " + t); }
				try {
					javax.microedition.media.Player p = javax.microedition.media.Manager.createPlayer("capture://video");
					p.realize();
					System.out.println("API camera OK");
				} catch (Throwable t) { System.out.println("API camera FAIL " + t); }
				System.out.println("API done");
			}
		}).start();
	}

	protected void pauseApp() { }
	protected void destroyApp(boolean u) { }
}
