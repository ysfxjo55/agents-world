import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// A fake "opencode" that never prints anything, to prove a hung start is stopped, retried once, and reported.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-fake-'));
const hang = path.join(dir, 'opencode-hang.mjs'); const good = path.join(dir, 'opencode-good.mjs');   // Node fakes, so they also run on Windows
fs.writeFileSync(hang, `import fs from 'node:fs'; fs.appendFileSync(${JSON.stringify(path.join(dir, 'starts.log'))}, process.pid + '\\n'); setTimeout(() => {}, 30000);\n`);
fs.writeFileSync(good, `console.log('{"type":"text","sessionID":"ses_x","part":{"messageID":"m1","text":"hello"}}'); console.log('{"type":"step_finish","sessionID":"ses_x","part":{"reason":"stop","cost":0}}');\n`);
process.env.AGENT_WORLD_OPENCODE_START_MS = '1500';   // generous: starting even a fake shell script can take 400 ms on a busy machine
const { startRun } = await import('../server/chat.js');
const run = (bin, sessionId) => new Promise((resolve) => {
  process.env.AGENT_WORLD_TEST_BIN = bin;
  const events = []; const t0 = Date.now();
  startRun({ tool: 'opencode', sessionId, cwd: dir, text: 'hi', mode: 'readonly', agent: null }, (e) => events.push(e), () => resolve({ events, ms: Date.now() - t0 }));
});

test('a hung OpenCode start on a NEW session is stopped, retried once, then reported (not left hanging)', async () => {
  fs.rmSync(path.join(dir, 'starts.log'), { force: true });
  const { events, ms } = await run(hang, null);
  assert.ok(ms < 8000, `finished in ${ms} ms, not 30 s`);
  assert.equal(fs.readFileSync(path.join(dir, 'starts.log'), 'utf8').trim().split('\n').length, 2, 'it was started twice');
  assert.match(events.find(e => e.t === 'error').text, /did not start.*tried twice/);
});
test('resuming an OLD session is not retried (a retry could send the message twice)', async () => {
  fs.rmSync(path.join(dir, 'starts.log'), { force: true });
  const { events } = await run(hang, 'ses_old');
  assert.equal(fs.readFileSync(path.join(dir, 'starts.log'), 'utf8').trim().split('\n').length, 1, 'started once only');
  assert.match(events.find(e => e.t === 'error').text, /did not start/);
});
test('a healthy OpenCode run is not touched by the watchdog', async () => {
  const { events } = await run(good, null);
  assert.ok(events.some(e => e.t === 'done' && e.ok));
  assert.ok(!events.some(e => e.t === 'error'));
});
