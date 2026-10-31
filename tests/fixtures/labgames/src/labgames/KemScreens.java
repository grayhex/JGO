package labgames;

import javax.microedition.lcdui.Alert;
import javax.microedition.lcdui.AlertType;
import javax.microedition.lcdui.Canvas;
import javax.microedition.lcdui.ChoiceGroup;
import javax.microedition.lcdui.Command;
import javax.microedition.lcdui.CommandListener;
import javax.microedition.lcdui.Display;
import javax.microedition.lcdui.Displayable;
import javax.microedition.lcdui.Form;
import javax.microedition.lcdui.Gauge;
import javax.microedition.lcdui.Graphics;
import javax.microedition.lcdui.List;
import javax.microedition.lcdui.StringItem;
import javax.microedition.lcdui.TextBox;
import javax.microedition.lcdui.TextField;
import javax.microedition.lcdui.Ticker;
import javax.microedition.midlet.MIDlet;

/**
 * CC0 test MIDlet: shows one high-level LCDUI screen chosen by the JAD/manifest attribute
 * KemLab-Screen (form | list | textbox | alert | canvascmd). Real games open Forms/Lists/Alerts
 * (language pickers, "sound on?" prompts), so each must either render or fail visibly.
 */
public class KemScreens extends MIDlet implements CommandListener {
	private Display display;
	private final Command ok = new Command("OK", Command.OK, 1);
	private final Command back = new Command("Back", Command.BACK, 2);
	private final Command opt1 = new Command("Option A", Command.SCREEN, 3);
	private final Command opt2 = new Command("Option B", Command.SCREEN, 4);

	protected void startApp() {
		display = Display.getDisplay(this);
		String kind = getAppProperty("KemLab-Screen");
		if (kind == null) kind = "form";
		Displayable d;
		try {
			if (kind.equals("list")) {
				List l = new List("Pick one", List.IMPLICIT);
				l.append("Alpha", null);
				l.append("Beta", null);
				l.append("Gamma", null);
				l.setSelectCommand(ok);
				d = l;
			} else if (kind.equals("textbox")) {
				d = new TextBox("Name", "hello", 32, TextField.ANY);
			} else if (kind.equals("alert")) {
				Alert a = new Alert("Notice", "Sound on?", null, AlertType.INFO);
				a.setTimeout(Alert.FOREVER);
				display.setCurrent(a, new Canvas() {
					protected void paint(Graphics g) {
						g.setColor(0x004000);
						g.fillRect(0, 0, getWidth(), getHeight());
						g.setColor(0xffffff);
						g.drawString("after alert", 4, 4, Graphics.TOP | Graphics.LEFT);
					}
				});
				System.out.println("SCREEN_SHOWN alert");
				return;
			} else if (kind.equals("canvascmd")) {
				Canvas c = new Canvas() {
					protected void paint(Graphics g) {
						g.setColor(0x202040);
						g.fillRect(0, 0, getWidth(), getHeight());
						g.setColor(0xffffff);
						g.drawString("canvas with commands", 4, 4, Graphics.TOP | Graphics.LEFT);
					}
				};
				c.addCommand(back);
				c.addCommand(opt1);
				c.addCommand(opt2);
				c.setCommandListener(this);
				display.setCurrent(c);
				System.out.println("SCREEN_SHOWN canvascmd");
				return;
			} else {
				Form f = new Form("Settings");
				try {
					javax.microedition.lcdui.Image im = javax.microedition.lcdui.Image.createImage("/icon.png");
					System.out.println("IMAGE_LOADED " + im.getWidth() + "x" + im.getHeight());
				} catch (Exception e) {
					// jars without that resource (the plain form fixture) simply have no image
				}
				f.append(new StringItem("Hello", "KemLab form"));
				f.append(new TextField("Name", "player", 16, TextField.ANY));
				ChoiceGroup cg = new ChoiceGroup("Sound", ChoiceGroup.EXCLUSIVE, new String[] {"On", "Off"}, null);
				f.append(cg);
				f.append(new Gauge("Volume", true, 10, 5));
				f.setTicker(new Ticker("KemLab ticker "));
				d = f;
			}
			d.addCommand(ok);
			d.addCommand(back);
			d.setCommandListener(this);
			display.setCurrent(d);
			System.out.println("SCREEN_SHOWN " + kind);
		} catch (Throwable t) {
			System.out.println("SCREEN_FAILED " + kind + " " + t);
			t.printStackTrace();
		}
	}

	public void commandAction(Command c, Displayable d) {
		System.out.println("COMMAND_ACTION " + c.getLabel());
	}

	protected void pauseApp() {
	}

	protected void destroyApp(boolean u) {
	}
}
