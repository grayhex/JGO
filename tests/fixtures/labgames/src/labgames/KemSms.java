package labgames;

import javax.microedition.io.Connector;
import javax.microedition.lcdui.Display;
import javax.microedition.lcdui.Form;
import javax.microedition.midlet.MIDlet;
import javax.wireless.messaging.MessageConnection;
import javax.wireless.messaging.TextMessage;

/**
 * CC0 test MIDlet: sends one SMS the way games do ("send score by SMS") and reports what the MIDlet sees.
 * A phone without a SIM card throws an IOException; a NullPointerException would be an emulator bug.
 */
public class KemSms extends MIDlet {
	protected void startApp() {
		Display.getDisplay(this).setCurrent(new Form("SMS"));
		new Thread(new Runnable() {
			public void run() {
				try {
					MessageConnection mc = (MessageConnection) Connector.open("sms://+15551234567");
					TextMessage m = (TextMessage) mc.newMessage(MessageConnection.TEXT_MESSAGE);
					m.setPayloadText("hello");
					mc.send(m);
					System.out.println("SMS_RESULT sent");
				} catch (Throwable t) {
					System.out.println("SMS_RESULT " + t.getClass().getName());
				}
				System.out.println("SMS_DONE");
			}
		}).start();
	}

	protected void pauseApp() {
	}

	protected void destroyApp(boolean u) {
	}
}
