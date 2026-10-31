// Node-only regression checks for the secure first-start Docker login credential.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const script = path.resolve(__dirname, '../../runtime/scripts/docker-auth-token.cjs');

function run(dir, authToken = '') {
  return spawnSync(process.execPath, [script], {
    env: { ...process.env, DATA_DIR: dir, AUTH_TOKEN: authToken },
    encoding: 'utf8',
  });
}

test('generates unpredictable 64-character token and never changes it across starts', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jgo-docker-auth-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const one = run(dir);
  assert.equal(one.status, 0, one.stderr);
  assert.match(one.stdout, /^[0-9a-f]{64}$/);
  assert.match(one.stderr, /First-run login token/);
  const file = path.join(dir, '.jgo-auth-token');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(file, 'utf8').trim(), one.stdout);
  const two = run(dir);
  assert.equal(two.status, 0, two.stderr);
  assert.equal(two.stdout, one.stdout);
  assert.doesNotMatch(two.stderr, /First-run login token/);
  assert.equal(fs.readdirSync(dir).length, 1);
});

test('explicit AUTH_TOKEN override wins without changing persisted token', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jgo-docker-auth-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const before = run(dir);
  assert.equal(before.status, 0);
  const configured = run(dir, 'manually-selected-valid-secret');
  assert.equal(configured.status, 0, configured.stderr);
  assert.equal(configured.stdout, 'manually-selected-valid-secret');
  assert.equal(fs.readFileSync(path.join(dir, '.jgo-auth-token'), 'utf8').trim(), before.stdout);
});

test('rejects unsafe or corrupted token files instead of disabling authentication', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jgo-docker-auth-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, '.jgo-auth-token');
  fs.writeFileSync(file, 'not-a-real-token\n', { mode: 0o600 });
  const malformed = run(dir);
  assert.notEqual(malformed.status, 0);
  assert.match(malformed.stderr, /Invalid token file/);
  fs.writeFileSync(file, 'a'.repeat(64), { mode: 0o600 });
  fs.chmodSync(file, 0o644);
  const unsafe = run(dir);
  assert.notEqual(unsafe.status, 0);
  assert.match(unsafe.stderr, /Unsafe token file/);
});
