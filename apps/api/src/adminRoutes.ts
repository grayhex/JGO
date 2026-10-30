import { createReadStream } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type { LibraryCheck, SettingsResponse } from '@j2me-web/protocol';
import type { Config } from './config.js';
import { UploadError } from './jar.js';
import type { Library } from './library.js';
import { browseLibrary, checkLibraryDir, listRoots, resolveInsideRoots } from './libraryPath.js';
import type { MetadataService, Scope } from './metadata.js';
import { MobyClient, MobyError } from './mobygames.js';
import type { ScanManager } from './scanner.js';
import type { SettingsStore } from './settingsStore.js';
import { systemStatus } from './systemStatus.js';

export interface AdminContext {
  cfg: Config;
  library: Library;
  store: SettingsStore;
  scan: ScanManager;
  metadata: MetadataService;
  moby: MobyClient;
  version: string;
  java: string | null;
}

const MIME = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' } as const;

function str(v: unknown, name: string, max = 1024): string {
  if (typeof v !== 'string' || !v || v.length > max) throw new UploadError('bad_request', `${name} must be a non-empty string`);
  return v;
}

/**
 * Setup, settings, library import and MobyGames routes. None of them takes a file path from the client other
 * than the library directory itself, and that one is only accepted inside the roots the server was configured with.
 * Secrets go in (PUT) but never come out.
 */
export function registerAdminRoutes(app: FastifyInstance, c: AdminContext): void {
  const { cfg, library, store, scan, metadata, moby } = c;

  const settingsResponse = (): SettingsResponse => {
    const s = store.setup();
    const m = store.mobygamesInfo();
    return {
      settings: store.get(),
      secrets: { mobygames: { configured: m.configured, hint: m.hint } },
      readonly: { host: cfg.host, port: cfg.port, auth: cfg.authToken ? 'token' : 'none', dataDirName: 'data directory' },
      envDefaults: store.envDefaults,
      setup: { status: s.status, completedAt: s.completedAt, legacy: s.legacy },
    };
  };

  // --- first-run wizard state ---
  app.get('/api/setup', async () => {
    const s = store.setup();
    return { status: s.status, completedAt: s.completedAt, legacy: s.legacy, needsWizard: s.status === 'pending', libraryConfigured: !!store.get().libraryPath, mobygamesConfigured: store.mobygamesInfo().configured, games: library.count() };
  });
  app.post('/api/setup/complete', async () => { store.setSetup('completed'); return settingsResponse().setup; });
  app.post('/api/setup/skip', async () => { store.setSetup('skipped'); return settingsResponse().setup; });
  app.post('/api/setup/reset', async () => { store.setSetup('pending'); return settingsResponse().setup; });

  // --- settings ---
  app.get('/api/settings', async () => settingsResponse());

  app.patch<{ Body: unknown }>('/api/settings', async (req) => {
    const body = req.body as Record<string, unknown> | null;
    if (body && typeof body === 'object' && 'libraryPath' in body && body.libraryPath) {
      const p = str(body.libraryPath, 'libraryPath');
      const hit = resolveInsideRoots(cfg, p);
      if (!hit) throw new UploadError('library_outside_roots', 'That directory does not exist or is outside the allowed library locations', 400);
      body.libraryPath = hit.real; // always store the resolved path: a later symlink swap cannot redirect the scan
    }
    store.update(body);
    return settingsResponse();
  });

  app.put<{ Body: { key?: unknown } }>('/api/settings/mobygames-key', async (req) => {
    store.setMobygamesKey(req.body?.key as string);
    return settingsResponse().secrets;
  });
  app.delete('/api/settings/mobygames-key', async () => {
    store.setMobygamesKey(null);
    return settingsResponse().secrets;
  });

  app.post('/api/mobygames/test', async () => {
    if (!moby.hasKey()) throw new UploadError('no_key', 'No MobyGames API key is configured', 400);
    try {
      const r = await moby.test();
      return { ok: true, platformId: r.platformId };
    } catch (e) {
      if (e instanceof MobyError) throw new UploadError(e.code, e.message, e.code === 'invalid_key' ? 400 : e.status);
      throw e;
    }
  });

  app.get('/api/system/status', async () => systemStatus(cfg, library, store, c.java, c.version));

  // --- library directory ---
  app.get('/api/library/roots', async () => ({ roots: listRoots(cfg), current: store.get().libraryPath }));

  app.get<{ Querystring: { path?: string } }>('/api/library/browse', async (req) => {
    const r = browseLibrary(cfg, req.query.path ? str(req.query.path, 'path') : null);
    if (!r) throw new UploadError('library_outside_roots', 'That directory is outside the allowed library locations', 400);
    return r;
  });

  app.post<{ Body: { path?: unknown } }>('/api/library/check', async (req): Promise<LibraryCheck> => checkLibraryDir(cfg, str(req.body?.path, 'path')));

  app.get('/api/library/scan', async () => ({ running: scan.isRunning(), report: scan.current() }));
  app.post<{ Body: { mode?: string } }>('/api/library/scan', async (req, reply) => {
    const mode = req.body?.mode === 'full' ? 'full' : 'update';
    return reply.code(202).send({ running: true, report: scan.start(mode) });
  });
  app.delete('/api/library/scan', async () => ({ cancelled: scan.cancel() }));

  // --- MobyGames metadata ---
  const mobyKey = () => {
    if (!moby.hasKey()) throw new UploadError('no_key', 'Add a MobyGames API key in Settings first', 400);
  };
  const asUpload = <T>(fn: () => Promise<T>): Promise<T> =>
    fn().catch((e: unknown) => {
      if (e instanceof MobyError) throw new UploadError(e.code, e.message, e.code === 'rate_limited' ? 429 : e.code === 'invalid_key' ? 400 : 502);
      throw e;
    });
  const groupOf = (id: string): { groupKey: string; name: string } => {
    const g = library.get(id);
    if (!g) throw new UploadError('not_found', 'Game not found', 404);
    return { groupKey: g.groupKey, name: g.name };
  };

  app.get('/api/metadata/job', async () => ({ job: metadata.job(), stats: metadata.stats(), review: metadata.needsReview().length }));
  app.post<{ Body: { scope?: string } }>('/api/metadata/enrich', async (req, reply) => {
    const scope: Scope = req.body?.scope === 'all' ? 'all' : req.body?.scope === 'retry' ? 'retry' : 'missing';
    return reply.code(202).send({ job: metadata.start(scope) });
  });
  app.delete('/api/metadata/job', async () => ({ cancelled: metadata.cancel() }));
  app.get('/api/metadata/review', async () => metadata.needsReview());
  app.delete('/api/metadata', async (_req, reply) => {
    if (metadata.job().state === 'running') throw new UploadError('job_running', 'Stop the running lookup first', 409);
    metadata.clear();
    return reply.code(204).send();
  });

  app.get<{ Params: { id: string } }>('/api/games/:id/info', async (req) => metadata.info(groupOf(req.params.id).groupKey));
  app.post<{ Params: { id: string } }>('/api/games/:id/info/refresh', async (req) => {
    mobyKey();
    const g = groupOf(req.params.id);
    await asUpload(() => metadata.matchGroup(g.groupKey, g.name));
    return metadata.info(g.groupKey);
  });
  app.post<{ Params: { id: string }; Body: { query?: unknown } }>('/api/games/:id/info/search', async (req) => {
    mobyKey();
    return asUpload(() => metadata.search(groupOf(req.params.id).groupKey, str(req.body?.query, 'query', 120)));
  });
  app.post<{ Params: { id: string }; Body: { mobyId?: unknown } }>('/api/games/:id/info/choose', async (req) => {
    const id = req.body?.mobyId;
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) throw new UploadError('bad_request', 'mobyId must be a positive integer');
    return asUpload(() => metadata.choose(groupOf(req.params.id).groupKey, id));
  });
  app.delete<{ Params: { id: string } }>('/api/games/:id/info', async (req) => metadata.unlink(groupOf(req.params.id).groupKey));

  const sendImage = (groupKey: string, name: string, reply: import('fastify').FastifyReply) => {
    const img = metadata.imagePath(groupKey, name);
    if (!img) throw new UploadError('not_found', 'No image', 404);
    return reply.header('Content-Type', MIME[img.ext]).header('Cache-Control', 'private, max-age=86400').header('Content-Security-Policy', "default-src 'none'; sandbox").send(createReadStream(img.file));
  };
  app.get<{ Params: { id: string } }>('/api/games/:id/cover', async (req, reply) => sendImage(groupOf(req.params.id).groupKey, 'cover', reply));
  app.get<{ Params: { id: string; n: string } }>('/api/games/:id/screenshots/:n', async (req, reply) => {
    if (!/^[1-6]$/.test(req.params.n)) throw new UploadError('not_found', 'No image', 404);
    return sendImage(groupOf(req.params.id).groupKey, `shot-${req.params.n}`, reply);
  });
}
