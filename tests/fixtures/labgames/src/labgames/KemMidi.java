package labgames;

import java.io.ByteArrayInputStream;
import javax.microedition.lcdui.Display;
import javax.microedition.lcdui.Form;
import javax.microedition.media.Manager;
import javax.microedition.media.Player;
import javax.microedition.midlet.MIDlet;

/** CC0 test MIDlet: plays one generated MIDI note, which makes the emulator load its SoundFont. */
public class KemMidi extends MIDlet {
	private static final byte[] SMF = {
		'M', 'T', 'h', 'd', 0, 0, 0, 6, 0, 0, 0, 1, 1, (byte) 0xE0,
		'M', 'T', 'r', 'k', 0, 0, 0, 13,
		0, (byte) 0x90, 0x3c, 0x64, (byte) 0x83, 0x60, (byte) 0x80, 0x3c, 0x40, 0, (byte) 0xff, 0x2f, 0
	};

	protected void startApp() {
		Display.getDisplay(this).setCurrent(new Form("MIDI"));
		new Thread(new Runnable() {
			public void run() {
				try {
					Player p = Manager.createPlayer(new ByteArrayInputStream(SMF), "audio/midi");
					p.realize();
					p.prefetch();
					p.start();
					Thread.sleep(1200);
					p.close();
					System.out.println("MIDI_RESULT ok");
				} catch (Throwable t) {
					System.out.println("MIDI_RESULT " + t);
				}
			}
		}).start();
	}

	protected void pauseApp() {
	}

	protected void destroyApp(boolean u) {
	}
}
