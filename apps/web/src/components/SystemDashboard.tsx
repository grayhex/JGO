import { useEffect, useRef, useState } from 'react';
import type { HealthStatus, SessionStatus, SymbianStatus, SystemStatus } from '@mgo/protocol';
import { api } from '../api';
import { t } from '../i18n';
import { SystemChecks } from './SettingsForms';

const bytes = (n: number) => n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : `${(n / 1048576).toFixed(1)} MB`;
export function SystemDashboard({ toast }: { toast: (kind: 'info' | 'error', text: string) => void }) {
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [symbian, setSymbian] = useState<SymbianStatus | null>(null);
  const [sessions, setSessions] = useState<SessionStatus[]>([]);
  const [history, setHistory] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const refresh = useRef<() => void>(() => undefined);
  useEffect(() => {
    let dead = false, loading = false; let timer: ReturnType<typeof setTimeout>;
    const sample = async () => {
      if (loading) return; loading = true;
      try {
        const [sys, h, sym, runs] = await Promise.all([api.systemStatus(), api.health(), api.symbianStatus(), api.sessions()]);
        if (!dead) { setSystem(sys); setHealth(h); setSymbian(sym); setSessions(runs.filter(s => ['running', 'starting'].includes(s.state))); setError(null); if (sys.monitoring?.cpuPercent != null) setHistory(old => [...old.slice(-29), sys.monitoring!.cpuPercent!]); }
      } catch (e) { if (!dead) setError((e as Error).message); }
      finally { loading = false; if (!dead) timer = setTimeout(sample, 5000); }
    };
    refresh.current = () => { clearTimeout(timer); void sample(); }; void sample();
    return () => { dead = true; clearTimeout(timer); };
  }, []);
  const m = system?.monitoring;
  const used = system ? system.storage.totalBytes - system.storage.freeBytes : 0;
  return <div className="system-dashboard">
    <div className="system-toolbar"><span className="badge prod">{t('Live monitoring')} · 5 s</span><span className="muted small">{system?.sampledAt ? new Date(system.sampledAt).toLocaleTimeString() : t('Connecting…')}</span><button className="btn sm" onClick={() => refresh.current()}>{t('Refresh')}</button></div>
    {error && <p className="note err" role="alert">{error}</p>}
    <div className="system-metrics">
      <article className="metric"><span>CPU</span><strong>{m?.cpuPercent == null ? '—' : `${m.cpuPercent.toFixed(1)}%`}</strong><small>{m?.cpuCores ?? '—'} {t('CPU cores')}</small><svg viewBox="0 0 290 70" preserveAspectRatio="none" aria-label="CPU history"><path d={history.map((v,i) => `${i ? 'L' : 'M'}${i * 10},${68 - v * .65}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="2" /></svg></article>
      <article className="metric"><span>{t('Memory')}</span><strong>{m ? bytes(m.memoryBytes) : '—'}</strong><small>{m ? `${t('of')} ${bytes(m.memoryLimitBytes)}` : ''}</small><progress max={m?.memoryLimitBytes || 1} value={m?.memoryBytes ?? 0} /></article>
      <article className="metric"><span>{t('Data storage')}</span><strong>{system ? bytes(system.storage.freeBytes) : '—'}</strong><small>{t('free')} · {system ? bytes(system.storage.totalBytes) : ''}</small><progress max={system?.storage.totalBytes || 1} value={used} /></article>
      <article className="metric"><span>{t('Active sessions')}</span><strong>{sessions.length}</strong><small>{m ? `${t('Uptime')} ${Math.floor(m.uptimeSeconds / 3600)}h ${Math.floor(m.uptimeSeconds / 60) % 60}m` : ''}</small><small>{m ? `${m.frames} ${t('frames')} · ${bytes(m.audioBytes)} PCM` : ''}</small></article>
    </div>
    <div className="system-engines">
      <article><h3>MGO <span className="badge prod">{t('Online')}</span></h3><code>{system?.version ?? '—'}</code><p>{m?.platform} · Node {m?.nodeVersion}</p><p className="small">{location.protocol === 'https:' ? t('HTTPS connection') : t('HTTP connection — enable HTTPS at the gateway')}</p></article>
      <article><h3>KEmulator <span className={`badge ${health?.ok ? 'prod' : 'danger'}`}>{t(health?.ok ? 'Ready' : 'Unavailable')}</span></h3><code>{health?.kemulator.commit?.slice(0,12) ?? '—'}</code><p>Java {health?.java.version ?? '—'}</p></article>
      <article><h3>EKA2L1 <span className={`badge ${symbian?.reachable ? 'prod' : 'danger'}`}>{t(symbian?.reachable ? symbian.busy ? 'Running' : 'Ready' : 'Unavailable')}</span></h3><code>{symbian?.emulator ?? '—'}</code><p>{symbian?.firmware.devices.length ?? 0} {t('Installed devices')}</p>{symbian?.metrics && <p>CPU {symbian.metrics.cpuPercent == null ? '—' : `${symbian.metrics.cpuPercent.toFixed(1)}%`} · {bytes(symbian.metrics.memoryBytes)}{symbian.metrics.memoryLimitBytes ? ` / ${bytes(symbian.metrics.memoryLimitBytes)}` : ''}</p>}{symbian?.audioDiagnostics && <p className={symbian.audioDiagnostics.ready ? 'muted' : 'note err'}>PulseAudio {symbian.audioDiagnostics.version ?? ''} · {symbian.audioDiagnostics.ready ? t('Ready') : symbian.audioDiagnostics.error} · {bytes(symbian.audioDiagnostics.bytes)} PCM</p>}<a href="/api/symbian/diagnostics" download>{t('Download Symbian diagnostics')}</a></article>
    </div>
    {sessions.map(s => <article className="system-session" key={s.id}><strong>{s.gameId}</strong><span>{s.backend} · {s.device ?? '—'} · {s.width}×{s.height}</span><span>{s.fps.toFixed(1)} FPS · {bytes(s.audioBytes)} PCM</span><a href={`/api/sessions/${s.id}/diagnostics`} download>{t('Diagnostics')}</a></article>)}
    <SystemChecks status={system} onReload={() => refresh.current()} />
  </div>;
}
