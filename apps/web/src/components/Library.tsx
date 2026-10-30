import type { GameMeta, HealthStatus } from '@j2me-web/protocol';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import type { Toast } from '../App';
import { GameSettingsDialog } from './GameSettingsDialog';
import { Icon } from './Icon';
import { Seg } from './ui';

type Filter = 'all' | 'favorites' | 'recent';

function Cover({ g }: { g: GameMeta }) {
  const [broken, setBroken] = useState(false);
  const hue = 18 + (parseInt(g.groupKey.slice(0, 4), 16) % 34); // warm range only: the palette has one signal colour
  return (
    <div className="cover" style={{ ['--hue' as string]: hue }}>
      {g.hasIcon && !broken ? <img src={api.iconUrl(g.id)} alt="" onError={() => setBroken(true)} /> : <span className="initials">{g.name.slice(0, 2).toUpperCase()}</span>}
    </div>
  );
}

export function Library({ toast, onPlay, health, query }: { toast: (k: Toast['kind'], t: string) => void; onPlay: (id: string) => void; health: HealthStatus | null; query: string }) {
  const [games, setGames] = useState<GameMeta[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [editing, setEditing] = useState<GameMeta | null>(null);
  const [chosen, setChosen] = useState<Record<string, string>>({}); // groupKey -> selected version id
  const fileInput = useRef<HTMLInputElement>(null);
  const depth = useRef(0);

  const reload = useCallback(async () => {
    try { setGames(await api.games()); } catch (e) { toast('error', (e as Error).message); setGames([]); }
  }, [toast]);
  useEffect(() => { void reload(); }, [reload]);

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
        toast('info', r.duplicate ? `“${r.game.name}” is already in the library` : `Added “${r.game.name}”`);
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
      .filter((vs) => !needle || vs.some((g) => `${g.name} ${g.vendor}`.toLowerCase().includes(needle)))
      .filter((vs) => (filter === 'favorites' ? vs.some((g) => g.favorite) : filter === 'recent' ? vs.some((g) => g.lastPlayedAt) : true))
      .sort((a, b) => (filter === 'recent' ? (b[0]!.lastPlayedAt ?? '').localeCompare(a[0]!.lastPlayedAt ?? '') : a[0]!.name.localeCompare(b[0]!.name)));
  }, [games, query, filter]);

  const toggleFav = async (g: GameMeta) => {
    try { const u = await api.patchGame(g.id, { favorite: !g.favorite }); setGames((gs) => gs!.map((x) => (x.id === u.id ? u : x))); } catch (e) { toast('error', (e as Error).message); }
  };

  const favCount = (games ?? []).filter((g) => g.favorite).length;
  return (
    <div className="library">
      <div className="page-head">
        <div>
          <h1>Library</h1>
          <p>{games === null ? 'Loading…' : `${new Set((games ?? []).map((g) => g.groupKey)).size} games · ${favCount} favorites · stored on this server only`}</p>
        </div>
        <span className="spacer" />
        <Seg<Filter> label="Filter" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'favorites', label: 'Favorites' }, { value: 'recent', label: 'Recent' }]} />
        <button className="btn primary" onClick={() => fileInput.current?.click()}><Icon name="upload" /> Add games</button>
        <input ref={fileInput} type="file" accept=".jar,.jad" multiple hidden onChange={(e) => { void upload([...(e.target.files ?? [])]); e.target.value = ''; }} />
      </div>

      {games && games.length === 0 && (
        <div className="empty">
          <div className="empty-art" aria-hidden />
          <h2>Your library is empty</h2>
          <p>Drop your own <code>.jar</code> files here (a matching <code>.jad</code> is optional). Games are stored on this server only; nothing is downloaded for you.</p>
          <button className="btn primary" onClick={() => fileInput.current?.click()}><Icon name="upload" /> Choose files</button>
        </div>
      )}
      {games === null && <p className="muted">Loading…</p>}

      <div className="lib-grid">
        {groups.map((vs) => {
          const sel = vs.find((v) => v.id === chosen[vs[0]!.groupKey]) ?? vs[0]!;
          const bad = sel.classVersion >= 49;
          return (
            <article className="card game-card" key={sel.groupKey}>
              <button className="card-main" onClick={() => onPlay(sel.id)} disabled={bad || health?.ok === false} title={bad ? 'Java 5+ class files are not supported by KEmulator' : `Play ${sel.name}`}>
                <Cover g={sel} />
                <div className="meta">
                  <h3>{sel.name}</h3>
                  <p className="muted">{sel.vendor}</p>
                </div>
              </button>
              <div className="card-foot">
                {vs.length > 1 ? (
                  <select className="select compact" value={sel.id} onChange={(e) => setChosen((c) => ({ ...c, [sel.groupKey]: e.target.value }))} aria-label="Version">
                    {vs.map((v) => <option key={v.id} value={v.id}>{v.version ? `v${v.version}` : v.id.slice(0, 6)} · {(v.sizeBytes / 1024).toFixed(0)} KB</option>)}
                  </select>
                ) : (
                  <span className="badge">{sel.version ? `v${sel.version}` : 'no version'}</span>
                )}
                {sel.warnings.length > 0 && <span className="badge mock" title={sel.warnings.join('\n')}>!</span>}
                <span className="spacer" />
                <button className={`icon-btn ${sel.favorite ? 'fav' : ''}`} onClick={() => toggleFav(sel)} aria-label={sel.favorite ? 'Remove from favorites' : 'Add to favorites'} aria-pressed={sel.favorite}><Icon name="star" /></button>
                <button className="icon-btn" onClick={() => setEditing(sel)} aria-label="Game settings"><Icon name="sliders" /></button>
              </div>
            </article>
          );
        })}
      </div>
      {games && games.length > 0 && groups.length === 0 && <p className="muted center">No games match.</p>}
      {uploading > 0 && <div className="uploading">Uploading {uploading}…</div>}
      {dragging && <div className="dropzone"><div><strong>Drop to add</strong><br />.jar and .jad files</div></div>}
      {editing && <GameSettingsDialog game={editing} toast={toast} onClose={() => setEditing(null)} onChanged={() => { setEditing(null); void reload(); }} />}
    </div>
  );
}
