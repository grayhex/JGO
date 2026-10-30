import assert from 'node:assert/strict';
import { it } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startApp,upload,openStream,waitFor } from './helpers.ts';
it('destroyApp RMS survives safe stop and API restart',async()=>{
 const data=mkdtempSync(path.join(tmpdir(),'jgo-recovery-'));let env=await startApp({},data);let first;
 const call=(url:string,method='GET',body?:unknown)=>fetch(env.base+url,{method,...(body?{headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});
 try{
  const game=(await upload(env.base,'tests/fixtures/labgames/build/kemshutdown.jar')).body.game;
  const run=async(expected:number)=>{
   const r=await call('/api/sessions','POST',{gameId:game.id});assert.equal(r.status,201);const s=await r.json();
   first=await openStream(env.base,s.id);await waitFor(()=>first!.frames.length>0,'frames');
   await waitFor(async()=>((await(await call('/api/sessions/'+s.id)).json()).logTail.join('\n')).includes('SHUTDOWN_COUNT '+expected),'RMS restored');return s;
  };
  const s=await run(0);await call('/api/sessions/'+s.id,'DELETE');
  const stopped=await(await call('/api/sessions/'+s.id)).json();assert.ok(stopped.logTail.some((x:string)=>x.includes('SHUTDOWN_SAVED 1')),JSON.stringify(stopped));
  first.close();await run(1);await Promise.all([env.app.close(),env.app.close()]);await env.stop();
  env=await startApp({},data);await run(2);await call('/api/sessions/'+(await(await call('/api/sessions')).json())[0].id,'DELETE');
  // Last checkpoint is game-written RMS, never a serialized VM state.
 }finally{first?.close();await env.stop();rmSync(data,{recursive:true,force:true});}
});
it('one disconnected viewer cannot release another viewer’s held key',async()=>{
 const env=await startApp();let a,b;
 try{
  const g=(await upload(env.base,'tests/fixtures/testmidlet/build/kemtest.jar')).body.game;
  const s=await(await fetch(env.base+'/api/sessions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({gameId:g.id})})).json();
  a=await openStream(env.base,s.id);b=await openStream(env.base,s.id);
  a.send({t:'key',s:'D',code:53});b.send({t:'key',s:'D',code:53});
  const logs=async()=>(await(await fetch(env.base+'/api/sessions/'+s.id)).json()).logTail.join('\n');
  await waitFor(async()=>/KEY_DOWN 53/.test(await logs()),'held');
  a.close();const frames=b.frames.length;await waitFor(()=>b!.frames.length>frames+5,'game still running');
  assert.doesNotMatch(await logs(),/KEY_UP 53/);
  b.send({t:'release-all'});await waitFor(async()=>/KEY_UP 53/.test(await logs()),'last holder released');
 }finally{a?.close();b?.close();await env.stop();cleanupEnv(env.dataDir);}
});
function cleanupEnv(dir:string){rmSync(dir,{recursive:true,force:true});}
it('a silent transport is terminated by heartbeat and cannot retain held keys',async()=>{
 const {WebSocket}=await import('ws');const env=await startApp();let ws;
 try{
  const g=(await upload(env.base,'tests/fixtures/testmidlet/build/kemtest.jar')).body.game;
  const s=await(await fetch(env.base+'/api/sessions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({gameId:g.id})})).json();
  ws=new WebSocket(env.base.replace('http','ws')+'/api/sessions/'+s.id+'/stream',{autoPong:false} as never);
  await new Promise<void>((resolve,reject)=>{ws!.once('open',resolve);ws!.once('error',reject);});
  ws.send(JSON.stringify({t:'key',s:'D',code:53}));
  await waitFor(()=>ws!.readyState===WebSocket.CLOSED,'silent socket terminated',16000);
  await waitFor(async()=> (await(await fetch(env.base+'/api/sessions/'+s.id)).json()).logTail.some((l:string)=>l.includes('KEY_UP 53')),'key released');
 }finally{ws?.terminate();await env.stop();cleanupEnv(env.dataDir);}
});
it('an unresponsive destroyApp is warned about before bounded forced closure',async()=>{
 const env=await startApp();let stream;
 try{
  const g=(await upload(env.base,'tests/fixtures/labgames/build/kemshutdown-hang.jar')).body.game;
  const s=await(await fetch(env.base+'/api/sessions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({gameId:g.id})})).json();
  stream=await openStream(env.base,s.id);await waitFor(()=>stream!.frames.length>0,'initial frame');
  const finished=fetch(env.base+'/api/sessions/'+s.id,{method:'DELETE'});
  await waitFor(async()=> (await(await fetch(env.base+'/api/sessions/'+s.id)).json()).logTail.some((l:string)=>l.includes('forcibly closed after 8 seconds')),'warning emitted before kill');
  const final=await(await finished).json();assert.equal(final.state,'failed');assert.match(final.exitDetail,/killed/);
 }finally{stream?.close();await env.stop();cleanupEnv(env.dataDir);}
});
