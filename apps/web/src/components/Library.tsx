import { t as translateUI } from '../i18n';
import { GENRES, type GameMeta, type HealthStatus, type ScanReport } from '@j2me-web/protocol';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import type { Toast } from '../App';
import { navigate } from '../router';
import { useServerSettings } from '../serverSettings';
import { GameInfoDialog } from './GameInfoDialog';
import { GenreDialog } from './GenreDialog';
import { splitPlayTime } from '../playTime';
import { compareGroups, matchesStatus, SORT_KEYS, STATUS_FILTERS, totalPlaySeconds, type SortKey, type StatusFilter } from '../libraryView';
import { GameSettingsDialog } from './GameSettingsDialog';
import { Icon } from './Icon';
import { Seg } from './ui';

type Filter = 'all' | 'favorites' | 'recent';
type GenreFilter = 'all' | 'unclassified' | (typeof GENRES)[number];
const SORT_STORE = 'j2me-web.library.sort';
const STATUS_STORE = 'j2me-web.library.status';
const loadSort = (): SortKey => { try { const v = localStorage.getItem(SORT_STORE) as SortKey; return SORT_KEYS.includes(v) ? v : 'name'; } catch { return 'name'; } };
const loadStatus = (): StatusFilter => { try { const v = localStorage.getItem(STATUS_STORE) as StatusFilter; return STATUS_FILTERS.includes(v) ? v : 'all'; } catch { return 'all'; } };
const SORT_LABEL: Record<SortKey, string> = { name: 'Name A–Z', 'name-desc': 'Name Z–A', added: 'Recently added', played: 'Recently played', time: 'Most played', genre: 'Genre' };
const STATUS_LABEL: Record<StatusFilter, string> = { all: 'Any status', unplayed: 'Not played', played: 'Played', gone: 'File gone', unconfirmed: 'Genre not confirmed' };
const GENRE_KEY = 'j2me-web.library.genre';
const loadGenre = (): GenreFilter => { try { const v = localStorage.getItem(GENRE_KEY); return v === 'unclassified' || (GENRES as readonly string[]).includes(v ?? '') ? (v as GenreFilter) : 'all'; } catch { return 'all'; } };
type View = 'tiles' | 'list';
const VIEW_KEY = 'j2me-web.library.view';
const loadView = (): View => { try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'tiles'; } catch { return 'tiles'; } };

/** "2 h 05 min", "35 min", "< 1 min"; nothing before the first launch. */
function playTime(seconds: number): string | null {
  const t = splitPlayTime(seconds);
  if (t.kind === 'none') return null;
  if (t.kind === 'short') return translateUI('< 1 min');
  return t.h > 0 ? translateUI('{h} h {m} min', { h: t.h, m: String(t.m).padStart(2, '0') }) : translateUI('{m} min', { m: t.m });
}

function Cover({ g }: { g: GameMeta }) {
  const [broken, setBroken] = useState(false);
  const art = !!g.info?.hasCover && !broken; // a MobyGames cover, served by this server
  const hue = 170 + (parseInt(g.groupKey.slice(0, 4), 16) % 46); // teal to blue: the palette has one signal colour, cyan
  return (
    <div className={`cover ${art ? 'art' : ''}`} style={{ ['--hue' as string]: hue }}>
      {art ? <img src={api.coverUrl(g.id)} alt="" loading="lazy" onError={() => setBroken(true)} /> : g.hasIcon && !broken ? <img src={api.iconUrl(g.id)} alt="" onError={() => setBroken(true)} /> : <span className="initials">{g.name.slice(0, 2).toUpperCase()}</span>}
    </div>
  );
}

export function Library({ toast, onPlay, health, query, onQuery }: { toast: (k: Toast['kind'], t: string) => void; onPlay: (id: string) => void; health: HealthStatus | null; query: string; onQuery: (v: string) => void }) {
  const [games, setGames] = useState<GameMeta[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [view, setViewState] = useState<View>(loadView);
  const setView = (v: View) => { setViewState(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* storage unavailable */ } };
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [editing, setEditing] = useState<GameMeta | null>(null);
  const [infoFor, setInfoFor] = useState<GameMeta | null>(null);
  const [genreFor, setGenreFor] = useState<GameMeta | null>(null);
  const [sort, setSortState] = useState<SortKey>(loadSort);
  const setSort = (v: SortKey) => { setSortState(v); try { localStorage.setItem(SORT_STORE, v); } catch { /* storage unavailable */ } };
  const [status, setStatusState] = useState<StatusFilter>(loadStatus);
  const setStatus = (v: StatusFilter) => { setStatusState(v); try { localStorage.setItem(STATUS_STORE, v); } catch { /* storage unavailable */ } };
  const [genre, setGenreState] = useState<GenreFilter>(loadGenre);
  const setGenre = (g: GenreFilter) => { setGenreState(g); try { localStorage.setItem(GENRE_KEY, g); } catch { /* storage unavailable */ } };
  const [scan, setScan] = useState<ScanReport | null>(null);
  const server = useServerSettings();
  const libraryPath = server?.settings.libraryPath ?? null;
  const [chosen, setChosen] = useState<Record<string, string>>({}); // groupKey -> selected version id
  const fileInput = useRef<HTMLInputElement>(null);
  const depth = useRef(0);

  const reload = useCallback(async () => {
    try { setGames(await api.games()); } catch (e) { toast('error', (e as Error).message); setGames([]); }
  }, [toast]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    const f = () => void reload();
    window.addEventListener('j2me:library-changed', f);
    return () => window.removeEventListener('j2me:library-changed', f);
  }, [reload]);

  // an import started from the wizard or Settings keeps running while this page is open: follow it and refresh when it ends
  const scanning = scan?.state === 'running';
  const lastScan = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    let dead = false;
    const tick = async () => {
      try {
        const s = await api.scan();
        if (dead) return;
        setScan(s.running ? s.report : null);
        // refresh when a scan started or ended since the last look; the first look always refreshes (a quick scan may already be over)
        const id = s.report ? `${s.report.id}:${s.report.state}` : null;
        if (id !== lastScan.current) {
          const first = lastScan.current === undefined;
          lastScan.current = id;
          void reload();
          if (!first && !s.running && s.report && s.report.state === 'done' && s.report.added + s.report.updated > 0) toast('info', translateUI('Import finished: {added} new, {updated} changed', {added:s.report.added,updated:s.report.updated}));
        }
      } catch { /* old server or offline */ }
    };
    void tick();
    const t = window.setInterval(() => void tick(), scanning ? 1000 : 4000);
    return () => { dead = true; window.clearInterval(t); };
  }, [scanning, reload, toast]);
  const review = (games ?? []).filter((g) => g.info?.status === 'ambiguous');
  const reviewGroups = new Set(review.map((g) => g.groupKey)).size;

  const upload = useCallback(async (files: File[]) => {
    const jars = files.filter((f) => /\.jar$/i.test(f.name));
    const jads = files.filter((f) => /\.jad$/i.test(f.name));
    if (!jars.length) { toast('error', jads.length ? 'A .jad alone cannot be played — drop the .jar too.' : 'Drop .jar (and optionally .jad) files.'); return; }
    setUploading((n) => n + jars.length);
    for (const jar of jars) {
      const base = jar.name.replace(/\.jar$/i, '').toLowerCase();
      const jad = jads.find((j) => j.name.replace(/\.jad$/i, '').toLowerCase() === base) ?? (jars.length === 1 ? jads[0] : undefined);
      try {
        const r = await api.upload(jar, jad);
        toast('info', translateUI(r.duplicate ? '“{name}” is already in the library' : 'Added “{name}”', {name:r.game.name}));
        r.game.warnings.forEach((w) => toast('error', w));
      } catch (e) {
        toast('error', `${jar.name}: ${(e as ApiError).message}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
    void reload();
  }, [reload, toast]);

  // window-wide drag & drop
  useEffect(() => {
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
    const enter = (e: DragEvent) => { if (hasFiles(e)) { depth.current++; setDragging(true); } };
    const leave = (e: DragEvent) => { if (hasFiles(e) && --depth.current <= 0) { depth.current = 0; setDragging(false); } };
    const over = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); depth.current = 0; setDragging(false);
      void upload([...(e.dataTransfer?.files ?? [])]);
    };
    window.addEventListener('dragenter', enter); window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over); window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragenter', enter); window.removeEventListener('dragleave', leave); window.removeEventListener('dragover', over); window.removeEventListener('drop', drop); };
  }, [upload]);

  const groups = useMemo(() => {
    const m = new Map<string, GameMeta[]>();
    for (const g of games ?? []) (m.get(g.groupKey) ?? m.set(g.groupKey, []).get(g.groupKey)!).push(g);
    const needle = query.trim().toLowerCase();
    return [...m.values()]
      .map((vs) => vs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
      .filter((vs) => !needle || vs.some((g) => `${g.name} ${g.vendor} ${g.classification?.canonicalTitle ?? ''} ${g.classification?.primaryGenre ?? ''} ${(g.classification?.tags ?? []).join(' ')}`.toLowerCase().includes(needle)))
      .filter((vs) => genre === 'all' || (genre === 'unclassified' ? !vs[0]!.classification : vs[0]!.classification?.primaryGenre === genre || !!vs[0]!.classification?.genres.includes(genre)))
      .filter((vs) => (filter === 'favorites' ? vs.some((g) => g.favorite) : filter === 'recent' ? vs.some((g) => g.lastPlayedAt) : true))
      .filter((vs) => matchesStatus(vs, status))
      .sort((a, b) => compareGroups(a, b, filter === 'recent' && sort === 'name' ? 'played' : sort)); // "Recent" keeps its order unless another one is chosen
  }, [games, query, filter, genre, status, sort]);

  // games per genre (one per group, so the versions of a game count once), from what is already loaded
  const genreCounts = useMemo(() => {
    const seen = new Map<string, GameMeta>();
    for (const g of games ?? []) if (!seen.has(g.groupKey)) seen.set(g.groupKey, g);
    const n = new Map<string, number>();
    let none = 0;
    for (const g of seen.values()) { const c = g.classification; if (!c) { none++; continue; } for (const x of new Set([c.primaryGenre, ...c.genres])) n.set(x, (n.get(x) ?? 0) + 1); }
    return { n, none, total: seen.size };
  }, [games]);

  const toggleFav = async (g: GameMeta) => {
    try { const u = await api.patchGame(g.id, { favorite: !g.favorite }); setGames((gs) => gs!.map((x) => (x.id === u.id ? u : x))); } catch (e) { toast('error', (e as Error).message); }
  };

  const favCount = (games ?? []).filter((g) => g.favorite).length;
  return (
    <div className="library">
      <div className="page-head">
        <div>
          <h1>{translateUI("Library")}</h1>
          <p>{games === null ? translateUI('Loading…') : (() => { const n = new Set((games ?? []).map((g) => g.groupKey)).size; return translateUI('{games} · {fav} favorites · stored on this server only', { games: translateUI(n === 1 ? '{n} game' : '{n} games', { n }), fav: favCount }); })()}</p>
        </div>
        <span className="spacer" />
        {libraryPath && <button className="btn sm" disabled={scanning} onClick={() => void api.scanStart('update').then((r) => setScan(r.report), (e) => toast('error', (e as Error).message))} title={translateUI("Look for new and changed files in the library folder")}><Icon name="restart" /> {translateUI(scanning ? 'Importing…' : 'Scan folder')}</button>}
        <button className="btn sm primary" onClick={() => fileInput.current?.click()}><Icon name="upload" /> {translateUI("Add games")}</button>
        <input ref={fileInput} type="file" accept=".jar,.jad" multiple hidden onChange={(e) => { void upload([...(e.target.files ?? [])]); e.target.value = ''; }} />
      </div>

      <div className="lib-toolbar" role="search">
        <input className="input lib-search" type="search" placeholder={translateUI("Search games or vendors")} value={query} onChange={(e) => onQuery(e.target.value)} aria-label={translateUI("Search")} data-testid="search" />
        <select className="select compact" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label={translateUI("Sort by")} data-testid="sort">
          {SORT_KEYS.map((k) => <option key={k} value={k}>{translateUI(SORT_LABEL[k])}</option>)}
        </select>
        <select className="select compact" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} aria-label={translateUI("Show games")} data-testid="status-filter">
          {STATUS_FILTERS.map((k) => <option key={k} value={k}>{translateUI(STATUS_LABEL[k])}</option>)}
        </select>
        <Seg<Filter> label={translateUI("Filter")} value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'favorites', label: 'Favorites' }, { value: 'recent', label: 'Recent' }]} />
        <Seg<View> label={translateUI("View")} value={view} onChange={setView} options={[{ value: 'tiles', label: 'Tiles', title: 'Large tiles with covers' }, { value: 'list', label: 'List', title: 'Compact list, one game per line' }]} />
      </div>

      {scanning && scan && <div className="note info" role="status" data-testid="scan-banner">{translateUI("Importing from the library folder…")} {scan.added + scan.updated + scan.unchanged}/{scan.jars} {translateUI("files ·")} {scan.added} {translateUI("new")}{translateUI(scan.current ? ` · ${scan.current}` : '')}</div>}
      {reviewGroups > 0 && <div className="note warn" role="status">{reviewGroups} {translateUI("game")}{translateUI(reviewGroups === 1 ? '' : 's')} {translateUI("could be matched to several MobyGames entries.")} <a href="/settings#mobygames" onClick={(e) => { e.preventDefault(); navigate('/settings#mobygames'); }}>{translateUI("Choose the right ones")}</a>.</div>}

      {games && games.length > 0 && (genreCounts.total - genreCounts.none > 0 || genre !== 'all') && (
        <div className="genre-bar" role="group" aria-label={translateUI("Filter by genre")} data-testid="genre-bar">
          <button className={`chip genre-chip${genre === 'all' ? ' on' : ''}`} aria-pressed={genre === 'all'} onClick={() => setGenre('all')}>{translateUI("All genres")} <span className="count">{genreCounts.total}</span></button>
          {GENRES.filter((x) => (genreCounts.n.get(x) ?? 0) > 0 || genre === x).map((x) => (
            <button key={x} className={`chip genre-chip${genre === x ? ' on' : ''}`} aria-pressed={genre === x} onClick={() => setGenre(genre === x ? 'all' : x)}>{translateUI(x)} <span className="count">{genreCounts.n.get(x) ?? 0}</span></button>
          ))}
          {(genreCounts.none > 0 || genre === 'unclassified') && <button className={`chip genre-chip${genre === 'unclassified' ? ' on' : ''}`} aria-pressed={genre === 'unclassified'} onClick={() => setGenre(genre === 'unclassified' ? 'all' : 'unclassified')}>{translateUI("No genre")} <span className="count">{genreCounts.none}</span></button>}
        </div>
      )}

      {games && games.length === 0 && (
        <div className="empty">
          <div className="empty-art" aria-hidden />
          <h2>{translateUI("Your library is empty")}</h2>
          <p>{translateUI("Drop your own")} <code>{translateUI(".jar")}</code> {translateUI("files here (a matching")} <code>{translateUI(".jad")}</code> {translateUI("is optional)")}{translateUI(libraryPath ? ', or import the folder you connected.' : ', or connect a folder with your collection.')} {translateUI("Games are stored on this server only; nothing is downloaded for you.")}</p>
          <div className="btn-row">
            <button className="btn primary" onClick={() => fileInput.current?.click()}><Icon name="upload" /> {translateUI("Choose files")}</button>
            {libraryPath
              ? <button className="btn" disabled={scanning} onClick={() => void api.scanStart('update').then((r) => setScan(r.report), (e) => toast('error', (e as Error).message))}><Icon name="restart" /> {translateUI("Scan folder")}</button>
              : <a className="btn" href="/settings#library" onClick={(e) => { e.preventDefault(); navigate('/settings#library'); }}>{translateUI("Connect a game folder")}</a>}
          </div>
        </div>
      )}
      {games === null && <p className="muted">{translateUI("Loading…")}</p>}

      {view === 'list' && groups.length > 0 && (
        <div className="lib-table-head" aria-hidden>
          <span /><span>{translateUI("Title")}</span><span className="c-vendor">{translateUI("Publisher")}</span><span className="c-genre">{translateUI("Genre")}</span><span className="c-version">{translateUI("Version")}</span><span className="c-time">{translateUI("Time")}</span><span />
        </div>
      )}
      <div className={`lib-grid${view === 'list' ? ' list' : ''}`} data-view={view}>
        {groups.map((vs) => {
          const sel = vs.find((v) => v.id === chosen[vs[0]!.groupKey]) ?? vs[0]!;
          const bad = sel.classVersion >= 49;
          const unconfirmed = !sel.classification || sel.classification.unconfirmed;
          const genreButton = (
            <button className={`badge plain genre-badge${unconfirmed ? ' unconfirmed' : ''}`} onClick={() => setGenreFor(sel)} data-testid="genre-badge"
              title={translateUI(unconfirmed ? 'The genre is not confirmed: click to choose it' : 'Change the genre')}>
              {translateUI(unconfirmed ? 'Genre not confirmed' : sel.classification!.primaryGenre)}
            </button>
          );
          const versionControl = vs.length > 1 ? (
            <select className="select compact" value={sel.id} onChange={(e) => setChosen((c) => ({ ...c, [sel.groupKey]: e.target.value }))} aria-label={translateUI("Version")}>
              {vs.map((v) => <option key={v.id} value={v.id}>{translateUI(v.version ? `v${v.version}` : v.id.slice(0, 6))} · {(v.sizeBytes / 1024).toFixed(0)} {translateUI("KB")}</option>)}
            </select>
          ) : (
            <span className="badge plain">{translateUI(sel.version ? `v${sel.version}` : 'no version')}</span>
          );
          const flags = (
            <>
              {sel.warnings.length > 0 && <span className="badge mock" title={translateUI(sel.warnings.join('\n'))}>!</span>}
              {sel.sourceMissing && <span className="badge plain" title={translateUI("The file is no longer in the library folder; the game stays here with its saves")}>{translateUI("file gone")}</span>}
              {sel.info?.status === 'ambiguous' && <span className="badge mock" title={translateUI("Several MobyGames matches: open the info to choose")}>{translateUI("review")}</span>}
            </>
          );
          const time = (
            <span className={`playtime${totalPlaySeconds(vs) ? '' : ' none'}`} data-testid="playtime" title={translateUI("Time spent in this game, all versions together")}><Icon name="clock" /> {playTime(totalPlaySeconds(vs)) ?? '0'}</span>
          );
          const actions = (
            <>
              <button className={`icon-btn ${sel.favorite ? 'fav' : ''}`} onClick={() => toggleFav(sel)} aria-label={translateUI(sel.favorite ? 'Remove from favorites' : 'Add to favorites')} aria-pressed={sel.favorite}><Icon name="star" /></button>
              <button className="icon-btn" onClick={() => setInfoFor(sel)} aria-label={translateUI("Game information")}><Icon name="info" /></button>
              <button className="icon-btn" onClick={() => setEditing(sel)} aria-label={translateUI("Game settings")}><Icon name="sliders" /></button>
            </>
          );
          if (view === 'list') return (
            <article className="card game-card game-row" key={sel.groupKey}>
              <button className="row-cover" tabIndex={-1} aria-hidden onClick={() => onPlay(sel.id)} disabled={bad || health?.ok === false}><Cover g={sel} /></button>
              <button className="card-main row-title" onClick={() => onPlay(sel.id)} disabled={bad || health?.ok === false} title={translateUI(bad ? 'Java 5+ class files are not supported by KEmulator' : `Play ${sel.name}`)}>
                <h3>{sel.name}</h3>
                <span className="row-flags">{flags}</span>
              </button>
              <span className="cell c-vendor muted" title={sel.vendor}>{translateUI(sel.info?.year ? `${sel.vendor} · ${sel.info.year}` : sel.vendor)}</span>
              <span className="cell c-genre">{genreButton}</span>
              <span className="cell c-version">{versionControl}</span>
              <span className="cell c-time">{time}</span>
              <span className="cell actions">{actions}</span>
            </article>
          );
          return (
            <article className="card game-card" key={sel.groupKey}>
              <button className="card-main" onClick={() => onPlay(sel.id)} disabled={bad || health?.ok === false} title={translateUI(bad ? 'Java 5+ class files are not supported by KEmulator' : `Play ${sel.name}`)}>
                <Cover g={sel} />
                <div className="meta">
                  <h3>{sel.name}</h3>
                  <p className="muted">{translateUI(sel.info?.year ? `${sel.vendor} · ${sel.info.year}` : sel.vendor)}</p>
                  <p>{time}</p>
                </div>
              </button>
              <div className="card-foot">
                {versionControl}
                {flags}
                {genreButton}
                <span className="spacer" />
                {actions}
              </div>
            </article>
          );
        })}
      </div>
      {games && games.length > 0 && groups.length === 0 && <p className="muted center">{translateUI("No games match.")}</p>}
      {uploading > 0 && <div className="uploading">{translateUI("Uploading")} {uploading}…</div>}
      {dragging && <div className="dropzone"><div><strong>{translateUI("Drop to add")}</strong><br />{translateUI(".jar and .jad files")}</div></div>}
      {genreFor && <GenreDialog game={genreFor} toast={toast} onClose={() => setGenreFor(null)} onChanged={() => { setGenreFor(null); void reload(); }} />}
      {infoFor && <GameInfoDialog game={infoFor} toast={toast} onClose={() => setInfoFor(null)} onChanged={() => void reload()} />}
      {editing && <GameSettingsDialog game={editing} toast={toast} onClose={() => setEditing(null)} onChanged={() => { setEditing(null); void reload(); }} />}
    </div>
  );
}
