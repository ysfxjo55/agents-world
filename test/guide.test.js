import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathFix, STEPS, ENGINES, fresh, load, save, onEvent, current, close, restart, isActive, onPage, label, engineWorks } from '../public/guide-logic.js';
import { saveName, saveSettings, parseSince } from '../server/config.js';
import { detectEngines, engineFor, engineSummary } from '../server/engines.js';

const at = (id) => ({ ...fresh(), step: STEPS.findIndex(s => s.id === id) });
const idOf = (s) => current(s)?.id;

test('a first visit (nothing saved) opens the guide at step 1', () => {
  const s = load(null);
  assert.equal(isActive(s), true);
  assert.equal(idOf(s), 'welcome');
  assert.equal(label(s), `Step 1 of ${STEPS.length}`);
});

test('each step moves on only on its own event', () => {
  const cases = [
    ['welcome', { type: 'selected', session: true }, { type: 'next' }],
    ['connect', { type: 'next' }, { type: 'engine-ok' }],
    ['name', { type: 'next' }, { type: 'name-saved' }],
    ['world', { type: 'selected', session: false }, { type: 'selected', session: true }],
    ['chat', { type: 'sent', mode: 'full' }, { type: 'sent', mode: 'readonly' }],
    ['wait', { type: 'sent', mode: 'readonly' }, { type: 'run-done', key: 'k' }],
    ['access', { type: 'run-done', key: 'k' }, { type: 'mode-opened' }],
  ];
  for (const c of cases) {
    const id = String(c[0]), wrong = /** @type {any} */ (c[1]), right = /** @type {any} */ (c[2]);
    const s = at(id);
    assert.equal(onEvent(s, wrong), s, `${id} ignores ${wrong.type}`);
    assert.equal(onEvent(s, right).step, s.step + 1, `${id} moves on with ${right.type}`);
  }
});

test('the wait step only finishes on the run it started', () => {
  let s = onEvent(at('wait'), { type: 'started', key: 'claude:abc' });
  assert.equal(s.runKey, 'claude:abc');
  assert.equal(idOf(s), 'wait');
  assert.equal(onEvent(s, { type: 'run-done', key: 'claude:other' }), s);
  assert.equal(idOf(onEvent(s, { type: 'run-done', key: 'claude:abc' })), 'access');
  assert.deepEqual(STEPS.map(x => x.id), ['welcome', 'connect', 'name', 'chat', 'wait', 'access', 'world', 'done']);
});

test('"started" outside the wait step changes nothing', () => {
  const s = at('chat');
  assert.equal(onEvent(s, { type: 'started', key: 'x' }), s);
});

test('skip moves on one step; the last step finishes the guide', () => {
  assert.equal(idOf(onEvent(at('name'), { type: 'skip' })), 'chat');
  const end = onEvent(at('done'), { type: 'next' });
  assert.equal(end.status, 'done');
  assert.equal(current(end), null);
  assert.equal(onEvent(end, { type: 'next' }), end);            // a finished guide ignores events
});

test('progress survives a reload (save then load)', () => {
  const s = onEvent(at('wait'), { type: 'started', key: 'claude:abc' });
  const back = load(save(s));
  assert.deepEqual(back, s);
  assert.equal(idOf(back), 'wait');
});

test('closed stays closed after a reload, and the Guide button starts again', () => {
  const s = load(save(close(at('world'))));
  assert.equal(isActive(s), false);
  assert.equal(current(s), null);
  assert.equal(idOf(restart()), 'welcome');
});

test('broken saved data starts a fresh guide', () => {
  for (const raw of ['nope', '{}', '{"v":2,"status":"active","step":99}', '{"v":2,"status":"weird","step":0}', '{"v":1,"status":"active","step":3}', 'null']) assert.deepEqual(load(raw), fresh(), raw);
});

test('steps know their page', () => {
  assert.equal(onPage(STEPS.find(s => s.id === 'world'), 'chat'), false);
  assert.equal(onPage(STEPS.find(s => s.id === 'chat'), 'chat'), true);
  assert.equal(onPage(STEPS.find(s => s.id === 'welcome'), 'world'), true);
});

test('saveName keeps the other settings and refuses empty or long names', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-name-')), file = path.join(dir, 'data', 'config.json');
  assert.equal(saveName('  Sam\n ', file), 'Sam');                                  // creates the file and folder
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { name: 'Sam' });
  fs.writeFileSync(file, JSON.stringify({ name: 'Sam', links: [{ name: 'x', url: 'https://x.dev/' }] }));
  assert.equal(saveName('Lee', file), 'Lee');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { name: 'Lee', links: [{ name: 'x', url: 'https://x.dev/' }] });
  assert.equal(saveName('', file), null);
  assert.equal(saveName('x'.repeat(41), file), null);
  assert.equal(saveName(42, file), null);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).name, 'Lee');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the Connect step needs at least one engine that is installed and not logged out', () => {
  assert.equal(engineWorks({}), false);
  assert.equal(engineWorks({ claude: { installed: true, loggedIn: false } }), false);
  assert.equal(engineWorks({ claude: { installed: false, loggedIn: false }, codex: { installed: true, loggedIn: true } }), true);
  for (const e of Object.values(ENGINES)) { assert.ok(e.install.mac && e.install.win && e.login && /^https:\/\//.test(e.docs)); }
});

test('detectEngines finds programs on PATH and login files, without reading tokens', () => {
  const home = '/h', files = new Set(['/h/.local/bin/claude', '/usr/local/bin/codex', '/h/.codex/auth.json']);
  const read = (f) => { assert.equal(f, '/h/.claude.json'); return JSON.stringify({ oauthAccount: { emailAddress: 'x' } }); };
  const found = detectEngines({ env: { PATH: '' }, platform: 'darwin', home, exists: (f) => files.has(f), read });
  assert.deepEqual(found, { claude: { installed: true, dir: '/h/.local/bin', onPath: true, loggedIn: true }, codex: { installed: true, dir: '/usr/local/bin', onPath: true, loggedIn: true }, opencode: { installed: false, loggedIn: false } });
  const none = detectEngines({ env: { PATH: '' }, platform: 'darwin', home, exists: () => false, read: () => '{}' });
  assert.equal(engineSummary(none).any, false);
  assert.equal(engineSummary(none).bella, null);
});

test('with one engine both agents use it; a setting can move an agent; an uninstalled setting is ignored', () => {
  const both = { claude: { installed: true }, codex: { installed: true } }, onlyClaude = { claude: { installed: true } }, onlyCodex = { codex: { installed: true } };
  assert.deepEqual([engineFor('bella', both), engineFor('interstellar', both)], ['claude', 'codex']);
  assert.deepEqual([engineFor('bella', onlyClaude), engineFor('interstellar', onlyClaude)], ['claude', 'claude']);
  assert.deepEqual([engineFor('bella', onlyCodex), engineFor('interstellar', onlyCodex)], ['codex', 'codex']);
  assert.equal(engineFor('interstellar', both, { interstellar: { engine: 'claude' } }), 'claude');
  assert.equal(engineFor('bella', onlyClaude, { bella: { engine: 'codex' } }), 'claude');
  assert.equal(engineFor('bella', { opencode: { installed: true } }), null);
});

test('start fresh: parseSince and saveSettings keep the other settings', () => {
  assert.equal(parseSince(undefined), null);
  assert.equal(parseSince('now', 5), 5);
  assert.equal(parseSince(0), 0);
  assert.equal(parseSince('2026-10-01T00:00:00Z'), Date.parse('2026-10-01T00:00:00Z'));
  assert.equal(parseSince('soon'), null);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-set-')), file = path.join(dir, 'config.json');
  fs.writeFileSync(file, JSON.stringify({ name: 'Sam' }));
  saveSettings({ showSince: 123 }, file);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { name: 'Sam', showSince: 123 });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('one engine: Bella and Interstellar both run on it, and the chat rules follow', async () => {
  const { chatAccessError, bellaCodexPrompt, interstellarPrompt } = await import('../server/chat.js');
  const { setEngines, currentEngines } = await import('../server/engines.js');
  const before = currentEngines();
  try {
    setEngines(engineSummary({ claude: { installed: true, loggedIn: true } }));
    assert.equal(chatAccessError({ tool: 'claude', mode: 'readonly', agent: 'interstellar', remote: false }), null);
    assert.match(chatAccessError({ tool: 'codex', mode: 'readonly', agent: 'interstellar', remote: false }).error, /Claude Code/);
    setEngines(engineSummary({ codex: { installed: true, loggedIn: true } }));
    assert.equal(chatAccessError({ tool: 'codex', mode: 'readonly', agent: 'bella', remote: false }), null);
    assert.match(chatAccessError({ tool: 'codex', mode: 'readonly', agent: 'architect', remote: false }).error, /Claude Code/);
    setEngines(engineSummary({}));
    assert.match(chatAccessError({ tool: 'claude', mode: 'readonly', agent: 'bella', remote: false }).error, /Install/);
  } finally { setEngines(before); }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-p-'));
  fs.writeFileSync(path.join(dir, 'bella.md'), '---\nname: bella\n---\nYou are Bella.');
  const first = bellaCodexPrompt('hi', null, false, { agentsDir: dir, memDir: dir });
  assert.match(first, /^\[Bella instructions\]\nYou are Bella\./);
  assert.match(first, /cannot start other agents/);
  assert.ok(first.endsWith('\n\nhi'));
  assert.equal(bellaCodexPrompt('hi', 'old-session', false, { agentsDir: dir, memDir: dir }), 'hi');   // only the first message carries it
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'I am Interstellar.');
  assert.equal(interstellarPrompt(dir), 'I am Interstellar.');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Windows: Claude Code installed to .local\\bin but not on PATH is found, flagged, and found on PATH after the fix', async () => {
  const { refreshUserPath, toolPath } = await import('../server/util.js');
  const home = 'C:\\Users\\USER3', exe = 'C:\\Users\\USER3\\.local\\bin\\claude.exe', npm = 'C:\\Users\\USER3\\AppData\\Roaming\\npm';
  const env = { Path: 'C:\\Windows', APPDATA: 'C:\\Users\\USER3\\AppData\\Roaming', USERPROFILE: home };
  const files = new Set([exe, npm + '\\codex.cmd']);
  const before = detectEngines({ env, platform: 'win32', home, userPath: '', exists: (f) => files.has(f), read: () => '{}' });
  assert.deepEqual(before.claude, { installed: true, dir: 'C:\\Users\\USER3\\.local\\bin', onPath: false, loggedIn: false });
  assert.equal(before.codex.dir, npm);                                         // the npm global folder is a known folder too
  const after = detectEngines({ env, platform: 'win32', home, userPath: 'C:\\Users\\USER3\\.local\\bin', exists: (f) => files.has(f), read: () => '{}' });
  assert.equal(after.claude.onPath, true);
  // "Check again" re-reads the saved user PATH from the registry, expanding %USERPROFILE%
  const reg = '\r\nHKEY_CURRENT_USER\\Environment\r\n    Path    REG_EXPAND_SZ    %USERPROFILE%\\.local\\bin;C:\\Tools\r\n';
  assert.equal(refreshUserPath({ platform: 'win32', env, run: () => reg }), 'C:\\Users\\USER3\\.local\\bin;C:\\Tools');
  assert.match(toolPath(env, 'win32', home), /^C:\\Users\\USER3\\\.local\\bin;C:\\Users\\USER3\\AppData\\Roaming\\npm;C:\\Windows;C:\\Users\\USER3\\\.local\\bin;C:\\Tools$/);
  assert.equal(refreshUserPath({ platform: 'win32', env, run: () => { throw new Error('no reg'); } }), '');
  assert.equal(refreshUserPath({ platform: 'darwin', env, run: () => reg }), '');
});

test('pathFix gives the PATH command and a full-path command to log in now', () => {
  const w = pathFix('claude', 'C:\\Users\\USER3\\.local\\bin', 'win');
  assert.equal(w.fix, '[Environment]::SetEnvironmentVariable("Path", [Environment]::GetEnvironmentVariable("Path","User") + ";$env:USERPROFILE\\.local\\bin", "User")');
  assert.equal(w.run, '& "C:\\Users\\USER3\\.local\\bin\\claude.exe"');
  assert.equal(pathFix('codex', 'C:\\Users\\U\\AppData\\Roaming\\npm', 'win').run, '& "C:\\Users\\U\\AppData\\Roaming\\npm\\codex.cmd"');
  const m = pathFix('claude', '/Users/u/.local/bin', 'mac');
  assert.equal(m.fix, `echo 'export PATH="/Users/u/.local/bin:$PATH"' >> ~/.zshrc`);
  assert.equal(m.run, '"/Users/u/.local/bin/claude"');
});
