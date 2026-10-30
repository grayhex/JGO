package cc.j2meweb.audio;

import javax.sound.sampled.AudioFormat;

final class PcmUtil {
	private PcmUtil() {
	}

	static boolean supported(AudioFormat f) {
		AudioFormat.Encoding e = f.getEncoding();
		boolean pcm = e == AudioFormat.Encoding.PCM_SIGNED || e == AudioFormat.Encoding.PCM_UNSIGNED;
		int bits = f.getSampleSizeInBits();
		return pcm && (bits == 8 || bits == 16 || bits == 24 || bits == 32) && f.getChannels() >= 1;
	}

	/** Converts interleaved PCM bytes to stereo float frames (L,R). Returns number of frames. */
	static int toStereo(AudioFormat f, byte[] b, int off, int len, float[] dst, int dstOff) {
		int ch = f.getChannels();
		int bytes = f.getSampleSizeInBits() / 8;
		int frameSize = f.getFrameSize() > 0 ? f.getFrameSize() : bytes * ch;
		boolean be = f.isBigEndian();
		boolean unsigned = f.getEncoding() == AudioFormat.Encoding.PCM_UNSIGNED;
		int frames = len / frameSize;
		for (int i = 0; i < frames; i++) {
			int p = off + i * frameSize;
			float l = sample(b, p, bytes, be, unsigned);
			float r = ch > 1 ? sample(b, p + bytes, bytes, be, unsigned) : l;
			dst[dstOff + i * 2] = l;
			dst[dstOff + i * 2 + 1] = r;
		}
		return frames;
	}

	private static float sample(byte[] b, int p, int bytes, boolean be, boolean unsigned) {
		int v;
		switch (bytes) {
			case 1:
				v = unsigned ? (b[p] & 0xff) - 128 : b[p];
				return v / 128f;
			case 2:
				v = be ? (b[p] << 8) | (b[p + 1] & 0xff) : (b[p + 1] << 8) | (b[p] & 0xff);
				if (unsigned) v = (v & 0xffff) - 32768;
				return v / 32768f;
			case 3:
				v = be ? (b[p] << 16) | ((b[p + 1] & 0xff) << 8) | (b[p + 2] & 0xff) : (b[p + 2] << 16) | ((b[p + 1] & 0xff) << 8) | (b[p] & 0xff);
				return v / 8388608f;
			default:
				v = be ? (b[p] << 24) | ((b[p + 1] & 0xff) << 16) | ((b[p + 2] & 0xff) << 8) | (b[p + 3] & 0xff)
						: (b[p + 3] << 24) | ((b[p + 2] & 0xff) << 16) | ((b[p + 1] & 0xff) << 8) | (b[p] & 0xff);
				return v / 2147483648f;
		}
	}
}
