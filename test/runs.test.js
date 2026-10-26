import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRuns, applyRuns, claudeProcessPattern } from '../server/runs.js';

const ps = [
  '/usr/local/bin/node /Users/me/agent-world/server/index.js',
  'claude -p --output-format stream-json --verbose --resume 11111111-aaaa-bbbb-cccc-222222222222 --permission-mode default',
  '/Users/me/.local/bin/claude -p --output-format stream-json --session-id 33333333-aaaa-bbbb-cccc-444444444444',
  'claude --resume 99999999-aaaa-bbbb-cccc-000000000000',                       // interactive terminal: NOT a headless run
  'opencode run --format json --dir /Users/me/proj -m opencode/big-pickle hello',
  'opencode run --format json --dir /Users/me/other -s ses_abc123 more',
  'opencode',                                                                    // the TUI: not a run
].join('\n');

test('parseRuns finds headless claude runs by session id', () => {
  const r = parseRuns(ps);
  assert.deepEqual([...r.claudeIds].sort(), ['11111111-aaaa-bbbb-cccc-222222222222', '33333333-aaaa-bbbb-cccc-444444444444']);
});
test('parseRuns finds opencode runs by folder and session id, and ignores the TUI', () => {
  const r = parseRuns(ps);
  assert.deepEqual([...r.opencodeDirs].sort(), ['/Users/me/other', '/Users/me/proj']);
  assert.deepEqual([...r.opencodeIds], ['ses_abc123']);
});
test('applyRuns marks live sessions as working and leaves the others', () => {
  const now = Date.now();
  const sessions = [
    { tool: 'claude', id: '11111111-aaaa-bbbb-cccc-222222222222', status: 'sleeping', lastActivity: now - 600_000 },
    { tool: 'claude', id: '99999999-aaaa-bbbb-cccc-000000000000', status: 'sleeping', lastActivity: now - 600_000 },
    { tool: 'opencode', id: 'ses_new', cwd: '/Users/me/proj', status: 'sleeping', lastActivity: now - 300_000 },
    { tool: 'opencode', id: 'ses_old', cwd: '/Users/me/proj', status: 'sleeping', lastActivity: now - 7 * 3600_000 },
  ];
  applyRuns(sessions, parseRuns(ps), now);
  assert.deepEqual(sessions.map(s => s.status), ['working', 'sleeping', 'working', 'sleeping']);
});

test('the "still open in a Terminal" check matches real claude processes only', () => {
  const re = new RegExp(claudeProcessPattern('abc-123'));
  assert.equal(re.test('claude --resume abc-123'), true);
  assert.equal(re.test('/Users/me/.local/bin/claude -p --output-format stream-json --session-id abc-123'), true);
  assert.equal(re.test('/bin/zsh -c /Users/me/agent-world/bin/delegate trash claude:abc-123 --reason test'), false);   // mentions the id, is not claude
  assert.equal(re.test('claude --resume other-id'), false);
  assert.equal(re.test('node server/index.js'), false);
});
