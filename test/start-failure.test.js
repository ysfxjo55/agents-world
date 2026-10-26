import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startRun } from '../server/chat.js';
import { FamilyChat } from '../server/family.js';

const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('callback failures kill every engine before releasing the run', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'start-failure-'));
  const bin = path.join(dir, 'hang');
  fs.writeFileSync(bin, `#!/bin/sh\nprintf '%s\\n' '{"type":"thread.started","thread_id":"test"}' '{"type":"step_start","sessionID":"test"}'\nexec sleep 30\n`, { mode: 0o755 });
  try {
    for (const tool of ['claude', 'codex', 'opencode']) {
      const env = tool === 'opencode' ? 'AGENT_WORLD_TEST_BIN' : `AGENT_WORLD_TEST_${tool.toUpperCase()}_BIN`;
      process.env[env] = bin;
      for (const event of ['start', ...(tool === 'claude' ? [] : ['status'])]) {
        let run;
        const error = new Error('callback failed');
        try {
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('child leaked')), 3000);
            try {
              run = startRun({ tool, agent: null, sessionId: null, cwd: dir, text: 'hi', mode: 'readonly' }, ev => {
                if (ev.t === event) throw error;
              }, (_key, failure) => {
                clearTimeout(timeout);
                try { assert.equal(failure, error); assert.equal(alive(run.child.pid), false); resolve(null); } catch (e) { reject(e); }
              });
            } catch (e) { clearTimeout(timeout); reject(e); }
          });
        } finally { run?.child.kill('SIGKILL'); }
      }
      delete process.env[env];
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('session persistence failure reports to the page and holds the family lock until exit', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'family-save-failure-'));
  const bin = path.join(dir, 'hang');
  fs.writeFileSync(bin, '#!/bin/sh\nexec sleep 30\n', { mode: 0o755 });
  process.env.AGENT_WORLD_TEST_CLAUDE_BIN = bin;
  const runs = new Map(), events = [];
  let child;
  const family = new FamilyChat({ dir, cwd: dir, runs, runner: (opts, emit, close) => {
    const run = startRun(opts, emit, (...args) => {
      assert.equal(runs.size, 1);
      assert.equal(alive(run.child.pid), false);
      close(...args);
    });
    child = run.child;
    assert.equal(runs.size, 1);
    assert.equal(family.active !== null, true);
    return run;
  } });
  family.saveSession = () => { throw new Error('ENOSPC'); };
  try {
    await family.send({ text: '@bella hello' }, false, ev => events.push(ev));
    assert.equal(alive(child.pid), false);
    assert.equal(runs.size, 0); assert.equal(family.active, null);
    assert.ok(events.some(e => e.t === 'error'));
    assert.equal(events.at(-1).final, true);
  } finally { child?.kill('SIGKILL'); delete process.env.AGENT_WORLD_TEST_CLAUDE_BIN; fs.rmSync(dir, { recursive: true, force: true }); }
});
