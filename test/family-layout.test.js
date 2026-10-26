import test from 'node:test';
import assert from 'node:assert/strict';
import { familyLayout, familySessions, HOUSE_WIDTH, FAMILY_MIN_SCALE } from '../public/family-layout.js';

test('family hexes touch and clear growing project footprints and fixed neighbours', () => {
  for (const size of [3, 6.2, 10]) for (const count of [0, 1, 7, 120, 400]) {
    const centers = Array.from({ length: count }, (_, i) => ({ x: Math.cos(i * 2.4) * Math.sqrt(i) * size * 2, z: Math.sin(i * 2.4) * Math.sqrt(i) * size * 2 }));
    centers.push({ x: -size * 4, z: 0 }, { x: -size * 5, z: size * 1.56 });
    const layout = familyLayout(size, centers);
    assert.ok(layout.clear);
    assert.ok(Math.abs(layout.interstellar.x - layout.bella.x - Math.sqrt(3) * size) < 1e-10);
    assert.equal(layout.bella.z, layout.interstellar.z);
    assert.deepEqual(layout, familyLayout(size, centers));
  }
});

test('family placement keeps both hexes clear of neighbours on either side of the cluster', () => {
  const size = 6.2;
  const centers = [{ x: 0, z: 0 }, { x: 24, z: 4 }, { x: 18, z: -8 }];
  const layout = familyLayout(size, centers);
  for (const p of [layout.bella, layout.interstellar]) for (const o of centers) {
    assert.ok(Math.hypot(p.x - o.x, p.z - o.z) >= size * 2.04);
  }
});

test('house footprints fit both halves for counts through eighty, shrinking and grouping overflow', () => {
  let shrunk = false, grouped = false;
  for (const size of [3, 6.2, 10]) for (const right of [false, true]) for (let count = 0; count <= 80; count++) {
    const layout = familySessions(count, size, right);
    assert.ok(layout.scale >= FAMILY_MIN_SCALE);
    assert.ok(layout.spacing >= 2 * HOUSE_WIDTH * layout.scale);
    assert.equal(layout.points.length + layout.overflow, count);
    shrunk ||= layout.scale < 0.8;
    grouped ||= layout.overflow > 0;
    const points = [...layout.points, ...(layout.marker ? [layout.marker] : [])];
    points.forEach((p, i) => {
      assert.ok(Math.abs(p.x) >= layout.radius);
      assert.ok(right ? p.x > 0 : p.x < 0);
      assert.ok(Math.hypot(p.x, p.z) + layout.radius <= size * Math.sqrt(3) / 2 + 1e-9);
      for (const q of points.slice(0, i)) assert.ok(Math.hypot(p.x - q.x, p.z - q.z) >= layout.spacing - 1e-9);
    });
  }
  assert.ok(shrunk); assert.ok(grouped);
});
