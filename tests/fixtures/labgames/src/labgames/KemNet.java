package labgames;

import java.io.InputStream;
import javax.microedition.io.Connector;
import javax.microedition.io.HttpConnection;
import javax.microedition.lcdui.Canvas;
import javax.microedition.lcdui.Display;
import javax.microedition.lcdui.Graphics;
import javax.microedition.midlet.MIDlet;

/** CC0: network access (security prompt), platformRequest, vibration. */
public class KemNet extends MIDlet {
	protected void startApp() {
		final Canvas c = new Canvas() {
			String status = "starting";

			protected void paint(Graphics g) {
				g.setColor(0x203020);
				g.fillRect(0, 0, getWidth(), getHeight());
				g.setColor(0xffffff);
				g.drawString("net: " + status, 2, 2, Graphics.TOP | Graphics.LEFT);
			}

			protected void keyPressed(int k) {
				if (k == KEY_NUM1) {
					Display.getDisplay(KemNet.this).vibrate(300);
					System.out.println("VIBRATE_REQUESTED");
				} else if (k == KEY_NUM2) {
					try {
						boolean exit = platformRequest("http://example.invalid/open");
						System.out.println("PLATFORM_REQUEST " + exit);
					} catch (Throwable t) {
						System.out.println("PLATFORM_REQUEST_FAILED " + t);
					}
				}
			}
		};
		Display.getDisplay(this).setCurrent(c);
		new Thread(new Runnable() {
			public void run() {
				try {
					System.out.println("NET_OPENING");
					HttpConnection h = (HttpConnection) Connector.open("http://example.invalid/test");
					InputStream in = h.openInputStream();
					System.out.println("NET_OK " + h.getResponseCode());
					in.close();
					h.close();
				} catch (Throwable t) {
					System.out.println("NET_FAILED " + t);
				}
			}
		}).start();
	}

	protected void pauseApp() {
	}

	protected void destroyApp(boolean u) {
	}
}
