import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { cleanup, fixtures, openStream, startApp, upload, waitFor, type TestEnv } from './helpers.ts';

const jar = path.join(fixtures, '../../labgames/build/kemm3gworld.jar');
const run = existsSync(jar) && existsSync('/usr/bin/Xvfb');

describe('3D: M3G retained mode (World, Camera, Light, Material, Texture2D) under Xvfb + llvmpipe', { skip: run ? false : 'needs Xvfb' }, () => {
  let env: TestEnv;
  let xvfb: ChildProcess;
  const display = ':96';
  before(async () => {
    xvfb = spawn('Xvfb', [display, '-screen', '0', '1024x768x24', '+extension', 'GLX', '-nolisten', 'tcp'], { stdio: 'ignore' });
    await waitFor(() => existsSync('/tmp/.X11-unix/X96'), 'Xvfb socket', 10000);
    env = await startApp({ KEM_DISPLAY: display, LIBGL_ALWAYS_SOFTWARE: '1', MAX_SESSIONS: '1' });
  });
  after(async () => { await env.app.sessions.stopAll(); await env.stop(); cleanup(env); xvfb.kill('SIGKILL'); });

  it('a lit, textured quad of a World is rendered: the checker texture shows red and blue areas', async () => {
    const up = await upload(env.base, jar);
    const r = await fetch(env.base + '/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ gameId: up.body.game.id }) });
    const s = (await r.json()) as any;
    const ws = await openStream(env.base, s.id);
    const seen = { red: 0, blue: 0, bg: 0 };
    const good = await waitFor(() => {
      const f = ws.frames.at(-1);
      if (!f) return null;
      seen.red = seen.blue = seen.bg = 0;
      for (let i = 0; i < f.pixels.length; i += 4) {
        const [R, G, B] = [f.pixels[i]!, f.pixels[i + 1]!, f.pixels[i + 2]!];
        if (R > 120 && G < 70 && B < 70) seen.red++;
        if (B > 120 && R < 70 && G < 70) seen.blue++;
        if (Math.abs(R - 0x20) < 8 && Math.abs(G - 0x30) < 8 && Math.abs(B - 0x40) < 8) seen.bg++;
      }
      return seen.red > 300 && seen.blue > 300 && seen.bg > 3000 ? f : null;
    }, 'a frame with the textured quad on the World background', 25000, 150);
    assert.ok(good, JSON.stringify(seen));
    const log = ((await (await fetch(`${env.base}/api/sessions/${s.id}`)).json()) as any).logTail.join('\n');
    assert.doesNotMatch(log, /M3GW_FAILED/);
    ws.close();
    await fetch(`${env.base}/api/sessions/${s.id}`, { method: 'DELETE' });
  });
});
