import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startRun, buildCodexArgs, COMPACT_TOKENS, CODEX_COMPACT_TOKENS } from '../server/chat.js';

test('every Claude run (new or resumed, Bella or not) compacts at COMPACT_TOKENS, not near 1M', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compact-')), bin = path.join(dir, 'fake.mjs'), output = path.join(dir, 'env.json');
  fs.writeFileSync(bin, `#!${process.execPath}\nimport fs from 'node:fs'; process.stdin.resume(); process.stdin.on('end',()=>fs.writeFileSync(${JSON.stringify(output)},JSON.stringify(process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW ?? null)));`, { mode: 0o755 });
  process.env.AGENT_WORLD_TEST_CLAUDE_BIN = bin;
  try {
    assert.ok(COMPACT_TOKENS >= 100_000 && COMPACT_TOKENS <= 250_000);   // Claude Code accepts 100k to 1M
    for (const agent of ['bella', null]) for (const sessionId of [null, 'old']) {
      fs.rmSync(output, { force: true });
      await new Promise(resolve => startRun({ tool: 'claude', agent, sessionId, cwd: dir, text: 'hi', mode: 'readonly' }, () => {}, resolve));
      assert.equal(JSON.parse(fs.readFileSync(output, 'utf8')), String(COMPACT_TOKENS));
    }
  } finally {
    delete process.env.AGENT_WORLD_TEST_CLAUDE_BIN;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Codex runs get a compact limit before the resume subcommand', () => {
  const args = buildCodexArgs({ cwd: '/tmp', mode: 'readonly', sessionId: 'old' });
  const i = args.indexOf(`model_auto_compact_token_limit=${CODEX_COMPACT_TOKENS}`);
  assert.ok(i > 0 && args[i - 1] === '-c' && i < args.indexOf('resume'));
});
