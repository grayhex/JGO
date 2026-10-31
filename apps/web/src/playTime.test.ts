import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { splitPlayTime } from './playTime';

describe('play time on the card', () => {
  it('shows nothing before the first launch and "< 1 min" for a short run', () => {
    assert.deepEqual(splitPlayTime(undefined), { kind: 'none' });
    assert.deepEqual(splitPlayTime(0), { kind: 'none' });
    assert.deepEqual(splitPlayTime(-5), { kind: 'none' });
    assert.deepEqual(splitPlayTime(59), { kind: 'short' });
  });
  it('splits into hours and minutes', () => {
    assert.deepEqual(splitPlayTime(60), { kind: 'time', h: 0, m: 1 });
    assert.deepEqual(splitPlayTime(35 * 60 + 40), { kind: 'time', h: 0, m: 35 });
    assert.deepEqual(splitPlayTime(2 * 3600 + 5 * 60), { kind: 'time', h: 2, m: 5 });
    assert.deepEqual(splitPlayTime(26 * 3600 + 59 * 60 + 59), { kind: 'time', h: 26, m: 59 });
  });
});
