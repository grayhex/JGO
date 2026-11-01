import assert from 'node:assert/strict';
import { it, mock } from 'node:test';
import { AgentClient } from './agentClient.js';

it('delivers intact stereo PCM when HTTP splits samples and frames across arbitrary byte boundaries', async () => {
  const original = Buffer.from([0,1,2,3,4,5,6,7,8,9,10,11]);
  const chunks = [original.subarray(0,1), original.subarray(1,6), original.subarray(6,9), original.subarray(9)];
  const fetch = mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({ start(controller) { for (const c of chunks) controller.enqueue(c); controller.close(); } })));
  try {
    const client = new AgentClient({ baseUrl: 'http://agent.test', token: 'test-token-0123456789' });
    const received: Buffer[] = [];
    for await (const pcm of client.audio(new AbortController().signal)) { assert.equal(pcm.length % 4, 0); received.push(pcm); }
    assert.deepEqual(Buffer.concat(received), original, 'no sample is lost, duplicated or swapped between channels');
  } finally { fetch.mock.restore(); }
});
it('reports truncated PCM instead of forwarding half a sample to AudioWorklet', async () => {
  const fetch = mock.method(globalThis, 'fetch', async () => new Response(new Uint8Array([1,2,3])));
  try {
    const client = new AgentClient({ baseUrl: 'http://agent.test', token: 'test-token-0123456789' });
    await assert.rejects(async () => { for await (const _ of client.audio(new AbortController().signal)) assert.fail('an incomplete frame must not be emitted'); }, /incomplete stereo PCM frame/);
  } finally { fetch.mock.restore(); }
});
