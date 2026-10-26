import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { personaFor, codexPersonaPrompt, stripPersona } from '../server/family-persona.js';
import { startRun, REMEMBER_CMD } from '../server/chat.js';

test('family personas depend on engine and exclude both parents and OpenCode', () => {
  for (const tool of ['claude', 'codex', 'opencode']) for (const agent of ['bella', 'interstellar']) assert.equal(personaFor({ tool, agent }), null);
  assert.equal(personaFor({ tool: 'opencode', agent: 'builder' }), null);
  for (const [tool, parent] of [['claude', 'Mom'], ['codex', 'Dad']]) {
    const text = personaFor({ tool, agent: 'builder' });
    assert.match(text, new RegExp(parent)); assert.match(text, /Honesty first/); assert.match(text, /Serious mode:/); assert.match(text, /No emojis/);
    assert.equal(text.split('\n').length, 7);
  }
});
test('Codex instructions apply to new threads only and can be hidden from transcripts', () => {
  assert.match(codexPersonaPrompt('hello', 'builder', null), /^\[Family instructions\]/);
  assert.equal(stripPersona(codexPersonaPrompt('hello', null, null)), 'hello');
  assert.equal(codexPersonaPrompt('hello', 'builder', 'old'), 'hello');
  assert.equal(codexPersonaPrompt('hello', 'interstellar', null), 'hello');
});
test('real runner with fake CLIs injects Claude persona on resume, preserves Bella, and supplies remember', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'persona-')), bin = path.join(dir, 'fake.mjs'), output = path.join(dir, 'call.json');
  fs.writeFileSync(bin, `#!${process.execPath}\nimport fs from 'node:fs'; let text=''; process.stdin.on('data', d=>text+=d); process.stdin.on('end',()=>fs.writeFileSync(${JSON.stringify(output)},JSON.stringify({args:process.argv.slice(2),text})));`, { mode: 0o755 });
  process.env.AGENT_WORLD_TEST_CLAUDE_BIN = bin;
  process.env.AGENT_WORLD_TEST_CODEX_BIN = bin;
  try {
    for (const tool of ['claude', 'codex']) for (const agent of [tool === 'claude' ? 'bella' : 'interstellar', null]) for (const sessionId of [null, 'old']) {
      // Interstellar has a fixed home, tested elsewhere; no need to spawn it here.
      if (agent === 'interstellar') continue;
      await new Promise(resolve => startRun({ tool, agent, sessionId, cwd: dir, text: 'hello', mode: 'readonly' }, () => {}, resolve));
      const call = JSON.parse(fs.readFileSync(output, 'utf8'));
      if (tool === 'claude') {
        const i = call.args.indexOf('--append-system-prompt'); assert.ok(i >= 0);
        assert.match(call.args[i + 1], agent === 'bella' ? /Your tools right now/ : /Bella's daughter/);
        assert.ok(call.args.some(a => a.includes(`Bash(${REMEMBER_CMD}:*)`)));
      } else assert.equal(call.text, codexPersonaPrompt('hello', agent, sessionId));
    }
  } finally {
    delete process.env.AGENT_WORLD_TEST_CLAUDE_BIN; delete process.env.AGENT_WORLD_TEST_CODEX_BIN;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
