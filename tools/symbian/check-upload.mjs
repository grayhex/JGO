#!/usr/bin/env node
// Finds out whether a large upload can reach MGO through YOUR network path (browser -> reverse proxy / tunnel -> MGO gateway -> app),
// before you send a real firmware. It sends N megabytes of zeros to POST /api/symbian/upload-probe, which counts and discards them.
//
//   node tools/symbian/check-upload.mjs https://mgo.example.com --mb 600 --token <AUTH_TOKEN>
//   node tools/symbian/check-upload.mjs http://nas.local:8080 --mb 2100
//
// Exit code 0: all bytes arrived. Otherwise the message says which kind of hop refused (see docs/SYMBIAN.md, "Upload limits").
import { Readable } from 'node:stream';

const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:\/\//.test(a)) ?? '').replace(/\/+$/, '');
const opt = (name, d) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : d; };
const mb = Number(opt('--mb', '100'));
const token = opt('--token', process.env.MGO_TOKEN ?? '');
if (!base || !(mb > 0)) { console.error('usage: check-upload.mjs <http(s)://host:port> [--mb 100] [--token T]'); process.exit(2); }

const boundary = '----mgoprobe' + Math.random().toString(16).slice(2);
const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="probe.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`);
const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
const total = Math.round(mb * 1048576);
const chunk = Buffer.alloc(1048576);
function* body() {
  yield head;
  for (let sent = 0; sent < total; sent += chunk.length) yield chunk.subarray(0, Math.min(chunk.length, total - sent));
  yield tail;
}
const t0 = Date.now();
console.log(`Sending ${mb} MB to ${base}/api/symbian/upload-probe ...`);
let res;
try {
  res = await fetch(`${base}/api/symbian/upload-probe`, {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: Readable.toWeb(Readable.from(body())),
    duplex: 'half',
  });
} catch (e) {
  console.error(`FAILED: the connection broke (${e.cause?.code ?? e.message}). A proxy in the path closed it, often because the body is over its limit or its timeout is short.`);
  process.exit(1);
}
const text = await res.text();
const secs = ((Date.now() - t0) / 1000).toFixed(1);
if (res.ok) {
  const j = JSON.parse(text);
  console.log(`OK: ${(j.received / 1048576).toFixed(0)} MB arrived in ${secs} s (MGO's own limit for firmware: ${(j.limit / 1048576).toFixed(0)} MB).`);
  process.exit(j.received >= total ? 0 : 1);
}
let json = null; try { json = JSON.parse(text); } catch { /* an HTML page from a proxy */ }
console.error(`FAILED: HTTP ${res.status} after ${secs} s.`);
if (json?.error === 'too_large') console.error(`MGO itself refused it: ${json.message}. Raise MAX_FIRMWARE_MB (app) and SYMBIAN_MAX_FIRMWARE_BYTES (service).`);
else if (json?.error === 'unauthorized') console.error('MGO wants its token: pass --token <AUTH_TOKEN>.');
else if (res.status === 413) console.error('A PROXY refused it (HTML, not MGO\'s JSON). "client_max_body_size" in nginx / Nginx Proxy Manager ("Custom Nginx Configuration"), "maxRequestBodyBytes" in Traefik, "request_body max_size" in Caddy, or the tunnel/CDN limit (Cloudflare: 100 MB on Free/Pro).\nIf you cannot raise it, put the files into the inbox folder instead (docs/SYMBIAN.md, "Firmware from a folder").');
else console.error(text.slice(0, 300));
process.exit(1);
