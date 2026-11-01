import assert from 'node:assert/strict';
import { it } from 'node:test';
// @ts-expect-error dependency-free service ESM
import { audioEnvironment } from '../../../../symbian/agent/audio.mjs';
it('shares an explicit Pulse socket and sink despite separate HOME directories and empty Pulse variables', () => {
  const original = { PATH: '/usr/bin', HOME: '/data/game-a', XDG_RUNTIME_DIR: '/tmp/runtime', PULSE_SERVER: '', PULSE_RUNTIME_PATH: '' };
  assert.deepEqual(audioEnvironment(original), { PATH: '/usr/bin', XDG_RUNTIME_DIR: '/tmp/runtime', PULSE_SERVER: 'unix:/tmp/runtime/pulse/native', PULSE_RUNTIME_PATH: '/tmp/runtime/pulse', PULSE_SINK: 'mgo_sink', PULSE_SOURCE: 'mgo_sink.monitor' });
  assert.deepEqual(audioEnvironment(original), audioEnvironment({ ...original, HOME: '/data/game-b' }));
  assert.equal(audioEnvironment({ PULSE_SERVER: 'unix:/custom/audio', PULSE_SINK: 'custom' }).PULSE_SERVER, 'unix:/custom/audio');
});
