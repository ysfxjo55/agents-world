import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { allowedDelegation, resolveResume, ensureWorktree, canTrash } from '../server/delegate.js';

const ok = (requestedMode, maxMode, tool = 'claude') => allowedDelegation({ requestedMode, maxMode, tool }).ok;

test('a read-only chat can start read-only agents (the architect designs, it does not change files)', () => assert.equal(ok('readonly', 'readonly'), true));
test('a read-only chat can NOT start an agent that edits', () => assert.equal(ok('edits', 'readonly'), false));
test('an editing chat can start editing agents but not agents that run commands', () => { assert.equal(ok('edits', 'edits'), true); assert.equal(ok('build', 'edits'), false); assert.equal(ok('full', 'edits'), false); });
test('a build chat can start build agents but not full-access ones', () => { assert.equal(ok('build', 'build'), true); assert.equal(ok('full', 'build'), false); });
test('OpenCode runs commands under its own permissions, so it needs a build chat', () => { assert.equal(ok('readonly', 'readonly', 'opencode'), false); assert.equal(ok('edits', 'edits', 'opencode'), false); assert.equal(ok('edits', 'build', 'opencode'), true); });
test('unknown modes are refused', () => { assert.equal(ok('root', 'edits'), false); assert.equal(ok('edits', 'admin'), false); });
test('the refusal explains what to do', () => assert.match(allowedDelegation({ requestedMode: 'edits', maxMode: 'readonly', tool: 'claude' }).error, /higher access mode/));

const session = { tool: 'opencode', id: 'ses_abc', cwd: '/gone/worktree', agent: 'build' };
test('continuing an old session keeps its own tool and id', () => {
  const r = resolveResume(session, null, '/app', () => false);
  assert.equal(r.tool, 'opencode'); assert.equal(r.sessionId, 'ses_abc');
});
test('if the old folder is gone, the session continues in the fallback folder', () => {
  assert.equal(resolveResume(session, null, '/app', () => false).cwd, '/app');
  assert.equal(resolveResume(session, null, '/app', () => true).cwd, '/gone/worktree');
  assert.equal(resolveResume(session, '/other', '/app', () => true).cwd, '/other');
});
test('only the agent of a Claude session is carried over (OpenCode has none of ours)', () => {
  assert.equal(resolveResume(session, null, '/app', () => true).agent, null);
  assert.equal(resolveResume({ tool: 'claude', id: 'x', cwd: '/a', agent: 'architect' }, null, '/app', () => true).agent, 'architect');
});
test('unknown tools or missing sessions cannot be resumed', () => { assert.equal(resolveResume(null, null, '/app', () => true), null); assert.equal(resolveResume({ tool: 'x', id: 'y', cwd: '/a' }, null, '/app', () => true), null); });

test('a missing sibling worktree is recreated on a new branch from main', () => {
  const calls = [];
  const r = ensureWorktree('/home/me/app-today', '/home/me/app', { exists: () => false, run: (...a) => calls.push(a.join(' ')), link: () => {} });
  assert.deepEqual(r, { made: true, branch: 'wt-today' });
  assert.ok(calls.some(c => c.includes('worktree add /home/me/app-today -b wt-today main')));
});
test('an existing folder is left alone', () => assert.deepEqual(ensureWorktree('/home/me/app-today', '/home/me/app', { exists: () => true, run: () => { throw new Error('no'); } }), { made: false }));
test('only siblings named after the app qualify (no arbitrary folders)', () => {
  const never = () => { throw new Error('must not run'); };
  for (const dir of ['/etc/evil', '/home/me/other-today', '/home/me/app', '/home/me/sub/app-today', '/home/me/app-bad name']) assert.equal(ensureWorktree(dir, '/home/me/app', { exists: () => false, run: never }).refused, true, dir);
});

const prot = ['claude:main', 'claude:history'];
test('Bella can trash sessions only from an editing chat', () => {
  assert.equal(canTrash(['a'], { maxMode: 'readonly', protectedKeys: prot }).ok, false);
  assert.equal(canTrash(['a'], { maxMode: 'edits', protectedKeys: prot }).ok, true);
  assert.equal(canTrash(['a'], { maxMode: 'build', protectedKeys: prot }).ok, true);
});
test('her own thread and the Terminal history are protected, even in a full-access chat', () => {
  assert.equal(canTrash(['claude:main'], { maxMode: 'full', protectedKeys: prot }).ok, false);
  assert.equal(canTrash(['a', 'claude:history'], { maxMode: 'full', protectedKeys: prot }).ok, false);
});
test('at most 5 at a time, and not zero', () => {
  assert.equal(canTrash(['1', '2', '3', '4', '5'], { maxMode: 'edits' }).ok, true);
  assert.equal(canTrash(['1', '2', '3', '4', '5', '6'], { maxMode: 'edits' }).ok, false);
  assert.equal(canTrash([], { maxMode: 'edits' }).ok, false);
  assert.equal(canTrash('a', { maxMode: 'edits' }).ok, false);
});
test('unknown modes cannot trash', () => assert.equal(canTrash(['a'], { maxMode: 'root' }).ok, false));

test('a new project folder gets its own git repo, the brief and a CLAUDE.md; bad or existing names are refused', async () => {
  const { createProject, loadCreated } = await import('../server/newproject.js');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-')), file = path.join(base, 'rec.json');
  const r = createProject({ name: 'my-app', brief: '# Brief\nhello', base, file, git: () => {} });
  assert.equal(r.ok, true); assert.equal(r.path, path.join(base, 'my-app'));
  assert.match(fs.readFileSync(path.join(r.path, 'BRIEF.md'), 'utf8'), /hello/); assert.match(fs.readFileSync(path.join(r.path, 'CLAUDE.md'), 'utf8'), /BRIEF\.md/);
  assert.deepEqual(loadCreated(file), [r.path]);
  assert.equal(createProject({ name: 'my-app', base, file, git: () => {} }).existed, true);            // again: fine, it is hers
  fs.mkdirSync(path.join(base, 'other')); assert.equal(createProject({ name: 'other', base, file, git: () => {} }).ok, false);   // not hers
  for (const bad of ['../x', 'A b', 'x', '', 'a/b']) assert.equal(createProject({ name: bad, base, file, git: () => {} }).ok, false, bad);
});
