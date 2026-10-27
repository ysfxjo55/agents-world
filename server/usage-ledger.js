import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { codexUsageSnapshot, codexUsageDelta, zeroCodexUsage, repairLegacyCodexUsage, safeCodexCounters } from './codex-usage.js';

const DEFAULT_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'usage.jsonl');
const FIELDS = ['inputTokens', 'cachedInputTokens', 'cacheWriteTokens', 'outputTokens', 'reasoningTokens', 'estimatedUsd'];
const count = n => typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
const id = s => typeof s === 'string' && /^[\w.:/-]{1,150}$/.test(s) ? s : null;
const sum = values => values.some(n => n !== null) ? values.reduce((a, n) => a + (n ?? 0), 0) : null;
const empty = () => ({ inputTokens: null, cachedInputTokens: null, cacheWriteTokens: null, outputTokens: null, reasoningTokens: null, estimatedUsd: null });
export const usageDay = timestamp => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(timestamp);

// Input is normalized to INCLUDE cache reads/writes; reasoning is a SUBSET of output.
function claudeTokens(u, camel = false) {
  if (!u || typeof u !== 'object') return empty();
  const fresh = count(camel ? u.inputTokens : u.input_tokens);
  const read = count(camel ? u.cacheReadInputTokens : u.cache_read_input_tokens);
  const write = count(camel ? u.cacheCreationInputTokens : u.cache_creation_input_tokens);
  return { ...empty(), inputTokens: fresh === null ? null : fresh + (read ?? 0) + (write ?? 0), cachedInputTokens: read, cacheWriteTokens: write, outputTokens: count(camel ? u.outputTokens : u.output_tokens) };
}
const combine = entries => Object.fromEntries(FIELDS.map(k => [k, sum(entries.map(u => u[k]))]));

export class RunUsage {
  constructor({ tool, model = undefined, agent = undefined, source = 'chat', sessionId = null, attempt = 1, contextId = null, startedAt = Date.now(), codexBaseline = undefined }, record = recordUsage) {
    this.record = record; this.closed = false; this.failed = false; this.aggregate = null; this.messages = new Map(); this.steps = new Map(); this.codexDone = false;
    this.codexBaseline = tool === 'codex' ? codexBaseline === undefined ? sessionId ? codexUsageSnapshot(sessionId, startedAt) : zeroCodexUsage() : codexBaseline : null;
    this.row = { id: crypto.randomUUID(), accountingVersion: 2, usageBasis: tool === 'codex' ? 'session-delta' : 'reported-run', counterBefore: safeCodexCounters(this.codexBaseline), counterAfter: null, tool, source: ['chat', 'delegation', 'family', 'research', 'today'].includes(source) ? source : 'chat', agent: id(agent), model: id(model), sessionId: id(sessionId), contextId: id(contextId), attempt, startedAt, ...empty() };
  }
  observe(event) {
    if (this.closed || !event) return;
    if (event.type === 'error' || event.type === 'turn.failed' || (event.type === 'result' && event.is_error)) this.failed = true;
    if (this.row.tool === 'claude') {
      if (event.type === 'system' && event.subtype === 'init') this.row.model = id(event.model) || this.row.model;
      if (event.type === 'assistant' && event.message?.usage && event.message.id) {
        const u = claudeTokens(event.message.usage), old = this.messages.get(event.message.id);
        this.messages.set(event.message.id, old ? Object.fromEntries(FIELDS.map(k => [k, sum([old[k], u[k]]) === null ? null : Math.max(old[k] ?? 0, u[k] ?? 0)])) : u);
        this.row.model = id(event.message.model) || this.row.model;
      }
      if (event.type === 'result') {
        const models = Object.entries(event.modelUsage || {});
        if (models.length) this.row.model = models.length === 1 ? id(models[0][0]) || this.row.model : 'multiple';
        // Final run totals supersede message observations: never add both.
        const finalUsage = event.usage ? claudeTokens(event.usage) : empty();
        const modelTotals = models.length ? combine(models.map(([, u]) => claudeTokens(u, true))) : empty();
        if (finalUsage.inputTokens !== null || finalUsage.outputTokens !== null) this.aggregate = finalUsage;
        else if (modelTotals.inputTokens !== null || modelTotals.outputTokens !== null) this.aggregate = modelTotals;
        this.row.estimatedUsd = count(event.total_cost_usd);
      }
    } else if (this.row.tool === 'codex') {
      if (event.type === 'turn.started') this.codexDone = false;
      if (event.type === 'turn.completed' && !this.codexDone) {
        this.codexDone = true;
        const raw = event.usage || {};
        this.row.counterAfter = safeCodexCounters(raw);
        const u = codexUsageDelta(raw, this.codexBaseline);
        if (!u) this.row.usageBasis = 'unverified-baseline';
        const entry = { ...empty(), inputTokens: count(u?.input_tokens), cachedInputTokens: count(u?.cached_input_tokens), cacheWriteTokens: count(u?.cache_write_input_tokens), outputTokens: count(u?.output_tokens), reasoningTokens: count(u?.reasoning_output_tokens) };
        // Codex exec reports conversation totals, even when resuming. Use one delta,
        // not a sum of cumulative snapshots. Input already includes cache reads.
        this.aggregate = entry;
      }
    } else if (this.row.tool === 'antigravity' && event.event === 'result') {   // agy: the final "result" carries the totals of the turn
      const u = event.result?.usage || {}, read = count(u.cache_read_tokens), fresh = count(u.input_tokens), out = count(u.output_tokens), think = count(u.thinking_tokens);
      this.aggregate = { ...empty(), inputTokens: fresh, cachedInputTokens: read, outputTokens: out === null ? null : out + (think ?? 0), reasoningTokens: think };
      if (event.result?.status && event.result.status !== 'SUCCESS') this.failed = true;
    } else if (this.row.tool === 'opencode' && event.type === 'step_finish') {
      const p = event.part || {}, t = p.tokens || {};
      const fresh = count(t.input), read = count(t.cache?.read), write = count(t.cache?.write), visible = count(t.output), reasoning = count(t.reasoning);
      this.steps.set(p.id || p.messageID || `step:${this.steps.size}`, { inputTokens: fresh === null ? null : fresh + (read ?? 0) + (write ?? 0), cachedInputTokens: read, cacheWriteTokens: write, outputTokens: visible === null ? null : visible + (reasoning ?? 0), reasoningTokens: reasoning, estimatedUsd: count(p.cost) });
      this.row.model = id(p.modelID) || this.row.model;
    }
    this.row.sessionId = id(event.thread_id || event.sessionID || event.session_id || event.conversation_id) || this.row.sessionId;
  }
  finish({ status = 'completed', sessionId = undefined, endedAt = Date.now() } = {}) {
    if (this.closed) return;
    this.closed = true;
    const totals = this.aggregate || combine([...this.steps.values(), ...this.messages.values()]);
    const row = { ...this.row, ...totals, estimatedUsd: this.row.estimatedUsd ?? totals.estimatedUsd, endedAt, status, sessionId: id(sessionId) || this.row.sessionId };
    try { this.record(row); } catch { console.error('Usage could not be saved. Chat is unaffected.'); }
    return row;
  }
}

export function recordUsage(row) {
  if (process.env.NODE_TEST_CONTEXT && !process.env.AGENT_WORLD_USAGE_FILE) return;
  const file = process.env.AGENT_WORLD_USAGE_FILE || DEFAULT_FILE;
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  // One append per finished attempt, shared safely by the app and research processes.
  fs.appendFileSync(file, JSON.stringify(row) + '\n', { mode: 0o600 });
}

export function readUsage(file = process.env.AGENT_WORLD_USAGE_FILE || DEFAULT_FILE) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size, start = Math.max(0, size - 32 * 1024 * 1024), buffer = Buffer.alloc(size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    const lines = buffer.toString('utf8').split('\n');
    if (start) lines.shift();
    const seen = new Set(), records = [];
    for (const line of lines) {
      try {
        const row = JSON.parse(line);
        if (!id(row.id) || seen.has(row.id) || !['claude', 'codex', 'opencode', 'antigravity'].includes(row.tool) || !Number.isFinite(row.startedAt) || !Number.isFinite(row.endedAt) || !Number.isFinite(new Date(row.startedAt).getTime()) || !Number.isFinite(new Date(row.endedAt).getTime())) continue;
        seen.add(row.id);
        const safe = { id: row.id, accountingVersion: count(row.accountingVersion), usageBasis: id(row.usageBasis), counterBefore: safeCodexCounters(row.counterBefore), counterAfter: safeCodexCounters(row.counterAfter), tool: row.tool, source: ['chat', 'delegation', 'family', 'research', 'today'].includes(row.source) ? row.source : 'chat', agent: id(row.agent), model: id(row.model), sessionId: id(row.sessionId), contextId: id(row.contextId), attempt: count(row.attempt), startedAt: row.startedAt, endedAt: row.endedAt, status: ['completed', 'failed', 'stopped'].includes(row.status) ? row.status : 'failed', ...Object.fromEntries(FIELDS.map(k => [k, count(row[k])])) };
        records.push(repairLegacyCodexUsage(safe));
      } catch { /* a partially written last line is retried on refresh */ }
    }
    return { records, truncated: start > 0 };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { records: [], truncated: false };
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}

export function summarizeUsage(records, { days = 7, tool = 'all', now = Date.now() } = {}) {
  const today = usageDay(now), firstDay = days ? usageDay(Date.parse(today + 'T00:00:00+03:00') - (days - 1) * 86400_000) : null;
  const selected = records.filter(r => (!firstDay || usageDay(r.endedAt) >= firstDay) && r.endedAt <= now && (tool === 'all' || r.tool === tool));
  const total = rows => {
    const totals = combine(rows);
    return { ...totals, runs: rows.length, reportedRuns: rows.filter(r => r.inputTokens !== null && r.outputTokens !== null).length, failedRuns: rows.filter(r => r.status !== 'completed').length, totalTokens: sum([totals.inputTokens, totals.outputTokens]) };
  };
  const group = key => [...new Set(selected.map(r => r[key]))].map(label => ({ label, ...total(selected.filter(r => r[key] === label)) }));
  return { now, firstDay, trackingSince: records.length ? Math.min(...records.map(r => r.startedAt)) : null, correctedRuns: selected.filter(r => r.usageBasis === 'reconciled-session-delta').length, unverifiedRuns: selected.filter(r => r.usageBasis === 'unverified-baseline').length, totals: total(selected), engines: group('tool'), sources: group('source'), models: group('model'), daily: groupDay(selected, total), recent: selected.sort((a, b) => b.endedAt - a.endedAt).slice(0, 100), matchedRuns: selected.length };
}
function groupDay(records, total) {
  const groups = new Map();
  for (const row of records) { const day = usageDay(row.endedAt); if (!groups.has(day)) groups.set(day, []); groups.get(day).push(row); }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([label, rows]) => ({ label, ...total(rows) }));
}

export function usageRoute({ req, res, p, url, json }) {
  if (p !== '/api/usage') return false;
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') { json(res, 405, { error: 'Use GET.' }); return true; }
  const period = url.searchParams.get('days') || '7', tool = url.searchParams.get('tool') || 'all';
  if (!['1', '7', '30', '0'].includes(period) || !['all', 'claude', 'codex', 'opencode', 'antigravity'].includes(tool)) { json(res, 400, { error: 'Invalid usage filter.' }); return true; }
  try { const data = readUsage(); json(res, 200, { ...summarizeUsage(data.records, { days: Number(period), tool }), truncated: data.truncated }); }
  catch { json(res, 503, { error: 'Usage history could not be read. Try again.' }); }
  return true;
}
