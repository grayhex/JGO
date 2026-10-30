package cc.j2meweb.audio;

import javax.sound.sampled.AudioFormat;
import javax.sound.sampled.Clip;
import javax.sound.sampled.Control;
import javax.sound.sampled.DataLine;
import javax.sound.sampled.Line;
import javax.sound.sampled.LineUnavailableException;
import javax.sound.sampled.Mixer;
import javax.sound.sampled.SourceDataLine;

final class WebMixer implements Mixer {
	static final Mixer.Info INFO = new Mixer.Info("J2ME Web Audio", "j2me-web", "Headless software mixer feeding the web player", "1.0") {
	};
	private static final Line.Info CLIP = new DataLine.Info(Clip.class, null, -1);
	private static final Line.Info SDL = new DataLine.Info(SourceDataLine.class, null, -1);
	private boolean open = true;

	public Mixer.Info getMixerInfo() {
		return INFO;
	}

	public Line.Info[] getSourceLineInfo() {
		return new Line.Info[] {CLIP, SDL};
	}

	public Line.Info[] getTargetLineInfo() {
		return new Line.Info[0];
	}

	public Line.Info[] getSourceLineInfo(Line.Info i) {
		return isLineSupported(i) ? new Line.Info[] {i} : new Line.Info[0];
	}

	public Line.Info[] getTargetLineInfo(Line.Info i) {
		return new Line.Info[0];
	}

	public boolean isLineSupported(Line.Info info) {
		if (!(info instanceof DataLine.Info)) return false;
		DataLine.Info di = (DataLine.Info) info;
		Class<?> c = di.getLineClass();
		if (c != Clip.class && c != SourceDataLine.class && c != DataLine.class) return false;
		for (AudioFormat f : di.getFormats()) {
			if (f != null && f.getEncoding() != null && !PcmUtil.supported(f)) return false;
		}
		return true;
	}

	public Line getLine(Line.Info info) throws LineUnavailableException {
		if (!isLineSupported(info)) throw new IllegalArgumentException("Line unsupported: " + info);
		DataLine.Info di = (DataLine.Info) info;
		if (di.getLineClass() == Clip.class) return new WebClip(di);
		return new WebSourceDataLine(di);
	}

	public int getMaxLines(Line.Info info) {
		return -1;
	}

	public Line[] getSourceLines() {
		return new Line[0];
	}

	public Line[] getTargetLines() {
		return new Line[0];
	}

	public void synchronize(Line[] lines, boolean maintainSync) {
		throw new IllegalArgumentException("synchronization is not supported");
	}

	public void unsynchronize(Line[] lines) {
	}

	public boolean isSynchronizationSupported(Line[] lines, boolean maintainSync) {
		return false;
	}

	public Line.Info getLineInfo() {
		return new Line.Info(Mixer.class);
	}

	public void open() {
		open = true;
	}

	public void close() {
		open = false;
	}

	public boolean isOpen() {
		return open;
	}

	public Control[] getControls() {
		return new Control[0];
	}

	public boolean isControlSupported(Control.Type t) {
		return false;
	}

	public Control getControl(Control.Type t) {
		throw new IllegalArgumentException("no controls");
	}

	public void addLineListener(javax.sound.sampled.LineListener l) {
	}

	public void removeLineListener(javax.sound.sampled.LineListener l) {
	}
}
