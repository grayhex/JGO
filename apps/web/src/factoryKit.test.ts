import assert from 'node:assert/strict';
import { it } from 'node:test';
import { checkFactoryFiles } from './factoryKit';

it('browser factory selection refuses ambiguous manifests, path components and duplicate filenames', () => {
  assert.doesNotThrow(() => checkFactoryFiles([{ name: 'kit.vpl' }, { name: 'core.fpsx' }]));
  for (const files of [
    [{ name: 'kit.vpl' }],
    [{ name: 'a.vpl' }, { name: 'b.vpl' }, { name: 'core.fpsx' }],
    [{ name: 'kit.vpl' }, { name: '../core.fpsx' }],
    [{ name: 'kit.vpl' }, { name: 'core.fpsx' }, { name: 'CORE.FPSX' }],
  ]) assert.throws(() => checkFactoryFiles(files));
});
