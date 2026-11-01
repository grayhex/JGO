import type { FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import { AgentError, agentFromConfig } from './eka2l1/agentClient.js';
import { UploadError } from './jar.js';
import type { SessionManager } from './sessions.js';
import { SessionError } from './sessions.js';

/** Where each uploaded firmware file may come from; EKA2L1 decides what is really inside (we only keep names and sizes sane). */
const SLOTS: Record<string, RegExp | null> = {
  rom: null, // ROM dumps come under many names (.rom, .bin, .v04.50 ...)
  rpkg: /\.rpkg$/i,
  archive: /\.(zip|7z|rar|rpkg)$/i,
};

function toHttp(e: unknown): never {
  if (e instanceof AgentError) {
    const status = e.status === 0 ? 503 : e.status >= 400 && e.status < 600 ? e.status : 502;
    throw new SessionError(e.code ?? 'symbian_error', e.message, status);
  }
  throw e;
}

/**
 * Settings for the optional Symbian service: its state and the user's own firmware. The service lives in another container
 * (jgo-symbian); JGO only streams the firmware files to it, they are never stored here and never pass through the repository.
 */
export function registerSymbianRoutes(app: FastifyInstance, c: { cfg: Config; sessions: SessionManager }): void {
  const { cfg, sessions } = c;
  const agent = agentFromConfig(cfg);
  const need = () => {
    if (!agent) throw new SessionError('symbian_unavailable', 'The Symbian service is not configured (SYMBIAN_AGENT_URL). See docs/SYMBIAN.md.', 503);
    return agent;
  };
  const noGame = () => {
    if (sessions.active().some((s) => s.game.platform && s.game.platform !== 'j2me')) throw new SessionError('in_use', 'Stop the running Symbian game first', 409);
  };

  app.get('/api/symbian/status', async () => {
    const base = { experimental: true, configured: !!agent, maxFirmwareBytes: cfg.maxFirmwareBytes, maxPackageBytes: cfg.maxPackageBytes };
    if (!agent) return { ...base, reachable: false, emulator: null, firmware: { installed: false, devices: [] }, busy: false, message: 'SYMBIAN_AGENT_URL is not set' };
    try {
      const h = await agent.health();
      return { ...base, reachable: true, emulator: h.emulator, firmware: h.firmware, busy: h.instance.running, message: null };
    } catch (e) {
      return { ...base, reachable: false, emulator: null, firmware: { installed: false, devices: [] }, busy: false, message: e instanceof Error ? e.message : String(e) };
    }
  });

  // One file per request, streamed through to the service; the answer names the stored file for the install call below.
  app.post<{ Querystring: { slot?: string } }>('/api/symbian/firmware', async (req) => {
    const a = need();
    const slot = req.query.slot ?? '';
    if (!(slot in SLOTS)) throw new UploadError('bad_request', 'slot must be rom, rpkg or archive');
    if (!req.isMultipart()) throw new UploadError('bad_request', 'Expected multipart/form-data with one file');
    const part = await req.file({ limits: { fileSize: cfg.maxFirmwareBytes + 1 } });
    if (!part) throw new UploadError('no_file', 'No file in the upload', 400);
    const name = part.filename ?? '';
    const rule = SLOTS[slot];
    if (!name || name.length > 120 || /[\\/\0]/.test(name)) throw new UploadError('bad_request', 'Invalid file name');
    if (rule && !rule.test(name)) throw new UploadError('bad_file', slot === 'rpkg' ? 'A firmware package is an .rpkg file' : 'A firmware archive is a .zip, .7z, .rar or .rpkg file');
    noGame();
    try {
      const r = await a.uploadFirmware(slot as 'rom' | 'rpkg' | 'archive', name, part.file);
      if (part.file.truncated) throw new UploadError('too_large', `Firmware files are limited to ${Math.round(cfg.maxFirmwareBytes / 1048576)} MB`, 413);
      return r;
    } catch (e) {
      part.file.resume();
      if (e instanceof UploadError) throw e;
      if (part.file.truncated) throw new UploadError('too_large', `Firmware files are limited to ${Math.round(cfg.maxFirmwareBytes / 1048576)} MB`, 413);
      return toHttp(e);
    }
  });

  app.post<{ Body: { rom?: unknown; rpkg?: unknown; archive?: unknown } }>('/api/symbian/firmware/install', async (req, reply) => {
    const a = need();
    noGame();
    const b = req.body ?? {};
    const pick = (v: unknown): string | undefined => {
      if (v === undefined) return undefined;
      if (typeof v !== 'string' || !v || v.length > 200 || /[\\/\0]/.test(v)) throw new UploadError('bad_request', 'Invalid file reference');
      return v;
    };
    const rom = pick(b.rom), rpkg = pick(b.rpkg), archive = pick(b.archive);
    if (!archive && !rom) throw new UploadError('bad_request', 'Upload a ROM (and its RPKG) or a firmware archive first');
    try {
      return reply.code(202).send(await a.installFirmware({ ...(archive ? { archive } : { rom, ...(rpkg ? { rpkg } : {}) }) }));
    } catch (e) { return toHttp(e); }
  });

  app.get<{ Params: { id: string } }>('/api/symbian/jobs/:id', async (req) => {
    const a = need();
    if (!/^[a-f0-9]{12}$/.test(req.params.id)) throw new UploadError('not_found', 'No such job', 404);
    try { return await a.job(req.params.id); } catch (e) { return toHttp(e); }
  });

  app.delete<{ Params: { code: string } }>('/api/symbian/firmware/:code', async (req, reply) => {
    const a = need();
    noGame();
    if (!/^[A-Za-z0-9._-]{1,32}$/.test(req.params.code)) throw new UploadError('bad_request', 'Invalid device code');
    try { return reply.code(202).send(await a.deleteDevice(req.params.code)); } catch (e) { return toHttp(e); }
  });
}
