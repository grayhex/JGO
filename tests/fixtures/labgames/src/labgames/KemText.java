package labgames;

import javax.microedition.lcdui.Command;
import javax.microedition.lcdui.CommandListener;
import javax.microedition.lcdui.Display;
import javax.microedition.lcdui.Displayable;
import javax.microedition.lcdui.Form;
import javax.microedition.lcdui.Item;
import javax.microedition.lcdui.ItemStateListener;
import javax.microedition.lcdui.TextBox;
import javax.microedition.lcdui.TextField;
import javax.microedition.midlet.MIDlet;

/**
 * CC0 test MIDlet for text input: a Form with three TextFields (free text limited to 8 characters,
 * numeric, password) and a command that switches to a TextBox. Every change the player makes is
 * reported on stdout (TEXT_VALUES / TEXTBOX_VALUE), which is what the integration test checks.
 */
public class KemText extends MIDlet implements CommandListener, ItemStateListener {
	private Display display;
	private Form form;
	private TextField any, num, pass;
	private TextBox box;
	private final Command toBox = new Command("Box", Command.SCREEN, 1);
	private final Command done = new Command("Done", Command.OK, 2);

	protected void startApp() {
		display = Display.getDisplay(this);
		form = new Form("Text");
		any = new TextField("Name", "ab", 8, TextField.ANY);
		num = new TextField("Number", "", 6, TextField.NUMERIC);
		pass = new TextField("Secret", "", 8, TextField.PASSWORD);
		form.append(any);
		form.append(num);
		form.append(pass);
		form.addCommand(toBox);
		form.setCommandListener(this);
		form.setItemStateListener(this);
		box = new TextBox("Notes", "note", 12, TextField.ANY);
		box.addCommand(done);
		box.setCommandListener(this);
		display.setCurrent(form);
		System.out.println("TEXT_READY");
	}

	public void itemStateChanged(Item item) {
		System.out.println("TEXT_VALUES any=[" + any.getString() + "] num=[" + num.getString() + "] pass=[" + pass.getString() + "]");
	}

	public void commandAction(Command c, Displayable d) {
		if (c == toBox) {
			display.setCurrent(box);
			System.out.println("TEXT_BOX_SHOWN");
		} else if (c == done) {
			System.out.println("TEXTBOX_VALUE [" + box.getString() + "]");
		}
	}

	protected void pauseApp() {
	}

	protected void destroyApp(boolean u) {
	}
}
