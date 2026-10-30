import { useEffect, useState } from 'react';
import { ACTION_LABEL } from '../input';
import { clearPadOverride, DEFAULT_PAD, loadPadProfile, PAD_ACTIONS, savePadProfile, type GamepadPoller, type PadAction, type PadProfile, type PadState } from '../gamepad';
export function GamepadSettings({ gameId, poller, state }: { gameId: string; poller: GamepadPoller | null; state: PadState }) {
  useEffect(()=>()=>{if(poller){poller.capture=undefined;poller.release();}},[poller]);
  const [profile,setProfile]=useState(()=>loadPadProfile(gameId));
  const [scope,setScope]=useState<'game'|'global'>('game');
  const [waiting,setWaiting]=useState<PadAction|null>(null);
  const apply=(p:PadProfile)=>{setProfile(p);poller?.setProfile(p);};
  return <div className="gamepad-settings">
    <p>{state.controllers.length ? state.controllers.map(p=>`${p.id} (${p.mapping || 'raw HID'}, #${p.index})`).join(' · ') : 'Connect a USB/Bluetooth controller, then press a button. The browser may require a click first.'}</p>
    <p className="hint">Xbox/PlayStation use browser standard mapping where available. Raw HID indices vary; bind buttons or move an axis below.</p>
    <label>Save scope <select aria-label="Gamepad scope" value={scope} onChange={e=>{if(poller)poller.capture=undefined;setWaiting(null);setScope(e.target.value as 'game'|'global');apply(loadPadProfile(e.target.value==='game'?gameId:undefined));}}><option value="game">This game</option><option value="global">Global</option></select></label>
    <label>Deadzone {profile.deadzone.toFixed(2)} <input aria-label="Stick deadzone" type="range" min="0.1" max="0.9" step="0.05" value={profile.deadzone} onChange={e=>apply({...profile,deadzone:Number(e.target.value)})}/></label>
    {PAD_ACTIONS.map(action=><div className={`pad-binding ${state.pressed.includes(action)?'held':''}`} key={action}>
      <span>{action in ACTION_LABEL ? ACTION_LABEL[action as keyof typeof ACTION_LABEL] : action}</span>
      <button className="btn sm" disabled={!poller} onClick={()=>{if(!poller)return;setWaiting(action);poller.release();poller.capture=b=>{apply({...profile,bindings:{...profile.bindings,[action]:[b]}});setWaiting(null);};}}>{waiting===action?'Press a button / move stick…':(profile.bindings[action]??[]).map(b=>b.kind==='button'?`B${b.index}`:`Axis ${b.index} ${b.direction}`).join(' / ')||'Bind'}</button>
      <button className="btn sm" aria-label={`Clear ${action}`} onClick={()=>apply({...profile,bindings:{...profile.bindings,[action]:[]}})}>×</button>
    </div>)}
    <div className="btn-row"><button className="btn" onClick={()=>{if(poller)poller.capture=undefined;setWaiting(null);savePadProfile(profile,scope==='game'?gameId:undefined);}}>Save mapping</button>
    <button className="btn" onClick={()=>{if(poller)poller.capture=undefined;setWaiting(null);apply(structuredClone(DEFAULT_PAD));}}>Reset</button>
    <button className="btn" onClick={()=>{clearPadOverride(gameId);apply(loadPadProfile());}}>Use global for this game</button>
    {waiting&&<button className="btn" onClick={()=>{if(poller)poller.capture=undefined;setWaiting(null);}}>Cancel binding</button>}</div>
  </div>;
}
