// Negative tests against the REAL patched EKA2L1 through the running agent.
// Only original synthetic XML and deliberately invalid FPSX bytes: no proprietary firmware.
// AGENT_URL=http://127.0.0.1:8766 AGENT_TOKEN=... node tests/scripts/vpl-real-smoke.mjs
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { factoryManifest } from '../fixtures/factory-kit.mjs';

const base = process.env.AGENT_URL ?? 'http://127.0.0.1:8766';
const token = process.env.AGENT_TOKEN;
assert.ok(token, 'AGENT_TOKEN is required');
const headers = { authorization: `Bearer ${token}` };
const req = async (route, method = 'GET', body) => {
  const response = await fetch(base + route, { method, headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() };
};
const installFailure = async (xml, images, variant, expected) => {
  const bundle = randomBytes(16).toString('hex');
  for (const [name, contents] of [['synthetic.vpl', xml], ...images]) {
    const slot = name.endsWith('.vpl') ? 'vpl' : 'fpsx';
    const response = await fetch(`${base}/agent/firmware/${slot}?bundle=${bundle}&name=${name}`, { method: 'PUT', headers: { ...headers, 'content-type': 'application/octet-stream' }, body: contents });
    assert.equal(response.status, 200, await response.text());
  }
  const start = await req('/agent/firmware/install', 'POST', { vpl: 'synthetic.vpl', bundle, ...(variant !== undefined ? { variant } : {}) });
  assert.equal(start.status, 202, JSON.stringify(start.body));
  let job;
  const deadline = Date.now() + 120000;
  do {
    await new Promise(resolve => setTimeout(resolve, 500));
    job = (await req(`/agent/jobs/${start.body.id}`)).body;
    assert.ok(Date.now() < deadline, 'real EKA2L1 firmware job timed out');
  } while (job.state === 'running');
  assert.equal(job.state, 'failed', JSON.stringify(job));
  assert.equal(job.errorCode, expected, JSON.stringify(job));
  console.log(`PASS real EKA2L1 factory installer: ${expected}`);
};

await installFailure('<not-a-vpl/>', [['core.fpsx', 'intentionally invalid']], undefined, 'vpl_invalid');
const two = factoryManifest([{ label: 'First', product: '0000001', files: ['first.fpsx'] }, { label: 'Second', product: '0000002', files: ['absent.fpsx'] }]);
await installFailure(two, [['first.fpsx', 'intentionally invalid']], undefined, 'variant_required');
// Proves variant 0 is used: variant 1 would fail on its missing image before decoding FPSX.
await installFailure(two, [['first.fpsx', 'intentionally invalid']], 0, 'fpsx_corrupt');
await installFailure(two, [['first.fpsx', 'intentionally invalid']], 1, 'firmware_file_missing');
await installFailure(two, [['first.fpsx', 'intentionally invalid']], 2, 'bad_request');
const one = factoryManifest([{ label: 'Header bounds', product: '0000004', files: ['core.fpsx'] }]);
await installFailure(one, [['core.fpsx', Buffer.from([176, 255, 255, 255, 255, 0, 0, 0, 0])]], 0, 'fpsx_corrupt');
await installFailure(one, [['core.fpsx', Buffer.from([176, 0, 0, 0, 4, 255, 255, 255, 255])]], 0, 'fpsx_corrupt');
const unsafe = factoryManifest([{ label: 'Unsafe', product: '0000003', files: ['../escape.fpsx'] }]);
await installFailure(unsafe, [['core.fpsx', 'intentionally invalid']], 0, 'firmware_file_missing');
assert.equal((await req('/agent/health')).body.firmware.devices.length, 0, 'invalid synthetic images must not install a device');
