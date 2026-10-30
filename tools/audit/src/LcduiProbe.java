import javax.microedition.lcdui.Command;
import javax.microedition.lcdui.CommandListener;
import javax.microedition.lcdui.Display;
import javax.microedition.lcdui.Displayable;
import javax.microedition.lcdui.Form;
import javax.microedition.lcdui.Item;
import javax.microedition.lcdui.ItemStateListener;
import javax.microedition.lcdui.TextField;
import javax.microedition.midlet.MIDlet;

/**
 * CC0 audit probe: a Form with an editable TextField. It reports what the MIDlet can observe
 * (value, item-state events, commands), because the frontend decides whether typing is possible.
 */
public class LcduiProbe extends MIDlet implements CommandListener, ItemStateListener {
	private TextField tf;

	protected void startApp() {
		Form f = new Form("Probe");
		tf = new TextField("Name", "player", 16, TextField.ANY);
		f.append(tf);
		f.addCommand(new Command("OK", Command.OK, 1));
		f.setCommandListener(this);
		f.setItemStateListener(this);
		Display.getDisplay(this).setCurrent(f);
		System.out.println("LCDUI form shown");
		new Thread(new Runnable() {
			public void run() {
				for (int i = 0; i < 40; i++) {
					System.out.println("LCDUI textfield=" + tf.getString() + " caret=" + tf.getCaretPosition());
					try { Thread.sleep(500); } catch (InterruptedException e) { return; }
				}
			}
		}).start();
	}

	public void itemStateChanged(Item item) { System.out.println("LCDUI itemStateChanged"); }
	public void commandAction(Command c, Displayable d) { System.out.println("LCDUI command " + c.getLabel()); }
	protected void pauseApp() { }
	protected void destroyApp(boolean u) { }
}
