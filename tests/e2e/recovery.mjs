import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
const data=mkdtempSync(path.join(tmpdir(),'jgo-recovery-browser-')),port=20100+Math.floor(Math.random()*200),base=`http://127.0.0.1:${port}`;
let proc,browser;
const wait=async(fn,limit=20000)=>{const until=Date.now()+limit;while(Date.now()<until){try{if(await fn())return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('timeout');};
const start=async()=>{proc=spawn('node',['apps/api/dist/server.js'],{env:{...process.env,HOST:'127.0.0.1',PORT:String(port),DATA_DIR:data,LOG_LEVEL:'warn'},stdio:['ignore','inherit','inherit']});await wait(async()=>(await fetch(base+'/api/health')).ok);};
const stop=async()=>{const exit=new Promise(r=>proc.once('exit',r));proc.kill('SIGTERM');await exit;};
try{
 await start();await fetch(base+'/api/setup/skip',{method:'POST'});
 const fd=new FormData();fd.append('jar',new Blob([readFileSync('tests/fixtures/labgames/build/kemshutdown.jar')]),'kemshutdown.jar');
 const game=(await(await fetch(base+'/api/games',{method:'POST',body:fd})).json()).game;
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']});
 const context=await browser.newContext();let p=await context.newPage();p.on('dialog',d=>d.accept());
 await p.goto(base+'/play/'+game.id);await p.locator('.ctrl-col').getByRole('button',{name:'Start',exact:true}).click();
 await p.waitForFunction(()=>document.querySelector('[data-testid=state-badge]')?.textContent.includes('running'));
 const active=async()=>(await(await fetch(base+'/api/sessions')).json()).find(s=>s.state==='running');
 const original=await active();
 await p.reload();await p.waitForFunction(()=>{const c=document.querySelector('canvas');return c&&c.getContext('2d').getImageData(0,0,1,1).data[1]===170;});assert.equal((await active()).id,original.id);
 await context.setOffline(true);await wait(async()=>await p.locator('[data-testid=state-badge]').textContent().then(t=>t.includes('reconnecting')),20000);
 await context.setOffline(false);await wait(async()=>!(await p.locator('[data-testid=state-badge]').textContent()).includes('reconnecting'));
 assert.equal((await active()).id,original.id);
 await p.close();p=await context.newPage();p.on('dialog',d=>d.accept());await p.goto(base+'/play/'+game.id);await p.waitForSelector('canvas');assert.equal((await active()).id,original.id);
 // Real OS SIGTERM is the same entry point used by systemd KillMode=mixed.
 await stop();await start();
 await wait(async()=>{const t=await p.locator('[data-testid=state-badge]').textContent();return t.includes('exited')||t.includes('stopped');},25000);
 await p.locator('.ctrl-col').getByRole('button',{name:'Start',exact:true}).click();
 await wait(async()=>{const s=await active();return s&&s.logTail.some(l=>l.includes('SHUTDOWN_COUNT 1'));});
 assert.notEqual((await active()).id,original.id);
 await p.getByLabel('Language / Язык').selectOption('ru');await p.getByRole('button',{name:'Остановить',exact:true}).waitFor();
 await p.reload();await p.getByRole('button',{name:'Остановить',exact:true}).waitFor();assert.equal(await p.locator('html').getAttribute('lang'),'ru');
 await p.getByLabel('Language / Язык').selectOption('en');await p.getByRole('button',{name:'Stop',exact:true}).waitFor();
 // A failed stop request must not pretend the live game has ended or launch a second JVM.
 await p.route('**/api/sessions/*',route=>route.request().method()==='DELETE'?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Temporary stop failure'})}):route.continue());
 await p.getByRole('button',{name:'Stop',exact:true}).click();await p.getByText('Temporary stop failure',{exact:true}).waitFor();
 assert.ok((await p.locator('[data-testid=state-badge]').textContent()).includes('running'));
 const stillRunning=await active();assert.ok(stillRunning);
 await p.unroute('**/api/sessions/*');await p.getByRole('button',{name:'Stop',exact:true}).click();
 await wait(async()=>(await p.locator('[data-testid=state-badge]').textContent()).includes('exited'));
 console.log('PASS: reload, tab closure, offline/reconnect, SIGTERM/restart, destroyApp RMS, failed-stop recovery and EN/RU persistence; no save states.');
}finally{await browser?.close();if(proc?.exitCode===null)await stop();rmSync(data,{recursive:true,force:true});}
