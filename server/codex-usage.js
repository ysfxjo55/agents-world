import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const KEYS = ['input_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'output_tokens', 'reasoning_output_tokens'];
export const zeroCodexUsage = () => Object.fromEntries(KEYS.map(key => [key, 0]));
const valid = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
export const safeCodexCounters = value => value && typeof value === 'object' ? Object.fromEntries(KEYS.map(key => [key, valid(value[key]) ? value[key] : null])) : null;
const roots = () => [process.env.AGENT_WORLD_CODEX_SESSIONS_DIR || path.join(os.homedir(), '.codex', 'sessions'), process.env.AGENT_WORLD_CODEX_ARCHIVED_DIR || path.join(os.homedir(), '.codex', 'archived_sessions')];

function findFile(sessionId, dirs) {
  for (const dir of dirs) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const file = path.join(dir, entry.name);
      if (entry.isFile() && entry.name.endsWith(`-${sessionId}.jsonl`)) return file;
      if (entry.isDirectory()) { const found = findFile(sessionId, [file]); if (found) return found; }
    }
  }
  return null;
}

// Open ONLY the requested session, never settings/auth or another conversation.
// The bounded tail is filtered to counter events; no prompt text is returned or saved.
export function codexUsageSnapshot(sessionId, before = Infinity, dirs = roots()) {
  if (typeof sessionId !== 'string' || !/^[\w-]+$/.test(sessionId)) return null;
  const file = findFile(sessionId, dirs);
  if (!file) return null;
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size, start = Math.max(0, size - 8 * 1024 * 1024), buffer = Buffer.alloc(size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    const lines = buffer.toString('utf8').split('\n'); if (start) lines.shift();
    let snapshot = null;
    for (const line of lines) {
      if (!line.includes('token_count')) continue;
      try {
        const event = JSON.parse(line), payload = event.payload;
        const timestamp = Date.parse(event.timestamp);
        if (event.type !== 'event_msg' || payload?.type !== 'token_count' || !Number.isFinite(timestamp) || timestamp > before) continue;
        const totals = payload.info?.total_token_usage;
        if (totals && valid(totals.input_tokens) && valid(totals.output_tokens)) snapshot = Object.fromEntries(KEYS.map(key => [key, valid(totals[key]) ? totals[key] : null]));
      } catch { /* skip incomplete lines; missing baseline remains unknown */ }
    }
    return snapshot;
  } catch { return null; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}

export function codexUsageDelta(after, before) {
  if (!after || !before) return null;
  const result = {};
  for (const key of KEYS) {
    if (!valid(after[key]) || !valid(before[key])) { result[key] = null; continue; }
    if (after[key] < before[key]) return null; // a reset is not negative consumption
    result[key] = after[key] - before[key];
  }
  return result;
}

export function repairLegacyCodexUsage(row, snapshot = codexUsageSnapshot) {
  if (row.tool !== 'codex' || row.accountingVersion >= 2) return row;
  const before = snapshot(row.sessionId, row.startedAt - 1), after = snapshot(row.sessionId, row.endedAt);
  // Only correct a legacy row if its reported counters match the native end snapshot.
  const matches = after && after.input_tokens === row.inputTokens && after.output_tokens === row.outputTokens && (row.cachedInputTokens == null || after.cached_input_tokens === row.cachedInputTokens);
  const delta = matches ? codexUsageDelta(after, before) : null;
  return { ...row, accountingVersion: 2, usageBasis: delta ? 'reconciled-session-delta' : 'unverified-baseline', counterBefore: safeCodexCounters(before), counterAfter: safeCodexCounters(after), inputTokens: delta?.input_tokens ?? null, cachedInputTokens: delta?.cached_input_tokens ?? null, cacheWriteTokens: delta?.cache_write_input_tokens ?? null, outputTokens: delta?.output_tokens ?? null, reasoningTokens: delta?.reasoning_output_tokens ?? null, estimatedUsd: null };
}
