import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../public/chat.js', import.meta.url), 'utf8');

test('the chat page never restores Full access or Build from the last visit', () => {
  assert.match(src, /S\.mode === 'full' \|\| S\.mode === 'build'\) S\.mode = 'readonly'/);
});

test('the mode labels match what the server really does', () => {
  assert.doesNotMatch(src, /never change anything/);
  assert.doesNotMatch(src, /answer, read and save to my memory/);
  assert.match(src, /Bella herself can edit files in this mode/);
});

test('a blocked-command notice names the mode the message was sent with', () => {
  assert.match(src, /blocked in "\$\{MODES\[run\.mode\]\}" mode/);
  assert.match(src, /const run = \{ key, mode: S\.mode,/);
});

test('finishing one chat cannot remove the run of a new draft chat', () => {
  assert.match(src, /if \(S\.runs\.get\('__draft__'\) === run\) S\.runs\.delete\('__draft__'\)/);
});

test('the server tells the page the run id immediately, so Stop works before the first event', () => {
  const server = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  assert.match(server, /t: 'accepted', runId/);
});

test('every page uses the one app name, Agent World', () => {
  for (const f of ['index', 'chat', 'family', 'research', 'today']) {
    const html = fs.readFileSync(new URL(`../public/${f}.html`, import.meta.url), 'utf8');
    assert.match(html, /<title>[^<]*Agent World[^<]*<\/title>/, f);
  }
});

test('build mode cannot call the app itself with curl (it could start a full-access agent that way)', async () => {
  const { MODES } = await import('../server/chat.js');
  assert.ok(!MODES.build.join(' ').includes('curl'));
});
