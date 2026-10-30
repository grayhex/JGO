import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export interface Config {
  host: string;
  port: number;
  dataDir: string;
  /** Directory that holds KEmulator.jar (built by runtime/scripts/build-kemulator.sh). */
  kemDir: string;
  adapterBin: string;
  javaBin: string;
  /** tmpfs-backed directory for FIFOs + framebuffer files, one subdirectory per session. */
  runDir: string;
  maxSessions: number;
  sessionMaxMs: number;
  /** A session with no WebSocket client for this long is stopped. */
  sessionIdleMs: number;
  maxUploadBytes: number;
  libraryQuotaBytes: number;
  authToken: string | null;
  frameEncoding: 'raw' | 'deflate';
  /** Extra Origins allowed to call the API/WS besides same-origin. */
  allowedOrigins: string[];
  webDir: string | null;
  /** A permission prompt nobody answers within this time is denied (the MIDlet thread would otherwise block forever). */
  permissionTimeoutMs: number;
  /** CPU seconds budget for the emulator process (RLIMIT_CPU). */
  cpuSeconds: number;
  /** DISPLAY used for 3D (M3G/Mascot Capsule); empty = none. */
  display: string;
  logLevel: string;
  /** Extra JVM args, space separated. */
  jvmExtraArgs: string[];
  /** Wrapper command prepended to the JVM (e.g. "xvfb-run -a"). Space separated. */
  launchWrapper: string[];
}

function int(env: NodeJS.ProcessEnv, name: string, def: number): number {
  const v = env[name];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number`);
  return n;
}

function list(env: NodeJS.ProcessEnv, name: string): string[] {
  return (env[name] ?? '').split(/\s+/).filter(Boolean);
}

export function loadConfig(env = process.env): Config {
  const dataDir = path.resolve(env.DATA_DIR ?? path.join(repoRoot, 'data'));
  const webDirEnv = env.WEB_DIR ?? path.join(repoRoot, 'apps/web/dist');
  const shm = '/dev/shm';
  const cfg: Config = {
    host: env.HOST ?? '127.0.0.1',
    port: int(env, 'PORT', 8080),
    dataDir,
    kemDir: path.resolve(env.KEM_DIR ?? path.join(repoRoot, 'runtime/build/kemulator')),
    adapterBin: path.resolve(env.ADAPTER_BIN ?? path.join(repoRoot, 'bridge/kemulator-adapter/target/release/kem-adapter')),
    javaBin: env.JAVA_BIN ?? 'java',
    runDir: path.resolve(env.RUN_DIR ?? path.join(existsSync(shm) ? shm : tmpdir(), 'j2me-web')),
    maxSessions: int(env, 'MAX_SESSIONS', 1),
    sessionMaxMs: int(env, 'SESSION_MAX_MINUTES', 120) * 60_000,
    sessionIdleMs: int(env, 'SESSION_IDLE_MINUTES', 5) * 60_000,
    maxUploadBytes: int(env, 'MAX_UPLOAD_MB', 32) * 1024 * 1024,
    libraryQuotaBytes: int(env, 'LIBRARY_QUOTA_MB', 2048) * 1024 * 1024,
    authToken: env.AUTH_TOKEN ? env.AUTH_TOKEN : null,
    frameEncoding: env.FRAME_ENCODING === 'deflate' ? 'deflate' : 'raw',
    allowedOrigins: list(env, 'ALLOWED_ORIGINS'),
    webDir: existsSync(webDirEnv) ? path.resolve(webDirEnv) : null,
    permissionTimeoutMs: int(env, 'PERMISSION_TIMEOUT_SECONDS', 60) * 1000,
    cpuSeconds: int(env, 'KEM_CPU_SECONDS', 0),
    display: env.KEM_DISPLAY ?? env.DISPLAY ?? '',
    logLevel: env.LOG_LEVEL ?? 'info',
    jvmExtraArgs: list(env, 'KEM_JVM_ARGS'),
    launchWrapper: list(env, 'KEM_LAUNCH_WRAPPER'),
  };
  const loopback = ['127.0.0.1', '::1', 'localhost'].includes(cfg.host);
  if (!loopback && !cfg.authToken && env.ALLOW_INSECURE_PUBLIC !== '1') {
    throw new Error(
      `Refusing to listen on ${cfg.host} without AUTH_TOKEN. Set AUTH_TOKEN, bind to 127.0.0.1, ` +
        'or (inside a private network only) set ALLOW_INSECURE_PUBLIC=1.',
    );
  }
  if (cfg.authToken && cfg.authToken.length < 16) throw new Error('AUTH_TOKEN must be at least 16 characters');
  return cfg;
}

export function readKemCommit(kemDir: string): string | null {
  try {
    return readFileSync(path.join(kemDir, 'KEM_COMMIT'), 'utf8').trim();
  } catch {
    return null;
  }
}
