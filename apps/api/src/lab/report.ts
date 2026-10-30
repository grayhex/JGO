import type { GameResult } from './runner.js';

export interface ReportMeta {
  generatedAt: string;
  emulatorCommit: string | null;
  host: string;
  defaultsDevice: string;
  title: string;
}

export interface Ratings {
  version: 1;
  /** keyed by game sha256 */
  ratings: Record<string, { rating: 'works' | 'minor' | 'broken' | 'untested'; note: string; updatedAt?: string }>;
}

const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const num = (n: number | null | undefined, unit = '', d = 1) => (n === null || n === undefined ? '—' : `${Math.round(n * 10 ** d) / 10 ** d}${unit}`);

export function applyRatings(results: GameResult[], r: Ratings | null): void {
  if (!r) return;
  for (const g of results) {
    const m = g.game ? r.ratings[g.game.sha256] : undefined;
    if (m) g.manual = { rating: m.rating, note: m.note };
  }
}

function card(g: GameResult, shotData: Map<string, string>): string {
  const a = g.analysis;
  const id = g.game?.sha256 ?? g.label;
  const badge = (cls: string, t: string) => `<span class="b ${cls}">${esc(t)}</span>`;
  const badges = [
    badge(g.auto.status, g.auto.status.toUpperCase()),
    g.device ? badge('dev', g.device) : badge('dev', 'default device'),
    a?.needs3d ? badge('d3', '3D') : '',
    g.audio.bytes > 0 ? badge(g.audio.audible ? 'snd' : 'snd0', g.audio.audible ? `sound ${g.audio.seconds}s` : 'silent audio') : badge('snd0', 'no sound'),
    a ? badge('fam', a.platform.family) : '',
  ].join('');
  const shots = g.shots.map((s) => `<figure><img src="${shotData.get(s.file) ?? ''}" width="${s.width}" height="${s.height}" alt="${esc(s.label)}" loading="lazy"><figcaption>${esc(s.label)} · ${s.width}×${s.height}</figcaption></figure>`).join('');
  const apis = (a?.apis ?? []).map((x) => `<li class="${x.missing.length ? 'miss' : ''}"><b>${esc(x.label)}</b> <span class="mut">${x.classes} class${x.classes === 1 ? '' : 'es'}</span>${x.missing.length ? ` <span class="b fail">missing: ${esc(x.missing.slice(0, 3).join(', '))}${x.missing.length > 3 ? '…' : ''}</span>` : ''}${x.note ? `<div class="mut">${esc(x.note)}</div>` : ''}</li>`).join('');
  const findings = (a?.findings ?? []).map((f) => `<li class="f-${f.level}">${esc(f.message)}</li>`).join('');
  const f = g.frames;
  const r = g.resources;
  const metrics = `
    <table class="m">
      <tr><th>First frame</th><td>${num(g.firstFrameMs, ' ms', 0)}</td><th>FPS idle</th><td>${num(f?.fpsIdle)}</td><th>FPS after input</th><td>${num(f?.fpsAfterInput)}</td></tr>
      <tr><th>CPU avg</th><td>${num(r?.cpuPercentAvg, ' %')}</td><th>RSS peak</th><td>${num(r?.peakRssMb, ' MB', 0)}</td><th>CPU time</th><td>${num(r?.cpuSeconds, ' s')}</td></tr>
      <tr><th>Distinct pictures (idle / after input)</th><td>${f ? `${f.distinctIdle} / ${f.distinctAfterInput}` : '—'}</td><th>Input response</th><td>${esc(g.verdicts.inputResponse)}</td><th>Exit</th><td>${esc(g.exit.state)} (${g.exit.code ?? '—'})${g.exit.cleanShutdown ? '' : ' ⚠'}</td></tr>
    </table>`;
  const pe = g.platformEvents;
  const peItems = [
    pe.softkeys && (pe.softkeys.left || pe.softkeys.right) ? `soft keys: “${esc(pe.softkeys.left)}” / “${esc(pe.softkeys.right)}”` : '',
    pe.menus ? `${pe.menus} command menu${pe.menus > 1 ? 's' : ''} opened` : '',
    pe.permissions.length ? `permission prompts: ${esc(pe.permissions.join('; '))}` : '',
    pe.vibrations ? `vibration ×${pe.vibrations}` : '', pe.urls.length ? `wants to open ${esc(pe.urls.join(', '))}` : '',
    pe.title ? `title “${esc(pe.title)}”` : '',
  ].filter(Boolean);
  const platform = peItems.length ? `<h3>Platform interaction</h3><ul>${peItems.map((x) => `<li>${x}</li>`).join('')}</ul>` : '';
  const logs = g.logTail.length ? `<details><summary>Emulator log (${g.logTail.length} lines)</summary><pre>${esc(g.logTail.join('\n'))}</pre></details>` : '';
  const manual = g.manual ?? { rating: 'untested', note: '' };
  const radio = (v: string, label: string) => `<label class="r r-${v}"><input type="radio" name="r-${esc(id)}" value="${v}" ${manual.rating === v ? 'checked' : ''}> ${label}</label>`;
  return `
  <article class="card st-${g.auto.status}" data-id="${esc(id)}" data-status="${g.auto.status}" data-search="${esc(`${g.game?.name ?? ''} ${g.game?.vendor ?? ''} ${g.file}`.toLowerCase())}">
    <header>
      <h2>${esc(g.game?.name ?? g.label)} <small>${esc(g.game?.version ?? '')}</small></h2>
      <div class="mut">${esc(g.game?.vendor ?? '')} · <code>${esc(g.file)}</code>${g.jad ? ` + <code>${esc(g.jad)}</code>` : ''} · ${g.game ? `${Math.round(g.game.sizeBytes / 1024)} KB · sha256 <code>${esc(g.game.sha256.slice(0, 12))}</code>` : ''} · ${esc(g.size ? `${g.size.width}×${g.size.height}` : '')}</div>
      <div class="badges">${badges}</div>
    </header>
    ${g.auto.reasons.length ? `<ul class="reasons">${g.auto.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    <div class="shots">${shots || '<p class="mut">No screenshots (the game produced no frames).</p>'}</div>
    ${metrics}
    <div class="cols">
      <div><h3>API usage</h3>${apis ? `<ul class="apis">${apis}</ul>` : '<p class="mut">Only core MIDP/CLDC APIs detected.</p>'}${a?.probedMissing.length ? `<p class="mut">Probed by name: ${esc(a.probedMissing.slice(0, 4).join(', '))}</p>` : ''}</div>
      <div><h3>Findings</h3>${findings ? `<ul class="finds">${findings}</ul>` : '<p class="mut">No static findings.</p>'}
        ${platform}
        ${g.diagnostics.length ? `<h3>Runtime diagnostics</h3><ul class="finds">${g.diagnostics.map((d) => `<li class="f-warn">${esc(d)}</li>`).join('')}</ul>` : ''}
        ${g.errorLines.length ? `<h3>Error lines</h3><pre class="err">${esc(g.errorLines.join('\n'))}</pre>` : ''}</div>
    </div>
    ${logs}
    <div class="manual"><strong>Manual check</strong> ${radio('works', 'Works')} ${radio('minor', 'Playable, minor issues')} ${radio('broken', 'Broken')} ${radio('untested', 'Not tested')}
      <input class="note" type="text" maxlength="400" placeholder="Notes (what you tried, what broke)" value="${esc(manual.note)}"></div>
  </article>`;
}

export function renderReport(results: GameResult[], meta: ReportMeta, shotData: Map<string, string>): string {
  const count = (s: string) => results.filter((r) => r.auto.status === s).length;
  const with3d = results.filter((r) => r.analysis?.needs3d).length;
  const withSound = results.filter((r) => r.audio.bytes > 0).length;
  const payload = JSON.stringify({ ids: results.map((r) => r.game?.sha256 ?? r.label), title: meta.title, generatedAt: meta.generatedAt }).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>${esc(meta.title)}</title>
<style>
:root{--bg:#f5f6f4;--fg:#15191a;--mut:#667070;--card:#fff;--line:#dcdfd9;--ok:#00875f;--warn:#9a6200;--bad:#c62f3b;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#0e1211;--fg:#e8eeec;--mut:#8d9b97;--card:#151a19;--line:#28312f;--ok:#2ad6a0;--warn:#f0b64a;--bad:#ff6b76}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif}
main{max-width:1200px;margin:0 auto;padding:20px 16px 60px}h1{margin:0 0 4px;font-size:22px}h2{margin:0;font-size:17px}h3{margin:12px 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--mut)}
.mut{color:var(--mut)}code{font:12px ui-monospace,monospace}.bar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:14px 0;position:sticky;top:0;background:var(--bg);padding:8px 0;z-index:3}
.sum{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0}.sum div{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 14px}.sum b{font-size:20px;display:block}
input[type=search],input.note,button{font:inherit;border:1px solid var(--line);background:var(--card);color:var(--fg);border-radius:8px;padding:6px 10px}button{cursor:pointer}
.card{background:var(--card);border:1px solid var(--line);border-left:5px solid var(--line);border-radius:12px;padding:14px 16px;margin:14px 0}
.st-pass{border-left-color:var(--ok)}.st-warn{border-left-color:var(--warn)}.st-fail{border-left-color:var(--bad)}
.badges{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}.b{font-size:11px;padding:2px 8px;border-radius:99px;border:1px solid var(--line);background:var(--bg)}
.b.pass{background:var(--ok);color:#fff;border-color:transparent}.b.warn{background:var(--warn);color:#fff;border-color:transparent}.b.fail{background:var(--bad);color:#fff;border-color:transparent}
.reasons{margin:8px 0;padding-left:18px;color:var(--warn)}.st-fail .reasons{color:var(--bad)}
.shots{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0}figure{margin:0}.shots img{display:block;max-height:240px;width:auto;image-rendering:pixelated;border:1px solid var(--line);background:#000;cursor:zoom-in}.shots img.zoom{max-height:none;position:relative;cursor:zoom-out}
figcaption{font-size:11px;color:var(--mut)}table.m{border-collapse:collapse;width:100%;margin:6px 0}table.m th{color:var(--mut);font-weight:500;text-align:left;padding:2px 10px 2px 0;font-size:12px}table.m td{padding:2px 14px 2px 0;font-variant-numeric:tabular-nums}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media(max-width:800px){.cols{grid-template-columns:1fr}}ul{margin:4px 0;padding-left:18px}.apis li.miss b{color:var(--bad)}
.f-error{color:var(--bad)}.f-warn{color:var(--warn)}.f-info{color:var(--mut)}pre{background:#0c1210;color:#b8e8d4;padding:8px;border-radius:8px;overflow:auto;max-height:260px;font:11px/1.35 ui-monospace,monospace}pre.err{color:#ffb4b4}
.manual{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-top:12px;padding-top:10px;border-top:1px dashed var(--line)}.manual .note{flex:1;min-width:200px}.r{cursor:pointer}
.hide{display:none}
</style></head><body><main>
<h1>${esc(meta.title)}</h1>
<div class="mut">Generated ${esc(meta.generatedAt)} · KEmulator nnmod <code>${esc(meta.emulatorCommit?.slice(0, 8) ?? 'unknown')}</code> · ${esc(meta.host)} · default device policy: <code>${esc(meta.defaultsDevice)}</code></div>
<div class="sum">
  <div><b>${results.length}</b>games</div><div><b style="color:var(--ok)">${count('pass')}</b>pass</div><div><b style="color:var(--warn)">${count('warn')}</b>warn</div><div><b style="color:var(--bad)">${count('fail')}</b>fail</div>
  <div><b>${with3d}</b>use 3D</div><div><b>${withSound}</b>made sound</div><div><b id="m-works">0</b>manually OK</div><div><b id="m-broken">0</b>manually broken</div>
</div>
<p class="mut">“pass / warn / fail” is an automatic verdict (picture present and alive, no crash, no diagnostics). It cannot judge gameplay: use the <em>Manual check</em> row in each card, then <b>Export ratings</b> and pass the file to <code>lab report --ratings</code> to bake it into the report.</p>
<div class="bar"><input type="search" id="q" placeholder="Filter by name / file">
  <label><input type="checkbox" id="onlyBad"> only warn/fail</label>
  <button id="export">Export ratings.json</button><button id="importBtn">Import ratings…</button><input type="file" id="importFile" accept="application/json" class="hide"></div>
${results.map((r) => card(r, shotData)).join('\n')}
</main>
<script>
const META=${payload};const KEY='lab-ratings:'+META.title+':'+META.generatedAt;
const store=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'{}')}catch(e){return{}}};
const save=o=>{try{localStorage.setItem(KEY,JSON.stringify(o))}catch(e){}};
const cards=[...document.querySelectorAll('.card')];
function read(c){const id=c.dataset.id;const r=c.querySelector('input[type=radio]:checked');return{rating:r?r.value:'untested',note:c.querySelector('.note').value}}
function refresh(){let w=0,b=0;for(const c of cards){const v=read(c).rating;if(v==='works')w++;if(v==='broken')b++}document.getElementById('m-works').textContent=w;document.getElementById('m-broken').textContent=b}
const s=store();for(const c of cards){const m=s[c.dataset.id];if(m){const r=c.querySelector('input[value="'+m.rating+'"]');if(r)r.checked=true;c.querySelector('.note').value=m.note||''}}
function persist(){const o={};for(const c of cards)o[c.dataset.id]=read(c);save(o);refresh()}
document.addEventListener('change',persist);document.addEventListener('input',e=>{if(e.target.classList.contains('note'))persist()});refresh();
function filter(){const q=document.getElementById('q').value.toLowerCase(),bad=document.getElementById('onlyBad').checked;for(const c of cards)c.classList.toggle('hide',!(c.dataset.search.includes(q)&&(!bad||c.dataset.status!=='pass')))}
document.getElementById('q').oninput=filter;document.getElementById('onlyBad').onchange=filter;
document.getElementById('export').onclick=()=>{const o={version:1,ratings:{}};for(const c of cards){const v=read(c);o.ratings[c.dataset.id]={rating:v.rating,note:v.note,updatedAt:new Date().toISOString()}}
 const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(o,null,2)],{type:'application/json'}));a.download='ratings.json';a.click()};
document.getElementById('importBtn').onclick=()=>document.getElementById('importFile').click();
document.getElementById('importFile').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{const o=JSON.parse(await f.text());for(const c of cards){const m=o.ratings&&o.ratings[c.dataset.id];if(m){const r=c.querySelector('input[value="'+m.rating+'"]');if(r)r.checked=true;c.querySelector('.note').value=m.note||''}}persist()}catch(err){alert('Invalid ratings file')}};
document.addEventListener('click',e=>{if(e.target.matches('.shots img'))e.target.classList.toggle('zoom')});
</script></body></html>`;
}
