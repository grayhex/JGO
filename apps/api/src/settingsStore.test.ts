import assert from 'node:assert/strict';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { SettingsStore, SKIN_IDS, mergeSettings, defaultSettings, validateApiKey } from './settingsStore.js';
import { testConfig } from './testing.js';

describe('settings store', () => {
  it('starts with defaults that match the old behaviour (240x320, Nokia keys, env limits)', () => {
    const cfg = testConfig();
    const s = new SettingsStore(cfg.dataDir, cfg, {});
    const g = s.get();
    assert.deepEqual([g.phone.width, g.phone.height, g.phone.layout, g.phone.heapMb], [240, 320, 'nokia', 256]);
    assert.equal(g.libraryPath, null);
    assert.equal(g.server.maxSessions, cfg.maxSessions);
    assert.equal(s.setup().status, 'pending');
  });

  it('persists, validates and rejects unknown keys', () => {
    const cfg = testConfig();
    const s = new SettingsStore(cfg.dataDir, cfg, {});
    s.update({ audio: { volume: 30 }, phone: { skinId: 'nokia-e71' } });
    const again = new SettingsStore(cfg.dataDir, testConfig({ dataDir: cfg.dataDir }), {});
    assert.equal(again.get().audio.volume, 30);
    assert.equal(again.get().phone.skinId, 'nokia-e71');
    assert.equal(again.get().audio.enabled, true, 'untouched values keep their default');
    for (const bad of [{ nope: 1 }, { audio: { volume: 101 } }, { audio: { loud: 1 } }, { phone: { skinId: '../x' } }, { phone: { width: 5000 } }, { libraryPath: 'relative' }, { server: { maxSessions: 0 } }, 'x', null]) {
      assert.throws(() => s.update(bad), /./, JSON.stringify(bad));
    }
    assert.equal(s.get().audio.volume, 30, 'a rejected patch changes nothing');
  });

  it('only pins server values that differ from the environment, so editing jgo.env keeps working', () => {
    const cfg = testConfig();
    const s = new SettingsStore(cfg.dataDir, cfg, {});
    s.update({ server: { maxSessions: cfg.maxSessions, sessionIdleMinutes: 17 } });
    const file = JSON.parse(readFileSync(s.file, 'utf8'));
    assert.deepEqual(file.settings.server, { sessionIdleMinutes: 17 });
    assert.equal(cfg.sessionIdleMs, 17 * 60_000, 'applied to the running config');
    const cfg2 = testConfig({ dataDir: cfg.dataDir, maxSessions: 3 });
    const s2 = new SettingsStore(cfg.dataDir, cfg2, {});
    assert.equal(s2.get().server.maxSessions, 3, 'the new environment value is used');
    assert.equal(s2.get().server.sessionIdleMinutes, 17);
  });

  it('keeps the API key in a separate 0600 file and never in settings.json', () => {
    const cfg = testConfig();
    const s = new SettingsStore(cfg.dataDir, cfg, {});
    assert.equal(s.mobygamesInfo().configured, false);
    s.setMobygamesKey('moby_SECRETKEY12345');
    assert.equal(s.mobygamesKey(), 'moby_SECRETKEY12345');
    assert.deepEqual(s.mobygamesInfo(), { configured: true, hint: '…2345', source: 'stored' });
    s.update({ audio: { volume: 10 } });
    assert.ok(!readFileSync(s.file, 'utf8').includes('SECRETKEY'));
    assert.ok(readFileSync(s.secretsFile, 'utf8').includes('SECRETKEY'));
    assert.equal(statSync(s.secretsFile).mode & 0o777, 0o600);
    assert.equal(statSync(s.file).mode & 0o777, 0o600);
    assert.ok(!readdirSync(cfg.dataDir).some((f) => f.endsWith('.tmp')), 'no temp files left behind');
    s.setMobygamesKey(null);
    assert.equal(s.mobygamesInfo().configured, false);
  });

  it('an environment key is used when none is stored, and a stored one wins', () => {
    const cfg = testConfig();
    const s = new SettingsStore(cfg.dataDir, cfg, { MOBYGAMES_API_KEY: 'moby_envkey_1234' });
    assert.deepEqual(s.mobygamesInfo(), { configured: true, hint: '…1234', source: 'environment' });
    s.setMobygamesKey('moby_stored_5678');
    assert.equal(s.mobygamesKey(), 'moby_stored_5678');
  });

  it('rejects keys that could break a URL or header', () => {
    for (const k of ['', 'short', 'has space 12345', 'a&b=c1234567', 'x\n1234567890', 'é'.repeat(10), 'a'.repeat(201)]) assert.throws(() => validateApiKey(k), /API key/, JSON.stringify(k));
    assert.equal(validateApiKey('  moby_ok_123456  '), 'moby_ok_123456');
  });

  it('an existing installation with games is not shown the wizard', () => {
    const cfg = testConfig();
    const s = new SettingsStore(cfg.dataDir, cfg, {});
    s.markLegacyIfPopulated(5);
    assert.deepEqual([s.setup().status, s.setup().legacy], ['completed', true]);
    // ...but a fresh install is, and a later start does not change a decision made by the user
    const fresh = testConfig();
    const f = new SettingsStore(fresh.dataDir, fresh, {});
    f.markLegacyIfPopulated(0);
    assert.equal(f.setup().status, 'pending');
    f.setSetup('skipped');
    const f2 = new SettingsStore(fresh.dataDir, testConfig({ dataDir: fresh.dataDir }), {});
    f2.markLegacyIfPopulated(9);
    assert.equal(f2.setup().status, 'skipped');
  });

  it('a settings file written by an older version (fewer fields, corrupt) still loads', () => {
    const cfg = testConfig();
    writeFileSync(path.join(cfg.dataDir, 'settings.json'), JSON.stringify({ version: 1, setup: { status: 'completed' }, settings: { audio: { volume: 5 } } }));
    const s = new SettingsStore(cfg.dataDir, cfg, {});
    assert.equal(s.get().audio.volume, 5);
    assert.equal(s.get().audio.enabled, true);
    assert.equal(s.setup().status, 'completed');
    writeFileSync(path.join(cfg.dataDir, 'settings.json'), '{not json');
    assert.equal(new SettingsStore(cfg.dataDir, testConfig({ dataDir: cfg.dataDir }), {}).get().phone.skinId, 'nokia-n95');
  });

  it('merge keeps the base when the patch is empty; skin list matches the shipped skins', () => {
    const d = defaultSettings({ maxSessions: 1, sessionMaxMinutes: 120, sessionIdleMinutes: 5, libraryQuotaMb: 4096, frameEncoding: 'deflate' });
    assert.deepEqual(mergeSettings(d, {}), d);
    const shipped = readdirSync(path.resolve(import.meta.dirname, '../../web/public/phones'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
    assert.deepEqual([...SKIN_IDS].sort(), shipped);
  });
});
