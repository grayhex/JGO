package labgames;

import java.util.Random;
import javax.microedition.lcdui.Display;
import javax.microedition.lcdui.Graphics;
import javax.microedition.lcdui.Image;
import javax.microedition.lcdui.game.GameCanvas;
import javax.microedition.lcdui.game.LayerManager;
import javax.microedition.lcdui.game.Sprite;
import javax.microedition.lcdui.game.TiledLayer;
import javax.microedition.midlet.MIDlet;

/** CC0 "typical 2D game": GameCanvas + key polling + TiledLayer background + animated Sprite, full screen. */
public class KemGame extends MIDlet {
	private Loop loop;

	protected void startApp() {
		if (loop == null) {
			loop = new Loop();
			Display.getDisplay(this).setCurrent(loop);
			new Thread(loop).start();
		}
	}

	protected void pauseApp() {
	}

	protected void destroyApp(boolean u) {
		if (loop != null) loop.alive = false;
	}

	static final class Loop extends GameCanvas implements Runnable {
		volatile boolean alive = true;
		final LayerManager lm = new LayerManager();
		final Sprite player;
		final TiledLayer tiles;
		int frame;
		int x = 100, y = 100;

		Loop() {
			super(true);
			setFullScreenMode(true);
			Image tileImg = Image.createImage(32, 16);
			Graphics tg = tileImg.getGraphics();
			tg.setColor(0x336633); tg.fillRect(0, 0, 16, 16);
			tg.setColor(0x669966); tg.fillRect(16, 0, 16, 16);
			tg.setColor(0x224422); tg.drawRect(0, 0, 15, 15);
			tiles = new TiledLayer(16, 24, tileImg, 16, 16);
			Random r = new Random(42);
			for (int c = 0; c < 16; c++) for (int rr = 0; rr < 24; rr++) tiles.setCell(c, rr, 1 + r.nextInt(2));
			Image sp = Image.createImage(48, 16);
			Graphics sg = sp.getGraphics();
			for (int i = 0; i < 3; i++) {
				sg.setColor(i == 0 ? 0xff4040 : i == 1 ? 0xffc040 : 0xffff40);
				sg.fillArc(i * 16 + 1, 1, 14, 14, 0, 360);
			}
			player = new Sprite(sp, 16, 16);
			player.defineReferencePixel(8, 8);
			lm.append(player);
			lm.append(tiles);
		}

		public void run() {
			Graphics g = getGraphics();
			while (alive) {
				int k = getKeyStates();
				if ((k & LEFT_PRESSED) != 0) x -= 3;
				if ((k & RIGHT_PRESSED) != 0) x += 3;
				if ((k & UP_PRESSED) != 0) y -= 3;
				if ((k & DOWN_PRESSED) != 0) y += 3;
				if ((k & FIRE_PRESSED) != 0) System.out.println("GAME_FIRE");
				x = Math.max(0, Math.min(getWidth() - 16, x));
				y = Math.max(0, Math.min(getHeight() - 16, y));
				frame++;
				player.setFrame(frame / 5 % 3);
				player.setPosition(x, y);
				tiles.setPosition(-(frame % 16), 0);
				g.setColor(0x000000);
				g.fillRect(0, 0, getWidth(), getHeight());
				lm.paint(g, 0, 0);
				g.setColor(0xffffff);
				g.drawString("KemGame " + frame, 2, 2, Graphics.TOP | Graphics.LEFT);
				flushGraphics();
				try {
					Thread.sleep(25);
				} catch (InterruptedException e) {
					return;
				}
			}
		}
	}
}
