/** The game's file area (JSR-75): what the MIDlet writes can be seen and downloaded, uploads can be read by the MIDlet, paths cannot escape. */
import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { cleanup, fixtures, javaProcs, openStream, startApp, upload, waitFor, type TestEnv } from './helpers.ts';

let env: TestEnv;
before(async () => { env = await startApp({ MAX_SESSIONS: '1' }); });
after(async () => { await env.app.sessions.stopAll(); await env.stop(); cleanup(env); });
const json = async (r: Response) => (await r.json()) as any;
const put = (id: string, dir: string, name: string, data: Buffer | string) => {
  const fd = new FormData();
  fd.append('file', new Blob([data]), name);
  return fetch(`${env.base}/api/games/${id}/files?path=${encodeURIComponent(dir)}`, { method: 'PUT', body: fd });
};

describe('game files', () => {
  it('lists, downloads, uploads and deletes inside the file area', async () => {
    const up = await upload(env.base, path.join(fixtures, '../../labgames/build/kemgame.jar'));
    const id = up.body.game.id;
    const files = `${env.base}/api/games/${id}/files`;

    assert.deepEqual((await json(await fetch(files))).entries, []);
    const r = await put(id, 'root1/docs', 'notes.txt', 'hello');
    assert.equal(r.status, 201);
    assert.deepEqual({ ...(await json(r)), modified: undefined }, { name: 'notes.txt', dir: false, size: 5, modified: undefined });

    const top = await json(await fetch(files));
    assert.deepEqual(top.entries.map((e: any) => [e.name, e.dir]), [['root1', true]]);
    const sub = await json(await fetch(`${files}?path=root1/docs`));
    assert.deepEqual(sub.entries.map((e: any) => [e.name, e.size]), [['notes.txt', 5]]);
    assert.equal(sub.usedBytes, 5);

    const dl = await fetch(`${files}/download?path=root1/docs/notes.txt`);
    assert.equal(await dl.text(), 'hello');
    assert.match(dl.headers.get('content-disposition') ?? '', /attachment; filename="notes.txt"/);
    assert.equal(dl.headers.get('x-content-type-options'), 'nosniff');

    assert.equal((await put(id, 'root1/docs', 'notes.txt', 'hello world')).status, 201, 'uploading again replaces');
    assert.equal(await (await fetch(`${files}/download?path=root1/docs/notes.txt`)).text(), 'hello world');

    assert.equal((await fetch(`${files}?path=root1/docs/notes.txt`, { method: 'DELETE' })).status, 204);
    assert.equal((await fetch(`${files}?path=root1`, { method: 'DELETE' })).status, 204);
    assert.deepEqual((await json(await fetch(files))).entries, []);
    assert.equal((await fetch(`${files}?path=root1`, { method: 'DELETE' })).status, 404);
  });

  it('refuses every way out of the file area', async () => {
    const up = await upload(env.base, path.join(fixtures, '../../labgames/build/kemgame.jar'));
    const id = up.body.game.id;
    const files = `${env.base}/api/games/${id}/files`;
    // a secret next to the file area and a link inside it that points there
    const saves = path.join(env.dataDir, 'saves', 'default', id);
    mkdirSync(path.join(saves, 'file'), { recursive: true });
    writeFileSync(path.join(saves, 'secret.txt'), 'top secret');
    symlinkSync(path.join(saves, 'secret.txt'), path.join(saves, 'file', 'link.txt'));
    symlinkSync(saves, path.join(saves, 'file', 'linkdir'));

    for (const bad of ['../secret.txt', 'a/../../secret.txt', '..', 'root1/../../x', 'a\\..\\b', 'x\u0000y']) {
      const q = encodeURIComponent(bad);
      assert.equal((await fetch(`${files}/download?path=${q}`)).status, 400, `download ${bad}`);
      assert.equal((await fetch(`${files}?path=${q}`)).status, 400, `list ${bad}`);
      assert.equal((await fetch(`${files}?path=${q}`, { method: 'DELETE' })).status, 400, `delete ${bad}`);
      assert.equal((await put(id, bad, 'x.txt', 'x')).status, 400, `upload to ${bad}`);
    }
    assert.equal((await fetch(`${files}/download?path=link.txt`)).status, 403, 'a link to a file is not followed');
    assert.equal((await fetch(`${files}/download?path=linkdir/secret.txt`)).status, 403, 'a link to a folder is not followed');
    assert.equal((await put(id, 'linkdir', 'x.txt', 'x')).status, 403);
    assert.ok(!existsSync(path.join(saves, 'x.txt')), 'nothing was written outside');
    assert.equal((await fetch(`${files}?path=`, { method: 'DELETE' })).status, 400, 'the file area itself stays');
    assert.equal((await fetch(`${env.base}/api/games/0123456789abcdef/files`)).status, 404);
  });

  it('enforces the size limits: an oversized file and the quota of the file area', async () => {
    const up = await upload(env.base, path.join(fixtures, '../../labgames/build/kemgame.jar'));
    const id = up.body.game.id;
    const big = Buffer.alloc(30 * 1024 * 1024, 1);
    assert.equal((await put(id, 'a', 'one.bin', big)).status, 201);
    assert.equal((await put(id, 'a', 'two.bin', big)).status, 201);
    const third = await put(id, 'a', 'three.bin', big);
    assert.equal(third.status, 413);
    assert.match((await json(third)).message, /limited to 64 MB/);
    assert.equal((await json(await fetch(`${env.base}/api/games/${id}/files?path=a`))).entries.length, 2, 'the refused upload left nothing behind');
    const huge = Buffer.alloc(env.cfg.maxUploadBytes + 1024, 1);
    assert.equal((await put(id, 'b', 'huge.bin', huge)).status, 413);
  });

  it('what a MIDlet writes through JSR-75 shows up, and an uploaded file is readable by the MIDlet', { skip: false }, async () => {
    const up = await upload(env.base, path.join(fixtures, '../../labgames/build/kemfiles.jar'));
    const id = up.body.game.id;
    assert.equal((await put(id, 'root1', 'input.txt', 'from the player')).status, 201);
    const r = await fetch(env.base + '/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ gameId: id, settings: {} }) });
    const s = await json(r);
    const ws = await openStream(env.base, s.id);
    const log = async () => ((await json(await fetch(`${env.base}/api/sessions/${s.id}`))).logTail as string[]).join('\n');
    await waitFor(async () => /FILES_DONE/.test(await log()), 'the MIDlet finished', 20000);
    assert.match(await log(), /FILES_READ \[from the player\]/);
    ws.close();
    await fetch(`${env.base}/api/sessions/${s.id}`, { method: 'DELETE' });
    await waitFor(() => javaProcs().length === 0, 'cleanup', 8000);
    const listing = await json(await fetch(`${env.base}/api/games/${id}/files?path=root1`));
    assert.ok(listing.entries.some((e: any) => e.name === 'written.txt'), JSON.stringify(listing.entries));
    assert.equal(await (await fetch(`${env.base}/api/games/${id}/files/download?path=root1/written.txt`)).text(), 'written by the game');
  });
});
