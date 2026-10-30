import type { DevicePreset, EmulationTweaks, GameFileEntry, GameInfo, GameMeta, GameSettings, HealthStatus, LibraryCheck, LibraryRoot, MetadataJob, MobyCandidate, PublicSettings, ScanReport, SessionStatus, SettingsResponse, SystemStatus } from '@j2me-web/protocol';

export type GameSettingsPatch = Partial<Omit<GameSettings, 'device' | 'emulation'>> & { device?: string | null; emulation?: EmulationTweaks | null };

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

/** The part of the server's JAR analysis the UI shows (apps/api/src/analysis/analyze.ts). */
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

export interface SetupState { status: 'pending' | 'completed' | 'skipped'; completedAt: string | null; legacy: boolean; needsWizard: boolean; libraryConfigured: boolean; mobygamesConfigured: boolean; games: number }
export interface BrowseResult { path: string | null; parent: string | null; dirs: { name: string; path: string }[]; truncated: boolean }
export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

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
  patchGame: (id: string, patch: { favorite?: boolean; settings?: GameSettingsPatch }) => req<GameMeta>(`/api/games/${id}`, jsonInit('PATCH', patch)),
  deleteGame: (id: string, saves: boolean) => req<void>(`/api/games/${id}${saves ? '?saves=1' : ''}`, { method: 'DELETE' }),
  iconUrl: (id: string) => `/api/games/${id}/icon`,
  startSession: (gameId: string, settings?: GameSettingsPatch) => req<SessionStatus>('/api/sessions', jsonInit('POST', { gameId, settings })),
  devices: () => req<{ presets: DevicePreset[]; defaultName: string | null }>('/api/devices'),
  analysis: (id: string) => req<{ analysis: JarAnalysisView; recommendedDevice: string | null }>(`/api/games/${id}/analysis`),
  sessions: () => req<SessionStatus[]>('/api/sessions'),
  session: (id: string) => req<SessionStatus>(`/api/sessions/${id}`),
  /** Plain-text report of a session (settings, log, JVM heap and threads) to attach to a bug report. */
  diagnostics: async (id: string): Promise<Blob> => {
    const r = await fetch(`/api/sessions/${id}/diagnostics`, { credentials: 'same-origin' });
    if (!r.ok) throw new ApiError(r.status, 'diagnostics', (await r.json().catch(() => ({}))).message ?? `HTTP ${r.status}`);
    return r.blob();
  },
  gameFiles: (id: string, dir: string) => req<{ path: string; entries: GameFileEntry[]; truncated: boolean; usedBytes: number; quotaBytes: number }>(`/api/games/${id}/files?path=${encodeURIComponent(dir)}`),
  gameFileUrl: (id: string, file: string) => `/api/games/${id}/files/download?path=${encodeURIComponent(file)}`,
  uploadGameFile: (id: string, dir: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file, file.name);
    return req<GameFileEntry>(`/api/games/${id}/files?path=${encodeURIComponent(dir)}`, { method: 'PUT', body: fd });
  },
  deleteGameFile: (id: string, file: string) => req<void>(`/api/games/${id}/files?path=${encodeURIComponent(file)}`, { method: 'DELETE' }),
  stopSession: (id: string) => req<SessionStatus>(`/api/sessions/${id}`, { method: 'DELETE' }),

  // first run, settings, system
  setup: () => req<SetupState>('/api/setup'),
  setupAction: (a: 'complete' | 'skip' | 'reset') => req<unknown>(`/api/setup/${a}`, { method: 'POST' }),
  settings: () => req<SettingsResponse>('/api/settings'),
  patchSettings: (patch: DeepPartial<PublicSettings>) => req<SettingsResponse>('/api/settings', jsonInit('PATCH', patch)),
  setMobyKey: (key: string) => req<SettingsResponse['secrets']>('/api/settings/mobygames-key', jsonInit('PUT', { key })),
  deleteMobyKey: () => req<SettingsResponse['secrets']>('/api/settings/mobygames-key', { method: 'DELETE' }),
  uploadSoundfont: (file: File) => {
    const fd = new FormData();
    fd.append('file', file, file.name);
    return req<SettingsResponse>('/api/settings/soundfont', { method: 'PUT', body: fd });
  },
  deleteSoundfont: () => req<SettingsResponse>('/api/settings/soundfont', { method: 'DELETE' }),
  testMoby: () => req<{ ok: true; platformId: number }>('/api/mobygames/test', { method: 'POST' }),
  systemStatus: () => req<SystemStatus>('/api/system/status'),

  // library directory and import
  libRoots: () => req<{ roots: LibraryRoot[]; current: string | null }>('/api/library/roots'),
  libBrowse: (path: string | null) => req<BrowseResult>(`/api/library/browse${path ? `?path=${encodeURIComponent(path)}` : ''}`),
  libCheck: (path: string) => req<LibraryCheck>('/api/library/check', jsonInit('POST', { path })),
  scan: () => req<{ running: boolean; report: ScanReport | null }>('/api/library/scan'),
  scanStart: (mode: 'update' | 'full') => req<{ running: boolean; report: ScanReport }>('/api/library/scan', jsonInit('POST', { mode })),
  scanCancel: () => req<{ cancelled: boolean }>('/api/library/scan', { method: 'DELETE' }),

  // MobyGames metadata
  metaJob: () => req<{ job: MetadataJob; stats: { matched: number; ambiguous: number; unmatched: number; bytes: number }; review: number }>('/api/metadata/job'),
  metaEnrich: (scope: 'missing' | 'retry' | 'all') => req<{ job: MetadataJob }>('/api/metadata/enrich', jsonInit('POST', { scope })),
  metaCancel: () => req<{ cancelled: boolean }>('/api/metadata/job', { method: 'DELETE' }),
  metaReview: () => req<{ groupKey: string; gameId: string; name: string; vendor: string; candidates: MobyCandidate[] }[]>('/api/metadata/review'),
  metaClear: () => req<void>('/api/metadata', { method: 'DELETE' }),
  gameInfo: (id: string) => req<GameInfo>(`/api/games/${id}/info`),
  infoRefresh: (id: string) => req<GameInfo>(`/api/games/${id}/info/refresh`, { method: 'POST' }),
  infoSearch: (id: string, query: string) => req<GameInfo>(`/api/games/${id}/info/search`, jsonInit('POST', { query })),
  infoChoose: (id: string, mobyId: number) => req<GameInfo>(`/api/games/${id}/info/choose`, jsonInit('POST', { mobyId })),
  infoUnlink: (id: string) => req<GameInfo>(`/api/games/${id}/info`, { method: 'DELETE' }),
  coverUrl: (id: string) => `/api/games/${id}/cover`,
  shotUrl: (id: string, n: number) => `/api/games/${id}/screenshots/${n}`,
};
