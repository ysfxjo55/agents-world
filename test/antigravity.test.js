import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-agy-'));
process.env.AGENT_WORLD_AGY_LOG_DIR = path.join(dir, 'log');
const { buildAgyArgs, startRun } = await import('../server/chat.js');
const { sessionFromRow, readSummaries, antigravityTranscript } = await import('../server/sources/antigravity.js');
const { parseRuns, applyRuns } = await import('../server/runs.js');
const { detectEngines } = await import('../server/engines.js');
const { RunUsage } = await import('../server/usage-ledger.js');

test('agy arguments: print mode with stream-json, our access levels map to its modes, resume by conversation id', () => {
  assert.deepEqual(buildAgyArgs({ text: 'hi', mode: 'readonly' }), ['-p', 'hi', '--output-format', 'stream-json', '--mode', 'plan', '--sandbox']);
  assert.deepEqual(buildAgyArgs({ text: 'hi', mode: 'full', sessionId: 'abc-123' }).slice(4), ['--mode', 'auto', '--dangerously-skip-permissions', '--conversation', 'abc-123']);
  assert.equal(buildAgyArgs({ text: '-rf', mode: 'edits' })[1], ' -rf');        // never read as a flag
  assert.throws(() => buildAgyArgs({ text: 'x', mode: 'nope' }));
});

test('a chat with a fake agy streams the reply, starts the session key, and keeps a local copy of the turn', async () => {
  const bin = path.join(dir, 'agy-fake.mjs'), argsFile = path.join(dir, 'args.json');
  const lines = [
    { event: 'init', conversation_id: 'conv-1234', init: { cwd: dir } },
    { event: 'step_update', step_update: { conversation_id: 'conv-1234', step_index: 0, state: 'DONE', step_type: 'user_input' } },
    { event: 'step_update', step_update: { conversation_id: 'conv-1234', step_index: 1, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'Hello' } },
    { event: 'step_update', step_update: { conversation_id: 'conv-1234', step_index: 1, state: 'DONE', step_type: 'agent_response', text_delta: ' there' } },
    { event: 'result', result: { conversation_id: 'conv-1234', status: 'SUCCESS', response: 'Hello there', usage: { input_tokens: 10, output_tokens: 2, thinking_tokens: 1, cache_read_tokens: 4 } } },
  ];
  fs.writeFileSync(bin, `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)));\nprocess.stdout.write(${JSON.stringify(lines.map(l => JSON.stringify(l)).join('\n') + '\n')});\n`);
  process.env.AGENT_WORLD_TEST_AGY_BIN = bin;
  try {
    const events = await new Promise((resolve) => { const ev = []; startRun({ tool: 'antigravity', sessionId: null, cwd: dir, text: 'say hello', mode: 'readonly', agent: null }, (e) => ev.push(e), () => resolve(ev)); });
    assert.equal(events.find(e => e.t === 'start').key, 'antigravity:conv-1234');
    assert.equal(events.filter(e => e.t === 'delta').map(e => e.text).join(''), 'Hello there');
    assert.deepEqual(events.find(e => e.t === 'done'), { t: 'done', ok: true, denied: [], error: null });
    assert.deepEqual(JSON.parse(fs.readFileSync(argsFile, 'utf8')).slice(0, 4), ['-p', 'say hello', '--output-format', 'stream-json']);
    const t = antigravityTranscript('conv-1234');
    assert.equal(t[0].blocks[0].type, 'notice');                                   // says the full history stays in agy
    assert.deepEqual(t.slice(1).map(m => [m.role, m.blocks[0].text]), [['user', 'say hello'], ['assistant', 'Hello there']]);
  } finally { delete process.env.AGENT_WORLD_TEST_AGY_BIN; }
});

test('a failed agy turn shows its reason in red', async () => {
  const bin = path.join(dir, 'agy-fail.mjs');
  fs.writeFileSync(bin, `process.stdout.write(JSON.stringify({ event: 'init', conversation_id: 'conv-9999' }) + '\\n' + JSON.stringify({ event: 'result', result: { conversation_id: 'conv-9999', status: 'ERROR', error: 'quota exceeded' } }) + '\\n');\n`);
  process.env.AGENT_WORLD_TEST_AGY_BIN = bin;
  try {
    const events = await new Promise((resolve) => { const ev = []; startRun({ tool: 'antigravity', sessionId: 'conv-9999', cwd: dir, text: 'x', mode: 'readonly', agent: null }, (e) => ev.push(e), () => resolve(ev)); });
    assert.deepEqual(events.find(e => e.t === 'done'), { t: 'done', ok: false, denied: [], error: 'quota exceeded' });
  } finally { delete process.env.AGENT_WORLD_TEST_AGY_BIN; }
});

test('conversations come from conversation_summaries.db as world blocks with folder, title and status', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { pathToFileURL } = await import('node:url');
  const proj = path.join(dir, 'proj'), uri = pathToFileURL(proj).href;   // a real folder on this system (Windows: file:///C:/...)
  const file = path.join(dir, 'conversation_summaries.db'), db = new DatabaseSync(file);
  db.exec('CREATE TABLE conversation_summaries (conversation_id text, title text, preview text, last_modified_time datetime, last_user_input_time datetime, workspace_uris text, status text)');
  const ins = db.prepare('INSERT INTO conversation_summaries VALUES (?,?,?,?,?,?,?)');
  ins.run('869bf516-01a4-4b85-98c3-e3385e06030c', 'Replying With One', 'p', '2026-10-27 03:01:36.510062+00:00', '2026-10-27 03:01:32.83683+00:00', JSON.stringify([uri]), 'CASCADE_RUN_STATUS_IDLE');
  ins.run('bad id!', 'x', 'p', '2026-10-27 03:01:36+00:00', '', JSON.stringify([uri]), '');
  db.close();
  const rows = readSummaries(file); assert.equal(rows.length, 2);
  const now = Date.parse('2026-10-27T03:02:00Z');
  const s = sessionFromRow(rows[0], now);
  assert.deepEqual([s.key, s.tool, s.title, s.cwd, s.status, s.lastActivity], ['antigravity:869bf516-01a4-4b85-98c3-e3385e06030c', 'antigravity', 'Replying With One', proj, 'needs', Date.parse('2026-10-27T03:01:36.510Z')]);
  assert.equal(sessionFromRow(rows[1], now), null);                                 // unsafe ids are skipped
  assert.equal(sessionFromRow({ ...rows[0], status: 'CASCADE_RUN_STATUS_RUNNING' }, now).status, 'working');
  assert.deepEqual(readSummaries(path.join(dir, 'missing.db')), []);
});

test('a running agy is noticed; agy is found and its Google sign-in recognised', () => {
  const r = parseRuns('/Users/me/.local/bin/agy -p hi --output-format stream-json --conversation conv-1234');
  assert.deepEqual([...r.antigravityIds], ['conv-1234']);
  const sessions = [{ tool: 'antigravity', id: 'conv-1234', status: 'sleeping', lastActivity: 1 }]; applyRuns(sessions, r, 1000);
  assert.equal(sessions[0].status, 'working');
  const files = new Set(['/h/.local/bin/agy', '/h/.gemini/oauth_creds.json']);
  assert.deepEqual(detectEngines({ env: { PATH: '' }, platform: 'darwin', home: '/h', exists: (f) => files.has(f), read: () => '{}' }).antigravity, { installed: true, dir: '/h/.local/bin', onPath: true, loggedIn: true });
  const win = detectEngines({ env: { Path: '', LOCALAPPDATA: 'C:\\Users\\Sam\\AppData\\Local' }, platform: 'win32', home: 'C:\\Users\\Sam', userPath: '', exists: (f) => f === 'C:\\Users\\Sam\\AppData\\Local\\agy\\bin\\agy.exe', read: () => '{}' });
  assert.equal(win.antigravity.dir, 'C:\\Users\\Sam\\AppData\\Local\\agy\\bin');   // Antigravity's Windows install folder
});

test('usage: an agy result counts input, cached and output (with thinking) tokens', () => {
  const rows = []; const u = new RunUsage({ tool: 'antigravity' }, (r) => rows.push(r));
  u.observe({ event: 'result', result: { conversation_id: 'conv-1', status: 'SUCCESS', usage: { input_tokens: 10, output_tokens: 2, thinking_tokens: 1, cache_read_tokens: 4 } } });
  const row = u.finish();
  assert.deepEqual([row.inputTokens, row.cachedInputTokens, row.outputTokens, row.reasoningTokens], [10, 4, 3, 1]);
  fs.rmSync(dir, { recursive: true, force: true });
});
