package labgames;

import java.io.ByteArrayInputStream;
import javax.microedition.lcdui.Display;
import javax.microedition.lcdui.Form;
import javax.microedition.media.Manager;
import javax.microedition.media.Player;
import javax.microedition.media.PlayerListener;
import javax.microedition.midlet.MIDlet;

/**
 * CC0 test MIDlet for background music the way games do it: a short generated MIDI, looped forever
 * (setLoopCount(-1)) or restarted from the END_OF_MEDIA event. KemLab-Music: loop | restart.
 */
public class KemMusic extends MIDlet implements PlayerListener {
	// one bar: a note on, 480 ticks later off, then 480 ticks of silence (about 1.0 s at the default 120 bpm)
	private static final byte[] SMF = {
		'M', 'T', 'h', 'd', 0, 0, 0, 6, 0, 0, 0, 1, 1, (byte) 0xE0,
		'M', 'T', 'r', 'k', 0, 0, 0, 14,
		0, (byte) 0x90, 0x3c, 0x7f, (byte) 0x83, 0x60, (byte) 0x80, 0x3c, 0x40, (byte) 0x83, 0x60, (byte) 0xff, 0x2f, 0
	};
	private Player p;
	private int ends;

	protected void startApp() {
		Display.getDisplay(this).setCurrent(new Form("Music"));
		String mode = getAppProperty("KemLab-Music");
		try {
			p = Manager.createPlayer(new ByteArrayInputStream(SMF), "audio/midi");
			p.addPlayerListener(this);
			p.realize();
			p.prefetch();
			if (!"restart".equals(mode)) p.setLoopCount(-1);
			p.start();
			System.out.println("MUSIC_STARTED " + mode);
		} catch (Throwable t) {
			System.out.println("MUSIC_FAILED " + t);
		}
	}

	public void playerUpdate(Player player, String event, Object data) {
		if (PlayerListener.END_OF_MEDIA.equals(event)) {
			ends++;
			System.out.println("MUSIC_END_OF_MEDIA " + ends);
			if ("restart".equals(getAppProperty("KemLab-Music"))) {
				try {
					player.setMediaTime(0);
					player.start();
				} catch (Throwable t) {
					System.out.println("MUSIC_RESTART_FAILED " + t);
				}
			}
		}
	}

	protected void pauseApp() {
	}

	protected void destroyApp(boolean u) {
	}
}
