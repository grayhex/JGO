import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/** A tiny stand-in for api.mobygames.com used by the tests (never by production code). */
export interface FakeGame {
  game_id: number;
  title: string;
  platforms: { platform_id: number; name: string; release_date?: string }[];
  genres?: { name: string }[];
  description?: string;
  moby_score?: number;
}

/** A real 1x1 PNG, so a browser can decode it. */
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

export class FakeMoby {
  server!: Server;
  base = '';
  games: FakeGame[] = [];
  requests: { path: string; query: URLSearchParams }[] = [];
  failWith: { status: number; retryAfter?: number; times: number } | null = null;
  rejectExtendedInclude = false;
  validKey = 'moby_testkey_0001';

  async start(): Promise<this> {
    this.server = createServer((req, res) => this.handle(req, res));
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.base = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/v2`;
    return this;
  }

  stop(): Promise<void> {
    return new Promise((r) => this.server.close(() => r()));
  }

  private json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', this.base);
    if (url.pathname.startsWith('/img/')) {
      if (url.pathname === '/img/bad.png') { res.writeHead(200, { 'content-type': 'image/png' }); res.end('<html>not an image at all</html>'); return; }
      if (url.pathname === '/img/redirect.png') { res.writeHead(302, { location: 'http://evil.example.invalid/x.png' }); res.end(); return; }
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(PNG);
      return;
    }
    this.requests.push({ path: url.pathname, query: url.searchParams });
    if (url.searchParams.get('api_key') !== this.validKey) return this.json(res, 401, { code: 401, error: 'Unauthorized', message: 'bad key' });
    if (this.failWith && this.failWith.times > 0) {
      this.failWith.times--;
      return this.json(res, this.failWith.status, { code: this.failWith.status, error: 'x', message: 'x' }, this.failWith.retryAfter ? { 'retry-after': String(this.failWith.retryAfter) } : {});
    }
    if (url.pathname === '/v2/platforms') return this.json(res, 200, { platforms: [{ platform_id: 3, name: 'Linux' }, { platform_id: 64, name: 'J2ME' }, { platform_id: 5, name: 'Windows' }] });
    if (url.pathname === '/v2/games') {
      if (this.rejectExtendedInclude && (url.searchParams.get('include') ?? '').includes('critic_score')) return this.json(res, 403, { code: 403, error: 'Forbidden', message: 'plan' });
      const title = (url.searchParams.get('title') ?? '').toLowerCase();
      const platform = Number(url.searchParams.get('platform') ?? 0);
      const id = Number(url.searchParams.get('id') ?? 0);
      let list = this.games.filter((g) => (id ? g.game_id === id : g.title.toLowerCase().includes(title.split(' ')[0] ?? '')));
      if (platform) list = list.filter((g) => g.platforms.some((p) => p.platform_id === platform));
      const origin = this.base.replace('/v2', '');
      return this.json(res, 200, {
        games: list.map((g) => ({
          ...g,
          moby_url: `https://www.mobygames.com/game/${g.game_id}/`,
          official_url: null,
          publishers: [{ company_id: 1, company_name: 'Gameloft' }],
          developers: ['Dev Studio'],
          covers: [{ cover_group_id: 1, platforms: [{ platform_id: 64, name: 'J2ME' }], images: [{ image_url: `${origin}/img/cover-${g.game_id}.png`, thumbnail_url: `${origin}/img/thumb-${g.game_id}.png` }] }],
          screenshots: [{ platform_id: 64, platform_name: 'J2ME', images: [1, 2].map((n) => ({ image_url: `${origin}/img/s${n}-${g.game_id}.png`, thumbnail_url: `${origin}/img/t${n}.png` })) }],
        })),
      });
    }
    this.json(res, 404, { code: 404, error: 'Not Found', message: 'no' });
  }
}
