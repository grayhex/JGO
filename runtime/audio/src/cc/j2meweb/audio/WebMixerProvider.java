package cc.j2meweb.audio;

import javax.sound.sampled.Mixer;
import javax.sound.sampled.spi.MixerProvider;

/** Java Sound SPI entry point (see META-INF/services). Select with -Djavax.sound.sampled.Clip=cc.j2meweb.audio.WebMixerProvider. */
public final class WebMixerProvider extends MixerProvider {
	private static final WebMixer MIXER = new WebMixer();

	public Mixer.Info[] getMixerInfo() {
		return new Mixer.Info[] {WebMixer.INFO};
	}

	public Mixer getMixer(Mixer.Info info) {
		if (info == null || info.equals(WebMixer.INFO)) return MIXER;
		throw new IllegalArgumentException("Mixer not supported: " + info);
	}
}
