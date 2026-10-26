import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { codexUsageSnapshot, codexUsageDelta, zeroCodexUsage, repairLegacyCodexUsage } from '../server/codex-usage.js';
import { RunUsage, summarizeUsage } from '../server/usage-ledger.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-counter-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const counts = (input, cached, output) => ({ ...zeroCodexUsage(), input_tokens: input, cached_input_tokens: cached, output_tokens: output });

test('two resumed runs subtract their starting conversation counters instead of summing history again', () => {
  const rows = [], record = row => rows.push(row);
  for (const [before, after] of [[counts(1000, 800, 100), counts(1200, 950, 120)], [counts(1200, 950, 120), counts(1500, 1200, 150)]]) {
    const run = new RunUsage({ tool: 'codex', sessionId: 'resumed-fixture', codexBaseline: before }, record);
    run.observe({ type: 'turn.completed', usage: after }); run.finish();
  }
  assert.equal(rows[0].inputTokens, 200); assert.equal(rows[0].outputTokens, 20);
  assert.equal(rows[1].inputTokens, 300); assert.equal(rows[1].outputTokens, 30);
  assert.equal(summarizeUsage(rows, { days: 0 }).totals.totalTokens, 550);
  assert.deepEqual(rows[0].counterBefore, counts(1000, 800, 100));
});
test('missing baseline and counters that decrease are unknown, never a full-conversation charge', () => {
  const run = new RunUsage({ tool: 'codex', sessionId: 'missing', codexBaseline: null }, () => {});
  run.observe({ type: 'turn.completed', usage: counts(16000000, 15000000, 45000) });
  const row = run.finish(); assert.equal(row.inputTokens, null); assert.equal(row.outputTokens, null); assert.equal(row.usageBasis, 'unverified-baseline');
  assert.equal(codexUsageDelta(counts(10, 5, 1), counts(100, 80, 5)), null);
});
test('native snapshots select counters before the run, ignore unrelated events and never return prompt content', () => {
  const file = path.join(dir, 'rollout-session-fixture.jsonl');
  const token = (timestamp, total) => ({ timestamp, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: total } } });
  fs.writeFileSync(file, [
    { type: 'response_item', payload: { content: 'PRIVATE PROMPT token_count' } },
    token('2026-10-23T00:00:00Z', counts(1000, 800, 100)),
    token('2026-10-23T00:00:10Z', counts(1200, 950, 120)),
    token('not a date', counts(9999, 999, 999)),
  ].map(x => JSON.stringify(x)).join('\n') + '\n{"partial":');
  assert.deepEqual(codexUsageSnapshot('session-fixture', Date.parse('2026-10-23T00:00:05Z'), [dir]), counts(1000, 800, 100));
  assert.deepEqual(codexUsageSnapshot('session-fixture', Infinity, [dir]), counts(1200, 950, 120));
  assert.equal(codexUsageSnapshot('../private', Infinity, [dir]), null);
  assert.equal(codexUsageSnapshot('missing', Infinity, [dir]), null);
});
test('large cumulative counters reconcile exactly; unmatched legacy counters are excluded', () => {
  const before = counts(1000000, 800000, 3000), after = counts(1020000, 819000, 3200);
  const old = { tool: 'codex', accountingVersion: null, sessionId: 'fixture', startedAt: 10, endedAt: 20, inputTokens: after.input_tokens, cachedInputTokens: after.cached_input_tokens, outputTokens: after.output_tokens };
  const corrected = repairLegacyCodexUsage(old, (_id, time) => time < 10 ? before : after);
  assert.equal(corrected.inputTokens, 20000); assert.equal(corrected.cachedInputTokens, 19000); assert.equal(corrected.outputTokens, 200);
  assert.equal(corrected.inputTokens + corrected.outputTokens, 20200);
  assert.equal(corrected.inputTokens - corrected.cachedInputTokens, 1000);
  assert.equal(corrected.usageBasis, 'reconciled-session-delta');
  assert.equal(repairLegacyCodexUsage(old, () => null).inputTokens, null);
  assert.equal(repairLegacyCodexUsage({ ...old, inputTokens: 999 }, (_id, time) => time < 10 ? before : after).inputTokens, null);
  assert.equal(repairLegacyCodexUsage({ ...old, accountingVersion: 2 }).inputTokens, old.inputTokens);
});
