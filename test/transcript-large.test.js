import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// a throw-away home folder, never the real sessions
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-home-'));
process.env.HOME = HOME; process.env.USERPROFILE = HOME;   // Windows finds the home folder through USERPROFILE
const { claudeTranscript } = await import('../server/sources/claude.js');

test('a session file over 30 MB still shows its newest message', () => {
  const dir = path.join(HOME, '.claude', 'projects', 'p'); fs.mkdirSync(dir, { recursive: true });
  const line = (i, role) => JSON.stringify({ type: role, timestamp: new Date(1e12 + i * 1000).toISOString(), message: { content: [{ type: 'text', text: `message ${i} ` + 'x'.repeat(2000) }] } }) + '\n';
  const lines = []; for (let i = 0; i < 16000; i++) lines.push(line(i, i % 2 ? 'assistant' : 'user'));
  fs.writeFileSync(path.join(dir, 'big-session.jsonl'), lines.join(''));
  assert.ok(fs.statSync(path.join(dir, 'big-session.jsonl')).size > 30 * 1024 * 1024);
  const msgs = claudeTranscript('big-session');
  const last = msgs.at(-1).blocks[0].text;
  assert.ok(last.startsWith('message 15999 '), last.slice(0, 20));
  fs.rmSync(HOME, { recursive: true, force: true });
});
