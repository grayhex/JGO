import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cleanTitle, cleanVendor } from './title.js';

describe('cleanTitle', () => {
  it('drops release groups and sites', () => {
    const cases: [string, string][] = [
      ['Asphalt 3 **MASYAKA**', 'Asphalt 3'],
      ['**MASYAKA** Prince of Persia', 'Prince of Persia'],
      ['Bounce Tales -zub-', 'Bounce Tales'],
      ['Real Football 2009 terjef', 'Real Football 2009'],
      ['Tetris (dedomil.net)', 'Tetris'],
      ['Tetris dedomil.net', 'Tetris'],
      ['Sims 3 [sefan.ru]', 'Sims 3'],
      ['[NP] Block Breaker', 'Block Breaker'],
      ['Gangstar x-mobila', 'Gangstar'],
      ['Gangstar - X-Mobila', 'Gangstar'],
      ['Rally -FreeZone-', 'Rally'],
      ['Mini Golf by freezone', 'Mini Golf'],
      ['Nokia Game (240x320)', 'Nokia Game'],
    ];
    for (const [raw, want] of cases) assert.equal(cleanTitle(raw), want, raw);
  });

  it('leaves real titles alone', () => {
    for (const t of ['Prince of Persia: The Two Thrones', 'Brothers in Arms 2: Global Front', 'Asphalt 6: Adrenaline', 'Zub Zero', "Assassin's Creed II", 'Tom Clancy’s Splinter Cell (Chaos Theory)', 'Cube-Runner', 'Space Invaders - Classic', 'SimCity', 'NBA Live 08']) {
      assert.equal(cleanTitle(t), t, t);
    }
  });

  it('turns file-name style words into titles', () => {
    assert.equal(cleanTitle('ExtremeAirSnowboarding3D'), 'Extreme Air Snowboarding 3D');
    assert.equal(cleanTitle('Rayman3'), 'Rayman 3');
    assert.equal(cleanTitle('NFSUnderground2'), 'NFS Underground 2');
    assert.equal(cleanTitle('Extreme_Air_Snowboarding_3D'), 'Extreme Air Snowboarding 3D');
    assert.equal(cleanTitle('PrinceOfPersia'), 'Prince Of Persia');
    assert.equal(cleanTitle('tetris'), 'Tetris');
    assert.equal(cleanTitle('asphalt3'), 'Asphalt 3');
    assert.equal(cleanTitle('ExtremeAirSnowboarding3D -zub-'), 'Extreme Air Snowboarding 3D');
  });

  it('never returns an empty title', () => {
    assert.equal(cleanTitle('**MASYAKA**'), '**MASYAKA**');
    assert.equal(cleanTitle('   '), '');
  });

  it('cleans vendors too', () => {
    assert.equal(cleanVendor('Gameloft SA by dedomil.net'), 'Gameloft SA');
    assert.equal(cleanVendor('Gameloft SA'), 'Gameloft SA');
    for (const v of ['j2me-web', 'iGames', 'Test Vendor', 'Hands-On Mobile', 'in2games']) assert.equal(cleanVendor(v), v, 'a vendor is a name: it is not split into words');
  });
});
