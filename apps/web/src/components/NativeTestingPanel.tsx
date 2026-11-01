import { useState } from 'react';
import { EMULATED_DEVICES, GAME_PLATFORM_LABELS, emulatedDevice, selectPhone, type GameMeta, type NativePhonePlan, type SymbianStatus } from '@j2me-web/protocol';
import { api } from '../api';
import { t } from '../i18n';
import { navigate } from '../router';
import { Panel } from './ui';

export function NativeTestingPanel({ game, data, error, running, starting, onChanged, onRefresh, onSkin, toast }: {
  game: GameMeta; data: { plan: NativePhonePlan; status: SymbianStatus } | null; error: string | null;
  running: boolean; starting: boolean; onChanged: (game: GameMeta) => void; onRefresh: () => void;
  onSkin: (id: import('@j2me-web/protocol').PhoneSkinId) => void; toast: (kind: 'info' | 'error', text: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const platform = game.platform ?? 'symbian';
  const profile = data?.plan.deviceId ? emulatedDevice(data.plan.deviceId) : null;
  const save = async (settings: Parameters<typeof api.patchGame>[1]['settings']) => {
    setSaving(true);
    try { onChanged(await api.patchGame(game.id, { settings })); onRefresh(); }
    catch (e) { toast('error', (e as Error).message); }
    finally { setSaving(false); }
  };
  return <Panel icon="cpu" title={t('Symbian emulator (experimental)')}>
    <div className="chips"><span className="chip">{GAME_PLATFORM_LABELS[platform]}</span><span className="chip">EKA2L1 {data?.status.emulator ?? ''}</span></div>
    <div className={`note ${data?.plan.ready ? 'ok' : 'warn'}`} role="status" data-testid="native-readiness" data-ready={data?.plan.ready ? '1' : '0'}>
      {error ? t('Cannot check the Symbian service. Refresh before starting.') : data ? t(data.plan.message) : t('Checking service and firmware…')}
    </div>
    {data && <ol className="native-checks" aria-label={t('Test readiness')}>
      <li>{t('Service')}: {t(data.status.reachable ? 'Service connected' : data.status.configured ? 'Unreachable' : 'Not configured')}</li>
      <li>{t('Installed devices')}: {data.status.firmware.devices.length}</li>
      <li>{t('Device (firmware)')}: <strong data-testid="resolved-firmware">{data.plan.firmwareCode ?? '—'}</strong>{data.plan.source && <span className="hint"> · {t(data.plan.source === 'game' ? 'This game' : data.plan.source === 'platform' ? 'Platform default' : 'Only installed device')}</span>}</li>
      <li>{t('First frame')}: {t(starting ? 'Waiting for the first frame…' : running ? 'Session active' : 'Start a test when ready')}</li>
    </ol>}
    <label className="field"><span className="label-caps">{t('Emulated device')}</span>
      <select className="select" aria-label={t('Emulated device')} value={game.settings.emulatedDeviceId ?? ''} disabled={running || saving} onChange={e => {
        const id = e.target.value, d = emulatedDevice(id);
        void save({ emulatedDeviceId: id || null, symbianDevice: d?.engine === 'eka2l1' ? d.firmware.product : null });
      }}>
        <option value="">{t('Use the selected firmware')}</option>
        {EMULATED_DEVICES.filter(d => d.engine === 'eka2l1' && d.platforms.includes(platform)).map(d => <option key={d.id} value={d.id}>{d.name} · {d.os}{d.engine === 'eka2l1' && !data?.status.firmware.devices.some(f => f.code.toLowerCase() === d.firmware.product.toLowerCase()) ? ` (${t('not installed')})` : ''}</option>)}
      </select>
    </label>
    <label className="field"><span className="label-caps">{t('Device (firmware)')}</span>
      <select className="select" data-testid="symbian-device" aria-label={t('Device (firmware)')} disabled={running || saving || !data?.status.reachable} value={data?.status.firmware.devices.find(d => d.code.toLowerCase() === game.settings.symbianDevice?.toLowerCase())?.code ?? game.settings.symbianDevice ?? ''} onChange={e => void save({ symbianDevice: e.target.value || null, emulatedDeviceId: null })}>
        <option value="">{t('Automatic (platform default or the only device)')}</option>
        {game.settings.symbianDevice && !data?.status.firmware.devices.some(d => d.code.toLowerCase() === game.settings.symbianDevice?.toLowerCase()) && <option value={game.settings.symbianDevice}>{game.settings.symbianDevice} ({t('not installed')})</option>}
        {data?.status.firmware.devices.map(d => <option key={d.code} value={d.code}>{d.manufacturer} {d.model} ({d.code})</option>)}
      </select>
    </label>
    {profile && <p className="hint">{profile.os} · {profile.screen.width}×{profile.screen.height} · {profile.layout}</p>}
    {data?.plan.warnings.map(w => <p key={w} className="note warn">{t(w)}</p>)}
    <p className="hint" data-testid="symbian-note">{t('The skin changes appearance. This game runs on the firmware shown above; compatibility with a real game still needs testing.')}</p>
    <div className="btn-row">
      <button className="btn sm" onClick={onRefresh}>{t('Refresh status')}</button>
      <button className="btn sm" onClick={() => navigate('/settings#symbian')}>{t('Manage firmware')}</button>
      {data?.plan.skinId && <button className="btn sm" onClick={() => {
        const selection = selectPhone({ platform, emulatedDeviceId: data.plan.deviceId! });
        if (selection.ok) { onSkin(selection.skinId); void save({ skinId: selection.skinId }); }
      }}>{t('Use matching skin')}</button>}
    </div>
    <a className="btn ghost sm" href="/api/symbian/diagnostics" download data-testid="symbian-session-diagnostics">{t('Download Symbian diagnostics')}</a>
  </Panel>;
}
