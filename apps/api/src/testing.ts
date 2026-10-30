import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { loadConfig, type Config } from './config.js';

/** Helpers shared by the unit tests: a minimal valid J2ME JAR and a throw-away configuration. */
export function makeJar(name: string, opts: { vendor?: string; version?: string; extra?: string } = {}): Uint8Array {
  const cls = new Uint8Array(16);
  cls.set([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 47]);
  const manifest = `MIDlet-Name: ${name}\nMIDlet-Vendor: ${opts.vendor ?? 'Test Vendor'}\nMIDlet-Version: ${opts.version ?? '1.0.0'}\nMIDlet-1: ${name},,a.Game\n${opts.extra ?? ''}`;
  return zipSync({ 'META-INF/MANIFEST.MF': strToU8(manifest), 'a/Game.class': cls });
}

export function tmpDir(prefix = 'jgo-test-'): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

export function put(root: string, rel: string, data: Uint8Array | string): string {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, data);
  return abs;
}

export function testConfig(over: Partial<Config> & { roots?: string[] } = {}): Config {
  const data = over.dataDir ?? tmpDir('jgo-data-');
  const { roots, ...rest } = over;
  return { ...loadConfig({ DATA_DIR: data, HOST: '127.0.0.1', LOG_LEVEL: 'silent', LIBRARY_ROOTS: (roots ?? []).join(' ') } as NodeJS.ProcessEnv), ...rest, dataDir: data };
}
