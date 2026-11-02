// Real MGO UI/API and agent; explicitly fake EKA2L1 and a synthetic AAS source.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
const dir = mkdtempSync(path.join(tmpdir(), 'mgo-ready-'));
const sleep = ms => new Promise(r => setTimeout(r,ms));
const wait = async (fn, message) => { for(let i=0;i<300;i++){try{const result=await fn();if(result)return result;}catch{}await sleep(100);}throw new Error('timeout: '+message);};
const free = () => new Promise(resolve=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port));});});
const source = createServer((req,res)=>{
  if(req.url.endsWith('.jpg')){res.setHeader('content-type','image/png');return res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKf8AAAAASUVORK5CYII=','base64'));}
  res.setHeader('content-type','text/html');
  res.end(req.url.endsWith('.php') ? `<script type="application/ld+json">{"@type":"VideoGame","aggregateRating":{"ratingValue":90,"bestRating":100}}</script><table><tr><td>Multiplayer</td><td>Bluetooth (2 players)</td></tr><tr><td>Product code</td><td>6R72</td></tr></table>` : `<h3>Strategy (1)</h3><a href="item/pathway-to-glory.php" class="game-card"><img src="/images/ngage/box_art/pathway.jpg"><div class="title">Pathway to Glory</div><div class="meta">Nokia / Studio &middot; 2004</div></a>`);
});
await new Promise(r=>source.listen(0,'127.0.0.1',r));
const port = await free(), agentPort = await free();
const base = `http://127.0.0.1:${port}`;
const fx = path.resolve('tests/fixtures/fake-eka2l1');
const agent = spawn(process.execPath,['symbian/agent/agent.mjs'],{env:{PATH:process.env.PATH,AGENT_TOKEN:'readiness-token-0123456789',AGENT_HOST:'127.0.0.1',AGENT_PORT:String(agentPort),CONTROL_PORT:String(await free()),DATA_DIR:path.join(dir,'agent'),EKA2L1_BIN:path.join(fx,'fake-eka2l1.mjs'),AUDIO_CMD:`${process.execPath} ${path.join(fx,'pcm.mjs')}`},stdio:'ignore'});
for(const kind of ['java','ngage','sis'])mkdirSync(path.join(dir,kind));
const server = spawn(process.execPath,['apps/api/dist/server.js'],{env:{...process.env,HOST:'127.0.0.1',PORT:String(port),LOG_LEVEL:'warn',DATA_DIR:path.join(dir,'data'),RUN_DIR:path.join(dir,'run'),KEM_DIR:path.join(dir,'no-java'),LIBRARY_ROOTS:dir,SYMBIAN_AGENT_URL:`http://127.0.0.1:${agentPort}`,SYMBIAN_AGENT_TOKEN:'readiness-token-0123456789',AAS_PROXY_URL:`http://127.0.0.1:${source.address().port}`},stdio:['ignore','inherit','inherit']});
let browser;
const call = async (url,body,method='POST')=>{const response=await fetch(base+url,{method,...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)})});assert.ok(response.ok,await response.clone().text());return response.status===204?null:response.json();};
try{
  await wait(async()=>{try{return(await fetch(base+'/api/health')).ok;}catch{return false;}},'MGO startup');
  await call('/api/setup/skip');
  for(const code of ['RM-84','NEM-4','RM-320']){
    const fd=new FormData();fd.append('file',new Blob(['synthetic firmware']),code+'.rom');
    const uploaded=await(await fetch(base+'/api/symbian/firmware?slot=rom',{method:'POST',body:fd})).json();
    const job=await call('/api/symbian/firmware/install',{rom:uploaded.file});
    await wait(async()=>{const j=await(await fetch(base+'/api/symbian/jobs/'+job.id)).json();if(j.state==='failed')throw new Error(j.error);return j.state==='succeeded';},'install synthetic device');
  }
  await call('/api/symbian/defaults',{platform:'symbian',code:'RM-84'},'PUT');
  const sis=Buffer.alloc(32);sis.writeUInt32LE(0x10201a7a,0);
  const data=new FormData();data.append('file',new Blob([sis]),'Worms_World_Party.sisx');
  const game=(await(await fetch(base+'/api/games',{method:'POST',body:data})).json()).game;
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,headless:true});
  const p=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.goto(base+'/play/'+game.id);
  await wait(async()=>await p.getByTestId('native-readiness').getAttribute('data-ready')==='1','N95 readiness');
  assert.ok((await p.getByTestId('native-readiness').innerText()).includes('N95 8GB'));
  await p.getByTestId('change-phone').click();
  assert.equal(await p.locator('.phone-pick').count(),15);
  assert.equal(await p.locator('.phones-intro').count(),1);
  await p.evaluate(async () => { await Promise.all([...document.querySelectorAll('.phone-pick .skin-body')].map(img => img.decode().catch(() => undefined))); });
  await p.screenshot({ path: 'test-results/mgo-phones.png', fullPage: true, animations: 'disabled' });
  const box=await p.locator('.phone-pick').first().boundingBox();assert.ok(box.height<330,'compact phone card');
  await p.getByRole('button',{name:'Nokia N95-1',exact:true}).click();
  await wait(async()=>await p.getByTestId('native-readiness').getAttribute('data-ready')==='1','N95 selected');
  const saved=await(await fetch(base+'/api/games/'+game.id)).json();assert.equal(saved.settings.symbianDevice,'RM-320');assert.equal(saved.settings.emulatedDeviceId,'eka2l1-n95-8gb');
  await p.getByRole('button',{name:'Start',exact:true}).first().click();
  await wait(async()=>await p.getByTestId('frame-size').innerText()==='176×208','native frame');
  await p.waitForTimeout(3300); // allow the next readiness poll to observe the occupied instance
  assert.ok(!(await p.getByTestId('native-readiness').innerText()).includes('busy'),'own running game is not a busy warning');
  assert.ok((await p.getByTestId('current-game').innerText()).includes(game.name));
  assert.equal(await p.locator('.runtime-list .runtime').count(),3);
  await p.getByRole('button',{name:'Stop',exact:true}).first().click();
  await p.goto(base+'/settings');
  await p.getByRole('tab',{name:'System',exact:true}).waitFor();
  await p.locator('.system-metrics .metric strong').first().waitFor();
  assert.equal(await p.getByRole('tabpanel').count(),1,'only active tab is accessible');
  await p.waitForTimeout(5200);
  await p.screenshot({path:'test-results/mgo-settings-system.png',fullPage:true,animations:'disabled'});
  await p.getByRole('tab',{name:'Game library',exact:true}).click();
  for(const [kind,label] of [['j2me','java'],['ngage','ngage'],['symbian','sis']]){
    await p.getByTestId(`choose-${kind}`).click();
    const picker=p.getByRole('dialog',{name:/Folder for/});
    await picker.getByTestId('folder-check').waitFor();
    // the picker starts at the shared folder: open the sub-folder of this kind
    await picker.locator('.folder',{hasText:new RegExp(`^\\s*${label}$`)}).click();
    await wait(async()=>/\/(java|ngage|sis)$/.test(await picker.locator('.crumb-path').innerText()),'sub-folder opened');
    await picker.getByTestId('folder-use').click();
    await picker.waitFor({state:'detached'});
  }
  await wait(async()=>{const s=await(await fetch(base+'/api/settings')).json();return Object.values(s.settings.libraryPaths).filter(Boolean).length===3;},'independent library paths');
  await p.getByRole('tab',{name:'My phones',exact:true}).click();
  await p.getByRole('tab', { name: 'My phones', exact: true }).waitFor();
  await p.locator('summary',{hasText:'Screen size, key layout'}).click();
  const resolution = p.getByLabel('Resolution', { exact: true });
  const originalResolution = await resolution.inputValue();
  await resolution.selectOption('176x208');
  await p.getByRole('tab', { name: 'System', exact: true }).click();
  await p.getByRole('tab', { name: 'My phones', exact: true }).click();
  assert.equal(await resolution.inputValue(), '176x208', 'switching tabs preserves an unsaved phone draft');
  await resolution.selectOption(originalResolution);
  await p.getByTestId('phone-nokia-n-gage-qd').click();
  await p.getByTestId('default-phone-ngage').selectOption('nokia-n-gage-qd');
  await wait(async()=>{const s=await(await fetch(base+'/api/settings')).json();return s.settings.nativePhones.ngage==='nokia-n-gage-qd';},'native default phone');
  await p.getByRole('tab',{name:'System',exact:true}).click();
  await p.getByRole('tab',{name:'System',exact:true}).press('ArrowRight');
  assert.equal(await p.getByRole('tab',{selected:true}).innerText(),'Game library');
  await p.setViewportSize({width:390,height:844});
  await p.waitForTimeout(400);
  await p.screenshot({path:'test-results/mgo-settings-mobile.png',fullPage:true,animations:'disabled'});
  const overflow = await p.evaluate(() => [...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().right > innerWidth + 1 && el.getBoundingClientRect().width > 0).slice(-15).map(el => ({ tag: el.tagName, cls: el.className, width: el.getBoundingClientRect().width, right: el.getBoundingClientRect().right })));
  assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'mobile settings fit: '+JSON.stringify(overflow));
  await p.goto(base+'/phones');assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'mobile phones fit');
  const card=new FormData();card.append('file',new Blob([Buffer.from('PK\x03\x04 synthetic card')]),'Pathway_To_Glory.zip');
  const ngage=(await(await fetch(base+'/api/games',{method:'POST',body:card})).json()).game;
  assert.equal(ngage.settings.symbianDevice,'RH-29','native default pins the chosen QD firmware');
  await wait(async()=>{const g=await(await fetch(base+'/api/games/'+ngage.id)).json();return g.ngageInfo?.hasCover&&g.classification?.primaryGenre==='Strategy';},'AAS metadata and cover');
  await p.setViewportSize({width:1440,height:1000});await p.goto(base+'/');
  await p.getByRole('radio',{name:'Tiles'}).click(); // the attribution line belongs to the tile; the list is the default view
  const tile=p.locator('.game-card').filter({hasText:'Pathway to Glory'});await tile.waitFor();
  await tile.locator('.cover.art img').waitFor();assert.ok((await tile.innerText()).includes('All About Symbian'));
  assert.ok((await tile.innerText()).includes('Bluetooth (2 players)'));
  await tile.getByRole('button',{name:'Game information',exact:true}).click();
  await p.getByText('6R72',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('PASS MGO production UI: N95 RM-320/SIS9, own-session status, sidebar versions/current game, compact phones, settings tabs/keyboard/mobile, separate folders/defaults and cached N-Gage facts/cover');
}finally{await browser?.close();server.kill('SIGTERM');agent.kill('SIGTERM');source.close();await sleep(500);rmSync(dir,{recursive:true,force:true});}
