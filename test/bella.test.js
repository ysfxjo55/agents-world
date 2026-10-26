import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bellaArgs } from '../server/chat.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bella-mem-'));
fs.writeFileSync(path.join(dir, 'MEMORY.md'), '# memory\n- he likes green tea\n');

test('Bella chats get her memory folder and index', () => {
  const a = bellaArgs('readonly', dir);
  assert.equal(a[a.indexOf('--add-dir') + 1], dir);
  assert.match(a[a.indexOf('--append-system-prompt') + 1], /he likes green tea/);
});
test('she may edit only inside her memory folder (absolute-path rule)', () => {
  const rules = bellaArgs('readonly', dir)[bellaArgs('readonly', dir).indexOf('--allowedTools') + 1];
  assert.ok(rules.includes(`Edit(/${dir}/**)`) && rules.includes(`Write(/${dir}/**)`));
  const list = rules.split(',');
  assert.equal(list.length, 6);                                              // edit + write her memory, delegate, remember, and edit + write the family folder (profile and inbox)
  assert.ok(list[3].startsWith('Bash(') && list[3].includes('/bin/remember:*'), 'remember is allowed');
  assert.ok(list[2].startsWith('Bash(') && list[2].includes('/bin/delegate:*'), 'delegate remains allowed');
});
test('full mode needs no extra allow rules', () => assert.ok(!bellaArgs('full', dir).includes('--allowedTools')));
test('the hidden built-in Agent tool and the unconnected ListAgents/SendMessage are switched off for her, in every mode', () => {
  for (const m of ['readonly', 'edits', 'full']) { const a = bellaArgs(m, dir); assert.equal(a[a.indexOf('--disallowedTools') + 1], 'Agent,Task,ListAgents,SendMessage'); }
});
test('a missing memory file does not break the chat', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'bella-empty-'));
  assert.ok(bellaArgs('readonly', empty).includes('--append-system-prompt'));      // the tool list is still sent
});

test('every message carries her CURRENT tool list, even with no memory file', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'bella-empty2-'));
  const prompt = (d) => { const a = bellaArgs('readonly', d); return a[a.indexOf('--append-system-prompt') + 1]; };
  for (const p of [prompt(dir), prompt(empty)]) { assert.match(p, /delegate continue/); assert.match(p, /delegate repo/); assert.match(p, /delegate sessions/); assert.match(p, /Do NOT use ListAgents/); }
});

test('Bella is told the real path of the delegate tool, not a hard-coded one', async () => {
  const { BELLA_TOOLS, DELEGATE_BIN } = await import('../server/chat.js');
  assert.ok(BELLA_TOOLS.includes(DELEGATE_BIN));
});

test('the delegate ceiling comes from a secret run token, never from a header the caller writes', async () => {
  const { issueRunToken, releaseRunToken, maxModeForToken } = await import('../server/chat.js');
  const t = issueRunToken('edits');
  assert.equal(maxModeForToken(t), 'edits');
  assert.equal(maxModeForToken('full'), 'readonly');          // claiming a mode is worthless
  assert.equal(maxModeForToken(undefined), 'readonly');
  assert.equal(maxModeForToken('0'.repeat(32)), 'readonly');
  releaseRunToken(t);
  assert.equal(maxModeForToken(t), 'readonly');               // a finished run's token stops working
  const server = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  const bin = fs.readFileSync(new URL('../bin/delegate', import.meta.url), 'utf8');
  assert.ok(!/x-bella-max-mode/i.test(server) && !/X-Bella-Max-Mode/.test(bin));
});
