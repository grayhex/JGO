package labgames;

import javax.microedition.lcdui.Canvas;
import javax.microedition.lcdui.Display;
import javax.microedition.lcdui.Font;
import javax.microedition.lcdui.Graphics;
import javax.microedition.midlet.MIDlet;

/** CC0 test MIDlet: reports the device properties that the per-game emulation options change. */
public class KemProps extends MIDlet {
	protected void startApp() {
		Canvas c = new Canvas() {
			protected void paint(Graphics g) {
				g.setColor(0x203040);
				g.fillRect(0, 0, getWidth(), getHeight());
			}
		};
		Display.getDisplay(this).setCurrent(c);
		System.out.println("PROPS locale=" + System.getProperty("microedition.locale")
			+ " pointer=" + c.hasPointerEvents()
			+ " fonts=" + Font.getFont(Font.FACE_SYSTEM, Font.STYLE_PLAIN, Font.SIZE_SMALL).getHeight()
			+ "/" + Font.getFont(Font.FACE_SYSTEM, Font.STYLE_PLAIN, Font.SIZE_MEDIUM).getHeight()
			+ "/" + Font.getFont(Font.FACE_SYSTEM, Font.STYLE_PLAIN, Font.SIZE_LARGE).getHeight());
	}

	protected void pauseApp() {
	}

	protected void destroyApp(boolean u) {
	}
}
