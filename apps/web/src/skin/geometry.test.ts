import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fitBox, hitTest, placeScreen, pointInPolygon, toNormalized } from './geometry';
import { parseHitboxSvg } from './hitboxes';

const sq: [number, number][] = [[0.2, 0.2], [0.4, 0.2], [0.4, 0.4], [0.2, 0.4]];

describe('geometry', () => {
  it('pointInPolygon / hitTest', () => {
    assert.equal(pointInPolygon([0.3, 0.3], sq), true);
    assert.equal(pointInPolygon([0.5, 0.3], sq), false);
    assert.equal(hitTest([{ id: 'a', points: sq }], 0.25, 0.39)?.id, 'a');
    assert.equal(hitTest([{ id: 'a', points: sq }], 0.1, 0.1), null);
  });

  it('fitBox keeps the aspect ratio', () => {
    assert.deepEqual(fitBox({ w: 1000, h: 400 }, 0.5), { w: 200, h: 400 });
    assert.deepEqual(fitBox({ w: 100, h: 400 }, 0.5), { w: 100, h: 200 });
    assert.deepEqual(fitBox({ w: 0, h: 10 }, 0.5), { w: 0, h: 0 });
  });

  it('placeScreen letterboxes instead of stretching', () => {
    const view = { screenRect: { x: 0.25, y: 0.2, width: 0.5, height: 0.25 } };
    // 400x800 box -> window 200x200; a 240x320 framebuffer is taller than wide
    const p = placeScreen(view, { w: 400, h: 800 }, { w: 240, h: 320 }, false);
    assert.equal(p.lcd.width, 200);
    assert.equal(p.lcd.height, 200);
    assert.ok(Math.abs(p.canvas.height - 200) < 1e-9);
    assert.ok(Math.abs(p.canvas.width / p.canvas.height - 240 / 320) < 1e-9, 'ratio of the framebuffer survives');
    assert.ok(p.canvas.left > p.lcd.left, 'pillarboxed on the sides');
    assert.ok(Math.abs(p.canvas.left + p.canvas.width / 2 - (p.lcd.left + p.lcd.width / 2)) < 1e-9, 'centred');
  });

  it('placeScreen integer scaling', () => {
    const view = { screenRect: { x: 0, y: 0, width: 1, height: 1 } };
    assert.equal(placeScreen(view, { w: 500, h: 500 }, { w: 128, h: 128 }, true).scale, 3); // 3.9 -> 3 is below 75%: keeps 3? no: 3/3.9=0.77 -> whole
    assert.equal(placeScreen(view, { w: 380, h: 380 }, { w: 128, h: 128 }, true).scale, 2.96875, '2.97 -> 2 would lose more than a quarter');
    assert.equal(placeScreen(view, { w: 100, h: 100 }, { w: 128, h: 128 }, true).scale, 100 / 128, 'below 1x it never snaps');
  });

  it('toNormalized', () => {
    assert.deepEqual(toNormalized(150, 60, { left: 100, top: 10, width: 100, height: 100 }), [0.5, 0.5]);
    assert.equal(toNormalized(1, 1, { left: 0, top: 0, width: 0, height: 10 }), null);
  });
});

describe('hitboxes.svg', () => {
  const svg = `<svg viewBox="0 0 1 1" preserveAspectRatio="none">
<polygon id="softLeft" points="0.27,0.48 0.48,0.49 0.40,0.50" fill="transparent" pointer-events="all"><title>Left soft key</title></polygon>
<polygon id="d1" points="0.2,0.6 0.3,0.6 0.3,0.7 0.2,0.7" fill="transparent"><title>1</title></polygon>
<polygon id="bad" points="0.2,0.6 1.9,0.6 0.3,0.7"/>
</svg>`;
  it('parses ids, points and titles and drops broken polygons', () => {
    const problems: string[] = [];
    const p = parseHitboxSvg(svg, problems);
    assert.deepEqual(p.map((x) => x.id), ['softLeft', 'd1']);
    assert.equal(p[0]!.label, 'Left soft key');
    assert.equal(p[1]!.points.length, 4);
    assert.equal(problems.length, 1);
  });
});
