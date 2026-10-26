import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { SOURCES, buildSnapshot, isInterstellarSession, interstellarSnapshot, guildAgents } from '../server/snapshot.js';
import { INTERSTELLAR_DIR } from '../server/chat.js';
import { parseRuns } from '../server/runs.js';

const session = (id, cwd = INTERSTELLAR_DIR, tool = 'codex') => ({ id, key: `${tool}:${id}`, tool, cwd, lastActivity: 1000, status: 'working' });

test('Interstellar owns the Codex or Claude Code sessions in its exact fixed folder', () => {
  assert.equal(isInterstellarSession(session('own')), true);
  assert.equal(isInterstellarSession(session('normalized', path.join(INTERSTELLAR_DIR, '.'))), true);
  assert.equal(isInterstellarSession(session('child', path.join(INTERSTELLAR_DIR, 'child'))), false);
  assert.equal(isInterstellarSession(session('other', '/other/project')), false);
  assert.equal(isInterstellarSession(session('claude', INTERSTELLAR_DIR, 'claude')), true);       // Interstellar on Claude Code (no Codex installed)
  assert.equal(isInterstellarSession(session('oc', INTERSTELLAR_DIR, 'opencode')), false);
});

test('Interstellar status follows its live Codex run, including silent thinking and stopping', () => {
  const own = session('partner'), other = session('elsewhere', '/other/project');
  const idle = interstellarSnapshot([own, other], parseRuns(''));
  assert.equal(idle.name, 'interstellar'); assert.equal(idle.displayName, 'Interstellar'); assert.equal(idle.color, '#ffb347');
  assert.equal(idle.status, 'idle'); assert.equal(idle.uses, 1); assert.equal(idle.lastUsed, 1000);
  assert.equal(interstellarSnapshot([own, other], parseRuns('codex exec resume partner --json')).status, 'working');
  assert.equal(interstellarSnapshot([own, other], parseRuns('codex exec resume elsewhere --json')).status, 'idle');
  assert.equal(interstellarSnapshot([], parseRuns('')).status, 'idle');
});

test('snapshot groups partner sessions and keeps other tools and projects in place', () => {
  const original = Object.fromEntries(Object.entries(SOURCES).map(([k, v]) => [k, v.list]));
  try {
    for (const src of Object.values(SOURCES)) src.list = () => [];
    SOURCES.codex.list = () => [session('own'), session('other', '/other/project')];
    SOURCES.claude.list = () => [session('claude', '/claude/project', 'claude')];
    const snap = buildSnapshot(2000);
    assert.equal(snap.interstellar.displayName, 'Interstellar');
    assert.equal(snap.sessions.find(s => s.id === 'own').projectPath, '__interstellar__');
    assert.equal(snap.sessions.find(s => s.id === 'other').projectPath, '/other/project');
    assert.equal(snap.sessions.find(s => s.id === 'claude').projectPath, '/claude/project');
    assert.ok(snap.projects.some(p => p.path === '__interstellar__' && p.name === 'Interstellar'));
    assert.ok(!snap.agents.some(a => a.name === 'interstellar'));
  } finally { for (const [k, list] of Object.entries(original)) SOURCES[k].list = list; }
});

test('Guild excludes the three residents and preserves every other agent', () => {
  const names = ['bella', 'deep-researcher', 'interstellar', 'architect', 'builder'];
  assert.deepEqual(guildAgents(names.map(name => ({ name }))).map(a => a.name), ['architect', 'builder']);
});
