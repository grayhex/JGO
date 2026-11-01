import { t } from '../i18n';
import type { StartFailure } from '@j2me-web/protocol';

const CAUSE: Record<StartFailure['cause'], string> = {
  no_firmware: 'No firmware', device: 'Firmware choice', service: 'Symbian service', install_failed: 'Installation failed',
  launch_rejected: 'The emulator refused to start the game', app_crashed: 'The game crashed on start', app_exited: 'The game ended by itself',
  no_picture: 'No picture appeared', screenshot_error: 'The picture could not be read',
};

/** Why a Symbian / N-Gage game did not start, with the facts behind the explanation. Nothing here is guessed. */
export function StartFailureCard({ failure, sessionId }: { failure: StartFailure; sessionId: string | null }) {
  return (
    <section className="card card-pad start-failure" role="alert" data-testid="start-failure" data-cause={failure.cause}>
      <h3>{t(CAUSE[failure.cause])}</h3>
      <p>{failure.message}</p>
      {failure.likelyIncompatibleGame && (
        <p className="note warn" data-testid="incompatible-game">
          <strong>{t('This game is probably not compatible with this firmware / EKA2L1.')}</strong>{' '}
          {t('The emulator itself reported the failure; it is not a JGO setting. Try another game, or firmware of the generation the game was made for.')}
        </p>
      )}
      <dl className="facts">
        <dt>{t('Step')}</dt><dd>{failure.stage}</dd>
        {failure.appName && <><dt>{t('Application')}</dt><dd>{failure.appName}</dd></>}
        {failure.uid && <><dt>UID</dt><dd><code>{failure.uid}</code></dd></>}
        {failure.firmware && <><dt>{t('Firmware')}</dt><dd>{failure.firmware.manufacturer} {failure.firmware.model} ({failure.firmware.code}){failure.firmware.os ? ` · ${failure.firmware.os}` : ''}</dd></>}
        {failure.launch && <><dt>{t('Launch answer')}</dt><dd><code>HTTP {failure.launch.httpStatus}{failure.launch.code ? ` ${failure.launch.code}` : ''}</code></dd></>}
      </dl>
      {failure.hints.length > 0 && <ul className="hints">{failure.hints.map((h) => <li key={h}>{h}</li>)}</ul>}
      <details>
        <summary>{t('Technical details')}</summary>
        {failure.timeline.length > 0 && <pre>{failure.timeline.map((x) => `+${x.atMs} ms  ${x.state}  screen=${x.screenVisible}${x.lastExit ? '  ' + JSON.stringify(x.lastExit) : ''}`).join('\n')}</pre>}
        {failure.screenshots.length > 0 && <pre>{failure.screenshots.map((x) => `+${x.atMs} ms  screenshot ${x.result}${x.httpStatus ? ' HTTP ' + x.httpStatus : ''}${x.code ? ' ' + x.code : ''}`).join('\n')}</pre>}
        {failure.emulatorErrors.length > 0 && <pre>{failure.emulatorErrors.join('\n')}</pre>}
        {failure.fontNotes.length > 0 && <pre>{failure.fontNotes.join('\n')}</pre>}
      </details>
      <div className="btn-row">
        {sessionId && <a className="btn sm" href={`/api/sessions/${sessionId}/diagnostics`} download data-testid="failure-diagnostics">{t('Download diagnostics')}</a>}
        <a className="btn ghost sm" href="/api/symbian/diagnostics" download>{t('Download Symbian diagnostics')}</a>
      </div>
    </section>
  );
}
