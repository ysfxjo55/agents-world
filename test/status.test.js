import test from 'node:test';
import assert from 'node:assert/strict';
import { computeStatus } from '../server/status.js';

const NOW = 1_000_000_000_000;
const st = (lastEvent, agoSec, extra = {}) => computeStatus({ lastEvent, lastTs: NOW - agoSec * 1000, ...extra }, NOW);

test('a fresh tool result means the agent is working', () => assert.equal(st('tool_result', 20), 'working'));
test('an answer that just finished needs you', () => assert.equal(st('assistant_end', 10), 'needs'));
test('an answer finished more than a minute ago falls asleep', () => assert.equal(st('assistant_end', 90), 'sleeping'));
test('a prompt with no reply for 3 minutes is sleeping', () => assert.equal(st('user', 180), 'sleeping'));
test('a tool running for 5 minutes still needs you, it does not sleep', () => assert.equal(st('tool_call', 300, { pendingToolSince: NOW - 300_000 }), 'needs'));
test('a tool call waiting more than 10s (likely a permission prompt) needs you', () => assert.equal(st('tool_call', 40, { pendingToolSince: NOW - 40_000 }), 'needs'));
test('a tool call only just started is still working', () => assert.equal(st('tool_call', 3, { pendingToolSince: NOW - 3_000 }), 'working'));
test('a busy helper keeps the agent working', () => assert.equal(st('assistant_end', 200, { busyChild: true }), 'working'));
test('no activity for hours is sleeping', () => assert.equal(st('tool_call', 3 * 3600), 'sleeping'));
test('a missing signal is sleeping', () => assert.equal(computeStatus(null, NOW), 'sleeping'));
