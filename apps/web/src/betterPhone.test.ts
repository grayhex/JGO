import assert from 'node:assert/strict';
import { it } from 'node:test';
import { betterPhone } from './betterPhone.js';

const phones = [
  { id: 'nokia-n-gage-classic', label: 'N-Gage', width: 176, height: 208 },
  { id: 'nokia-n70', label: 'N70', width: 176, height: 208 },
  { id: 'nokia-n95', label: 'N95', width: 240, height: 320 },
  { id: 'nokia-n8', label: 'N8', width: 360, height: 640 },
  { id: 'sony-ericsson-k750i', label: 'K750i', width: 176, height: 220 },
];
it('offers a larger phone that can run a Symbian game, only when its firmware is installed', () => {
  const hasFirmware = (id: string) => id === 'nokia-n70' || id === 'nokia-n95';
  assert.equal(betterPhone({ platform: 'symbian', packageFormat: 'sis-legacy', current: 'nokia-n70', options: phones, hasFirmware })?.id, undefined, 'a legacy .sis does not run on the N95: nothing larger fits');
  assert.equal(betterPhone({ platform: 'symbian', packageFormat: 'sis9', current: 'nokia-n70', options: phones, hasFirmware })?.id, 'nokia-n95');
  assert.equal(betterPhone({ platform: 'symbian', packageFormat: 'sis9', current: 'nokia-n95', options: phones, hasFirmware })?.id, undefined, 'the N8 has no firmware here');
  assert.equal(betterPhone({ platform: 'symbian', packageFormat: 'sis9', current: 'nokia-n70', options: phones, hasFirmware: () => true })?.id, 'nokia-n8');
});
it('never offers a phone that cannot run an N-Gage 1.0 game', () => {
  assert.equal(betterPhone({ platform: 'ngage', current: 'nokia-n-gage-classic', options: phones, hasFirmware: () => true }), null);
});
it('Java ME: only a phone with exactly the screen the game was made for', () => {
  assert.equal(betterPhone({ platform: 'j2me', current: 'nokia-n-gage-classic', options: phones, wanted: { width: 240, height: 320 } })?.id, 'nokia-n95');
  assert.equal(betterPhone({ platform: 'j2me', current: 'nokia-n95', options: phones, wanted: { width: 240, height: 320 } }), null);
  assert.equal(betterPhone({ platform: 'j2me', current: 'nokia-n95', options: phones, wanted: null }), null, 'no stated screen: nothing to claim');
  assert.equal(betterPhone({ platform: 'j2me', current: 'nokia-n95', options: phones, wanted: { width: 128, height: 128 } }), null, 'no phone with that screen among the options');
});
