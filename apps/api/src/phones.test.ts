import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { DEFAULT_SETTINGS, EMULATED_DEVICES, PHONE_SKIN_IDS, PHONE_COMPATIBILITY, emulatedDevice, profilesForSkin, selectPhone, nativePhonePlan, skinsForPlatform, sisFormatOf, generationOfOs, type SymbianStatus, type PhoneSkinId } from '@j2me-web/protocol';
import { phoneCatalog } from './phones.js';
import { validateSettings, Library } from './library.js';
import { buildApp } from './server.js';
import { SessionManager } from './sessions.js';
import { makeJar, testConfig } from './dev/testing.js';

const offline: SymbianStatus = { experimental: true, configured: false, reachable: false, emulator: null, firmware: { installed: false, devices: [] }, defaults: {}, inbox: [], disk: null, busy: false, message: null, maxFirmwareBytes: 100000, maxPackageBytes: 100000 };
const installed = (...codes: string[]): SymbianStatus => ({ ...offline, configured: true, reachable: true, firmware: { installed: !!codes.length, devices: codes.map(code => ({ code, manufacturer: 'Nokia', model: code })) } });

describe('readiness for the EKA2L1 core in PR #35', () => {
  it('distinguishes unconfigured, unreachable, no firmware and busy states', () => {
    assert.equal(nativePhonePlan('symbian', DEFAULT_SETTINGS, offline).code, 'symbian_unavailable');
    assert.equal(nativePhonePlan('symbian', DEFAULT_SETTINGS, { ...offline, configured: true }).code, 'symbian_unavailable');
    assert.equal(nativePhonePlan('symbian', DEFAULT_SETTINGS, installed()).code, 'no_firmware');
    assert.equal(nativePhonePlan('symbian', DEFAULT_SETTINGS, { ...installed('RM-84'), busy: true }).code, 'symbian_busy');
  });
  it('uses the explicit device, platform default or single device and refuses ambiguous firmware', () => {
    const status = installed('RM-84', 'RM-596');
    assert.equal(nativePhonePlan('symbian', DEFAULT_SETTINGS, status).code, 'device_required');
    const defaults = { ...status, defaults: { symbian: 'RM-596' } };
    const plan = nativePhonePlan('symbian', DEFAULT_SETTINGS, defaults);
    assert.equal(plan.ready, true); assert.equal(plan.source, 'platform'); assert.equal(plan.deviceId, 'eka2l1-n8');
    const explicit = nativePhonePlan('symbian', { ...DEFAULT_SETTINGS, symbianDevice: 'RM-84' }, defaults);
    assert.equal(explicit.source, 'game'); assert.equal(explicit.deviceId, 'eka2l1-n70');
    assert.equal(nativePhonePlan('symbian', DEFAULT_SETTINGS, installed('RM-84')).source, 'only');
    assert.equal(nativePhonePlan('symbian', { ...DEFAULT_SETTINGS, symbianDevice: 'rm-84' }, status).firmwareCode, 'RM-84');
  });
  it('never substitutes the installed N70 for a requested N8, or equates matching screens with firmware', () => {
    const status = installed('RM-84');
    assert.equal(nativePhonePlan('symbian', { ...DEFAULT_SETTINGS, emulatedDeviceId: 'eka2l1-n8' }, status).code, 'device_missing');
    assert.equal(nativePhonePlan('symbian', { ...DEFAULT_SETTINGS, emulatedDeviceId: 'eka2l1-n8', symbianDevice: 'RM-84' }, status).code, 'firmware_mismatch');
    // a skin of another phone is refused (the suggestion is the phone that matches the installed firmware), never silently run
    const plan = nativePhonePlan('symbian', { ...DEFAULT_SETTINGS, skinId: 'nokia-n8' }, status);
    assert.equal(plan.ready, false); assert.equal(plan.code, 'incompatible_skin'); assert.equal(plan.firmwareCode, 'RM-84'); assert.equal(plan.skinId, 'nokia-n70');
    assert.match(plan.message, /Nokia N8 cannot run .* on Nokia N70/);
    assert.equal(nativePhonePlan('ngage2', DEFAULT_SETTINGS, status).code, 'incompatible_profile');
  });
  it('identifies a known N-Gage firmware and labels an uncatalogued firmware as unverified', () => {
    const plan = nativePhonePlan('ngage', DEFAULT_SETTINGS, installed('RH-29'));
    assert.equal(plan.ready, true); assert.equal(plan.skinId, 'nokia-n-gage-qd');
    const custom = nativePhonePlan('symbian', { ...DEFAULT_SETTINGS, symbianDevice: 'CUSTOM-1' }, installed('CUSTOM-1'));
    assert.equal(custom.ready, true); assert.equal(custom.deviceId, null); assert.ok(custom.warnings.length);
    assert.equal(phoneCatalog([], installed('RM-84')).availability.find(a => a.deviceId === 'eka2l1-n70')?.available, true);
    assert.equal(phoneCatalog([], installed('RM-84')).availability.find(a => a.deviceId === 'eka2l1-n8')?.available, false);
  });
});

describe('independent skins, emulated devices and game platforms', () => {
  it('has unique profile IDs and complete compatibility relations for fifteen skins', () => {
    assert.equal(PHONE_SKIN_IDS.length, 15);
    assert.equal(new Set(EMULATED_DEVICES.map(d => d.id)).size, EMULATED_DEVICES.length);
    assert.deepEqual(Object.keys(PHONE_COMPATIBILITY), [...PHONE_SKIN_IDS]);
    for (const id of PHONE_SKIN_IDS) {
      assert.equal(profilesForSkin(id, 'j2me').length, 1, id);
      for (const deviceId of PHONE_COMPATIBILITY[id]) assert.ok(emulatedDevice(deviceId), deviceId);
    }
  });
  it('reuses each Nokia skin for its real native OS generation', () => {
    const expected = {
      'nokia-n-gage-classic': ['6.1', 176, 208], 'nokia-n-gage-qd': ['6.1', 176, 208],
      'nokia-n70': ['8.1a', 176, 208], 'nokia-5320-xpressmusic': ['9.3', 240, 320],
      'nokia-n95': ['9.2', 240, 320], 'nokia-e71': ['9.2', 320, 240],
      'nokia-5800': ['9.4', 360, 640], 'nokia-n8': ['Symbian³', 360, 640],
    };
    for (const [skinId, [version, width, height]] of Object.entries(expected)) {
      const selection = selectPhone({ skinId: skinId as PhoneSkinId, platform: 'symbian' });
      assert.ok(selection.ok);
      assert.equal(selection.skinId, skinId);
      assert.equal(selection.device.engine, 'eka2l1');
      assert.ok(selection.device.os.includes(String(version)));
      assert.deepEqual(selection.device.screen, { width, height });
    }
  });
  it('does not confuse N-Gage generations or assume all S60 phones support N-Gage 2', () => {
    for (const id of ['nokia-n-gage-classic', 'nokia-n-gage-qd'] as const) {
      assert.ok(selectPhone({ platform: 'ngage', skinId: id }).ok);
      assert.equal(selectPhone({ platform: 'ngage2', skinId: id }).ok, false);
    }
    for (const id of ['nokia-n95', 'nokia-5320-xpressmusic'] as const) assert.ok(selectPhone({ platform: 'ngage2', skinId: id }).ok);
    for (const id of ['nokia-n70', 'nokia-e71', 'nokia-5800', 'nokia-n8'] as const) assert.equal(selectPhone({ platform: 'ngage2', skinId: id }).ok, false);
  });
  it('selects compatible defaults and never substitutes firmware by display resolution', () => {
    const qd = selectPhone({ platform: 'ngage', emulatedDeviceId: 'eka2l1-ngage-qd' });
    assert.ok(qd.ok); assert.equal(qd.skinId, 'nokia-n-gage-qd');
    const native = selectPhone({ platform: 'symbian', screen: { width: 320, height: 240 } });
    assert.ok(native.ok); assert.equal(native.device.id, 'eka2l1-e71');
    assert.equal(selectPhone({ platform: 'symbian', emulatedDeviceId: 'missing' }).ok, false);
    assert.equal(selectPhone({ platform: 'ngage', emulatedDeviceId: 'eka2l1-n70' }).ok, false);
    assert.equal(selectPhone({ platform: 'symbian', skinId: 'nokia-n95', emulatedDeviceId: 'eka2l1-5320' }).ok, false);
    assert.equal(selectPhone({ platform: 'symbian', skinId: 'samsung-s5230' }).ok, false);
  });
  it('S60 and N-Gage games run only on phones that have a Symbian / N-Gage profile: never on a Sony Ericsson, Motorola or Samsung', () => {
    const NOT_NATIVE = ['sony-ericsson-k790i', 'sony-ericsson-k750i', 'sony-ericsson-w995', 'motorola-razr-v3', 'samsung-s5230', 'nokia-6100', 'nokia-6230i'] as const;
    for (const skinId of NOT_NATIVE) {
      for (const platform of ['symbian', 'ngage', 'ngage2'] as const) {
        const plan = nativePhonePlan(platform, { ...DEFAULT_SETTINGS, skinId }, installed('RM-84', 'NEM-4', 'RM-409'));
        assert.equal(plan.ready, false, `${skinId} must not host ${platform}`);
        assert.ok(['incompatible_skin', 'device_required', 'incompatible_profile'].includes(plan.code!), `${skinId}/${platform}: ${plan.code}`);
      }
      // with a firmware the catalog does not know, the skin is still judged by what it can host
      const unknown = nativePhonePlan('symbian', { ...DEFAULT_SETTINGS, skinId, symbianDevice: 'CUSTOM-1' }, installed('CUSTOM-1'));
      assert.equal(unknown.code, 'incompatible_skin');
    }
    assert.equal(nativePhonePlan('symbian', { ...DEFAULT_SETTINGS, skinId: 'nokia-n70' }, installed('RM-84')).ready, true);
    assert.equal(nativePhonePlan('ngage', { ...DEFAULT_SETTINGS, skinId: 'nokia-n-gage-classic' }, installed('NEM-4')).ready, true);
    assert.equal(nativePhonePlan('symbian', { ...DEFAULT_SETTINGS, skinId: 'nokia-n95', symbianDevice: 'CUSTOM-1' }, installed('CUSTOM-1')).ready, true);
    assert.deepEqual(skinsForPlatform('ngage'), ['nokia-n-gage-classic', 'nokia-n-gage-qd']);
    assert.ok(skinsForPlatform('symbian').every((id) => id.startsWith('nokia-')));
    assert.ok(!skinsForPlatform('symbian').includes('sony-ericsson-k790i'));
  });
  it('reads the Symbian generation of a package from its header (as EKA2L1 does) and of a phone from its OS name', () => {
    const head = (uid1: number, uid2: number) => { const b = Buffer.alloc(16); b.writeUInt32LE(uid1, 0); b.writeUInt32LE(uid2, 4); return b; };
    assert.equal(sisFormatOf(head(0x10201a7a, 0)), 'sis9');
    assert.equal(sisFormatOf(head(0x10003a12, 0x1000006d)), 'sis-legacy');
    assert.equal(sisFormatOf(head(0x10003a12, 0x10003a12)), 'sis-legacy');
    assert.equal(sisFormatOf(head(0x0d, 0)), 'sis9-stub');
    assert.equal(sisFormatOf(head(0x12345678, 0x9abcdef0)), 'unknown');
    assert.equal(sisFormatOf(Buffer.alloc(3)), 'unknown');
    for (const [os, gen] of [['Symbian 6.1 / S60 1st Edition', 'legacy'], ['Symbian 8.1a / S60 2nd Edition FP3', 'legacy'], ['Symbian 9.2 / S60 3rd Edition FP1', 'v9'], ['Symbian 9.4 / S60 5th Edition', 'v9'], ['Symbian³', 'v9'], ['Windows', null]] as const) assert.equal(generationOfOs(os), gen, os);
  });
  it('a Symbian 9 package (.sisx) is never run on Symbian 8.x firmware, and the matching firmware is chosen when it is the only one that fits', () => {
    // the real report: Worms World .sisx on a Nokia N70 (RM-84, Symbian 8.1a)
    const n70 = nativePhonePlan('symbian', DEFAULT_SETTINGS, installed('RM-84'), 'sis9');
    assert.equal(n70.ready, false); assert.equal(n70.code, 'incompatible_package'); assert.equal(n70.firmwareCode, 'RM-84');
    assert.match(n70.message, /Symbian 9/); assert.match(n70.message, /Nokia N70/); assert.match(n70.message, /Symbian 8\.1a/);
    // the same firmware accepts an old package
    assert.equal(nativePhonePlan('symbian', DEFAULT_SETTINGS, installed('RM-84'), 'sis-legacy').ready, true);
    // an explicit device that cannot install the package is refused, not silently replaced
    assert.equal(nativePhonePlan('symbian', { ...DEFAULT_SETTINGS, symbianDevice: 'RM-84' }, installed('RM-84', 'RM-159'), 'sis9').code, 'incompatible_package');
    // with several firmware installed, the generation the package needs decides when exactly one fits
    const both = nativePhonePlan('symbian', DEFAULT_SETTINGS, installed('RM-84', 'RM-159'), 'sis9');
    assert.equal(both.ready, true); assert.equal(both.firmwareCode, 'RM-159'); assert.equal(both.source, 'compatible'); assert.equal(both.deviceId, 'eka2l1-n95');
    assert.equal(nativePhonePlan('symbian', DEFAULT_SETTINGS, installed('RM-84', 'NEM-4'), 'sis-legacy').code, 'device_required', 'two old firmware fit: MGO does not guess');
    assert.equal(nativePhonePlan('symbian', DEFAULT_SETTINGS, installed('RM-84', 'RH-29'), 'sis9').code, 'no_compatible_firmware');
    // an unknown package format or an uncatalogued firmware is not judged
    assert.equal(nativePhonePlan('symbian', DEFAULT_SETTINGS, installed('RM-84'), 'unknown').ready, true);
    assert.equal(nativePhonePlan('symbian', { ...DEFAULT_SETTINGS, symbianDevice: 'CUSTOM-1' }, installed('CUSTOM-1'), 'sis9').ready, true);
  });
  it('reports missing runtime profiles even when the requested skin exists', () => {
    for (const device of EMULATED_DEVICES.filter(d => d.engine === 'eka2l1')) {
      const selection = selectPhone({ platform: device.platforms[0]!, emulatedDeviceId: device.id });
      assert.ok(selection.ok);
      assert.equal(nativePhonePlan(device.platforms[0]! as 'symbian', { ...DEFAULT_SETTINGS, skinId: selection.skinId, emulatedDeviceId: device.id }, offline).ready, false);
      assert.equal(phoneCatalog([], offline).availability.find(a => a.deviceId === device.id)?.available, false);
    }
    assert.equal(validateSettings({}).emulatedDeviceId, undefined, 'legacy Java ME defaults still work');
  });
  it('validates and clears explicit profiles without inferring the platform from a skin', () => {
    const old = validateSettings({ skinId: 'nokia-n-gage-classic' });
    assert.equal(old.emulatedDeviceId, undefined);
    assert.throws(() => validateSettings({ emulatedDeviceId: '../firmware' }));
    const s = validateSettings({ emulatedDeviceId: 'eka2l1-ngage-classic' });
    assert.equal(validateSettings({ emulatedDeviceId: null }, s).emulatedDeviceId, undefined);
  });
  it('rejects native launch before replacing a session or touching Java saves', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'jgo-platform-'));
    const cfg = testConfig({ dataDir: root, runDir: path.join(root, 'run') });
    const lib = new Library(root);
    try {
      const game = lib.addPackage(Buffer.from('native test'), 'platform.sis', 'symbian', cfg.libraryQuotaBytes).game;
      const manager = new SessionManager(cfg, lib);
      let touched = false;
      manager.active = () => { touched = true; return []; };
      const before = readdirSync(root, { recursive: true });
      await assert.rejects(manager.create(game, { ...game.settings, skinId: 'nokia-n8' }, 'default'), /Symbian service is not configured/);
      assert.equal(touched, false);
      assert.deepEqual(readdirSync(root, { recursive: true }), before);
    } finally { lib.close(); rmSync(root, { recursive: true, force: true }); }
  });
});

it('persists native selections, rejects forged native launches and exposes authenticated availability without KEmulator', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'jgo-native-api-'));
  const token = 'phone-test-token-0123456789';
  const app = await buildApp(testConfig({ dataDir: root, runDir: path.join(root, 'run'), kemDir: path.join(root, 'missing-kem'), authToken: token }));
  const headers = { authorization: `Bearer ${token}` };
  try {
    assert.equal((await app.fastify.inject({ url: '/api/phones' })).statusCode, 401);
    const catalog = await app.fastify.inject({ url: '/api/phones', headers });
    assert.equal(catalog.statusCode, 200);
    assert.ok(catalog.json().availability.every((a: { available: boolean }) => !a.available));
    const game = app.library.addPackage(Buffer.from('native selection'), 'native.sis', 'symbian', app.cfg.libraryQuotaBytes).game;
    const saved = await app.fastify.inject({ method: 'PATCH', url: `/api/games/${game.id}`, headers, payload: { settings: { skinId: 'nokia-n8', profileMode: 'auto', emulatedDeviceId: 'eka2l1-n8' } } });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json().settings.emulatedDeviceId, 'eka2l1-n8');
    assert.equal(saved.json().settings.width, game.settings.width, 'native selection preserves Java defaults');
    const start = await app.fastify.inject({ method: 'POST', url: '/api/sessions', headers, payload: { gameId: game.id } });
    assert.equal(start.statusCode, 503, start.body);
    assert.equal(start.json().error, 'symbian_unavailable');
    assert.ok(start.json().message.includes('Settings'));
    assert.deepEqual(app.sessions.list(), []);
    const bad = await app.fastify.inject({ method: 'PATCH', url: `/api/games/${game.id}`, headers, payload: { settings: { emulatedDeviceId: EMULATED_DEVICES.find(d => d.engine === 'kemulator')!.id } } });
    assert.equal(bad.statusCode, 400);
    assert.equal(app.library.get(game.id)!.platform, 'symbian');
    // Return to the prior Java configuration without requiring an installed runtime for this edit.
    const java = await app.fastify.inject({ method: 'PATCH', url: `/api/games/${game.id}`, headers, payload: { settings: { emulatedDeviceId: null } } });
    assert.equal(java.statusCode, 200, java.body);
    assert.equal(java.json().settings.emulatedDeviceId, undefined);
  } finally { await app.close(); rmSync(root, { recursive: true, force: true }); }
});
