// Build runtime/Dockerfile --target gateway first; no application secrets or ROMs.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
const id = 'mgo-tls-' + process.pid;
const dir = mkdtempSync(path.join(tmpdir(), id));
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }).trim();
const free = () => new Promise(resolve => { const s = createServer(); s.listen(0,'127.0.0.1',()=>{const port=s.address().port; s.close(()=>resolve(port));}); });
const httpPort = await free(), httpsPort = await free();
const request = (url, options = {}, size = 0) => new Promise((resolve,reject) => {
  const req = httpsRequest(url, { ...options, ca: readFileSync(path.join(dir,'server.crt')) }, res => { const chunks=[]; res.on('data', c=>chunks.push(c)); res.on('end',()=>resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() })); });
  req.setTimeout(5000, () => req.destroy(new Error('HTTPS request timed out')));
  req.on('error',reject);
  const chunk = Buffer.alloc(65536,7);
  const send = () => { while(size>0) { const n=Math.min(size,chunk.length); size-=n; if(!req.write(chunk.subarray(0,n))) { req.once('drain',send); return; } } req.end(); };
  send();
});
try {
  docker('network','create',id);
  docker('run','-d','--name',id+'-app','--network',id,'--network-alias','app','--read-only','--cap-drop','ALL','--mount',`type=bind,source=${path.resolve('tests/fixtures/https-upstream.mjs')},target=/upstream.mjs,readonly`,'--entrypoint','node',process.env.MGO_TLS_UPSTREAM_IMAGE || 'node:22-alpine','/upstream.mjs');
  docker('run','-d','--name',id+'-gateway','--network',id,'--read-only','--cap-drop','ALL','--cap-add','CHOWN','--cap-add','SETUID','--cap-add','SETGID','--tmpfs','/tmp','--tmpfs','/var/run','--tmpfs','/var/cache/nginx','--tmpfs','/etc/nginx/conf.d','-v',id+'-certs:/certs','-e',`MGO_HTTPS_PORT=${httpsPort}`,'-p',`127.0.0.1:${httpPort}:8080`,'-p',`127.0.0.1:${httpsPort}:8443`,process.env.MGO_TLS_IMAGE || 'mgo-gateway:verify');
  let copied=false;
  for(let i=0;i<100;i++) { try { docker('cp',id+'-gateway:/certs/server.crt',path.join(dir,'server.crt')); copied=true; break; } catch {} await new Promise(r=>setTimeout(r,100)); }
  assert.ok(copied,'gateway certificate was not created');
  let response;
  for(let i=0;i<100;i++) { try { response=await request(`https://127.0.0.1:${httpsPort}/api/health`); if(response.status===200)break; } catch {} await new Promise(r=>setTimeout(r,100)); }
  assert.equal(response?.status,200); assert.equal(JSON.parse(response.body).proto,'https');
  const redirect=await fetch(`http://127.0.0.1:${httpPort}/play/test`,{redirect:'manual'});
  assert.equal(redirect.status,308); assert.equal(redirect.headers.get('location'),`https://127.0.0.1:${httpsPort}/play/test`);
  await new Promise((resolve,reject)=>{const ws=new WebSocket(`wss://127.0.0.1:${httpsPort}/live`,{ca:readFileSync(path.join(dir,'server.crt'))});ws.on('error',reject);ws.on('message',data=>{try{assert.equal(data.toString(),'MGO WSS!');ws.terminate();resolve();}catch(e){reject(e);}});});
  const size=70*1048576;
  const upload=await request(`https://127.0.0.1:${httpsPort}/api/symbian/upload-probe`,{method:'POST',headers:{'content-length':size}},size);
  assert.equal(upload.status,200);assert.equal(JSON.parse(upload.body).received,size);
  const certificate=readFileSync(path.join(dir,'server.crt'),'utf8');
  docker('restart',id+'-gateway');
  docker('cp',id+'-gateway:/certs/server.crt',path.join(dir,'server.crt'));
  assert.equal(readFileSync(path.join(dir,'server.crt'),'utf8'),certificate,'certificate persists across restart');
  console.log('PASS HTTPS: trusted certificate, HTTP redirect, WSS upgrade, 70 MB streaming and persistent certificate');
} catch(e) {
  try { const logs = spawnSync('docker',['logs',id+'-gateway'],{encoding:'utf8'}); console.error((logs.stdout + logs.stderr).slice(-5000)); }catch{}
  throw e;
} finally {
  for(const name of [id+'-gateway',id+'-app'])try{docker('rm','-f',name);}catch{}
  try{docker('network','rm',id);}catch{} try{docker('volume','rm',id+'-certs');}catch{}
  rmSync(dir,{recursive:true,force:true});
}
