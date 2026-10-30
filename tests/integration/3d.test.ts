import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { cleanup, fixtures, javaProcs, openStream, sleep, startApp, upload, waitFor, type TestEnv } from './helpers.ts';

const jar3d = path.join(fixtures, '../../testmidlet3d/build/kemtest3d.jar');
const haveXvfb = existsSync('/usr/bin/Xvfb');
const run = existsSync(jar3d) && haveXvfb;

describe('3D: M3G through LWJGL/OpenGL (software Mesa llvmpipe under Xvfb)', { skip: run ? false : 'needs Xvfb and tests/fixtures/testmidlet3d/build/kemtest3d.jar' }, () => {
  let env: TestEnv;
  let xvfb: ChildProcess;
  const display = ':97';

  before(async () => {
    xvfb = spawn('Xvfb', [display, '-screen', '0', '1024x768x24', '+extension', 'GLX', '-nolisten', 'tcp'], { stdio: 'ignore' });
    await waitFor(() => existsSync('/tmp/.X11-unix/X97'), 'Xvfb socket', 10000);
    env = await startApp({ KEM_DISPLAY: display, LIBGL_ALWAYS_SOFTWARE: '1' });
  });
  after(async () => {
    await env.app.sessions.stopAll();
    await env.stop();
    cleanup(env);
    xvfb.kill('SIGKILL');
  });

  it('renders a spinning vertex-coloured triangle (real GL, not a placeholder)', async () => {
    const up = await upload(env.base, jar3d);
    assert.equal(up.status, 201, JSON.stringify(up.body));
    const r = await fetch(env.base + '/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ gameId: up.body.game.id }) });
    const s = (await r.json()) as any;
    assert.equal(r.status, 201, JSON.stringify(s));
    const ws = await openStream(env.base, s.id);
    // wait for a frame in which the triangle faces us: many strongly red, green and blue pixels
    const seen = { r: 0, g: 0, b: 0 };
    const good = await waitFor(() => {
      const f = ws.frames.at(-1);
      if (!f) return null;
      seen.r = seen.g = seen.b = 0;
      for (let i = 0; i < f.pixels.length; i += 4) {
        const [R, G, B] = [f.pixels[i]!, f.pixels[i + 1]!, f.pixels[i + 2]!];
        if (R > 200 && G < 60 && B < 60) seen.r++;
        if (G > 200 && R < 60 && B < 60) seen.g++;
        if (B > 200 && R < 60 && G < 60) seen.b++;
      }
      return seen.r > 15 && seen.g > 15 && seen.b > 15 ? f : null;
    }, 'a frame with the colour-interpolated triangle', 20000, 100);
    assert.ok(good);
    const log = ((await (await fetch(`${env.base}/api/sessions/${s.id}`)).json()) as any).logTail.join('\n');
    assert.match(log, /GL Renderer: llvmpipe/);
    assert.doesNotMatch(log, /M3G_(INIT|RENDER)_FAILED/);
    const t0 = ws.frames.length;
    await sleep(2000);
    const fps = (ws.frames.length - t0) / 2;
    console.log(`      M3G 240x320 on llvmpipe: ${fps.toFixed(1)} fps (4 vCPU sandbox, game asks for ~30)`);
    assert.ok(fps > 8, `3D frame rate too low: ${fps}`);
    ws.close();
    await fetch(`${env.base}/api/sessions/${s.id}`, { method: 'DELETE' });
    await waitFor(() => javaProcs().length === 0, 'processes gone', 8000);
  });
});
