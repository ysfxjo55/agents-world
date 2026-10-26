import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildCodexArgs, startRun, chatAccessError, INTERSTELLAR_DIR } from '../server/chat.js';
import { resolveResume } from '../server/delegate.js';
import { parseRuns } from '../server/runs.js';

const dir = fs.mkdtempSync(path.join(process.cwd(), '.codex-chat-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const bin = path.join(dir, 'codex.mjs');   // .mjs: run with Node on every system, Windows too
const fixture = [
  { type: 'thread.started', thread_id: 'thread-a2' },
  { type: 'turn.started' },
  { type: 'item.completed', item: { id: 'unknown', type: 'future_item', value: 1 } },
  { type: 'item.started', item: { id: 'cmd', type: 'command_execution' } },
  { type: 'item.completed', item: { id: 'cmd', type: 'command_execution', command: 'pwd', aggregated_output: 'sample folder', exit_code: 0 } },
  { type: 'item.completed', item: { id: 'answer', type: 'agent_message', text: 'Fixture answer' } },
  { type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 2 } },
];
function fake(events, hang = false, code = 0) {
  fs.writeFileSync(bin, `#!${process.execPath}\nimport fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(path.join(dir, 'args.json'))}, JSON.stringify(process.argv.slice(2)));\nlet input = ''; process.stdin.on('data', d => input += d); process.stdin.on('end', () => {
    if (Object.keys(process.env).some(k => k.startsWith('AGENT_WORLD_'))) process.exit(9);
    if (!input.endsWith('fixture prompt')) process.exit(8);
    process.stdout.write(${JSON.stringify(events.map(e => JSON.stringify(e)).join('\n') + (hang ? '\n' : ''))});
    ${hang ? 'setInterval(() => {}, 1000);' : `process.exitCode = ${code};`}
  });\n`, { mode: 0o755 });
  process.env.AGENT_WORLD_TEST_CODEX_BIN = bin;
}
function run(sessionId = null, stop = false) {
  return new Promise((resolve) => {
    const events = [];
    const r = startRun({ tool: 'codex', sessionId, cwd: dir, text: 'fixture prompt', mode: 'readonly', agent: null }, e => {
      events.push(e); if (stop && e.t === 'start') r.child.kill('SIGTERM');
    }, key => resolve({ events, key }));
  });
}

test('Codex arguments map every mode, keep safety flags before resume and read stdin', () => {
  for (const [mode, sandbox] of Object.entries({ readonly: 'read-only', edits: 'workspace-write', build: 'workspace-write', full: 'danger-full-access' })) {
    assert.deepEqual(buildCodexArgs({ cwd: dir, mode }), ['exec', '-c', 'model_auto_compact_token_limit=120000', '--skip-git-repo-check', '-C', dir, '--sandbox', sandbox, '--json', '-']);
    assert.deepEqual(buildCodexArgs({ cwd: dir, mode, sessionId: 'old', addDirs: ['family'] }), ['exec', '-c', 'model_auto_compact_token_limit=120000', '--skip-git-repo-check', '-C', dir, '--sandbox', sandbox, '--add-dir', 'family', 'resume', 'old', '--json', '-']);
  }
  for (const mode of ['readonly', 'edits', 'build', 'full']) for (const addDirs of [[], ['family'], ['family folder']]) for (const cwd of [dir, path.join(dir, 'space here')]) assert.ok(parseRuns(['codex', ...buildCodexArgs({ cwd, mode, sessionId: 'old', addDirs })].join(' ')).codexIds.has('old'));
});

test('fake Codex maps start, text, commands and done, ignores unknown items and filters environment', async () => {
  fake(fixture);
  const { events, key } = await run();
  assert.equal(key, 'codex:thread-a2');
  assert.equal(events.find(e => e.t === 'start').key, key);
  assert.ok(events.some(e => e.t === 'blocks' && e.blocks.some(b => b.text === 'Fixture answer')));
  assert.ok(events.some(e => e.t === 'blocks' && e.blocks.some(b => b.result === 'sample folder')));
  assert.ok(events.some(e => e.t === 'status' && e.text === 'Running a command'));
  assert.deepEqual(events.at(-1), { t: 'done', ok: true, denied: [] });
  await run('old');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'args.json'), 'utf8')), buildCodexArgs({ cwd: dir, sessionId: 'old', mode: 'readonly' }));
});

test('fake Codex resumes, reports failures and non-zero exits, and stops a live child', async () => {
  for (const type of ['turn.failed', 'error']) {
    fake([{ type, error: { message: 'Fixture failure' } }]);
    assert.match((await run('old')).events.find(e => e.t === 'error').text, /Fixture failure/);
  }
  fake([], false, 3);
  assert.match((await run()).events.find(e => e.t === 'error').text, /code 3/);
  fake([fixture[0]], true);
  const stopped = await run(null, true);
  assert.ok(stopped.events.some(e => e.t === 'done' && e.error === 'Stopped'));
});

test('Interstellar is refused by both other engines before spawning', () => {
  for (const tool of ['claude', 'opencode']) assert.throws(() => startRun({ tool, sessionId: null, cwd: dir, text: 'x', mode: 'readonly', agent: 'interstellar' }, () => {}, () => {}), /Interstellar runs on Codex/);
});

test('chat access guard allows only read-only Codex remotely and Interstellar only on Codex', () => {
  for (const mode of ['edits', 'build', 'full']) {
    const error = chatAccessError({ tool: 'codex', mode, remote: true, agent: null });
    assert.equal(error.status, 403); assert.match(error.error, /read-only/);
  }
  assert.equal(chatAccessError({ tool: 'codex', mode: 'readonly', remote: true, agent: null }), null);
  for (const tool of ['claude', 'opencode']) assert.match(chatAccessError({ tool, mode: 'readonly', remote: false, agent: 'interstellar' }).error, /Interstellar runs on Codex/);
  assert.equal(chatAccessError({ tool: 'codex', mode: 'edits', remote: false, agent: 'interstellar' }), null);
  assert.match(chatAccessError({ tool: 'codex', mode: 'readonly', remote: false, agent: 'bella' }).error, /Claude Code/);
});

test('a missing Interstellar folder gives a clear error before spawning', () => {
  if (!fs.existsSync(INTERSTELLAR_DIR)) assert.throws(() => startRun({ tool: 'codex', sessionId: null, cwd: dir, text: 'x', mode: 'edits', agent: 'interstellar' }, () => {}, () => {}), /Interstellar folder is missing/);
});

test('Codex delegation resumes the same engine and keeps Interstellar in its fixed folder', () => {
  assert.deepEqual(resolveResume({ tool: 'codex', id: 'old', cwd: dir }, null, dir, () => true), { tool: 'codex', sessionId: 'old', cwd: dir, agent: null });
  assert.deepEqual(resolveResume({ tool: 'codex', id: 'interstellar', cwd: INTERSTELLAR_DIR }, dir, dir, () => true), { tool: 'codex', sessionId: 'interstellar', cwd: INTERSTELLAR_DIR, agent: 'interstellar' });
});
