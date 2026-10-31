import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PHONE_PROFILES, resolvePhone } from '@j2me-web/protocol';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { cleanup, jar1, jar2, openStream, startApp, upload, waitFor } from './helpers.ts';

describe('PhoneSkin automatic profiles against real KEmulator', () => {
  for (const id of Object.keys(PHONE_PROFILES) as (keyof typeof PHONE_PROFILES)[]) it(id, async () => {
    const env=await startApp(); let stream;
    try {
      const game=(await upload(env.base,jar1)).body.game;
      const presets=(await (await fetch(env.base+'/api/devices')).json()).presets;
      assert.equal(presets.length,59);
      const resolved=resolvePhone(id,presets),p=resolved.preset;
      const settings={skinId:id,profileMode:'auto',width:777,height:777,layout:'siemens',device:'no-such-device'};
      const patch=await fetch(env.base+'/api/games/'+game.id,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({settings})});
      assert.equal(patch.status,200);const saved=await patch.json();
      assert.deepEqual([saved.settings.device,saved.settings.width,saved.settings.height,saved.settings.layout],[p.id,p.width,p.height,resolved.layout]);
      assert.equal(saved.settings.skinId,id);
      const r=await fetch(env.base+'/api/sessions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({gameId:game.id})});
      assert.equal(r.status,201);const session=await r.json();
      stream=await openStream(env.base,session.id);
      const frame=await waitFor(()=>stream!.frames.at(-1),'real framebuffer');
      assert.deepEqual([frame.w,frame.h],[p.width,p.height]);
      stream.send({t:'key',s:'D',code:p.keys.fire});stream.send({t:'key',s:'U',code:p.keys.fire});
      const logs=async()=>(await (await fetch(env.base+'/api/sessions/'+session.id)).json()).logTail.join('\n');
      await waitFor(async()=> (await logs()).includes('ACTION '+p.keys.fire+' 8'),'profile Fire mapping');
      await waitFor(async()=> (await logs()).includes('PLATFORM '+(p.platform??'Nokia6700c')),'platform property');
      // Verify actual emitted runtime configuration, not just selection metadata.
      const ini=readFileSync(path.join(env.dataDir,'saves','default',game.id,'midlets.ini'),'utf8');
      assert.ok(ini.includes(p.name));
      assert.ok(ini.includes('IgnoreFullScreenMode='+p.forceFullscreen));
      if(p.platform)assert.ok(ini.includes('MIDPPlatform='+p.platform));else assert.ok(!ini.includes('MIDPPlatform='));
      // Changing saved defaults must not mutate an active JVM.
      const advanced=await fetch(env.base+'/api/games/'+game.id,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({settings:{profileMode:'advanced',device:'132x176-siemens-full-screen'}})});
      assert.equal(advanced.status,200);
      const still=await(await fetch(env.base+'/api/sessions/'+session.id)).json();assert.equal(still.device,p.id);assert.equal(still.width,p.width);
      const other=(await upload(env.base,jar2,'other.jar')).body.game;assert.notEqual(other.id,game.id);assert.equal(other.settings.skinId,undefined);assert.equal(other.settings.profileMode,undefined);
    } finally {stream?.close();await env.stop();cleanup(env);}
  });
});
