import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { shouldOpen, localDateString, readOpenedDate, autoOpen } from '../server/autoopen.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'autoopen-'));

test('shouldOpen: opens when there is no record', () => assert.equal(shouldOpen(null, '2026-10-10'), true));
test('shouldOpen: opens on a new day', () => assert.equal(shouldOpen('2026-10-09', '2026-10-10'), true));
test('shouldOpen: does not open twice on the same day', () => assert.equal(shouldOpen('2026-10-10', '2026-10-10'), false));

test('localDateString: uses the local date, not UTC', () => {
  assert.equal(localDateString(new Date(2026, 9, 10, 0, 1)), '2026-10-10');    // just after local midnight
  assert.equal(localDateString(new Date(2026, 9, 10, 23, 59)), '2026-10-10');  // just before the next one
});

const opts = (over) => /** @type {any} */ ({
  url: 'http://localhost:4321/today.html?popup=1', today: '2026-10-10',
  platform: 'darwin', env: { AGENT_WORLD_OPEN_CMD: 'echo' }, log: () => {}, ...over,
});

test('autoOpen: runs the open command once, then remembers the day', () => {
  const stateFile = path.join(tmp(), 'today-opened.json');
  const calls = [];
  const run = (cmd, args, cb) => { calls.push([cmd, ...args]); cb(null); };
  assert.equal(autoOpen(opts({ stateFile, run })), true);
  assert.deepEqual(calls, [['echo', 'http://localhost:4321/today.html?popup=1']]);
  assert.equal(readOpenedDate(stateFile), '2026-10-10');
  assert.equal(autoOpen(opts({ stateFile, run })), false);        // same day: skipped
  assert.equal(calls.length, 1);
});

test('autoOpen: opens again on a later day', () => {
  const stateFile = path.join(tmp(), 'today-opened.json');
  const calls = [];
  const run = (cmd, args, cb) => { calls.push(cmd); cb(null); };
  autoOpen(opts({ stateFile, run }));
  assert.equal(autoOpen(opts({ stateFile, run, today: '2026-10-11' })), true);
  assert.equal(calls.length, 2);
});

test('autoOpen: skips off macOS, in dry runs, and when disabled', () => {
  const stateFile = path.join(tmp(), 'today-opened.json');
  const run = () => assert.fail('must not run');
  assert.equal(autoOpen(opts({ stateFile, run, platform: 'linux' })), false);
  assert.equal(autoOpen(opts({ stateFile, run, env: { AGENT_WORLD_DRYRUN: '1' } })), false);
  assert.equal(autoOpen(opts({ stateFile, run, env: { AGENT_WORLD_NO_AUTOOPEN: '1' } })), false);
});

test('autoOpen: a corrupt state file still opens and is replaced', () => {
  const stateFile = path.join(tmp(), 'today-opened.json');
  fs.writeFileSync(stateFile, '{not json');
  assert.equal(readOpenedDate(stateFile), null);
  const run = (cmd, args, cb) => cb(null);
  assert.equal(autoOpen(opts({ stateFile, run })), true);
  assert.equal(readOpenedDate(stateFile), '2026-10-10');
});

test('autoOpen: a failing open command is logged, not thrown', () => {
  const stateFile = path.join(tmp(), 'today-opened.json');
  const logs = [];
  const run = (cmd, args, cb) => cb(new Error('boom'));
  assert.equal(autoOpen(opts({ stateFile, run, log: (m) => logs.push(m) })), true);
  assert.ok(logs.some((m) => m.includes('auto-open failed')));
});
