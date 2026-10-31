import assert from 'node:assert/strict';
import { readdirSync, readFileSync, rmSync, statSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { FakeMoby, PNG } from './dev/fakeMoby.js';
import { buildApp, type App } from './server.js';
import { makeJar, put, testConfig, tmpDir } from './dev/testing.js';

const TOKEN = 'test-token-0123456789';
const KEY = 'moby_testkey_0001';

describe('setup, settings, library and MobyGames over the API', () => {
  let app: App;
  let fake: FakeMoby;
  let root: string;
  let outside: string;
  const auth = { authorization: `Bearer ${TOKEN}` };

  before(async () => {
    fake = await new FakeMoby().start();
    process.env.MOBYGAMES_API_BASE = fake.base;
    process.env.MOBYGAMES_MIN_INTERVAL_MS = '0';
    root = tmpDir('jgo-api-lib-');
    outside = tmpDir('jgo-api-out-');
    put(outside, 'secret.jar', makeJar('Secret'));
    symlinkSync(outside, path.join(root, 'escape'));
    app = await buildApp(testConfig({ roots: [root], authToken: TOKEN }));
  });
  after(async () => {
    await app.close();
    await fake.stop();
    delete process.env.MOBYGAMES_API_BASE;
    delete process.env.MOBYGAMES_MIN_INTERVAL_MS;
  });

  const call = async (method: string, url: string, body?: unknown, headers: Record<string, string> = auth) => {
    const res = await app.fastify.inject({ method: method as 'GET', url, headers: { ...headers, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(body !== undefined ? { payload: JSON.stringify(body) } : {}) });
    let json: any = null;
    try { json = res.json(); } catch { /* not JSON */ }
    return { status: res.statusCode, json, raw: res.rawPayload, headers: res.headers, text: res.body };
  };
  const waitScan = async () => {
    await app.scan.idle();
    return (await call('GET', '/api/library/scan')).json.report;
  };

  it('every new endpoint needs the existing JGO token (Bearer and the login cookie both work)', async () => {
    for (const [m, u] of [['GET', '/api/setup'], ['GET', '/api/settings'], ['PATCH', '/api/settings'], ['PUT', '/api/settings/mobygames-key'], ['GET', '/api/system/status'], ['GET', '/api/library/roots'], ['GET', '/api/library/browse'], ['POST', '/api/library/scan'], ['POST', '/api/metadata/enrich'], ['GET', '/api/games/0123456789abcdef/cover']] as const) {
      assert.equal((await call(m, u, m === 'GET' ? undefined : {}, {})).status, 401, `${m} ${u}`);
    }
    assert.equal((await call('GET', '/api/setup')).status, 200);
    const login = await app.fastify.inject({ method: 'POST', url: '/api/auth/login', payload: { token: TOKEN } });
    assert.equal(login.statusCode, 200);
    const cookie = String(login.headers['set-cookie']).split(';')[0]!;
    assert.equal((await call('GET', '/api/settings', undefined, { cookie })).status, 200);
    assert.equal((await call('GET', '/api/health', undefined, {})).status, 200, 'health stays public');
  });

  it('a fresh install asks for the wizard; skipping and re-running work', async () => {
    assert.equal((await call('GET', '/api/setup')).json.needsWizard, true);
    assert.equal((await call('POST', '/api/setup/skip')).json.status, 'skipped');
    assert.equal((await call('GET', '/api/setup')).json.needsWizard, false);
    assert.equal((await call('POST', '/api/setup/reset')).json.status, 'pending');
  });

  it('settings: validated partial updates, nothing about the token or paths of the host leaks', async () => {
    const r = await call('PATCH', '/api/settings', { audio: { volume: 42 }, phone: { skinId: 'nokia-e71', width: 320, height: 240 } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.settings.audio.volume, 42);
    assert.equal(r.json.settings.phone.skinId, 'nokia-e71');
    assert.equal(r.json.readonly.auth, 'token');
    assert.ok(!r.text.includes(TOKEN), 'the access token is never returned');
    assert.equal((await call('PATCH', '/api/settings', { audio: { volume: 500 } })).status, 400);
    assert.equal((await call('PATCH', '/api/settings', { authToken: 'x' })).status, 400, 'the token cannot be changed through the settings API');
    assert.equal((await call('PATCH', '/api/settings', { server: { maxSessions: 2 } })).json.settings.server.maxSessions, 2);
    assert.equal(app.cfg.maxSessions, 2, 'applied to the running server without a restart');
    await call('PATCH', '/api/settings', { server: { maxSessions: 1 } });
  });

  it('the library directory can only be one of the allowed roots (or inside), and links cannot escape', async () => {
    for (const p of ['/etc', '/', '/root', path.join(root, '..'), path.join(root, 'escape'), 'relative']) {
      const r = await call('PATCH', '/api/settings', { libraryPath: p });
      assert.equal(r.status, 400, p);
    }
    assert.equal((await call('GET', `/api/library/browse?path=${encodeURIComponent('/etc')}`)).status, 400);
    assert.equal((await call('GET', `/api/library/browse?path=${encodeURIComponent(path.join(root, 'escape'))}`)).status, 400);
    assert.equal((await call('GET', `/api/library/browse?path=${encodeURIComponent(root + '/../../etc')}`)).status, 400);
    const chk = await call('POST', '/api/library/check', { path: '/etc' });
    assert.equal(chk.json.ok, false);
    assert.equal(chk.json.insideRoot, false);
    assert.equal(chk.json.jarCount, 0);
    const roots = await call('GET', '/api/library/roots');
    assert.ok(roots.json.roots.some((x: any) => x.path === root && x.exists));
    assert.equal((await call('PATCH', '/api/settings', { libraryPath: root })).json.settings.libraryPath, root);
  });

  it('imports through the API, reports duplicates and versions, shows them in /api/games', async () => {
    put(root, 'A/Snake.jar', makeJar('Snake', { version: '1.0' }));
    put(root, 'B/Snake copy.jar', makeJar('Snake', { version: '1.0' }));
    put(root, 'A/Snake 2.jar', makeJar('Snake', { version: '2.0' }));
    put(root, 'C/Racer.jar', makeJar('Racer'));
    const chk = await call('POST', '/api/library/check', { path: root });
    assert.deepEqual([chk.json.ok, chk.json.jarCount], [true, 4]);
    assert.equal((await call('POST', '/api/library/scan', { mode: 'update' })).status, 202);
    const r = await waitScan();
    assert.equal(r.state, 'done', JSON.stringify(r));
    assert.deepEqual([r.added, r.duplicates, r.newVersions, r.skipped], [3, 1, 1, 0]);
    const games = (await call('GET', '/api/games')).json;
    assert.equal(games.length, 3);
    assert.ok(games.every((g: any) => g.origin === 'import'));
    assert.ok(games.every((g: any) => g.settings.width === 320 && g.settings.height === 240), 'new games start with the default phone');
    assert.ok(!JSON.stringify({ ...r, root: '' }).includes(root), 'apart from the library directory itself, the report only has relative paths');
    // the second run is incremental
    await call('POST', '/api/library/scan', { mode: 'update' });
    const r2 = await waitScan();
    assert.deepEqual([r2.added, r2.unchanged], [0, 4]);
    assert.equal((await call('POST', '/api/library/scan', { mode: 'update' })).status, 202);
    assert.equal((await call('POST', '/api/library/scan', {})).status, 409);
    await app.scan.idle();
  });

  it('uploads keep working and use the default phone too', async () => {
    const boundary = '----t';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="jar"; filename="up.jar"\r\nContent-Type: application/java-archive\r\n\r\n`),
      Buffer.from(makeJar('Uploaded Game')),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await app.fastify.inject({ method: 'POST', url: '/api/games', headers: { ...auth, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body });
    assert.equal(res.statusCode, 201, res.body);
    const g = res.json().game;
    assert.equal(g.origin, 'upload');
    assert.equal(g.settings.width, 320);
  });

  it('the MobyGames key goes in, never comes out (responses, files, logs)', async () => {
    assert.equal((await call('POST', '/api/mobygames/test')).status, 400);
    assert.equal((await call('PUT', '/api/settings/mobygames-key', { key: 'short' })).status, 400);
    const put1 = await call('PUT', '/api/settings/mobygames-key', { key: KEY });
    assert.deepEqual(put1.json.mobygames, { configured: true, hint: '…0001' });
    const everything = [(await call('GET', '/api/settings')).text, (await call('GET', '/api/setup')).text, (await call('GET', '/api/system/status')).text, put1.text];
    for (const t of everything) assert.ok(!t.includes(KEY), 'the key is not in any response');
    assert.ok(!readFileSync(app.settings.file, 'utf8').includes(KEY), 'not in settings.json');
    assert.equal(statSync(app.settings.secretsFile).mode & 0o777, 0o600);
    assert.deepEqual((await call('POST', '/api/mobygames/test')).json, { ok: true, platformId: 64 });
    assert.ok(!readdirSync(app.cfg.dataDir).some((f) => f.endsWith('.tmp')));
  });

  it('looks games up, asks for a decision on ambiguity, serves images from the server', async () => {
    fake.games = [
      { game_id: 11, title: 'Racer', platforms: [{ platform_id: 64, name: 'J2ME', release_date: '2007-01-01' }], genres: [{ name: 'Racing' }], moby_score: 6.5 },
      { game_id: 21, title: 'Snake', platforms: [{ platform_id: 64, name: 'J2ME', release_date: '2003-01-01' }] },
      { game_id: 22, title: 'Snake', platforms: [{ platform_id: 64, name: 'J2ME', release_date: '2006-01-01' }] },
    ];
    const start = await call('POST', '/api/metadata/enrich', { scope: 'missing' });
    assert.equal(start.status, 202);
    await app.metadata.idle();
    const job = (await call('GET', '/api/metadata/job')).json;
    assert.deepEqual([job.job.state, job.job.matched, job.job.ambiguous, job.review], ['done', 1, 1, 1]);
    const games = (await call('GET', '/api/games')).json;
    const racer = games.find((g: any) => g.name === 'Racer');
    const snake = games.find((g: any) => g.name === 'Snake');
    assert.equal(racer.info.status, 'matched');
    assert.deepEqual(racer.info.genres, ['Racing']);
    const info = (await call('GET', `/api/games/${racer.id}/info`)).json;
    assert.match(info.attribution, /MobyGames/);
    assert.equal(info.score, 6.5);
    const cover = await call('GET', `/api/games/${racer.id}/cover`);
    assert.equal(cover.status, 200);
    assert.equal(cover.headers['content-type'], 'image/png');
    assert.deepEqual(Buffer.from(cover.raw), PNG);
    assert.equal((await call('GET', `/api/games/${racer.id}/screenshots/1`)).status, 200);
    assert.equal((await call('GET', `/api/games/${racer.id}/screenshots/9`)).status, 404);
    assert.equal((await call('GET', `/api/games/${snake.id}/cover`)).status, 404, 'no image before a match is chosen');
    // both Snake versions share the open question, and a choice settles both
    const cands = (await call('GET', `/api/games/${snake.id}/info`)).json.candidates;
    assert.equal(cands.length, 2);
    assert.equal((await call('POST', `/api/games/${snake.id}/info/choose`, { mobyId: '22' })).status, 400);
    const chosen = await call('POST', `/api/games/${snake.id}/info/choose`, { mobyId: 22 });
    assert.equal(chosen.json.status, 'manual');
    assert.equal(chosen.json.year, 2006);
    const other = games.filter((g: any) => g.name === 'Snake').map((g: any) => g.id);
    for (const id of other) assert.equal((await call('GET', `/api/games/${id}/info`)).json.mobyId, 22);
    assert.equal((await call('GET', '/api/games/zzzz/info')).status, 404);
  });

  it('removing the key or the data is possible; games and saves stay', async () => {
    const before = (await call('GET', '/api/games')).json.length;
    assert.equal((await call('DELETE', '/api/metadata')).status, 204);
    assert.equal((await call('DELETE', '/api/settings/mobygames-key')).json.mobygames.configured, false);
    const games = (await call('GET', '/api/games')).json;
    assert.equal(games.length, before);
    assert.ok(games.every((g: any) => !g.info));
    assert.equal((await call('POST', '/api/metadata/enrich', {})).status, 400);
  });

  it('system status reports each component', async () => {
    const s = (await call('GET', '/api/system/status')).json;
    const ids = s.checks.map((c: any) => c.id);
    for (const id of ['java', 'kemulator', 'bridge', 'mesa', 'storage', 'library', 'mobygames']) assert.ok(ids.includes(id), id);
    assert.ok(s.checks.every((c: any) => ['ok', 'warn', 'error'].includes(c.state) && typeof c.detail === 'string'));
    assert.equal(s.checks.find((c: any) => c.id === 'library').state, 'ok');
    assert.ok(s.storage.freeBytes > 0);
    assert.ok(!JSON.stringify(s).includes(app.cfg.dataDir), 'no host paths in the status');
  });

  it('games whose files are gone can be removed in one go, and the whole library can be emptied (only with confirmation)', async () => {
    const lib = tmpDir('jgo-cleanup-');
    for (const n of ['Keep One', 'Gone One', 'Gone Two']) put(lib, `${n}.jar`, makeJar(n, { vendor: 'Cleanup' }));
    const original = app.cfg.libraryRoots;
    app.cfg.libraryRoots.push(lib);
    try {
      assert.equal((await call('PATCH', '/api/settings', { libraryPath: lib })).status, 200);
      await call('POST', '/api/library/scan', { mode: 'full' });
      await waitScan();
      const before = (await call('GET', '/api/games')).json.length;
      rmSync(path.join(lib, 'Gone One.jar'));
      rmSync(path.join(lib, 'Gone Two.jar'));
      await call('POST', '/api/library/scan', { mode: 'update' });
      await waitScan();
      const gone = (await call('GET', '/api/games')).json.filter((g: any) => g.sourceMissing).map((g: any) => g.name).sort();
      // the games imported earlier from another folder are "file gone" too: that is the situation after moving to a new collection
      assert.ok(['Gone One', 'Gone Two', 'Racer', 'Snake'].every((n) => gone.includes(n)), gone.join());
      assert.ok(!gone.includes('Keep One'));
      assert.equal((await call('POST', '/api/library/cleanup', { what: 'nonsense' })).status, 400);
      const r = await call('POST', '/api/library/cleanup', { what: 'missing' });
      assert.deepEqual([r.json.removed, r.json.skipped], [gone.length, 0]);
      const after = (await call('GET', '/api/games')).json;
      assert.equal(after.length, before - gone.length);
      assert.ok(after.some((g: any) => g.name === 'Keep One'), 'a game whose file is still there is kept');
      assert.equal((await call('POST', '/api/library/cleanup', { what: 'all' })).status, 400, 'the whole library needs a confirmation');
      assert.equal((await call('GET', '/api/games')).json.length, before - gone.length, 'nothing was removed without it');
      const all = await call('POST', '/api/library/cleanup', { what: 'all', confirm: 'DELETE', deleteSaves: true });
      assert.equal(all.json.removed, before - gone.length);
      assert.deepEqual((await call('GET', '/api/games')).json, []);
      // the folder is still connected: a scan brings the file back
      await call('POST', '/api/library/scan', { mode: 'update' });
      await waitScan();
      assert.deepEqual((await call('GET', '/api/games')).json.map((g: any) => g.name), ['Keep One']);
    } finally {
      original.splice(original.indexOf(lib), 1);
    }
  });
});

describe('existing installations', () => {
  it('a data directory with games and no settings file keeps working and does not show the wizard', async () => {
    const cfg = testConfig();
    const { Library } = await import('./library.js');
    const lib = new Library(cfg.dataDir);
    lib.add(makeJar('Old Game'), null, 1e9);
    lib.close();
    const app = await buildApp(cfg);
    try {
      const setup = (await app.fastify.inject({ method: 'GET', url: '/api/setup' })).json();
      assert.deepEqual([setup.needsWizard, setup.legacy, setup.games], [false, true, 1]);
      const games = (await app.fastify.inject({ method: 'GET', url: '/api/games' })).json();
      assert.equal(games[0].name, 'Old Game');
      assert.equal(games[0].settings.width, 240);
      const settings = (await app.fastify.inject({ method: 'GET', url: '/api/settings' })).json();
      assert.equal(settings.settings.server.maxSessions, cfg.maxSessions);
      assert.equal(settings.settings.libraryPath, null);
    } finally {
      await app.close();
    }
  });
});
