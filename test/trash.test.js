import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// use throw-away folders, never the real trash or real sessions
const TRASH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-trash-'));
process.env.AGENT_WORLD_TRASH_DIR = TRASH;
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-home-'));   // so the Claude projects folder is a throw-away one
const { CLAUDE_ROOT } = await import('../server/sources/claude.js');
const mkOrig = () => { fs.mkdirSync(CLAUDE_ROOT, { recursive: true }); return fs.mkdtempSync(path.join(CLAUDE_ROOT, 'orig-')); };
const { listTrash, restoreSession, emptyTrash } = await import('../server/trash.js');

function fakeEntry(id, origDir, { extras = false } = {}) {
  const dir = path.join(TRASH, id); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'session.jsonl'), '{"hello":1}\n');
  if (extras) { fs.mkdirSync(path.join(dir, 'extras')); fs.writeFileSync(path.join(dir, 'extras', 'x.txt'), 'x'); }
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ id, tool: 'claude', sessionId: 'abc', title: 't', cwd: origDir, origDir, deletedAt: 1 }));
  return dir;
}

test('listTrash shows an entry that has its label', () => {
  const orig = mkOrig();
  fakeEntry('t1', orig);
  assert.ok(listTrash().some(x => x.id === 't1'));
});
test('restore puts the session back and removes it from the trash', async () => {
  const orig = mkOrig();
  fakeEntry('t2', orig, { extras: true });
  assert.deepEqual(await restoreSession('t2'), { ok: true });
  assert.ok(fs.existsSync(path.join(orig, 'abc.jsonl')));
  assert.ok(fs.existsSync(path.join(orig, 'abc', 'x.txt')));
  assert.ok(!listTrash().some(x => x.id === 't2'));
});
test('restore refuses, and moves nothing, if the destination already exists', async () => {
  const orig = mkOrig();
  fs.writeFileSync(path.join(orig, 'abc.jsonl'), 'already here');
  const dir = fakeEntry('t3', orig, { extras: true });
  const r = await restoreSession('t3');
  assert.equal(r.ok, false);
  assert.equal(fs.readFileSync(path.join(orig, 'abc.jsonl'), 'utf8'), 'already here');   // untouched
  assert.ok(fs.existsSync(path.join(dir, 'session.jsonl')) && fs.existsSync(path.join(dir, 'extras')));   // still in trash, complete
});
test('restore refuses when only the extras destination already exists', async () => {
  const orig = mkOrig();
  fs.mkdirSync(path.join(orig, 'abc'));
  const dir = fakeEntry('t4', orig, { extras: true });
  assert.equal((await restoreSession('t4')).ok, false);
  assert.ok(fs.existsSync(path.join(dir, 'session.jsonl')));                              // the session file was NOT moved on its own
  assert.ok(!fs.existsSync(path.join(orig, 'abc.jsonl')));
});
test('restore rejects a bad id', async () => assert.equal((await restoreSession('../etc')).ok, false));
test('emptyTrash removes everything', () => { emptyTrash(); assert.deepEqual(listTrash(), []); });

test('restore refuses a Claude session whose saved folder is outside the Claude projects folder', async () => {
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-elsewhere-'));
  const dir = fakeEntry('t5', elsewhere);
  const r = await restoreSession('t5');
  assert.equal(r.ok, false);
  assert.ok(!fs.existsSync(path.join(elsewhere, 'abc.jsonl')));
  assert.ok(fs.existsSync(path.join(dir, 'session.jsonl')));                               // still in trash
});

test('Empty Trash is refused for requests that come through Tailscale', () => {
  const server = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  assert.match(server, /p === '\/api\/trash\/empty'\) \{\n\s+if \(auth\.remote\) return json\(res, 403/);
});
