import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installStarter } from '../server/starter.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('first start copies the starter files into data/, and never overwrites your own', () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-starter-'));
  fs.mkdirSync(path.join(data, 'interstellar'), { recursive: true });
  fs.writeFileSync(path.join(data, 'interstellar', 'AGENTS.md'), 'mine');
  const copied = installStarter(ROOT, data);
  assert.equal(fs.readFileSync(path.join(data, 'interstellar', 'AGENTS.md'), 'utf8'), 'mine');
  assert.ok(fs.existsSync(path.join(data, 'bella', 'memory', 'MEMORY.md')));
  assert.ok(fs.existsSync(path.join(data, 'interstellar', 'memory', 'MEMORY.md')));
  assert.ok(!copied.some(f => f.endsWith('README.md')));
  assert.deepEqual(installStarter(ROOT, data), [], 'a second start copies nothing');
  fs.rmSync(data, { recursive: true, force: true });
});
