import { KEY_LAYOUTS, SCREEN_PRESETS, type DevicePreset, type LayoutId, type PublicSettings, type SystemStatus } from '@j2me-web/protocol';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { setServerSettings, useServerSettings } from '../serverSettings';
import { useCatalog } from '../skin/registry';
import { Icon } from './Icon';
import { SkinPicker, SkinStatus } from './SkinPicker';
import { Seg, Switch } from './ui';

type Toaster = (kind: 'info' | 'error', text: string) => void;

/** One settings section = a draft of that part of the server settings plus a Save button. */
function useSection<K extends 'phone' | 'audio' | 'controls' | 'server'>(key: K, toast: Toaster, auto = false) {
  const server = useServerSettings();
  const saved = server?.settings[key] as PublicSettings[K] | undefined;
  const [draft, setDraft] = useState<PublicSettings[K] | null>(saved ?? null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (saved) setDraft(saved); }, [JSON.stringify(saved)]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved);
  const save = async (message = 'Saved') => {
    if (!draft) return;
    setBusy(true);
    try { setServerSettings(await api.patchSettings({ [key]: draft } as never)); toast('info', message); } catch (e) { toast('error', (e as Error).message); } finally { setBusy(false); }
  };
  // wizard mode: every change is saved by itself (after a short pause), also when the step is left right away
  const latest = useRef({ draft, dirty, save });
  latest.current = { draft, dirty, save };
  useEffect(() => {
    if (!auto || !dirty) return;
    const t = window.setTimeout(() => void latest.current.save('Saved'), 500);
    return () => window.clearTimeout(t);
  }, [auto, dirty, JSON.stringify(draft)]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (auto && latest.current.dirty) void latest.current.save('Saved'); }, [auto]);
  return { draft, set: (p: Partial<PublicSettings[K]>) => setDraft((d) => (d ? { ...d, ...p } : d)), dirty, busy, save, saved, auto };
}

export function SaveBar({ dirty, busy, onSave, onReset, note, auto }: { dirty: boolean; busy: boolean; onSave: () => void; onReset?: () => void; note?: string; auto?: boolean }) {
  if (auto) return <p className="muted small" role="status">{busy ? 'Saving…' : dirty ? 'Saving…' : 'Changes are saved automatically.'}</p>;
  return (
    <div className="btn-row save-bar">
      <button className="btn primary" type="button" disabled={!dirty || busy} onClick={onSave}>Save</button>
      {onReset && <button className="btn ghost" type="button" disabled={!dirty || busy} onClick={onReset}>Discard changes</button>}
      {note && <span className="muted small">{note}</span>}
    </div>
  );
}

export function PhoneDefaultsForm({ toast, auto }: { toast: Toaster; auto?: boolean }) {
  const { draft, set, dirty, busy, save, saved } = useSection('phone', toast, auto);
  const { skins } = useCatalog();
  const [devices, setDevices] = useState<DevicePreset[] | null>(null);
  useEffect(() => { api.devices().then((d) => setDevices(d.presets), () => setDevices([])); }, []);
  if (!draft) return <p className="muted">Loading…</p>;
  const skin = skins?.find((s) => s.config.id === draft.skinId);
  const preset = SCREEN_PRESETS.find((p) => p.width === draft.width && p.height === draft.height);
  const pickDevice = (id: string) => {
    const d = devices?.find((x) => x.id === id);
    if (!d) set({ device: null });
    else set({ device: d.id, width: d.width, height: d.height, layout: d.layout });
  };
  return (
    <div className="stack">
      <p className="muted">The phone new games start with. It is chosen once here and can be changed per game later; games already in the library keep their own settings.</p>
      <div>
        <span className="label-caps">Phone picture</span>
        <SkinPicker skins={skins} value={draft.skinId} onChange={(id) => set({ skinId: id })} />
        {skin && <p className="muted small">{skin.config.manufacturer} {skin.config.model} · <SkinStatus status={skin.config.status} /> The picture is only a look: it never changes what the game sees.</p>}
      </div>
      <div className="field"><span className="label-caps">Starting view</span><Seg<'full' | 'screen'> label="Starting view" value={draft.view} onChange={(v) => set({ view: v })} options={[{ value: 'full', label: 'Whole phone' }, { value: 'screen', label: 'Screen close-up' }]} /></div>
      <label className="field">
        <span className="label-caps">Device profile (KEmulator)</span>
        <select className="select" value={draft.device ?? ''} onChange={(e) => pickDevice(e.target.value)} disabled={devices === null || devices.length === 0}>
          <option value="">None — resolution and key layout only</option>
          {(devices ?? []).map((d) => <option key={d.id} value={d.id}>{d.name} · {d.width}×{d.height}</option>)}
        </select>
        {devices !== null && devices.length === 0 && <span className="muted small">Device profiles are not available on this server.</span>}
      </label>
      <label className="field">
        <span className="label-caps">Resolution</span>
        <select className="select" value={preset ? `${preset.width}x${preset.height}` : 'custom'} onChange={(e) => { const [w, h] = e.target.value.split('x').map(Number); if (w && h) set({ width: w, height: h, device: null }); }}>
          {SCREEN_PRESETS.map((p) => <option key={p.label} value={`${p.width}x${p.height}`}>{p.label}</option>)}
          {!preset && <option value="custom">{draft.width}×{draft.height} (custom)</option>}
        </select>
      </label>
      <div className="field-row">
        <label className="field"><span className="label-caps">Key layout</span>
          <select className="select" value={draft.layout} onChange={(e) => set({ layout: e.target.value as LayoutId })}>
            {Object.entries(KEY_LAYOUTS).map(([id, l]) => <option key={id} value={id}>{l.label}</option>)}
          </select>
        </label>
        <label className="field"><span className="label-caps">Heap (MB)</span><input className="input" type="number" min={64} max={1024} step={32} value={draft.heapMb} onChange={(e) => set({ heapMb: Number(e.target.value) })} /></label>
      </div>
      <SaveBar auto={auto} dirty={dirty} busy={busy} onSave={() => void save('Default phone saved')} onReset={saved ? () => set(saved) : undefined} />
    </div>
  );
}

export function SoundControlsForm({ toast, auto }: { toast: Toaster; auto?: boolean }) {
  const a = useSection('audio', toast, auto);
  const c = useSection('controls', toast, auto);
  if (!a.draft || !c.draft) return <p className="muted">Loading…</p>;
  return (
    <div className="stack">
      <h3><Icon name="volume" /> Sound</h3>
      <Switch checked={a.draft.enabled} onChange={(v) => a.set({ enabled: v })}>Play game sound (otherwise games start muted)</Switch>
      <label className="field"><span className="label-caps">Starting volume — {a.draft.volume}%</span><input type="range" min={0} max={100} value={a.draft.volume} onChange={(e) => a.set({ volume: Number(e.target.value) })} aria-label="Volume" /></label>
      <SaveBar auto={auto} dirty={a.dirty} busy={a.busy} onSave={() => void a.save('Sound settings saved')} note="Browsers only start sound after a click: pressing Start in the player does that." />
      <h3><Icon name="gamepad" /> Controls</h3>
      <div className="field"><span className="label-caps">On-screen keypad</span><Seg<'auto' | 'always' | 'never'> label="On-screen keypad" value={c.draft.keypad} onChange={(v) => c.set({ keypad: v })} options={[{ value: 'auto', label: 'Touch devices only' }, { value: 'always', label: 'Always' }, { value: 'never', label: 'Never' }]} /></div>
      <Switch checked={c.draft.haptics} onChange={(v) => c.set({ haptics: v })}>Vibration feedback on touch keys and when the game vibrates</Switch>
      <Switch checked={c.draft.gamepad} onChange={(v) => c.set({ gamepad: v })}>Use a connected gamepad</Switch>
      <p className="muted small">The keyboard keys of each phone button can be changed per player (“Keys…” in the Controls panel). That is stored in this browser.</p>
      <SaveBar auto={auto} dirty={c.dirty} busy={c.busy} onSave={() => void c.save('Control settings saved')} />
    </div>
  );
}

export function ServerForm({ toast, auto }: { toast: Toaster; auto?: boolean }) {
  const server = useServerSettings();
  const { draft, set, dirty, busy, save, saved } = useSection('server', toast, auto);
  if (!draft || !server) return <p className="muted">Loading…</p>;
  const env = server.envDefaults;
  const num = (label: string, k: 'maxSessions' | 'sessionMaxMinutes' | 'sessionIdleMinutes' | 'libraryQuotaMb', min: number, max: number, unit: string) => (
    <label className="field">
      <span className="label-caps">{label} ({unit})</span>
      <input className="input" type="number" min={min} max={max} value={draft[k]} onChange={(e) => set({ [k]: Number(e.target.value) } as never)} />
      {draft[k] !== env[k] && <span className="muted small">Default from the server configuration: {env[k]}</span>}
    </label>
  );
  return (
    <div className="stack">
      <div className="field-row">
        {num('Parallel sessions', 'maxSessions', 1, 8, 'games at once')}
        {num('Library size limit', 'libraryQuotaMb', 64, 4194304, 'MB')}
      </div>
      <div className="field-row">
        {num('Maximum session length', 'sessionMaxMinutes', 1, 1440, 'minutes')}
        {num('Stop when nobody watches after', 'sessionIdleMinutes', 1, 240, 'minutes')}
      </div>
      <div className="field"><span className="label-caps">Video encoding</span><Seg<'raw' | 'deflate'> label="Video encoding" value={draft.frameEncoding} onChange={(v) => set({ frameEncoding: v })} options={[{ value: 'deflate', label: 'Compressed (less bandwidth)' }, { value: 'raw', label: 'Raw (less CPU)' }]} /></div>
      <SaveBar auto={auto} dirty={dirty} busy={busy} onSave={() => void save('Server settings saved')} onReset={saved ? () => set(saved) : undefined} note="Applies immediately; running games are not interrupted." />
      <dl className="facts">
        <dt>Listens on</dt><dd className="mono">{server.readonly.host}:{server.readonly.port}</dd>
        <dt>Access</dt><dd>{server.readonly.auth === 'token' ? 'Protected by the access token (show it with `jgo token` in the container)' : 'No token: reachable from this machine only'}</dd>
      </dl>
      <p className="muted small">Address, port and the access token are set at install time (<code>/etc/jgo/jgo.env</code>) and cannot be changed from the web UI.</p>
    </div>
  );
}

export function SystemChecks({ status, onReload }: { status: SystemStatus | null; onReload?: () => void }) {
  if (!status) return <p className="muted">Checking the server…</p>;
  const gb = (n: number) => `${(n / 1073741824).toFixed(1)} GB`;
  return (
    <div className="stack">
      <ul className="checks" data-testid="system-checks">
        {status.checks.map((c) => (
          <li key={c.id} className={`check ${c.state}`} data-check={c.id}>
            <span className="check-icon"><Icon name={c.state === 'ok' ? 'check' : 'alert'} /></span>
            <div>
              <strong>{c.label}</strong>
              <div className="muted small">{c.detail}</div>
              {c.hint && c.state !== 'ok' && <div className="small hint">Fix: <code>{c.hint}</code></div>}
            </div>
            <span className={`badge ${c.state === 'ok' ? 'prod' : c.state === 'warn' ? 'mock' : 'danger'}`}>{c.state === 'ok' ? 'OK' : c.state === 'warn' ? 'Check' : 'Problem'}</span>
          </li>
        ))}
      </ul>
      {status.storage.totalBytes > 0 && (
        <div>
          <div className="meter" role="meter" aria-label="Disk used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((1 - status.storage.freeBytes / status.storage.totalBytes) * 100)}><span style={{ width: `${(1 - status.storage.freeBytes / status.storage.totalBytes) * 100}%` }} /></div>
          <p className="muted small">Disk: {gb(status.storage.totalBytes - status.storage.freeBytes)} used of {gb(status.storage.totalBytes)} · games library {gb(status.storage.libraryBytes)} of {gb(status.storage.quotaBytes)} limit · JGO {status.version}</p>
        </div>
      )}
      {onReload && <button className="btn sm" type="button" onClick={onReload}><Icon name="restart" /> Check again</button>}
    </div>
  );
}
