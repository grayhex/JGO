import { useState } from 'react';
import { EMULATED_DEVICES, PACKAGE_FORMAT_LABEL, emulatedDevice, type GameMeta, type NativePhonePlan, type SymbianStatus } from '@mgo/protocol';
import { api } from '../api';
import { t } from '../i18n';
import { PlatformTag } from './PlatformTag';
import { navigate } from '../router';
import { Panel } from './ui';

/** Codes after which the user has something to do in Settings; for the rest the message alone says what is wrong. */
const NEEDS_FIRMWARE = new Set(['symbian_unavailable', 'no_firmware', 'device_missing', 'no_compatible_firmware', 'incompatible_package']);

/**
 * What a Symbian / N-Gage game needs to say to its player: whether it can start and on which firmware. Nothing about the service
 * itself (versions, counts, steps); that lives in Settings → Symbian and in the diagnostics.
 */
export function NativeTestingPanel({ game, data, error, running, starting, onChanged, onRefresh, toast }: {
  game: GameMeta; data: { plan: NativePhonePlan; status: SymbianStatus } | null; error: string | null;
  running: boolean; starting?: boolean; onChanged: (game: GameMeta) => void; onRefresh: () => void;
  onSkin?: (id: import('@mgo/protocol').PhoneSkinId) => void; toast: (kind: 'info' | 'error', text: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const platform = game.platform ?? 'symbian';
  const plan = data?.plan;
  const profile = plan?.deviceId ? emulatedDevice(plan.deviceId) : null;
  const installed = data?.status.firmware.devices ?? [];
  const nameOf = (code: string) => EMULATED_DEVICES.flatMap(d => (d.engine === 'eka2l1' && d.firmware.product.toLowerCase() === code.toLowerCase() ? [d.name] : []))[0] ?? `${installed.find(d => d.code === code)?.manufacturer ?? ''} ${installed.find(d => d.code === code)?.model ?? code}`.trim();
  const save = async (settings: Parameters<typeof api.patchGame>[1]['settings']) => {
    setSaving(true);
    try { onChanged(await api.patchGame(game.id, { settings })); onRefresh(); }
    catch (e) { toast('error', (e as Error).message); }
    finally { setSaving(false); }
  };
  const owned = (running || starting) && plan?.code === 'symbian_busy';
  const ready = !!plan?.ready || !!owned;
  return <Panel icon="cpu" title={t('Symbian emulator')} right={<span className="badge mock" title={t('Experimental: not every game works')}>{t('experimental')}</span>}>
    <p className="muted small native-platform"><PlatformTag platform={platform} size="sm" />{game.packageFormat && game.packageFormat !== 'unknown' && platform === 'symbian' ? ` · ${t(PACKAGE_FORMAT_LABEL[game.packageFormat])}` : ''}</p>
    <div className={`note ${ready ? 'ok' : 'warn'}`} role="status" data-testid="native-readiness" data-ready={ready ? '1' : '0'}>
      {error ? t('Cannot check the Symbian service. Try again in a moment.')
        : !data ? t('Checking…')
          : ready ? <>{t(starting ? 'Starting on' : 'Runs on')} <strong data-testid="resolved-firmware" data-code={plan!.firmwareCode ?? ''}>{plan!.firmwareCode ? nameOf(plan!.firmwareCode) : ''}</strong>{profile ? <span className="muted"> · {profile.os}</span> : null}</>
            : t(plan!.message)}
    </div>
    {plan && plan.warnings.map(w => <p key={w} className="note warn">{t(w)}</p>)}
    {installed.length > 1 && (
      <label className="field"><span className="label-caps">{t('Firmware')}</span>
        <select className="select" data-testid="symbian-device" aria-label={t('Firmware')} disabled={running || saving} value={installed.find(d => d.code.toLowerCase() === game.settings.symbianDevice?.toLowerCase())?.code ?? ''} onChange={e => void save({ symbianDevice: e.target.value || null, emulatedDeviceId: null })}>
          <option value="">{t('Automatic')}</option>
          {installed.map(d => <option key={d.code} value={d.code}>{nameOf(d.code)} ({d.code})</option>)}
        </select>
      </label>
    )}
    {!ready && plan?.code && NEEDS_FIRMWARE.has(plan.code) && <div className="btn-row"><button className="btn sm" onClick={() => navigate('/settings#symbian')}>{t('Open firmware settings')}</button></div>}
  </Panel>;
}
