package labgames;

import java.io.DataInputStream;
import java.io.OutputStream;
import javax.microedition.io.Connector;
import javax.microedition.io.file.FileConnection;
import javax.microedition.lcdui.Display;
import javax.microedition.lcdui.Form;
import javax.microedition.midlet.MIDlet;

/** CC0 test MIDlet for JSR-75: reads root1/input.txt, writes root1/written.txt. */
public class KemFiles extends MIDlet {
	protected void startApp() {
		Display.getDisplay(this).setCurrent(new Form("Files"));
		new Thread(new Runnable() {
			public void run() {
				try {
					FileConnection in = (FileConnection) Connector.open("file:///root1/input.txt", Connector.READ);
					DataInputStream d = in.openDataInputStream();
					byte[] b = new byte[(int) in.fileSize()];
					d.readFully(b);
					d.close();
					in.close();
					System.out.println("FILES_READ [" + new String(b) + "]");
					FileConnection out = (FileConnection) Connector.open("file:///root1/written.txt", Connector.READ_WRITE);
					if (!out.exists()) out.create();
					OutputStream o = out.openOutputStream();
					o.write("written by the game".getBytes());
					o.close();
					out.close();
				} catch (Throwable t) {
					System.out.println("FILES_FAILED " + t);
				}
				System.out.println("FILES_DONE");
			}
		}).start();
	}

	protected void pauseApp() {
	}

	protected void destroyApp(boolean u) {
	}
}
