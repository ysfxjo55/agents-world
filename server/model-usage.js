import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { HttpError } from './auth.js';

const PROVIDERS = ['claude', 'codex'];
const STATES = ['unknown', 'available', 'near', 'exhausted'];
const FRESH_MS = 15 * 60_000;
const BLOCKED_MS = 24 * 3600_000;
const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'model-usage.json');
const percent = n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100;
const seconds = n => typeof n === 'number' && Number.isFinite(n) && n > 0 ? n * 1000 : null;

export class UsageStore {
  constructor(filename = null) {
    this.filename = filename; this.records = {};
    if (filename) try { const data = JSON.parse(fs.readFileSync(filename, 'utf8')); for (const tool of PROVIDERS) if (Array.isArray(data[tool])) this.records[tool] = data[tool].filter(r => STATES.includes(r?.status) && Number.isFinite(r?.observedAt) && ['manual', 'cli', 'codex-account'].includes(r?.source)); } catch { /* no saved observations */ }
  }
  save() {
    if (!this.filename) return;
    fs.mkdirSync(path.dirname(this.filename), { recursive: true });
    const tmp = this.filename + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(this.records, null, 2), { mode: 0o600 }); fs.renameSync(tmp, this.filename);
  }
  update(tool, observations, source, now = Date.now()) {
    if (!PROVIDERS.includes(tool) || !Array.isArray(observations)) throw new HttpError(400, 'Invalid usage provider.');
    const records = observations.map(r => ({
      status: STATES.includes(r.status) ? r.status : 'unknown',
      usedPercent: percent(r.usedPercent) ? r.usedPercent : null,
      resetsAt: Number.isFinite(r.resetsAt) && r.resetsAt > 0 ? r.resetsAt : null,
      window: String(r.window || 'account').slice(0, 40), model: ['haiku', 'sonnet', 'opus'].includes(r.model) ? r.model : null, source, observedAt: now,
    }));
    // A partial CLI update must not erase another quota window (e.g. weekly exhaustion).
    const old = this.records[tool] || [];
    const keepManual = r => r.source === 'manual' && ['near', 'exhausted'].includes(r.status) && now - r.observedAt <= (r.status === 'exhausted' ? BLOCKED_MS : FRESH_MS) && (r.resetsAt == null || r.resetsAt > now);
    this.records[tool] = source === 'cli'
      ? [...old.filter(r => keepManual(r) || !records.some(n => n.window === r.window)), ...records]
      : source === 'codex-account' ? [...old.filter(keepManual), ...records]
        : [...old.filter(r => r.source !== 'manual' && r.status === 'exhausted' && now - r.observedAt <= BLOCKED_MS && (r.resetsAt == null || r.resetsAt > now)), ...records];
    this.save(); return this.snapshot(now);
  }
  manual(input, now = Date.now()) {
    if (!input || !PROVIDERS.includes(input.tool) || !STATES.includes(input.status)) throw new HttpError(400, 'Invalid usage status.');
    if (input.usedPercent != null && !percent(input.usedPercent)) throw new HttpError(400, 'Usage must be between 0 and 100.');
    if (input.resetsAt != null && (!Number.isFinite(input.resetsAt) || input.resetsAt <= now || input.resetsAt > now + 31 * 86400_000)) throw new HttpError(400, 'Choose a future reset within 31 days.');
    return this.update(input.tool, [{ status: input.status, usedPercent: input.usedPercent, resetsAt: input.resetsAt, window: 'account' }], 'manual', now);
  }
  snapshot(now = Date.now()) {
    return Object.fromEntries(PROVIDERS.map(tool => {
      const records = (this.records[tool] || []).map(r => {
        const stale = now - r.observedAt > (r.status === 'exhausted' ? BLOCKED_MS : FRESH_MS) || (r.resetsAt != null && now >= r.resetsAt);
        return { ...r, status: stale ? 'unknown' : r.status, stale };
      });
      const priority = { unknown: 0, available: 1, near: 2, exhausted: 3 };
      const summarize = windows => {
        const worst = windows.reduce((a, b) => priority[b.status] > priority[a.status] ? b : a, { status: 'unknown', source: 'none', usedPercent: null, resetsAt: null, observedAt: null, stale: false });
        return { ...worst, status: worst.status === 'available' && windows.some(r => r.status === 'unknown') ? 'unknown' : worst.status, windows };
      };
      const accountWindows = records.filter(r => !r.model);
      const account = summarize(accountWindows);
      const manualAvailable = accountWindows.some(r => r.source === 'manual' && r.status === 'available');
      if (tool === 'claude' && account.status === 'available' && !manualAvailable && !['five_hour', 'seven_day'].every(window => accountWindows.some(r => r.window === window && r.status === 'available'))) account.status = 'unknown';
      return [tool, { ...account, models: Object.fromEntries((tool === 'claude' ? ['haiku', 'sonnet', 'opus'] : []).map(model => [model, summarize(records.filter(r => r.model === model))])) }];
    }));
  }
}
export const modelUsage = new UsageStore(file);
export function codexObservations(payload) {
  const limits = payload?.rateLimitsByLimitId?.codex || payload?.rateLimits || payload?.rate_limits;
  if (!limits || (limits.limitId && limits.limitId !== 'codex')) return [];
  return ['primary', 'secondary'].flatMap(window => {
    const r = limits[window]; const used = r?.usedPercent ?? r?.used_percent;
    if (!percent(used)) return [];
    return [{ window, usedPercent: used, status: used >= 100 ? 'exhausted' : used >= 80 ? 'near' : 'available', resetsAt: seconds(r.resetsAt ?? r.resets_at) }];
  });
}
export function observeUsageEvent(tool, event, store = modelUsage, now = Date.now()) {
  if (tool === 'claude' && event?.type === 'rate_limit_event') {
    const r = event.rate_limit_info ?? event.rateLimitInfo;
    if (!r || !['allowed', 'allowed_warning', 'rejected'].includes(r.status)) return;
    // SDK utilization is a fraction, unlike status-line percentages. Never infer one from the other.
    const used = typeof r.utilization === 'number' && r.utilization >= 0 && r.utilization <= 1 ? r.utilization * 100 : null;
    const kind = String(r.rateLimitType ?? r.rate_limit_type ?? 'account');
    const limitedModel = ['haiku', 'sonnet', 'opus'].find(name => kind.includes(name)) || null;
    store.update(tool, [{ model: limitedModel, window: r.rateLimitType ?? r.rate_limit_type ?? 'account', usedPercent: used,
      status: r.status === 'rejected' ? 'exhausted' : r.status === 'allowed_warning' || used >= 80 ? 'near' : used != null ? 'available' : 'unknown', resetsAt: seconds(r.resetsAt ?? r.resets_at) }], 'cli', now);
  }
  if (tool === 'codex' && (event?.method === 'account/rateLimits/updated' || event?.type === 'rate_limits.updated')) {
    const records = codexObservations(event.params ?? event);
    if (records.length) store.update(tool, records, 'cli', now);
  }
  // Only explicit quota errors, never the model's own prose or a generic network 429.
  const code = event?.error?.code ?? event?.error?.type ?? event?.subtype;
  if (['usage_limit_reached', 'usage_limit', 'quota_exceeded'].includes(code) && ['error', 'turn.failed', 'result'].includes(event?.type)) store.update(tool, [{ status: 'exhausted', window: 'account' }], 'cli', now);
}

export function readCodexLimits({ spawnImpl = spawn, timeoutMs = 7000 } = {}) {
  return new Promise(resolve => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('AGENT_WORLD_')));
    const child = spawnImpl('codex', ['app-server'], { env, stdio: ['pipe', 'pipe', 'ignore'] });
    let done = false, buffer = '', outcome = null, grace = null;
    const finish = result => {
      if (done) return; done = true; outcome = result; clearTimeout(timer);
      child.stdin.end(); child.kill('SIGTERM');
      grace = setTimeout(() => child.kill('SIGKILL'), 1000);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    child.on('error', () => finish(null));
    child.on('close', () => { done = true; clearTimeout(timer); clearTimeout(grace); resolve(outcome); }); child.stdin.on('error', () => finish(null));
    const send = value => child.stdin.write(JSON.stringify(value) + '\n');
    child.stdout.setEncoding('utf8'); child.stdout.on('data', chunk => {
      buffer += chunk; if (buffer.length > 256_000) return finish(null);
      let i; while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
        let message; try { message = JSON.parse(line); } catch { continue; }
        if (message.id === 1) {
          if (message.error) return finish(null);
          send({ method: 'initialized', params: {} }); send({ method: 'account/rateLimits/read', id: 2, params: {} });
        } else if (message.id === 2) finish(message.error ? null : message.result);
      }
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'bella_usage', title: 'Bella usage check', version: '1.0.0' } } });
  });
}
let checking = null;
let checkedAt = 0;
export async function refreshCodexUsage(store = modelUsage) {
  if (checking) return checking;
  if (Date.now() - checkedAt < 60_000) return { usage: store.snapshot(), refreshed: false, cached: true };
  checkedAt = Date.now();
  checking = (async () => {
    const result = await readCodexLimits(); const observations = codexObservations(result);
    if (observations.length) store.update('codex', observations, 'codex-account');
    return { usage: store.snapshot(), refreshed: observations.length > 0 };
  })();
  try { return await checking; } finally { checking = null; }
}
