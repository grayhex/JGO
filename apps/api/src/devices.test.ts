import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadDevicePresets, parsePresets, recommendPreset, slug } from './devices.js';

const SAMPLE = `<?xml version="1.0"?>
<presets>
  <default value="240x320 (COMMON - full screen)"/>
  <!-- layouts -->
  <layout name="Nokia"><define name="KEY_UP" value="-1"/><define name="KEY_DOWN" value="-2"/><define name="KEY_LEFT" value="-3"/><define name="KEY_RIGHT" value="-4"/><define name="KEY_FIRE" value="-5"/><define name="KEY_S1" value="-6"/><define name="KEY_S2" value="-7"/></layout>
  <layout name="Sagem" parent="Nokia"><define name="KEY_S1" value="-7"/><define name="KEY_S2" value="-6"/></layout>
  <layout name="Siemens"><define name="KEY_UP" value="-59"/><define name="KEY_DOWN" value="-60"/><define name="KEY_LEFT" value="-61"/><define name="KEY_RIGHT" value="-62"/><define name="KEY_FIRE" value="-26"/><define name="KEY_S1" value="-1"/><define name="KEY_S2" value="-4"/></layout>
  <!-- Common -->
  <!-- Sony Ericsson K800i -->
  <preset name="240x320 (COMMON - full screen)" layout="Nokia"><define name="SCREEN_WIDTH" value="240"/><define name="SCREEN_HEIGHT" value="320"/><define name="FORCE_FULLSCREEN" value="false"/></preset>
  <!-- Nokia -->
  <!-- Nokia 6230i -->
  <preset name="208x208 (Nokia - full screen)" layout="Nokia"><define name="SCREEN_WIDTH" value="208"/><define name="SCREEN_HEIGHT" value="208"/><define name="FORCE_FULLSCREEN" value="true"/></preset>
  <!-- Siemens CX75 -->
  <preset name="132x176 (Siemens - full screen)" layout="Siemens"><define name="SCREEN_WIDTH" value="132"/><define name="SCREEN_HEIGHT" value="176"/><define name="FORCE_FULLSCREEN" value="false"/></preset>
  <!--
  <preset name="commented out" layout="Nokia"><define name="SCREEN_WIDTH" value="1"/><define name="SCREEN_HEIGHT" value="1"/></preset>
  -->
  <preset name="sagem" layout="Sagem"><define name="SCREEN_WIDTH" value="128"/><define name="SCREEN_HEIGHT" value="160"/></preset>
</presets>`;

describe('parsePresets', () => {
  const { presets, defaultName } = parsePresets(SAMPLE);
  it('reads presets, default, sizes, layouts and inherited keys', () => {
    assert.equal(defaultName, '240x320 (COMMON - full screen)');
    assert.deepEqual(presets.map((p) => p.id), ['240x320-common-full-screen', '208x208-nokia-full-screen', '132x176-siemens-full-screen', 'sagem']);
    const sag = presets.find((p) => p.id === 'sagem')!;
    assert.equal(sag.keys.softLeft, -7); // overridden by the Sagem layout
    assert.equal(sag.keys.up, -1); // inherited from parent Nokia
    assert.equal(presets[2]!.keys.fire, -26);
    assert.equal(presets[2]!.layout, 'siemens');
  });
  it('takes the model from the nearest preceding comment, ignores commented-out presets', () => {
    assert.equal(presets[1]!.model, 'Nokia 6230i');
    assert.equal(presets[2]!.model, 'Siemens CX75');
    assert.ok(!presets.some((p) => p.name === 'commented out'));
  });
  it('only sets a platform string for specific vendors, never for COMMON presets', () => {
    assert.equal(presets[0]!.vendor, 'common');
    assert.equal(presets[0]!.platform, null);
    assert.equal(presets[1]!.platform, 'Nokia6230i');
    assert.equal(presets[1]!.forceFullscreen, true);
  });
  it('recommends by screen hint and platform family', () => {
    assert.equal(recommendPreset(presets, { family: 'nokia', screens: [{ width: 208, height: 208 }] })?.id, '208x208-nokia-full-screen');
    assert.equal(recommendPreset(presets, { family: 'siemens', screens: [] })?.id, '132x176-siemens-full-screen');
    assert.equal(recommendPreset(presets, { family: 'generic', screens: [] }), null);
  });
  it('slug is stable', () => assert.equal(slug('176x204 (Motorola V300)'), '176x204-motorola-v300'));
});

describe('real KEmulator presets (needs the built emulator)', { skip: !existsSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../runtime/build/kemulator/KEmulator.jar')) }, () => {
  it('parses all 59 presets from the pinned build with unique ids', () => {
    const kem = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../runtime/build/kemulator');
    const { presets, defaultName } = loadDevicePresets(kem);
    assert.equal(presets.length, 59);
    assert.equal(new Set(presets.map((p) => p.id)).size, 59);
    assert.ok(presets.some((p) => p.name === defaultName));
    assert.ok(presets.every((p) => p.width >= 64 && p.height >= 64 && p.keys.fire !== 0));
  });
});
