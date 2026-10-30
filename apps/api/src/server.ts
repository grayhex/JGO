import { execFile } from 'node:child_process';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import type { ClientEvent, HealthStatus } from '@j2me-web/protocol';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { type Config, loadConfig, readKemCommit } from './config.js';
import { UploadError } from './jar.js';
import { Library, newId, validateSettings } from './library.js';
import { SessionError, SessionManager, type StreamClient } from './sessions.js';

const VERSION = '0.1.0';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const COOKIE = 'j2me_auth';

function hostOnly(h: string | undefined): string {
  if (!h) return '';
  return h.startsWith('[') ? h.slice(0, h.indexOf(']') + 1) : h.split(':')[0]!.toLowerCase();
}

function javaVersion(javaBin: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(javaBin, ['-version'], { timeout: 5000, env: { PATH: process.env.PATH } }, (err, _o, stderr) => {
      if (err) return resolve(null);
      const m = /version "([^"]+)"/.exec(stderr);
      resolve(m?.[1] ?? 'unknown');
    });
  });
}

export interface App {
  fastify: FastifyInstance;
  cfg: Config;
  library: Library;
  sessions: SessionManager;
  close(): Promise<void>;
}

export async function buildApp(cfg: Config = loadConfig()): Promise<App> {
  const app = Fastify({ logger: { level: cfg.logLevel }, bodyLimit: 64 * 1024, trustProxy: process.env.TRUST_PROXY === '1' });
  const library = new Library(cfg.dataDir);
  // stale bridge dirs from a crashed run
  if (existsSync(cfg.runDir)) for (const d of readdirSync(cfg.runDir)) rmSync(path.join(cfg.runDir, d), { recursive: true, force: true });
  const sessions = new SessionManager(cfg, library);
  const java = await javaVersion(cfg.javaBin);

  const authCookie = cfg.authToken ? createHmac('sha256', cfg.authToken).update('j2me-web-session').digest('hex') : null;
  const safeEq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
  const allowedOriginHosts = new Set(cfg.allowedOrigins.map((o) => { try { return new URL(o).host.toLowerCase(); } catch { return o.toLowerCase(); } }));

  function cookieOf(req: FastifyRequest): string | null {
    const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([0-9a-f]+)`).exec(req.headers.cookie ?? '');
    return m?.[1] ?? null;
  }
  const owner = 'default';

  // --- security: Host/Origin checks (DNS rebinding + CSRF against a localhost API) and auth ---
  app.addHook('onRequest', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer').header('X-Frame-Options', 'DENY');
    const host = req.headers.host?.toLowerCase() ?? '';
    if (!cfg.authToken && !LOOPBACK_HOSTS.has(hostOnly(host)) && !allowedOriginHosts.has(host)) {
      return reply.code(403).send({ error: 'bad_host', message: 'Unexpected Host header (the unauthenticated mode is loopback-only)' });
    }
    const origin = req.headers.origin;
    if (origin) {
      let oh = '';
      try { oh = new URL(origin).host.toLowerCase(); } catch { /* invalid */ }
      if (oh !== host && !allowedOriginHosts.has(oh)) return reply.code(403).send({ error: 'bad_origin', message: 'Cross-origin request rejected' });
    }
    if (!cfg.authToken) return;
    const url = req.url.split('?')[0]!;
    if (url === '/api/health' || url === '/api/auth/login' || !url.startsWith('/api/')) return;
    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
    const ck = cookieOf(req);
    const ok = (bearer && safeEq(bearer, cfg.authToken)) || (ck && authCookie && safeEq(ck, authCookie));
    if (!ok) return reply.code(401).send({ error: 'unauthorized', message: 'Authentication required' });
  });

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
    if (err instanceof UploadError || err instanceof SessionError) return reply.code(err.status).send({ error: err.code, message: err.message });
    if (err.code === 'FST_REQ_FILE_TOO_LARGE' || err.code === 'FST_FILES_LIMIT') return reply.code(413).send({ error: 'too_large', message: 'Upload too large' });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.code ?? 'bad_request', message: err.message });
    req.log.error(err);
    return reply.code(500).send({ error: 'internal', message: 'Internal server error' });
  });

  await app.register(fastifyMultipart, { limits: { fileSize: cfg.maxUploadBytes, files: 2, fields: 4, parts: 8, headerPairs: 50 } });
  await app.register(fastifyWebsocket, { options: { maxPayload: 8 * 1024, perMessageDeflate: false } });

  // --- health ---
  app.get('/api/health', async (): Promise<HealthStatus> => ({
    ok: !!java && existsSync(cfg.adapterBin) && existsSync(path.join(cfg.kemDir, 'KEmulator.jar')),
    version: VERSION,
    kemulator: { commit: readKemCommit(cfg.kemDir), jarPresent: existsSync(path.join(cfg.kemDir, 'KEmulator.jar')) },
    adapter: { present: existsSync(cfg.adapterBin) },
    java: { present: !!java, version: java },
    activeSessions: sessions.active().length,
    maxSessions: cfg.maxSessions,
    auth: cfg.authToken ? 'token' : 'none',
    dataDir: cfg.authToken ? '' : cfg.dataDir,
  }));

  app.post('/api/auth/login', async (req, reply) => {
    if (!cfg.authToken || !authCookie) return { ok: true };
    const t = (req.body as { token?: unknown } | null)?.token;
    if (typeof t !== 'string' || !safeEq(t, cfg.authToken)) return reply.code(401).send({ error: 'unauthorized', message: 'Wrong token' });
    const secure = req.protocol === 'https' ? '; Secure' : '';
    reply.header('Set-Cookie', `${COOKIE}=${authCookie}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${secure}`);
    return { ok: true };
  });

  // --- games ---
  app.get('/api/games', async () => library.list());

  app.get<{ Params: { id: string } }>('/api/games/:id', async (req) => {
    const g = library.get(req.params.id);
    if (!g) throw new UploadError('not_found', 'Game not found', 404);
    return g;
  });

  app.get<{ Params: { id: string } }>('/api/games/:id/icon', async (req, reply) => {
    const icon = library.get(req.params.id) ? library.readIcon(req.params.id) : null;
    if (!icon) throw new UploadError('not_found', 'No icon', 404);
    return reply.header('Content-Type', 'image/png').header('Cache-Control', 'private, max-age=86400').send(icon);
  });

  app.post('/api/games', async (req, reply) => {
    if (!req.isMultipart()) throw new UploadError('bad_request', 'Expected multipart/form-data with a "jar" file');
    let jar: Buffer | null = null;
    let jad: Buffer | null = null;
    for await (const part of req.parts()) {
      if (part.type !== 'file') continue;
      const buf = await part.toBuffer(); // throws FST_REQ_FILE_TOO_LARGE past the limit
      const name = (part.filename ?? '').toLowerCase();
      if (name.endsWith('.jad') || part.fieldname === 'jad') jad = buf;
      else if (name.endsWith('.jar') || part.fieldname === 'jar' || part.fieldname === 'file') jar = buf;
    }
    if (!jar) {
      throw new UploadError(jad ? 'jad_only' : 'no_file', jad
        ? 'A .jad descriptor alone cannot be played: upload the .jar (optionally together with its .jad).'
        : 'No .jar file in the upload');
    }
    const { game, duplicate } = library.add(jar, jad, cfg.libraryQuotaBytes);
    return reply.code(duplicate ? 200 : 201).send({ game, duplicate });
  });

  app.patch<{ Params: { id: string }; Body: { favorite?: boolean; settings?: unknown } }>('/api/games/:id', async (req) => {
    const g = library.update(req.params.id, { ...(typeof req.body?.favorite === 'boolean' ? { favorite: req.body.favorite } : {}), settings: req.body?.settings });
    if (!g) throw new UploadError('not_found', 'Game not found', 404);
    return g;
  });

  app.delete<{ Params: { id: string }; Querystring: { saves?: string } }>('/api/games/:id', async (req, reply) => {
    const id = req.params.id;
    if (sessions.active().some((s) => s.game.id === id)) throw new SessionError('in_use', 'Stop the running session first', 409);
    if (!library.remove(id)) throw new UploadError('not_found', 'Game not found', 404);
    if (req.query.saves === '1') library.removeSaves(owner, id);
    return reply.code(204).send();
  });

  // --- sessions ---
  app.post<{ Body: { gameId?: string; settings?: unknown } }>('/api/sessions', async (req, reply) => {
    const game = typeof req.body?.gameId === 'string' ? library.get(req.body.gameId) : null;
    if (!game) throw new UploadError('not_found', 'Game not found', 404);
    const settings = validateSettings(req.body?.settings, game.settings);
    const s = await sessions.create(game, settings, owner);
    return reply.code(201).send(s.status());
  });

  app.get('/api/sessions', async () => sessions.list().map((s) => s.status()));

  app.get<{ Params: { id: string } }>('/api/sessions/:id', async (req) => {
    const s = sessions.get(req.params.id);
    if (!s) throw new SessionError('not_found', 'Session not found', 404);
    return s.status();
  });

  app.delete<{ Params: { id: string } }>('/api/sessions/:id', async (req, reply) => {
    const s = sessions.get(req.params.id);
    if (!s) throw new SessionError('not_found', 'Session not found', 404);
    await s.stop('requested');
    return reply.code(200).send(s.status());
  });

  app.get('/api/sessions/:id/stream', { websocket: true }, (socket, req) => {
    const s = sessions.get((req.params as { id: string }).id);
    if (!s || (s.state !== 'running' && s.state !== 'starting')) {
      socket.close(4404, 'no such running session');
      return;
    }
    const id = newId(6);
    let budget = 400; // client messages per second
    const refill = setInterval(() => (budget = 400), 1000);
    const client: StreamClient = {
      id,
      sendText: (t) => { if (socket.readyState === 1) socket.send(t); },
      sendFrame: (b) => {
        if (socket.readyState !== 1) return false;
        if (socket.bufferedAmount > b.length * 2) return false; // stale video frame: drop instead of queueing
        socket.send(b, { binary: true });
        return true;
      },
      close: () => socket.close(1000, 'session ended'),
    };
    s.addClient(client);
    socket.on('message', (data: Buffer, isBinary: boolean) => {
      if (isBinary || --budget < 0) return;
      let ev: ClientEvent;
      try { ev = JSON.parse(data.toString('utf8')); } catch { return; }
      if (!ev || typeof ev !== 'object' || typeof (ev as { t?: unknown }).t !== 'string') return;
      s.handleClientEvent(id, ev);
    });
    const gone = () => { clearInterval(refill); s.removeClient(id); };
    socket.on('close', gone);
    socket.on('error', gone);
  });

  // --- static web UI (production) ---
  if (cfg.webDir) {
    const webDir = cfg.webDir;
    await app.register(fastifyStatic, { root: webDir, wildcard: false, index: ['index.html'] });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not_found', message: 'No such endpoint' });
      return reply.sendFile('index.html');
    });
    app.addHook('onSend', async (req, reply, payload) => {
      if (!req.url.startsWith('/api/')) {
        reply.header('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
      }
      return payload;
    });
  }

  return {
    fastify: app, cfg, library, sessions,
    async close() {
      await sessions.stopAll();
      await app.close();
      library.close();
    },
  };
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const app = await buildApp(cfg);
  let closing = false;
  const shutdown = async (sig: string) => {
    if (closing) return;
    closing = true;
    app.fastify.log.info(`${sig}: stopping sessions and shutting down`);
    await app.close().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  await app.fastify.listen({ host: cfg.host, port: cfg.port });
  if (cfg.authToken === null) app.fastify.log.warn(`no AUTH_TOKEN: API is unauthenticated, reachable only on ${cfg.host}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
