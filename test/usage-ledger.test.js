import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RunUsage, readUsage, summarizeUsage, usageRoute, usageDay } from '../server/usage-ledger.js';
import { startRun } from '../server/chat.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bella-usage-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const collect = tool => {
  const rows = [];
  const usage = new RunUsage({ tool, source: 'chat' }, row => rows.push(row));
  return { rows, usage };
};
test('Claude final totals replace message counts and preserve cache categories without double counting', () => {
  const { usage, rows } = collect('claude');
  usage.observe({ type: 'assistant', message: { id: 'message-1', model: 'claude-test', usage: { input_tokens: 10, output_tokens: 2 } } });
  usage.observe({ type: 'result', usage: { input_tokens: 20, cache_read_input_tokens: 100, cache_creation_input_tokens: 30, output_tokens: 12 }, total_cost_usd: .02, modelUsage: { 'claude-test': {} } });
  usage.finish(); usage.finish();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].inputTokens, 150); assert.equal(rows[0].cachedInputTokens, 100); assert.equal(rows[0].cacheWriteTokens, 30);
  assert.equal(rows[0].outputTokens, 12); assert.equal(rows[0].estimatedUsd, .02); assert.equal(rows[0].model, 'claude-test');
});
test('Claude repeated message snapshots use the greatest counts, and modelUsage is a fallback', () => {
  const { usage } = collect('claude');
  for (const n of [2, 4, 3]) usage.observe({ type: 'assistant', message: { id: 'same', usage: { input_tokens: 5, output_tokens: n } } });
  usage.observe({ type: 'result', usage: {}, modelUsage: {} });
  const row = usage.finish({ status: 'stopped' }); assert.equal(row.outputTokens, 4); assert.equal(row.inputTokens, 5);
  const fallback = collect('claude').usage;
  fallback.observe({ type: 'result', modelUsage: { one: { inputTokens: 5, cacheReadInputTokens: 20, outputTokens: 2 }, two: { inputTokens: 3, cacheCreationInputTokens: 7, outputTokens: 4 } } });
  const result = fallback.finish(); assert.equal(result.inputTokens, 35); assert.equal(result.outputTokens, 6); assert.equal(result.model, 'multiple');
});
test('Codex input already includes cache and output includes reasoning; duplicate terminal events are ignored', () => {
  const { usage } = collect('codex');
  const event = { type: 'turn.completed', usage: { input_tokens: 120, cached_input_tokens: 100, output_tokens: 30, reasoning_output_tokens: 20 } };
  usage.observe(event); usage.observe(event);
  const row = usage.finish(); assert.equal(row.inputTokens, 120); assert.equal(row.outputTokens, 30); assert.equal(row.reasoningTokens, 20);
  assert.equal(summarizeUsage([row], { days: 0 }).totals.totalTokens, 150);
});
test('OpenCode sums steps, deduplicates part ids and adds its separate reasoning category to output', () => {
  const { usage } = collect('opencode');
  const one = { type: 'step_finish', sessionID: 'ses-test', part: { id: 'part1', tokens: { input: 5, output: 7, reasoning: 3, cache: { read: 20, write: 2 } }, cost: 0 } };
  usage.observe(one); usage.observe(one);
  usage.observe({ type: 'step_finish', part: { id: 'part2', tokens: { input: 10, output: 4, reasoning: 1, cache: { read: 30, write: 0 } }, cost: 0 } });
  const row = usage.finish(); assert.equal(row.inputTokens, 67); assert.equal(row.outputTokens, 15); assert.equal(row.cachedInputTokens, 50); assert.equal(row.estimatedUsd, 0);
});
test('unknown and invalid usage stays unknown, including failures before a model responds', () => {
  const { usage } = collect('codex');
  usage.observe({ type: 'turn.completed', usage: { input_tokens: -1, output_tokens: '99', cached_input_tokens: Infinity } });
  const row = usage.finish({ status: 'failed' });
  assert.equal(row.inputTokens, null); assert.equal(row.outputTokens, null);
  const data = summarizeUsage([row], { days: 0 }); assert.equal(data.totals.totalTokens, null); assert.equal(data.totals.failedRuns, 1); assert.equal(data.totals.reportedRuns, 0);
});
test('ledger survives reload, ignores partial/corrupt lines, deduplicates ids and exposes only metadata', () => {
  const file = path.join(dir, 'saved.jsonl'), old = process.env.AGENT_WORLD_USAGE_FILE;
  process.env.AGENT_WORLD_USAGE_FILE = file;
  try {
    const usage = new RunUsage({ tool: 'codex', source: 'delegation', agent: 'builder', model: 'test-model' });
    usage.observe({ type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 80, output_tokens: 10 } });
    const row = usage.finish();
    fs.appendFileSync(file, JSON.stringify({ ...row, prompt: 'PRIVATE PROMPT', apiKey: 'PRIVATE KEY' }) + '\nnot json\n{"unfinished":');
    const data = readUsage(file); assert.equal(data.records.length, 1); assert.equal(data.records[0].inputTokens, 100);
    assert.equal(JSON.stringify(data.records).includes('PRIVATE'), false); if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);   // Windows has no Unix file permissions
    assert.equal(readUsage(path.join(dir, 'does-not-exist')).records.length, 0);
  } finally { if (old === undefined) delete process.env.AGENT_WORLD_USAGE_FILE; else process.env.AGENT_WORLD_USAGE_FILE = old; }
});
test('periods respect Riyadh midnight, filters do not hide coverage and cache is not counted twice', () => {
  const now = Date.parse('2026-10-23T00:10:00+03:00');
  const row = (id, time, tool, inputTokens, outputTokens) => ({ id, tool, source: 'chat', model: null, startedAt: time - 1000, endedAt: time, inputTokens, outputTokens, cachedInputTokens: 80, cacheWriteTokens: null, reasoningTokens: null, estimatedUsd: null, status: 'completed' });
  const records = [row('today', now, 'codex', 100, 20), row('yesterday', now - 3600000, 'claude', 200, 30), row('unknown', now, 'claude', null, null)];
  assert.equal(usageDay(now), '2026-10-23');
  const today = summarizeUsage(records, { now, days: 1 }); assert.equal(today.totals.runs, 2); assert.equal(today.totals.totalTokens, 120); assert.equal(today.totals.reportedRuns, 1);
  const codex = summarizeUsage(records, { now, days: 7, tool: 'codex' }); assert.equal(codex.totals.runs, 1); assert.equal(codex.totals.totalTokens, 120);
  assert.equal(summarizeUsage([], { now }).totals.totalTokens, null);
});
test('usage endpoint accepts only read-only valid filters and never executes a model', () => {
  const responses = [], headers = {}, res = { setHeader: (key, value) => { headers[key] = value; } };
  const call = (method, search) => usageRoute({ req: { method }, res, p: '/api/usage', url: new URL('http://localhost/api/usage' + search), json: (_res, status, data) => responses.push({ status, data }) });
  assert.equal(call('POST', ''), true); assert.equal(responses.at(-1).status, 405);
  call('GET', '?days=999'); assert.equal(responses.at(-1).status, 400);
  call('GET', '?tool=bad'); assert.equal(responses.at(-1).status, 400);
  assert.equal(headers['Cache-Control'], 'no-store');
});
test('real chat runner integration records each engine once, handles an unterminated final JSON line and stores no chat text', async () => {
  const file = path.join(dir, 'integration.jsonl'), old = process.env.AGENT_WORLD_USAGE_FILE;
  process.env.AGENT_WORLD_USAGE_FILE = file;
  const fixtures = {
    codex: [{ type: 'thread.started', thread_id: 'fixture-codex' }, { type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 80, output_tokens: 10 } }],
    claude: [{ type: 'system', subtype: 'init', model: 'fixture-claude' }, { type: 'result', is_error: false, usage: { input_tokens: 20, output_tokens: 5, cache_read_input_tokens: 80 } }],
    opencode: [{ type: 'step_finish', sessionID: 'fixture-open', part: { id: 'finish', reason: 'stop', tokens: { input: 20, output: 5, reasoning: 2, cache: { read: 80, write: 0 } } } }],
  };
  try {
    for (const [tool, events] of Object.entries(fixtures)) {
      const bin = path.join(dir, `fake-${tool}.cjs`), variable = tool === 'opencode' ? 'AGENT_WORLD_TEST_BIN' : `AGENT_WORLD_TEST_${tool.toUpperCase()}_BIN`;
      fs.writeFileSync(bin, `#!${process.execPath}\nconst send=()=>process.stdout.write(${JSON.stringify(events.map(e => JSON.stringify(e)).join('\n'))}); if(process.argv.includes('--format'))send();else{process.stdin.resume();process.stdin.on('end',send);}`, { mode: 0o755 });
      process.env[variable] = bin;
      try { await new Promise(resolve => startRun({ tool, sessionId: null, cwd: dir, text: 'PRIVATE fixture prompt', mode: 'readonly', agent: null, usageSource: 'delegation' }, () => {}, resolve)); }
      finally { delete process.env[variable]; }
    }
    const { records } = readUsage(file); assert.equal(records.length, 3); assert.ok(records.every(r => r.source === 'delegation' && r.status === 'completed'));
    assert.equal(records.find(r => r.tool === 'claude').inputTokens, 100); assert.equal(records.find(r => r.tool === 'codex').inputTokens, 100); assert.equal(records.find(r => r.tool === 'opencode').outputTokens, 7);
    assert.equal(fs.readFileSync(file, 'utf8').includes('PRIVATE'), false);
  } finally { if (old === undefined) delete process.env.AGENT_WORLD_USAGE_FILE; else process.env.AGENT_WORLD_USAGE_FILE = old; }
});
