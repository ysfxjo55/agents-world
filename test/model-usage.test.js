import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { UsageStore, codexObservations, observeUsageEvent, readCodexLimits } from '../server/model-usage.js';
const now = 1800000000000;
test('manual reports expire, reset becomes unknown rather than invented available, fresh near starts at 80%', () => {
  const store = new UsageStore(); assert.equal(store.snapshot(now).claude.status, 'unknown');
  store.manual({ tool: 'claude', status: 'exhausted', resetsAt: now + 10000 }, now);
  assert.equal(store.snapshot(now).claude.status, 'exhausted'); assert.equal(store.snapshot(now + 10000).claude.status, 'unknown');
  store.manual({ tool: 'claude', status: 'near' }, now); assert.equal(store.snapshot(now + 16 * 60000).claude.status, 'unknown');
  for (const bad of [{ tool: 'wrong', status: 'near' }, { tool: 'claude', status: 'yes' }, { tool: 'claude', status: 'near', usedPercent: 101 }, { tool: 'claude', status: 'near', resetsAt: now - 1 }]) assert.throws(() => store.manual(bad, now));
});
test('partial Claude telemetry preserves weekly blocks; arbitrary 429s and assistant prose do not block an account', () => {
  const store = new UsageStore();
  observeUsageEvent('claude', { type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: 'seven_day', resetsAt: (now + 1000000) / 1000 } }, store, now);
  observeUsageEvent('claude', { type: 'rate_limit_event', rate_limit_info: { status: 'allowed', rateLimitType: 'five_hour', utilization: .2 } }, store, now + 1);
  assert.equal(store.snapshot(now + 2).claude.status, 'exhausted');
  const clean = new UsageStore();
  for (const event of [{ type: 'assistant', message: { content: [{ type: 'text', text: 'Your limit is reached' }] } }, { type: 'error', error: { code: '429' } }]) observeUsageEvent('claude', event, clean, now);
  assert.equal(clean.snapshot(now).claude.status, 'unknown');
  observeUsageEvent('claude', { type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', utilization: .85 } }, clean, now);
  assert.equal(clean.snapshot(now).claude.usedPercent, 85); assert.equal(clean.snapshot(now).claude.status, 'near');
});
test('Codex uses worst of actual account windows; ignores unrelated buckets and invalid percentages', () => {
  const store = new UsageStore(); const obs = codexObservations({ rateLimits: { primary: { usedPercent: 22 }, secondary: { usedPercent: 100, resetsAt: (now + 10000) / 1000 } } });
  store.update('codex', obs, 'codex-account', now); assert.equal(store.snapshot(now).codex.status, 'exhausted');
  assert.deepEqual(codexObservations({ rateLimits: { limitId: 'some-other-service', primary: { usedPercent: 100 } } }), []);
  assert.deepEqual(codexObservations({ rateLimits: { primary: { usedPercent: -1 } } }), []);
});
test('Codex read-only account protocol never starts a model turn, filters secrets and closes child', async () => {
  const calls = []; const child = /** @type {any} */ (new EventEmitter()); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.kill = signal => { calls.push(signal); queueMicrotask(() => child.emit('close', 0)); return true; };
  const spawnImpl = (cmd, args, _opts) => { assert.equal(cmd, 'codex'); assert.deepEqual(args, ['app-server']); return child; };
  let input = ''; child.stdin.on('data', chunk => {
    input += chunk; let i; while ((i = input.indexOf('\n')) >= 0) { const req = JSON.parse(input.slice(0, i)); input = input.slice(i + 1); calls.push(req.method);
      if (req.id === 1) queueMicrotask(() => child.stdout.write(JSON.stringify({ id: 1, result: {} }) + '\n'));
      if (req.id === 2) queueMicrotask(() => child.stdout.write(JSON.stringify({ id: 2, result: { rateLimits: { primary: { usedPercent: 12 } } } }) + '\n'));
    }
  });
  const result = await readCodexLimits({ spawnImpl: /** @type {any} */ (spawnImpl), timeoutMs: 1000 }); assert.equal(result.rateLimits.primary.usedPercent, 12);
  assert.deepEqual(calls, ['initialize', 'initialized', 'account/rateLimits/read', 'SIGTERM']);
});

test('an Opus-only limit does not incorrectly exhaust all Claude models', () => {
  const store = new UsageStore();
  observeUsageEvent('claude', { type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: 'seven_day_opus' } }, store, now);
  const usage = store.snapshot(now);
  assert.equal(usage.claude.status, 'unknown'); assert.equal(usage.claude.models.opus.status, 'exhausted');
});

test('a manual blocked report survives healthy automatic readings until cleared or reset', () => {
  const store = new UsageStore();
  store.manual({ tool: 'codex', status: 'exhausted', resetsAt: now + 10000 }, now);
  store.update('codex', [{ window: 'primary', status: 'available', usedPercent: 10 }], 'codex-account', now + 1);
  assert.equal(store.snapshot(now + 2).codex.status, 'exhausted');
  // After a reset, the old report is unknown, not an invented guarantee of capacity.
  assert.equal(store.snapshot(now + 10000).codex.status, 'unknown');
  store.manual({ tool: 'codex', status: 'available' }, now + 11000);
  assert.equal(store.snapshot(now + 11001).codex.status, 'available');
});
test('a silent Codex usage process times out and is killed', async () => {
  const child = /** @type {any} */ (new EventEmitter()); child.stdin = new PassThrough(); child.stdout = new PassThrough(); let killed = false; child.kill = () => { killed = true; queueMicrotask(() => child.emit('close', 0)); };
  const spawnImpl = /** @type {any} */ (() => child);
  assert.equal(await readCodexLimits({ spawnImpl, timeoutMs: 15 }), null); assert.equal(killed, true);
});

test('a manual available report cannot erase an unexpired CLI rejection', () => {
  const store = new UsageStore();
  observeUsageEvent('claude', { type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: 'seven_day', resetsAt: (now + 10000) / 1000 } }, store, now);
  store.manual({ tool: 'claude', status: 'available' }, now + 1);
  assert.equal(store.snapshot(now + 2).claude.status, 'exhausted');
});
test('partial healthy Claude quota data remains unknown until both global windows are observed', () => {
  const store = new UsageStore();
  observeUsageEvent('claude', { type: 'rate_limit_event', rate_limit_info: { status: 'allowed', rateLimitType: 'five_hour', utilization: .2 } }, store, now);
  assert.equal(store.snapshot(now).claude.status, 'unknown');
  observeUsageEvent('claude', { type: 'rate_limit_event', rate_limit_info: { status: 'allowed', rateLimitType: 'seven_day', utilization: .2 } }, store, now + 1);
  assert.equal(store.snapshot(now + 2).claude.status, 'available');
});
