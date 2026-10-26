import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runToFile } from '../server/trash.js';

test('a big output written by a program that exits right away is NOT cut off', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-run-')), 'out.json');
  // prints ~400 KB of JSON and exits immediately: through a pipe this used to stop at 64 KB
  await runToFile(process.execPath, ['-e', "process.stdout.write(JSON.stringify({ messages: 'x'.repeat(400000) })); process.exit(0);"], {}, file);
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(parsed.messages.length, 400000);
});
test('a failing command is reported, not swallowed', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-run-')), 'out.json');
  await assert.rejects(runToFile(process.execPath, ['-e', "console.error('boom'); process.exit(3);"], {}, file), /boom/);
});
