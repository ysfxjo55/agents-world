import test from 'node:test';
import assert from 'node:assert/strict';
import { interstellarLayout, familySessions, overviewDistance } from '../public/family-layout.js';

test('entire TARS loop clears the hex edge, seam, disc, station orbit and session houses', () => {
  for (const size of [3, 6.2, 10]) {
    const layout = interstellarLayout(size), route = layout.waypoints, clearance = layout.robotRadius;
    for (let i = 0; i < route.length; i++) for (let j = 0; j <= 100; j++) {
      const a = route[i], b = route[(i + 1) % route.length], t = j / 100;
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      // Signed distances to all six edges of the pointy hex.
      for (let edge = 0; edge < 6; edge++) {
        const angle = edge * Math.PI / 3;
        assert.ok(x * Math.cos(angle) + z * Math.sin(angle) + clearance < size * Math.sqrt(3) / 2);
      }
      assert.ok(x - clearance > -size * Math.sqrt(3) / 2 + size * 0.525 / 6.2);
      const holeDistance = Math.hypot(x - layout.hole.x, z - layout.hole.z);
      assert.ok(holeDistance > layout.discRadius + clearance);
      assert.ok(holeDistance > layout.orbitRadius + layout.stationRadius + clearance);
      const houses = familySessions(80, size, true);
      for (const house of houses.points) {
        assert.ok(Math.hypot(x - house.x, z - house.z) > clearance + houses.radius);
      }
    }
  }
});

test('Overview fits individual plot extents and asymmetric chips at desktop and phone sizes', () => {
  const points = [
    { x: -32, y: -12, z: 5 }, { x: 35, y: 14, z: -5 },
    { x: -24, y: 8, z: 3, left: 105, right: 25, top: 15, bottom: 15 },
    { x: 28, y: 10, z: 0, left: 20, right: 110, top: 15, bottom: 15 },
    { x: 0, y: 0, z: 0, left: 150, right: 150 },
  ];
  for (const [width, height] of [[1400, 900], [1100, 900], [390, 844], [360, 800]]) {
    const distance = overviewDistance(points, 38, width, height);
    const scale = height / (2 * Math.tan(19 * Math.PI / 180));
    let closest = Infinity;
    for (const p of points) {
      const x = width / 2 + p.x * scale / (distance - p.z);
      const y = height / 2 - p.y * scale / (distance - p.z);
      const margins = [x - (p.left ?? 0), width - x - (p.right ?? 0), y - (p.top ?? 0), height - y - (p.bottom ?? 0)];
      assert.ok(margins.every(m => m >= 16 - 1e-8));
      closest = Math.min(closest, ...margins);
    }
    // Fit reaches an edge instead of leaving the world tiny at the centre.
    assert.ok(Math.abs(closest - 16) < 1e-8);
  }
});

test('a wide interior chip does not reserve space at unrelated plot edges', () => {
  const edge = [{ x: -40, y: 0, z: 0 }, { x: 40, y: 0, z: 0 }];
  const distance = overviewDistance(edge, 38, 1100, 900);
  assert.equal(overviewDistance([...edge, { x: 0, y: 0, z: 0, left: 200, right: 200 }], 38, 1100, 900), distance);
  assert.ok(overviewDistance([...edge, { x: 40, y: 0, z: 0, right: 120 }], 38, 1100, 900) > distance);
});
