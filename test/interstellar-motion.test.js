import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../public/world.js';
import { interstellarLayout } from '../public/family-layout.js';

function resident() {
  const world = Object.create(World.prototype), layout = interstellarLayout(6.2);
  const root = new THREE.Group(); root.position.set(layout.waypoints[0].x, 0.12, layout.waypoints[0].z);
  const screen = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  world.interstellar = { status: 'idle' }; world.reducedMotion = { matches: false };
  world.camera = new THREE.PerspectiveCamera(); world.camera.position.set(10, 15, 20);
  world.interstellarItem = {
    layout, waypoint: 1, pause: 0, gait: 0, robot: { root },
    body: new THREE.Group(), slabs: Array.from({ length: 4 }, () => new THREE.Group()),
    disc: new THREE.Group(), orbit: new THREE.Group(), stars: new THREE.Group(),
    crown: new THREE.Group(), sign: new THREE.Group(), screen,
    glowM: new THREE.MeshStandardMaterial(), position: new THREE.Vector3(),
  };
  return world;
}

test('TARS translates at walking speed, pauses to wave, then parks at its work stop', () => {
  const world = resident(), it = world.interstellarItem, start = it.robot.root.position.clone();
  world.tickInterstellar(0.1, 0.1);
  assert.ok(Math.abs(it.robot.root.position.distanceTo(start) - 0.032) < 1e-9);
  assert.ok(world.interstellarWorldPos().distanceTo(it.robot.root.position) < 1e-9);
  let waved = false;
  for (let frame = 1; frame < 1800; frame++) {
    world.tickInterstellar(frame / 60, 1 / 60);
    if (it.robot.mode === 'wave') {
      const position = it.robot.root.position.clone();
      world.tickInterstellar(frame / 60, 0);
      assert.equal(position.distanceTo(it.robot.root.position), 0); waved = true;
    }
  }
  assert.ok(waved);
  world.interstellar.status = 'working';
  for (let frame = 0; frame < 1800; frame++) world.tickInterstellar(30 + frame / 60, 1 / 60);
  assert.ok(Math.hypot(it.robot.root.position.x - it.layout.waypoints[0].x, it.robot.root.position.z - it.layout.waypoints[0].z) < 1e-4);
  assert.equal(it.robot.mode, 'hammer');
});

test('reduced motion freezes all transforms while the screen glows slowly', () => {
  const world = resident(), it = world.interstellarItem;
  world.reducedMotion.matches = true;
  const objects = [it.robot.root, it.body, ...it.slabs, it.disc, it.orbit, it.stars, it.crown, it.sign];
  const before = objects.map(o => [...o.position.toArray(), ...o.rotation.toArray()]);
  world.tickInterstellar(10, 1);
  assert.deepEqual(objects.map(o => [...o.position.toArray(), ...o.rotation.toArray()]), before);
  assert.notEqual(it.screen.material.emissiveIntensity, 1);
});

test('home frames actual plot corners and edge chips with its destination camera', () => {
  for (const [width, height] of [[1100, 900], [390, 844]]) {
    const world = Object.create(World.prototype);
    world.host = { clientWidth: width, clientHeight: height };
    world.camera = new THREE.PerspectiveCamera(38, width / height, 0.5, 2000);
    world.controls = {}; world.scene = { fog: {} };
    world.plots = new Map([-30, 0, 38].map((x, i) => [i, {
      target: new THREE.Vector3(x, 0, i * 8), group: { visible: true },
      label: { position: new THREE.Vector3(i === 2 ? 1.8 : 0, 6.6, 0), center: new THREE.Vector2(i === 2 ? 0.15 : 0.5, 0.5) },
      el: { getBoundingClientRect: () => ({ width: 130, height: 30 }) },
    }]));
    world.flyTo = (target, distance) => {
      world.camera.position.copy(target).add(new THREE.Vector3(0.4, 0.58, 0.85).setLength(distance));
      world.camera.lookAt(target); world.camera.updateMatrixWorld();
    };
    world.home();
    for (const plot of world.plots.values()) {
      const anchor = plot.target.clone().add(plot.label.position).project(world.camera);
      const px = (anchor.x + 1) * width / 2, py = (1 - anchor.y) * height / 2;
      assert.ok(px - 130 * plot.label.center.x >= 16 - 1e-8);
      assert.ok(px + 130 * (1 - plot.label.center.x) <= width - 16 + 1e-8);
      assert.ok(py - 15 >= 16 - 1e-8 && py + 15 <= height - 16 + 1e-8);
      for (const x of [-6.2, 6.2]) for (const y of [-9, 7]) for (const z of [-6.2, 6.2]) {
        const point = plot.target.clone().add(new THREE.Vector3(x, y, z)).project(world.camera);
        assert.ok(Math.abs(point.x) <= 1 - 32 / width + 1e-8);
        assert.ok(Math.abs(point.y) <= 1 - 32 / height + 1e-8);
      }
    }
  }
});
