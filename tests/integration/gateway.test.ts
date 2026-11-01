// Large uploads through the REAL nginx gateway configuration (infrastructure/local/nginx.conf): a 70 MB firmware and a 45 MB Symbian
// package must pass the gateway (they used to stop at "413 Request Entity Too Large" because of the global 40m), nothing is spooled
// to the gateway's disk, and the ordinary API keeps its 40m. The app and the Symbian agent behind it are real; the emulator is the fake.
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { after, before, describe, it } from 'node:test';
import { cleanup, root, sleep, startApp, waitFor, type TestEnv } from './helpers.ts';

const nginxBin = ['/usr/sbin/nginx', '/usr/local/sbin/nginx', '/usr/bin/nginx'].find((p) => existsSync(p));
const AGENT = path.join(root, 'symbian/agent/agent.mjs');
const FAKE = path.join(root, 'tests/fixtures/fake-eka2l1/fake-eka2l1.mjs');
const free = () => new Promise<number>((res, rej) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)); }); s.on('error', rej); });
const MB = 1048576;

/** A multipart body of `bytes` bytes of file content, streamed (never held in memory). */
function multipart(bytes: number, filename: string, extra?: { platform?: string }) {
  const boundary = '----t' + Math.random().toString(16).slice(2);
  const head = Buffer.from(`${extra?.platform ? `--${boundary}\r\nContent-Disposition: form-data; name="platform"\r\n\r\n${extra.platform}\r\n` : ''}--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const chunk = Buffer.alloc(MB, 7);
  function* gen() { yield head; for (let s = 0; s < bytes; s += MB) yield chunk.subarray(0, Math.min(MB, bytes - s)); yield tail; }
  return { length: head.length + bytes + tail.length, contentType: `multipart/form-data; boundary=${boundary}`, body: Readable.toWeb(Readable.from(gen())) as unknown as BodyInit };
}
async function post(url: string, bytes: number, filename: string, extra?: { platform?: string }) {
  const m = multipart(bytes, filename, extra);
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': m.contentType, 'content-length': String(m.length) }, body: m.body, duplex: 'half' } as RequestInit);
  const text = await r.text();
  return { status: r.status, text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() as any };
}

describe('gateway (nginx) and large uploads', { skip: nginxBin ? false : 'nginx is not installed' }, () => {
  let env: TestEnv, agent: ChildProcess, ngx: ChildProcess, ngxOld: ChildProcess;
  let tmp: string, gw: string, gwOld: string, agentData: string, bodyTemp: string;

  function startNginx(name: string, port: number, appPort: number, serverConf: string, proxyConf: string): ChildProcess {
    const dir = path.join(tmp, name);
    mkdirSync(dir, { recursive: true });
    const proxy = proxyConf.replace('http://app:8080', `http://127.0.0.1:${appPort}`);
    const proxyFile = path.join(dir, 'mgo-proxy.conf');
    writeFileSync(proxyFile, proxy);
    const server = serverConf.replace('listen 8080;', `listen 127.0.0.1:${port};`).replaceAll('/etc/nginx/mgo-proxy.conf', proxyFile);
    const main = `${process.getuid?.() === 0 ? 'user root;\n' : ''}daemon off;\nworker_processes 1;\npid ${dir}/nginx.pid;\nerror_log ${dir}/error.log warn;\nevents { worker_connections 64; }\nhttp {\n  access_log off;\n  client_body_temp_path ${dir}/body;\n  proxy_temp_path ${dir}/proxy;\n  fastcgi_temp_path ${dir}/fcgi;\n  uwsgi_temp_path ${dir}/uwsgi;\n  scgi_temp_path ${dir}/scgi;\n${server}\n}\n`;
    writeFileSync(path.join(dir, 'nginx.conf'), main);
    return spawn(nginxBin!, ['-c', path.join(dir, 'nginx.conf'), '-p', dir], { stdio: 'ignore' });
  }

  before(async () => {
    tmp = mkdtempSync(path.join(tmpdir(), 'mgo-gw-'));
    agentData = path.join(tmp, 'agent');
    const agentPort = await free();
    agent = spawn(process.execPath, [AGENT], { env: { PATH: process.env.PATH ?? '', AGENT_TOKEN: 'gateway-token-0123456789', AGENT_PORT: String(agentPort), AGENT_HOST: '127.0.0.1', CONTROL_PORT: String(await free()), DATA_DIR: agentData, EKA2L1_BIN: FAKE }, stdio: 'ignore' });
    await waitFor(async () => { try { return (await fetch(`http://127.0.0.1:${agentPort}/agent/ping`)).ok; } catch { return false; } }, 'agent', 10000);
    env = await startApp({ SYMBIAN_AGENT_URL: `http://127.0.0.1:${agentPort}`, SYMBIAN_AGENT_TOKEN: 'gateway-token-0123456789' });
    const appPort = Number(new URL(env.base).port);
    const conf = readFileSync(path.join(root, 'infrastructure/local/nginx.conf'), 'utf8');
    const proxy = readFileSync(path.join(root, 'infrastructure/local/mgo-proxy.conf'), 'utf8');
    const mapLine = conf.slice(conf.indexOf('map $http_upgrade'));
    // the shipped configuration
    const port = await free();
    ngx = startNginx('new', port, appPort, conf, proxy);
    gw = `http://127.0.0.1:${port}`;
    bodyTemp = path.join(tmp, 'new', 'body');
    // the old one: a single global 40m, request buffering on (what shipped before) - the control that proves the test can fail
    const oldPort = await free();
    const old = `server {\n  listen 8080;\n  client_max_body_size 40m;\n  location / { include /etc/nginx/mgo-proxy.conf; }\n}\n${mapLine}`;
    ngxOld = startNginx('old', oldPort, appPort, old, proxy.replace('proxy_request_buffering off;', ''));
    gwOld = `http://127.0.0.1:${oldPort}`;
    for (const u of [gw, gwOld]) await waitFor(async () => { try { return (await fetch(`${u}/api/health`)).ok; } catch { return false; } }, 'nginx ' + u, 10000);
  });
  after(async () => {
    ngx?.kill('SIGTERM'); ngxOld?.kill('SIGTERM'); agent?.kill('SIGTERM');
    await env?.app.sessions.stopAll();
    await env?.stop();
    if (env) cleanup(env);
    await sleep(300);
    rmSync(tmp, { recursive: true, force: true });
  });

  const walk = (d: string): string[] => (existsSync(d) ? readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])) : []);

  it('control: the old configuration (40m for everything) stops a 60 MB probe with 413', async () => {
    const r = await post(`${gwOld}/api/symbian/upload-probe`, 60 * MB, 'p.bin');
    assert.equal(r.status, 413, r.text.slice(0, 300));
    assert.match(r.text, /Request Entity Too Large/i, 'nginx\'s own page, not MGO\'s JSON');
  });

  it('the shipped configuration lets a 120 MB probe through to the app, and spools nothing to the gateway disk', async () => {
    const r = await post(`${gw}/api/symbian/upload-probe`, 120 * MB, 'p.bin');
    assert.equal(r.status, 200, r.text.slice(0, 200));
    assert.equal(r.json.received, 120 * MB);
    assert.deepEqual(walk(bodyTemp), [], 'proxy_request_buffering off: no client body temp file');
  });

  it('a 70 MB firmware reaches the Symbian service through the gateway', async () => {
    const r = await post(`${gw}/api/symbian/firmware?slot=rom`, 70 * MB, 'RM-84.rom');
    assert.equal(r.status, 200, r.text.slice(0, 200));
    const stored = path.join(agentData, 'firmware-upload', r.json.file);
    assert.equal(statSync(stored).size, 70 * MB, 'every byte arrived at the service');
    assert.deepEqual(walk(bodyTemp), []);
  });

  it('a 45 MB Symbian package is accepted into the library through the gateway', async () => {
    const r = await post(`${gw}/api/games`, 45 * MB, 'Big Game.sis');
    assert.equal(r.status, 201, r.text.slice(0, 200));
    assert.equal(r.json.game.platform, 'symbian');
  });

  it('MGO\'s own limits still apply behind the gateway (a JSON 413 from the app, not a hang)', async () => {
    const small = await startApp({ MAX_FIRMWARE_MB: '50' });
    const port = await free();
    const n = startNginx('lim', port, Number(new URL(small.base).port), readFileSync(path.join(root, 'infrastructure/local/nginx.conf'), 'utf8'), readFileSync(path.join(root, 'infrastructure/local/mgo-proxy.conf'), 'utf8'));
    try {
      await waitFor(async () => { try { return (await fetch(`http://127.0.0.1:${port}/api/health`)).ok; } catch { return false; } }, 'nginx', 10000);
      const r = await post(`http://127.0.0.1:${port}/api/symbian/upload-probe`, 60 * MB, 'p.bin');
      assert.equal(r.status, 413);
      assert.equal(r.json?.error, 'too_large');
    } finally { n.kill('SIGTERM'); await small.stop(); cleanup(small); }
  });

  it('everything else keeps the 40m limit', async () => {
    const body = JSON.stringify({ what: 'missing', pad: 'x'.repeat(41 * MB) });
    const r = await fetch(`${gw}/api/library/cleanup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    assert.equal(r.status, 413);
  });
});
