package cc.j2meweb.audio;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import javax.sound.sampled.AudioFormat;
import javax.sound.sampled.Control;
import javax.sound.sampled.FloatControl;
import javax.sound.sampled.Line;
import javax.sound.sampled.LineEvent;
import javax.sound.sampled.LineListener;

/** Shared Line plumbing: listeners, MASTER_GAIN, open/close flags. */
abstract class BaseLine implements Line {
	private final List<LineListener> listeners = new CopyOnWriteArrayList<LineListener>();
	private final Line.Info info;
	protected volatile boolean open;
	protected volatile float gain = 1f;
	private final FloatControl gainControl = new FloatControl(FloatControl.Type.MASTER_GAIN, -80f, 6.0206f, 0.5f, 0, 0f, "dB", "-80", "0", "+6") {
		public void setValue(float v) {
			super.setValue(v);
			gain = (float) Math.pow(10.0, getValue() / 20.0);
		}
	};

	BaseLine(Line.Info info) {
		this.info = info;
	}

	public Line.Info getLineInfo() {
		return info;
	}

	public void addLineListener(LineListener l) {
		if (l != null) listeners.add(l);
	}

	public void removeLineListener(LineListener l) {
		listeners.remove(l);
	}

	protected void fire(LineEvent.Type t, long pos) {
		LineEvent e = new LineEvent(this, t, pos);
		for (LineListener l : listeners) {
			try {
				l.update(e);
			} catch (Throwable ignored) {
			}
		}
	}

	public boolean isOpen() {
		return open;
	}

	public Control[] getControls() {
		return new Control[] {gainControl};
	}

	public boolean isControlSupported(Control.Type t) {
		return t == FloatControl.Type.MASTER_GAIN;
	}

	public Control getControl(Control.Type t) {
		if (t == FloatControl.Type.MASTER_GAIN) return gainControl;
		throw new IllegalArgumentException("Unsupported control: " + t);
	}

	static AudioFormat unwrap(AudioFormat f) {
		return f;
	}
}
