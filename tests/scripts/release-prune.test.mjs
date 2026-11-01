import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const script = path.join(repo, 'tools/release/prune.mjs');
const manifests = ['package.json', 'apps/api/package.json', 'apps/web/package.json', 'packages/protocol/package.json'];
const run = root => spawnSync(process.execPath, [script, root], { encoding: 'utf8' });
const stage = t => {
  const root = mkdtempSync(path.join(tmpdir(), 'mgo-release-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const file of manifests) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    copyFileSync(path.join(repo, file), path.join(root, file));
  }
  return root;
};

test('packages the current MGO workspace and keeps runtime output while removing development files', t => {
  const root = stage(t);
  const keep = ['apps/api/dist/server.js', 'apps/api/dist/analysis/analyze.js', 'apps/web/dist/index.html', 'apps/web/dist/phones/nokia-n95/config.json', 'packages/protocol/dist/index.js', 'node_modules/fastify/index.js'];
  const remove = ['apps/api/src/server.ts', 'apps/api/dist/lab/cli.js', 'apps/api/dist/testing.js', 'apps/api/dist/server.js.map', 'apps/api/dist/example.test.js', 'apps/web/src/App.tsx', 'packages/protocol/dist/index.d.ts', 'tests/example.js'];
  for (const file of [...keep, ...remove]) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), file);
  }
  const result = run(root);
  assert.equal(result.status, 0, result.stderr);
  for (const file of keep) assert.equal(readFileSync(path.join(root, file), 'utf8'), file, `retains ${file}`);
  for (const file of remove) assert.equal(existsSync(path.join(root, file)), false, `removes ${file}`);
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'mgo');
  assert.deepEqual(pkg.scripts, { start: 'node apps/api/dist/server.js' });
  for (const file of manifests) assert.equal(JSON.parse(readFileSync(path.join(root, file), 'utf8')).devDependencies, undefined);
});

test('refuses a checkout or unrelated staged project before deleting files', t => {
  const root = stage(t);
  const source = path.join(root, 'apps/api/src/server.ts');
  mkdirSync(path.dirname(source), { recursive: true });
  writeFileSync(source, 'keep this source');
  mkdirSync(path.join(root, '.git'));
  assert.notEqual(run(root).status, 0);
  assert.equal(readFileSync(source, 'utf8'), 'keep this source');
  rmSync(path.join(root, '.git'), { recursive: true });
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'unrelated' }));
  assert.notEqual(run(root).status, 0);
  assert.equal(readFileSync(source, 'utf8'), 'keep this source');
  assert.notEqual(run(repo).status, 0);
});
