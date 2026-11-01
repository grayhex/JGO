import type { CatalogReport, DevicePreset, GameClassification, Genre, GenreSummary, EmulationTweaks, GameFileEntry, GameInfo, GameMeta, GameSettings, HealthStatus, LibraryCheck, LibraryRoot, MetadataJob, MobyCandidate, PublicSettings, Platform, ScanReport, SessionStatus, SettingsResponse, SymbianJob, SymbianStatus, SystemStatus } from '@mgo/protocol';

export type GameSettingsPatch = Partial<Omit<GameSettings, 'device' | 'emulation' | 'symbianDevice' | 'emulatedDeviceId'>> & { device?: string | null; emulation?: EmulationTweaks | null; symbianDevice?: string | null; emulatedDeviceId?: string | null };

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    /** Machine-readable facts the server attached to the error (for example why a Symbian start failed). */
    public details?: { failure?: import('@mgo/protocol').StartFailure; sessionId?: string } & Record<string, unknown>,
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
  if (!r.ok) throw new ApiError(r.status, body.error ?? 'error', body.message ?? `HTTP ${r.status}`, body.details);
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
  /** A Symbian / N-Gage game (.sis, .sisx, .n-gage, or the .zip of an N-Gage 1.0 card). */
  uploadPackage: async (file: File, platform?: Platform) => {
    const fd = new FormData();
    if (platform) fd.append('platform', platform);
    fd.append('file', file, file.name);
    return req<{ game: GameMeta; duplicate: boolean }>('/api/games', { method: 'POST', body: fd });
  },
  ngageCatalog: () => req<{ running: boolean; entries: number; matched: number; updatedAt: string | null; error: string | null }>('/api/catalog/ngage'),
  ngageCatalogRefresh: () => req<{ running: boolean; entries: number; matched: number; updatedAt: string | null; error: string | null }>('/api/catalog/ngage/refresh', { method: 'POST' }),
  symbianStatus: () => req<SymbianStatus>('/api/symbian/status'),
  /** One firmware file; the answer names it for symbianInstall. */
  symbianUpload: (slot: 'rom' | 'rpkg' | 'archive' | 'vpl' | 'fpsx', file: File, options?: { progress: (percent: number) => void; signal: AbortSignal; bundle?: string }) => {
    const fd = new FormData();
    fd.append('file', file, file.name);
    if (options) return new Promise<{ file: string }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const abort = () => xhr.abort();
      const cleanup = () => options.signal.removeEventListener('abort', abort);
      xhr.open('POST', `/api/symbian/firmware?slot=${slot}${options.bundle ? `&bundle=${options.bundle}` : ''}`);
      xhr.withCredentials = true;
      xhr.upload.onprogress = e => { if (e.lengthComputable) options.progress(Math.round(e.loaded / e.total * 100)); };
      xhr.onload = () => {
        cleanup();
        let body: { file?: string; error?: string; message?: string } = {};
        try { body = JSON.parse(xhr.responseText); } catch { /* proxy HTML error */ }
        if (xhr.status >= 200 && xhr.status < 300 && body.file) resolve({ file: body.file });
        else reject(new ApiError(xhr.status, body.error ?? 'upload_failed', body.message ?? `HTTP ${xhr.status}`));
      };
      xhr.onerror = () => { cleanup(); reject(new ApiError(0, 'network', 'Cannot reach the server')); };
      xhr.onabort = () => { cleanup(); reject(new ApiError(0, 'cancelled', 'Upload cancelled')); };
      options.signal.addEventListener('abort', abort, { once: true });
      if (options.signal.aborted) { cleanup(); reject(new ApiError(0, 'cancelled', 'Upload cancelled')); return; }
      xhr.send(fd);
    });
    return req<{ file: string }>(`/api/symbian/firmware?slot=${slot}`, { method: 'POST', body: fd });
  },
  symbianInstall: (files: import('@mgo/protocol').FirmwareInstallRequest) => req<SymbianJob>('/api/symbian/firmware/install', jsonInit('POST', files)),
  symbianDiscardBundle: (bundle: string) => req<void>(`/api/symbian/firmware/bundles/${bundle}`, { method: 'DELETE' }),
  symbianDefault: (platform: 'symbian' | 'ngage' | 'ngage2', code: string | null) => req<{ defaults: Record<string, string> }>('/api/symbian/defaults', jsonInit('PUT', { platform, code })),
  symbianJob: (id: string) => req<SymbianJob>(`/api/symbian/jobs/${id}`),
  symbianRemove: (code: string) => req<SymbianJob>(`/api/symbian/firmware/${encodeURIComponent(code)}`, { method: 'DELETE' }),
  patchGame: (id: string, patch: { favorite?: boolean; settings?: GameSettingsPatch }) => req<GameMeta>(`/api/games/${id}`, jsonInit('PATCH', patch)),
  deleteGame: (id: string, saves: boolean) => req<void>(`/api/games/${id}${saves ? '?saves=1' : ''}`, { method: 'DELETE' }),
  iconUrl: (id: string) => `/api/games/${id}/icon`,
  startSession: (gameId: string, settings?: GameSettingsPatch) => req<SessionStatus>('/api/sessions', jsonInit('POST', { gameId, settings })),
  devices: () => req<{ presets: DevicePreset[]; defaultName: string | null }>('/api/devices'),
  phones: () => req<import('@mgo/protocol').PhoneCatalog>('/api/phones'),
  phonePlan: (id: string) => req<{ status: SymbianStatus; plan: import('@mgo/protocol').NativePhonePlan }>(`/api/games/${id}/phone`),
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

  // genres
  genres: () => req<GenreSummary>('/api/library/genres'),
  catalogPreview: (file: unknown) => req<CatalogReport>('/api/library/catalog/preview', jsonInit('POST', file)),
  catalogImport: (file: unknown) => req<CatalogReport>('/api/library/catalog/import', jsonInit('POST', file)),
  setClassification: (groupKey: string, patch: { primaryGenre?: Genre; tags?: string[]; canonicalTitle?: string | null; locked?: false }) => req<GameClassification>(`/api/library/groups/${groupKey}/classification`, jsonInit('PATCH', patch)),
  clearClassification: (groupKey: string) => req<void>(`/api/library/groups/${groupKey}/classification`, { method: 'DELETE' }),

  setTitle: (groupKey: string, title: string | null) => req<{ title: string | null }>(`/api/library/groups/${groupKey}/title`, jsonInit('PUT', { title })),
  genresFromFolders: () => req<{ assigned: number; unchanged: number; skipped: number }>('/api/library/genres/from-folders', { method: 'POST' }),
  cleanup: (what: 'missing' | 'all', deleteSaves: boolean, confirm?: string) => req<{ removed: number; skipped: number; deletedSaves: boolean }>('/api/library/cleanup', jsonInit('POST', { what, deleteSaves, ...(confirm ? { confirm } : {}) })),

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
