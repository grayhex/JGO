// SKETCH — not deployed, not type-checked against a real @cloudflare/containers version.
// One Durable Object + container per game session; WebSocket traffic is proxied to the container's API port.
import { Container, getContainer } from '@cloudflare/containers';

export class GameSession extends Container {
  defaultPort = 8080;
  sleepAfter = '5m'; // matches SESSION_IDLE_MINUTES
  envVars = { MAX_SESSIONS: '1', FRAME_ENCODING: 'deflate', HOST: '0.0.0.0', ALLOW_INSECURE_PUBLIC: '1' };
}

export default {
  async fetch(req: Request, env: { ASSETS: Fetcher; GAME_SESSION: DurableObjectNamespace<GameSession> }): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    // TODO: authenticate the user, derive a stable session key, sync saves/ with R2 on start/stop
    const stub = getContainer(env.GAME_SESSION, 'user-1');
    return stub.fetch(req); // handles WebSocket upgrades too
  },
};
