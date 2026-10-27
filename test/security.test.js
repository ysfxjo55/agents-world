import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkRequest, originAllowed } from '../server/auth.js';
import { safeArchive, createUpdater } from '../server/updater.js';
import { saveSettings } from '../server/config.js';

// Security checks, written as attacks: each one must be refused.
const port = 4321;

test('DNS rebinding: a request addressed to another host name is refused, even from this computer', () => {
  for (const host of ['evil.example:4321', 'localhost.evil.example:4321', 'localhost:4322', '0.0.0.0:4321', '[::1]:4321', '', undefined])
    assert.equal(checkRequest({ host, port }).ok, false, String(host));
  assert.equal(checkRequest({ host: 'localhost:4321', port }).ok, true);
});

test('another website cannot change anything: foreign Origin or Sec-Fetch-Site is refused on writes', () => {
  assert.equal(originAllowed('https://evil.example', { port }), false);
  assert.equal(originAllowed('http://localhost:3000', { port }), false);                 // another app on this computer
  assert.equal(originAllowed('null', { port }), false);                                  // sandboxed frames and files
  assert.equal(originAllowed(undefined, { port, fetchSite: 'cross-site' }), false);     // no Origin, but the browser says cross-site
  assert.equal(originAllowed(undefined, { port, fetchSite: 'same-site' }), false);
  assert.equal(originAllowed('http://localhost:4321', { port, fetchSite: 'same-origin' }), true);
  assert.equal(originAllowed(undefined, { port, fetchSite: 'none' }), true);             // typed in the address bar
  assert.equal(originAllowed(undefined, { port }), true);                                // not a browser (a tool on this computer)
});

test('updates: a download with paths that leave its folder is refused (zip-slip)', () => {
  assert.equal(safeArchive(['agents-world-main/', 'agents-world-main/server/index.js']), true);
  for (const bad of [['../evil.js'], ['agents-world-main/../../.zshrc'], ['/etc/passwd'], ['C:/Windows/x'], ['a\\..\\..\\x'], []])
    assert.equal(safeArchive(bad), false, JSON.stringify(bad));
});

test('updates: nothing is installed when there is no newer version', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-sec-')); fs.writeFileSync(path.join(root, 'package.json'), '{"version":"0.3.0"}');
  const same = async (url) => (url.endsWith('package.json') ? { ok: true, json: async () => ({ version: '0.2.9' }) } : { ok: false });
  const u = createUpdater({ root, doFetch: /** @type {any} */ (same), log: () => {} });
  await u.check(); assert.equal(u.state.available, false);
  assert.match((await u.install()).error, /no newer version/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('settings are saved readable only by you (they can hold your ntfy topic)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-perm-')), file = path.join(dir, 'config.json');
  saveSettings({ name: 'Sam' }, file);
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);   // Windows has no Unix file permissions
  fs.rmSync(dir, { recursive: true, force: true });
});
