import assert from 'node:assert/strict';
import { it } from 'node:test';
import { InputController } from './input';
import { GamepadPoller, DEFAULT_PAD, sanitizeProfile, loadPadProfile, savePadProfile } from './gamepad';
const pad = (buttons: number[] = [], axes = [0,0], index=0) => ({index,id:'Test standard controller',connected:true,mapping:'standard',buttons:Array.from({length:17},(_,i)=>({pressed:buttons.includes(i),value:buttons.includes(i)?1:0})),axes}) as unknown as Gamepad;
it('gamepad, keyboard and skin share references; simultaneous directions and fire, disconnect only releases pad',()=>{
 const events: unknown[]=[]; const input=new InputController(e=>events.push(e)),gp=new GamepadPoller(input,undefined,structuredClone(DEFAULT_PAD));
 input.press('keyboard','fire');input.press('skin','fire');gp.tick([pad([0,12])]);
 assert.deepEqual([...input.heldActions()].sort(),['fire','up']);
 gp.tick([]);assert.deepEqual([...input.heldActions()],['fire']);
 input.release('keyboard');assert.equal(input.heldCodes().length,1);input.release('skin');assert.equal(input.heldCodes().length,0);
 assert.equal(events.filter((e:any)=>e.s==='D'&&e.code===-5).length,1);
});
it('deadzone, negative axes, focus loss and neutral rearm',()=>{
 const input=new InputController(()=>{}), gp=new GamepadPoller(input,undefined,structuredClone(DEFAULT_PAD));
 gp.tick([pad([],[.2,-.2])]);assert.equal(input.heldCodes().length,0);
 gp.tick([pad([],[-.8,-.8])]);assert.equal(input.heldCodes().length,2);
 gp.tick([pad([],[-.8,-.8])],false);assert.equal(input.heldCodes().length,0);
 gp.tick([pad([],[-.8,-.8])],true);assert.equal(input.heldCodes().length,0);
 gp.tick([pad()]);gp.tick([pad([],[-.8,0])]);assert.deepEqual([...input.heldActions()],['left']);
});
it('disabled input, remapping held sources, two controllers and UI edges',()=>{
 const input=new InputController(()=>{}),gp=new GamepadPoller(input,undefined,structuredClone(DEFAULT_PAD));
 gp.tick([pad([0]),pad([0],[],1)]);assert.equal(input.heldCodes().length,1);
 gp.tick([pad([],[],0),pad([0],[],1)]);assert.equal(input.heldCodes().length,1);
 input.enabled=false;gp.tick([pad([0])]);assert.equal(input.heldCodes().length,0);
 input.enabled=true;gp.tick([pad([0])]);assert.equal(input.heldCodes().length,0);
 gp.tick([pad()]);gp.setProfile({deadzone:.5,bindings:{d9:[{kind:'button',index:0}]}});gp.tick([pad([0])]);assert.deepEqual([...input.heldActions()],['d9']);
 gp.uiMode=true;const ui:string[]=[];gp.onUi=a=>ui.push(a);gp.tick([pad()]);gp.tick([pad([0])]);gp.tick([pad([0])]);assert.deepEqual(ui,['d9']);assert.equal(input.heldCodes().length,0);
});
it('global and per-game storage are independent and validate hostile input',()=>{
 const data=new Map<string,string>();Object.defineProperty(globalThis,'localStorage',{value:{getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>data.set(k,v)},configurable:true});
 savePadProfile({deadzone:.6,bindings:{} });savePadProfile({deadzone:.2,bindings:{fire:[{kind:'axis',index:3,direction:-1}]}},'a');
 assert.equal(loadPadProfile('a').deadzone,.2);assert.equal(loadPadProfile('b').deadzone,.6);
 assert.deepEqual(sanitizeProfile({deadzone:NaN,bindings:{fire:[{kind:'axis',index:-3,direction:8}]}}),{deadzone:.35,bindings:{fire:[]}});
});
