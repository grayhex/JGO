import assert from 'node:assert/strict';
import { it } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { NgageCatalog, parseAasIndex, parseAasDetails, matchAas } from './ngageCatalog.js';
import { Library } from './library.js';
const index = `<h3>Strategy (2)</h3><a href="item/pathway-to-glory.php" class="game-card"><img src="/images/ngage/box_art/pathway-to-glory_thumb.jpg"><div class="title">Pathway to Glory</div><div class="meta">Nokia / Studio &middot; 2004 &middot; 90%</div></a><a href="item/pathway-to-glory-ikusa-islands.php" class="game-card"><div class="title">Pathway to Glory: Ikusa Islands</div><div class="meta">Nokia · 2005</div></a><h2 id="unreleased">Unreleased</h2><a href="item/prototype.php" class="game-card"><div class="title">Prototype</div></a>`;
const detail = `<script type="application/ld+json">{"@type":"VideoGame","aggregateRating":{"ratingValue":90,"bestRating":100}}</script><table><tr><td>Developer</td><td>Studio</td></tr><tr><td>Multiplayer</td><td>Bluetooth (2 players)</td></tr><tr><td>Product code</td><td>6R72</td></tr></table>`;
it('parses released AAS cards and matches exact normalized titles without confusing a sequel', () => {
  const entries = parseAasIndex(index);
  assert.equal(entries.length, 2);
  assert.equal(entries[0]!.genre, 'Strategy');
  assert.equal(entries[0]!.publisher, 'Nokia');
  assert.equal(matchAas('Pathway_To_Glory.zip', entries)?.title, 'Pathway to Glory');
  assert.equal(matchAas('Pathway to Glory Ikusa Islands.zip', entries)?.title, 'Pathway to Glory: Ikusa Islands');
  assert.equal(matchAas('Pathway.zip', entries), null);
  assert.equal(matchAas('Pathway to Glory', [...entries, entries[0]!]), null);
  const info = parseAasDetails(detail, entries[0]!);
  assert.equal(info.rating, 90); assert.equal(info.productCode, '6R72'); assert.equal(info.multiplayer, 'Bluetooth (2 players)');
});
it('caches catalog facts and covers, leaves manual genres intact, and never enriches Java or N-Gage 2', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mgo-aas-'));
  const library = new Library(dir);
  try {
    const game = library.addPackage(Buffer.from('PK\x03\x04 synthetic'), 'Pathway_To_Glory.zip', 'ngage', 100000).game;
    library.classes.setManual(game.groupKey, { primaryGenre: 'Action' });
    const calls: string[] = [];
    const client: typeof fetch = async input => { const url = String(input); calls.push(url); return new Response(url.endsWith('.jpg') ? new Uint8Array([255,216,255,217]) : url.endsWith('.php') ? detail : index, { headers: { 'content-type': url.endsWith('.jpg') ? 'image/jpeg' : 'text/html' } }); };
    const catalog = new NgageCatalog(library, dir, client, 'http://gateway:9090');
    await catalog.refresh();
    const enriched = catalog.enrich(library.get(game.id)!);
    assert.equal(enriched.ngageInfo?.title, 'Pathway to Glory'); assert.equal(enriched.ngageInfo?.hasCover, true);
    assert.ok(catalog.cover(game.groupKey));
    assert.equal(library.get(game.id)!.classification?.primaryGenre, 'Action');
    assert.equal(catalog.enrich({ ...game, platform: 'ngage2' }).ngageInfo, undefined);
    assert.ok(calls.every(url => url.startsWith('http://gateway:9090/')));
    await catalog.refresh(); assert.equal(calls.length, 3, 'fresh cache does not contact the source again');
    const offline = new NgageCatalog(library, dir, async () => { throw new Error('offline'); });
    assert.equal(offline.enrich(game).ngageInfo?.year, 2004);
    await offline.refresh(true); assert.match(offline.status().error ?? '', /cannot be reached.*\(offline\)/s); assert.equal(offline.enrich(game).ngageInfo?.hasCover, true);
  } finally { library.close(); rmSync(dir, { recursive: true, force: true }); }
});

it('recognises dump-style file names (region tags, missing brand, Roman numerals) and never guesses between candidates', () => {
  const entries = [
    ["Tom Clancy's Ghost Recon: Jungle Storm", 'Shooter'], ['Asphalt: Urban GT', 'Racing'], ['Asphalt: Urban GT 2', 'Racing'], ["Tony Hawk's Pro Skater", 'Sports'],
    ['X-Men Legends II: Rise of Apocalypse', 'RPG'], ['FIFA Football 2004', 'Sports'], ['FIFA Football 2005', 'Sports'], ['Pathway to Glory', 'Strategy'], ['Pathway to Glory: Ikusa Islands', 'Strategy'], ['The Sims Bustin\' Out', 'Simulation'],
  ].map(([title, genre]) => ({ title: title!, genre: genre!, url: 'https://allaboutsymbian.com/n-gage-games/original/item/x.php', publisher: '', year: null, cover: null }));
  const m = (name: string) => matchAas(name, entries)?.title ?? null;
  assert.equal(m('Asphalt Urban GT (E).zip'), 'Asphalt: Urban GT');
  assert.equal(m('Asphalt Urban GT 2 [!].zip'), 'Asphalt: Urban GT 2');
  assert.equal(m("Tony Hawk's Pro Skater (Europe) (En,Fr,De)"), "Tony Hawk's Pro Skater");
  assert.equal(m('Ghost Recon - Jungle Storm'), "Tom Clancy's Ghost Recon: Jungle Storm");
  assert.equal(m('X-Men Legends 2'), 'X-Men Legends II: Rise of Apocalypse');
  assert.equal(m('Sims Bustin Out'), "The Sims Bustin' Out");
  assert.equal(m('FIFA 2004'), 'FIFA Football 2004');
  assert.equal(m('Pathway to Glory (N-Gage)'), 'Pathway to Glory');
  assert.equal(m('FIFA'), null, 'one word is not enough');
  assert.equal(m('Asphalt Urban'), null, 'two candidates: no guess');
  assert.equal(m('Something Else Entirely'), null);
});
it('recognises games and fills their genre from the shipped list when the source cannot be reached, and says why covers are missing', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mgo-aas-'));
  const library = new Library(dir);
  try {
    const game = library.addPackage(Buffer.from('PK\x03\x04 synthetic'), 'Pandemonium! (E).zip', 'ngage', 100000).game;
    const unknown = library.addPackage(Buffer.from('PK\x03\x04 other'), 'Not In The Directory.zip', 'ngage', 100000).game;
    const offline = new NgageCatalog(library, dir, async () => { throw new TypeError('fetch failed'); });
    assert.equal(offline.enrich(library.get(game.id)!).ngageInfo?.title, 'Pandemonium!', 'recognised without any network');
    assert.equal(library.get(game.id)!.classification?.primaryGenre, 'Platformer');
    await offline.refresh(true);
    const status = offline.status();
    assert.match(status.error ?? '', /cannot be reached.*still recognised/s);
    assert.equal(status.source, 'snapshot');
    assert.deepEqual(status.unmatched, [library.get(unknown.id)!.name]);
    assert.equal(status.matched, 1);
    assert.equal(offline.enrich(library.get(game.id)!).ngageInfo?.hasCover, false);
  } finally { library.close(); rmSync(dir, { recursive: true, force: true }); }
});
it('follows only redirects that stay on the fixed catalog pages', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mgo-aas-'));
  const library = new Library(dir);
  try {
    const urls: string[] = [];
    const client: typeof fetch = async input => { const url = String(input); urls.push(url); if (url.endsWith('/original/')) return new Response(null, { status: 302, headers: { location: 'https://evil.example/n-gage-games/original/' } }); return new Response('x'); };
    const catalog = new NgageCatalog(library, dir, client);
    await catalog.refresh(true);
    assert.deepEqual(urls, ['https://allaboutsymbian.com/n-gage-games/original/']);
    assert.match(catalog.status().error ?? '', /Unsupported catalog URL/);
  } finally { library.close(); rmSync(dir, { recursive: true, force: true }); }
});
