import type { DevicePreset, GameMeta, GameSettings, HealthStatus, SessionStatus } from '@j2me-web/protocol';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(path, { credentials: 'same-origin', ...init });
  } catch {
    throw new ApiError(0, 'network', 'Cannot reach the server');
  }
  if (r.status === 204) return undefined as T;
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, body.error ?? 'error', body.message ?? `HTTP ${r.status}`);
  return body as T;
}

/** The part of the server's JAR analysis the UI shows (apps/api/src/lab/analyze.ts). */
export interface JarAnalysisView {
  classCount: number;
  apis: { id: string; label: string; group: string; classes: number; missing: string[]; needsGl: boolean; note?: string }[];
  missingClasses: string[];
  needs3d: boolean;
  platform: { family: string; evidence: string[] };
  screenHints: { width: number; height: number; source: string }[];
  findings: { level: 'info' | 'warn' | 'error'; code: string; message: string }[];
  risk: 'low' | 'medium' | 'high';
}

const jsonInit = (method: string, body: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const api = {
  health: () => req<HealthStatus>('/api/health'),
  login: (token: string) => req<{ ok: true }>('/api/auth/login', jsonInit('POST', { token })),
  games: () => req<GameMeta[]>('/api/games'),
  upload: async (jar: File, jad?: File) => {
    const fd = new FormData();
    fd.append('jar', jar, jar.name);
    if (jad) fd.append('jad', jad, jad.name);
    return req<{ game: GameMeta; duplicate: boolean }>('/api/games', { method: 'POST', body: fd });
  },
  patchGame: (id: string, patch: { favorite?: boolean; settings?: Partial<GameSettings> }) => req<GameMeta>(`/api/games/${id}`, jsonInit('PATCH', patch)),
  deleteGame: (id: string, saves: boolean) => req<void>(`/api/games/${id}${saves ? '?saves=1' : ''}`, { method: 'DELETE' }),
  iconUrl: (id: string) => `/api/games/${id}/icon`,
  startSession: (gameId: string, settings?: Partial<GameSettings>) => req<SessionStatus>('/api/sessions', jsonInit('POST', { gameId, settings })),
  devices: () => req<{ presets: DevicePreset[]; defaultName: string | null }>('/api/devices'),
  analysis: (id: string) => req<{ analysis: JarAnalysisView; recommendedDevice: string | null }>(`/api/games/${id}/analysis`),
  sessions: () => req<SessionStatus[]>('/api/sessions'),
  session: (id: string) => req<SessionStatus>(`/api/sessions/${id}`),
  stopSession: (id: string) => req<SessionStatus>(`/api/sessions/${id}`, { method: 'DELETE' }),
};
