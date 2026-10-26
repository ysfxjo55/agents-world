import test from 'node:test';
import assert from 'node:assert/strict';
import { familyOf, lookOf } from '../public/family-look.js';
import { TOOLS, THEMES } from '../public/themes.js';
import { Building, Robot } from '../public/models.js';

test('family follows delegation before engine, with safe missing and unknown fields', () => {
  for (const delegatedBy of ['bella', 'interstellar']) {
    for (const tool of ['claude', 'codex', 'opencode', 'unknown', undefined]) {
      assert.equal(familyOf({ delegatedBy, tool }), delegatedBy);
    }
  }
  for (const delegatedBy of [undefined, 'unknown', null]) {
    assert.equal(familyOf({ delegatedBy, tool: 'claude' }), 'bella');
    assert.equal(familyOf({ delegatedBy, tool: 'codex' }), 'interstellar');
    assert.equal(familyOf({ delegatedBy, tool: 'opencode' }), 'other');
    assert.equal(familyOf({ delegatedBy, tool: 'unknown' }), 'other');
  }
  for (const session of [undefined, null, {}, { delegatedBy: 'unknown' }]) assert.equal(familyOf(session), 'other');
});

test('look returns family colors and preserves other engine colors and the existing fallback', () => {
  const bella = { color: '#ff6fae', accent: '#ffc1dc' };
  const interstellar = { color: '#ffb347', accent: '#ffd9a0' };
  assert.deepEqual(lookOf({ tool: 'claude' }), bella);
  assert.deepEqual(lookOf({ tool: 'codex' }), interstellar);
  assert.deepEqual(lookOf({ tool: 'codex', delegatedBy: 'bella' }), bella);
  assert.deepEqual(lookOf({ tool: 'opencode', delegatedBy: 'interstellar' }), interstellar);
  assert.deepEqual(lookOf({ delegatedBy: 'bella' }), bella);
  assert.deepEqual(lookOf({ tool: 'opencode' }), { color: TOOLS.opencode.color, accent: TOOLS.opencode.accent });
  for (const session of [undefined, null, {}, { tool: 'unknown' }]) {
    assert.deepEqual(lookOf(session), { color: TOOLS.claude.color, accent: TOOLS.claude.accent });
  }
  assert.equal(TOOLS.codex.label, 'Codex');
  assert.equal(TOOLS.codex.color, interstellar.color);
});

test('family models build in every theme, preserve status signals, and release their accent materials', () => {
  for (const theme of Object.values(THEMES)) {
    for (const tool of ['claude', 'codex', 'opencode']) {
      const session = { id: 'test', key: 'test', tool }, family = familyOf(session), look = lookOf(session);
      const building = new Building(theme, session), robot = new Robot(look.color, 0.8, family);
      assert.equal(Boolean(building.flag), theme.roof === 'spire' || family !== 'other');
      building.setStatus('working', 1); robot.setStatus('working');
      assert.equal(robot.ballMat.color.getHexString(), '4ade80');
      assert.equal(building.beaconMat.color.getHexString(), '4ade80');
      assert.equal(building.winMat.emissive.getHexString(), family === 'interstellar' ? 'ffd9a0' : 'ffe9b0');
      let disposed = false;
      if (robot.familyMat) robot.familyMat.addEventListener('dispose', () => { disposed = true; });
      robot.dispose(); building.dispose();
      assert.equal(disposed, family !== 'other');
    }
  }
});
