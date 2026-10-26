import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(process.cwd(), '.codex-test-'));
process.env.AGENT_WORLD_CODEX_SESSIONS_DIR = path.join(root, 'sessions');
process.env.AGENT_WORLD_CODEX_ARCHIVED_DIR = path.join(root, 'archived_sessions');
process.env.AGENT_WORLD_TRASH_DIR = path.join(root, 'trash');
const { listCodex, codexFile, codexTranscript, codexDetail } = await import('../server/sources/codex.js');
const { trashSession, restoreSession, listTrash, emptyTrash } = await import('../server/trash.js');
const { parseRuns, applyRuns } = await import('../server/runs.js');
after(() => fs.rmSync(root, { recursive: true, force: true }));
const now = Date.now();
const event = (type, payload, ts = now - 1000) => JSON.stringify({ type, timestamp: new Date(ts).toISOString(), payload });
function fixture(id, extra = [], archived = false, cwd = '/fake/project') {
  const dir = path.join(archived ? process.env.AGENT_WORLD_CODEX_ARCHIVED_DIR : process.env.AGENT_WORLD_CODEX_SESSIONS_DIR, '2026', '01', '02');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `rollout-2026-01-02-${id}.jsonl`);
  fs.writeFileSync(file, [event('session_meta', { id, cwd, git: { branch: 'feature' } }),
    event('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>fake</environment_context>' }] }),
    'broken JSON', event('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Make a sample widget' }] }), ...extra].join('\n'));
  fs.utimesSync(file, new Date(now - 1000), new Date(now - 1000));
  return file;
}

test('lists nested and archived rollouts, extracts title and metadata, ignores missing cwd and broken lines', () => {
  fixture('list', [event('turn_context', { model: 'sample-model' })]);
  fixture('archived', [], true);
  fixture('no-cwd', [], false, null);
  const s = listCodex(now).find(s => s.id === 'list');
  assert.equal(s.key, 'codex:list'); assert.equal(s.tool, 'codex');
  assert.equal(s.title, 'Make a sample widget'); assert.equal(s.cwd, '/fake/project');
  assert.equal(s.branch, 'feature'); assert.equal(s.model, 'sample-model');
  assert.equal(s.lastActivity, now - 1000);
  assert.ok(listCodex(now).some(s => s.id === 'archived'));
  assert.ok(!listCodex(now).some(s => s.id === 'no-cwd'));
  assert.equal(codexFile('../escape'), null);
});

test('transcript and detail expose user, assistant and short tool blocks without duplicate event messages', () => {
  fixture('transcript', [event('event_msg', { type: 'user_message', message: 'Make a sample widget' }),
    event('response_item', { type: 'function_call', name: 'exec_command', call_id: 'call-1', arguments: '{"cmd":"pwd"}' }),
    event('response_item', { type: 'function_call_output', call_id: 'call-1', output: '/fake/project' }),
    event('response_item', { type: 'custom_tool_call', name: 'apply_patch', call_id: 'call-2', input: 'fake patch' }),
    event('response_item', { type: 'custom_tool_call_output', call_id: 'call-2', output: 'done' }),
    event('response_item', { type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'Widget ready' }] })]);
  const messages = codexTranscript('transcript');
  assert.deepEqual(messages.map(m => m.role), ['user', 'assistant']);
  assert.equal(messages[1].blocks[0].summary, 'exec_command · pwd');
  assert.equal(messages[1].blocks[0].result, '/fake/project');
  assert.equal(messages[1].blocks[1].result, 'done');
  assert.equal(messages[1].blocks[2].text, 'Widget ready');
  assert.ok(codexDetail('transcript').some(b => b.kind === 'tool'));
  assert.ok(codexTranscript('transcript', 2, { textOnly: true, full: true }).every(m => m.blocks.every(b => b.type === 'text')));
  assert.equal(codexTranscript('missing').length, 0);
});

test('uses shared status rules, caps working at recent writes and recognizes live resume processes', () => {
  fixture('working', [event('event_msg', { type: 'task_started' })]);
  fixture('done', [event('event_msg', { type: 'task_complete' })]);
  fixture('permission', [event('response_item', { type: 'function_call', name: 'tool', call_id: 'pending' }, now - 20000)]);
  const sessions = listCodex(now);
  assert.equal(sessions.find(s => s.id === 'working').status, 'working');
  assert.equal(sessions.find(s => s.id === 'done').status, 'needs');
  assert.equal(sessions.find(s => s.id === 'permission').status, 'needs');
  assert.equal(listCodex(now + 61000).find(s => s.id === 'working').status, 'sleeping');
  assert.equal(listCodex(now + 61000).find(s => s.id === 'done').status, 'sleeping');
  const runs = parseRuns('/opt/bin/codex resume working\ncodex exec resume done\necho codex resume permission');
  assert.deepEqual([...runs.codexIds], ['working', 'done']);
  applyRuns(sessions, runs, now + 3600000);
  assert.equal(sessions.find(s => s.id === 'working').status, 'working');
});

test('trash and restore preserve rollout filename and bytes, refuse collisions', async () => {
  const file = fixture('trash', [], true), bytes = fs.readFileSync(file);
  const s = listCodex(now).find(s => s.id === 'trash');
  const result = await trashSession(s); assert.equal(result.ok, true);
  assert.ok(!fs.existsSync(file)); assert.equal(codexFile('trash'), null);
  assert.ok(listTrash().some(m => m.sessionId === 'trash'));
  fs.writeFileSync(file, 'collision');
  assert.equal((await restoreSession(result.trashId)).ok, false);
  assert.equal(fs.readFileSync(file, 'utf8'), 'collision');
  fs.unlinkSync(file);
  assert.deepEqual(await restoreSession(result.trashId), { ok: true });
  assert.deepEqual(fs.readFileSync(file), bytes);
  assert.equal(codexFile('trash'), file);
  assert.ok(!listTrash().some(m => m.sessionId === 'trash'));
});

test('streaming handles chunk boundaries, huge lines, bounded transcripts and cache invalidation', () => {
  const file = fixture('large');
  fs.appendFileSync(file, '\n' + 'x'.repeat(8_100_000) + '\n');
  for (let i = 0; i < 20; i++) fs.appendFileSync(file, event('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'sample ' + i + '界'.repeat(22000) }] }) + '\n');
  assert.equal(codexTranscript('large', 3).length, 3);
  assert.ok(!codexTranscript('large', 1)[0].blocks[0].text.includes('�'));
  assert.ok(listCodex(now).some(s => s.id === 'large'));
  fs.appendFileSync(file, event('turn_context', { model: 'updated-model' }));
  assert.equal(listCodex(now).find(s => s.id === 'large').model, 'updated-model');
});

test('source registry provides Terminal resume and snapshot project placement', async () => {
  const { SOURCES, buildSnapshot } = await import('../server/snapshot.js');
  assert.equal(SOURCES.codex.resume({ id: 'list' }), 'codex resume list');
  const snapshot = buildSnapshot(now);
  const s = snapshot.sessions.find(s => s.key === 'codex:list');
  assert.equal(s.projectPath, '/fake/project');
  assert.equal(s.archived, false);
  assert.ok(snapshot.projects.some(p => p.path === '/fake/project'));
});

test('Empty Trash removes a trashed Codex session for good, like any other session (the page asks first)', async () => {
  const file = fixture('emptied', [], true);
  const s = listCodex(now).find(s => s.id === 'emptied');
  assert.equal((await trashSession(s)).ok, true);
  assert.ok(listTrash().some(m => m.sessionId === 'emptied'));
  emptyTrash();
  assert.equal(listTrash().some(m => m.sessionId === 'emptied'), false);
  assert.ok(!fs.existsSync(file));
});

test('a Codex session launched through node is still detected as running', () => {
  assert.ok(parseRuns('node /opt/homebrew/bin/codex exec --skip-git-repo-check -C /fake --sandbox read-only resume wrapped --json -').codexIds.has('wrapped'));
  assert.ok(parseRuns('codex exec --skip-git-repo-check -C /fake --sandbox read-only resume plain --json -').codexIds.has('plain'));
});

test('restore refuses a target outside the Codex sessions folders, even if meta.json says so', async () => {
  const file = fixture('evil-restore');
  const s = listCodex(now).find(s => s.id === 'evil-restore');
  const result = await trashSession(s); assert.equal(result.ok, true);
  const metaFile = path.join(process.env.AGENT_WORLD_TRASH_DIR, result.trashId, 'meta.json');
  const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
  const elsewhere = path.join(root, 'elsewhere', 'stolen.jsonl');
  fs.writeFileSync(metaFile, JSON.stringify({ ...meta, origFile: elsewhere }));
  const r = await restoreSession(result.trashId);
  assert.equal(r.ok, false); assert.ok(!fs.existsSync(elsewhere));
  fs.writeFileSync(metaFile, JSON.stringify(meta));                         // put the true label back: the normal restore still works
  assert.deepEqual(await restoreSession(result.trashId), { ok: true });
  assert.ok(fs.existsSync(file));
});
