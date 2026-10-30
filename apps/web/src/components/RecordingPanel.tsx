import { useRef, useState } from 'react';
import type { ClientEvent } from '@j2me-web/protocol';
import { t as translateUI } from '../i18n';
import { parseRecording, type Recorder, type Recording, type Replayer } from '../recording';
import { downloadBlob, fileSafe } from '../snapshot';

/** Record the player's input and play it back with the original timing (a recording belongs to one game and one frame size). */
export function RecordingPanel({ gameId, gameName, frame, live, recorder, replayer, sendRaw, toast }: {
  gameId: string;
  gameName: string;
  frame: { w: number; h: number };
  live: boolean;
  recorder: Recorder;
  replayer: Replayer;
  /** Straight to the session, bypassing the recorder. */
  sendRaw: (ev: ClientEvent) => void;
  toast: (kind: 'info' | 'error', text: string) => void;
}) {
  const [mode, setMode] = useState<'idle' | 'recording' | 'playing'>('idle');
  const [rec, setRec] = useState<Recording | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const start = () => { recorder.start(); setMode('recording'); };
  const stop = () => {
    if (mode === 'recording') {
      const r = recorder.stop({ gameId, gameName, width: frame.w, height: frame.h });
      setRec(r.events.length ? r : null);
      if (!r.events.length) toast('info', 'Nothing was recorded: press keys or touch the screen while recording.');
    } else replayer.stop(sendRaw);
    setMode('idle');
  };
  const play = () => {
    if (!rec) return;
    if (rec.width !== frame.w || rec.height !== frame.h) toast('info', `This was recorded at ${rec.width}×${rec.height}; the game now runs at ${frame.w}×${frame.h}, so touches may land elsewhere.`);
    setMode('playing');
    replayer.play(rec, sendRaw, () => { sendRaw({ t: 'release-all' }); setMode('idle'); });
  };
  const load = async (f: File) => {
    try { setRec(parseRecording(await f.text(), gameId)); toast('info', 'Recording loaded.'); } catch (e) { toast('error', (e as Error).message); }
    if (file.current) file.current.value = '';
  };

  return (
    <>
      <div className="btn-row">
        {mode === 'recording' ? <button className="btn sm danger" onClick={stop}>{translateUI('■ Stop recording')}</button>
          : <button className="btn sm" disabled={!live || mode === 'playing'} onClick={start}>{translateUI('● Record')}</button>}
        {mode === 'playing' ? <button className="btn sm" onClick={stop}>{translateUI('■ Stop playback')}</button>
          : <button className="btn sm" disabled={!live || !rec || mode === 'recording'} onClick={play}>{translateUI('▶ Play')}</button>}
      </div>
      <div className="btn-row">
        <button className="btn ghost sm" disabled={!rec} onClick={() => rec && downloadBlob(new Blob([JSON.stringify(rec)], { type: 'application/json' }), `${fileSafe(gameName)}.jgo-rec.json`)}>{translateUI('Save…')}</button>
        <button className="btn ghost sm" onClick={() => file.current?.click()}>{translateUI('Load…')}</button>
        <input ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void load(f); }} />
      </div>
      <p className="hint" data-testid="recording-status">
        {mode === 'recording' ? translateUI('Recording… every key, touch and command is kept.')
          : rec ? `${rec.events.length} ${translateUI('events')} · ${(rec.durationMs / 1000).toFixed(1)} s · ${rec.width}×${rec.height}`
            : translateUI('No recording yet. Record, then play it back or save it to a file.')}
      </p>
    </>
  );
}
