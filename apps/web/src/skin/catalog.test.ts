import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { PHONE_PROFILES } from '@j2me-web/protocol';
import { SKIN_IDS } from './registry';

it('the ten selectable skins have server profiles and actual runtime assets', () => {
  assert.equal(SKIN_IDS.length, 10);
  assert.deepEqual([...SKIN_IDS].sort(), Object.keys(PHONE_PROFILES).sort());
  for (const id of SKIN_IDS) {
    const base = new URL(`../../public/phones/${id}/`, import.meta.url);
    const c = JSON.parse(readFileSync(new URL('config.json', base), 'utf8'));
    assert.equal(c.id, id);
    for (const filename of [c.assets.body, c.assets.hitboxes, c.assets.preview, c.views.screen.body]) {
      assert.ok(readFileSync(new URL(filename, base)).length > 0, `${id}: ${filename}`);
    }
  }
});

it('touchscreen phones preserve their physical controls and use an external game keypad', () => {
  for (const id of ['nokia-5800', 'samsung-s5230']) {
    const c = JSON.parse(readFileSync(new URL(`../../public/phones/${id}/config.json`, import.meta.url), 'utf8'));
    assert.deepEqual(c.input, { kind: 'touchscreen', pointer: true, externalKeypad: true });
    assert.ok(!c.buttons.some((b: { id: string }) => /^(d\d|up|down|left|right|fire)$/.test(b.id)));
    assert.deepEqual(c.views.screen.buttons, []);
  }
});
