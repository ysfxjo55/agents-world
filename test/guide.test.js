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
    ['about', { type: 'name-saved' }, { type: 'about-saved' }],
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
  assert.deepEqual(STEPS.map(x => x.id), ['welcome', 'connect', 'name', 'about', 'chat', 'wait', 'access', 'world', 'done']);
});

test('"started" outside the wait step changes nothing', () => {
  const s = at('chat');
  assert.equal(onEvent(s, { type: 'started', key: 'x' }), s);
});

test('skip moves on one step; the last step finishes the guide', () => {
  assert.equal(idOf(onEvent(at('name'), { type: 'skip' })), 'about');
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
  for (const raw of ['nope', '{}', '{"v":3,"status":"active","step":99}', '{"v":3,"status":"weird","step":0}', '{"v":2,"status":"active","step":3}', 'null']) assert.deepEqual(load(raw), fresh(), raw);
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
  assert.deepEqual(found, { claude: { installed: true, dir: '/h/.local/bin', onPath: true, loggedIn: true }, codex: { installed: true, dir: '/usr/local/bin', onPath: true, loggedIn: true }, opencode: { installed: false, loggedIn: false }, antigravity: { installed: false, loggedIn: false } });
  const none = detectEngines({ env: { PATH: '' }, platform: 'darwin', home, exists: () => false, read: () => '{}' });
  assert.equal(engineSummary(none).any, false);
  assert.equal(engineSummary(none).bella, null);
});

test('Claude only gives Bella, Codex only gives Interstellar; a setting can move an agent; an uninstalled setting is ignored', () => {
  const both = { claude: { installed: true }, codex: { installed: true } }, onlyClaude = { claude: { installed: true } }, onlyCodex = { codex: { installed: true } };
  assert.deepEqual([engineFor('bella', both), engineFor('interstellar', both)], ['claude', 'codex']);
  assert.deepEqual([engineFor('bella', onlyClaude), engineFor('interstellar', onlyClaude)], ['claude', null]);
  assert.deepEqual([engineFor('bella', onlyCodex), engineFor('interstellar', onlyCodex)], [null, 'codex']);
  assert.equal(engineFor('interstellar', onlyClaude, { interstellar: { engine: 'claude' } }), 'claude');   // old configs that chose Claude still work
  assert.equal(engineFor('interstellar', both, { interstellar: { engine: 'claude' } }), 'claude');
  assert.equal(engineFor('bella', onlyClaude, { bella: { engine: 'codex' } }), 'claude');
  assert.equal(engineFor('interstellar', onlyClaude, { interstellar: { engine: 'codex' } }), null);
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

test('one engine: only its own manager is shown and may chat', async () => {
  const { chatAccessError, bellaCodexPrompt, interstellarPrompt } = await import('../server/chat.js');
  const { setEngines, currentEngines } = await import('../server/engines.js');
  const before = currentEngines();
  try {
    const { agentShown } = await import('../server/engines.js');
    setEngines(engineSummary({ claude: { installed: true, loggedIn: true } }));
    assert.equal(chatAccessError({ tool: 'claude', mode: 'readonly', agent: 'bella', remote: false }), null);
    assert.match(chatAccessError({ tool: 'claude', mode: 'readonly', agent: 'interstellar', remote: false }).error, /Install/);
    assert.deepEqual([agentShown('bella'), agentShown('interstellar')], [true, false]);
    setEngines(engineSummary({ codex: { installed: true, loggedIn: true } }));
    assert.equal(chatAccessError({ tool: 'codex', mode: 'readonly', agent: 'interstellar', remote: false }), null);
    assert.deepEqual([agentShown('bella'), agentShown('interstellar')], [false, true]);
    setEngines(engineSummary({ claude: { installed: true }, codex: { installed: true } }));
    assert.deepEqual([agentShown('bella'), agentShown('interstellar')], [true, true]);
    setEngines(engineSummary({ opencode: { installed: true } }));
    assert.deepEqual([agentShown('bella'), agentShown('interstellar')], [true, true]);   // nothing usable yet: nothing is hidden
    assert.match(chatAccessError({ tool: 'codex', mode: 'readonly', agent: 'architect', remote: false }).error, /Claude Code/);
  } finally { setEngines(before); }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-p-'));
  fs.writeFileSync(path.join(dir, 'bella.md'), '---\r\nname: bella\r\n---\r\nYou are Bella.');   // Windows line ends
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
  const home = 'C:\\Users\\Sam', exe = 'C:\\Users\\Sam\\.local\\bin\\claude.exe', npm = 'C:\\Users\\Sam\\AppData\\Roaming\\npm';
  const env = { Path: 'C:\\Windows', APPDATA: 'C:\\Users\\Sam\\AppData\\Roaming', USERPROFILE: home };
  const files = new Set([exe, npm + '\\codex.cmd']);
  const before = detectEngines({ env, platform: 'win32', home, userPath: '', exists: (f) => files.has(f), read: () => '{}' });
  assert.deepEqual(before.claude, { installed: true, dir: 'C:\\Users\\Sam\\.local\\bin', onPath: false, loggedIn: false });
  assert.equal(before.codex.dir, npm);                                         // the npm global folder is a known folder too
  const after = detectEngines({ env, platform: 'win32', home, userPath: 'C:\\Users\\Sam\\.local\\bin', exists: (f) => files.has(f), read: () => '{}' });
  assert.equal(after.claude.onPath, true);
  // "Check again" re-reads the saved user PATH from the registry, expanding %USERPROFILE%
  const reg = '\r\nHKEY_CURRENT_USER\\Environment\r\n    Path    REG_EXPAND_SZ    %USERPROFILE%\\.local\\bin;C:\\Tools\r\n';
  assert.equal(refreshUserPath({ platform: 'win32', env, run: () => reg }), 'C:\\Users\\Sam\\.local\\bin;C:\\Tools');
  assert.match(toolPath(env, 'win32', home), /^C:\\Users\\Sam\\\.local\\bin;C:\\Users\\Sam\\AppData\\Roaming\\npm;C:\\Windows;C:\\Users\\Sam\\\.local\\bin;C:\\Tools$/);
  assert.equal(refreshUserPath({ platform: 'win32', env, run: () => { throw new Error('no reg'); } }), '');
  assert.equal(refreshUserPath({ platform: 'darwin', env, run: () => reg }), '');
});

test('pathFix gives the PATH command and a full-path command to log in now', () => {
  const w = pathFix('claude', 'C:\\Users\\Sam\\.local\\bin', 'win');
  assert.equal(w.fix, '[Environment]::SetEnvironmentVariable("Path", [Environment]::GetEnvironmentVariable("Path","User") + ";$env:USERPROFILE\\.local\\bin", "User")');
  assert.equal(w.run, '& "C:\\Users\\Sam\\.local\\bin\\claude.exe"');
  assert.equal(pathFix('codex', 'C:\\Users\\U\\AppData\\Roaming\\npm', 'win').run, '& "C:\\Users\\U\\AppData\\Roaming\\npm\\codex.cmd"');
  const m = pathFix('claude', '/Users/u/.local/bin', 'mac');
  assert.equal(m.fix, `echo 'export PATH="/Users/u/.local/bin:$PATH"' >> ~/.zshrc`);
  assert.equal(m.run, '"/Users/u/.local/bin/claude"');
});

test('no 3D: the stand-in world does nothing safely; a dead connection shows help', async () => {
  const { nullWorld } = await import('../public/null-world.js');
  const { watchConnection, CONN_HELP } = await import('../public/conn-hint.js');
  const w = /** @type {any} */ (nullWorld({}));
  w.setTheme('x'); w.sync([]); assert.equal(w.pick(), null); assert.equal(w.screenPos('k'), null); assert.equal(w.buildings.size, 0);
  let shown = null, timer = null;
  const c = watchConnection(/** @type {any} */ ({ show: (t) => { shown = t; }, hide: () => { shown = null; }, setTimer: (f) => { timer = f; return 1; }, clearTimer: () => { timer = null; } }));
  timer(); assert.equal(shown, CONN_HELP);                      // nothing arrived in time
  c.ok(); assert.equal(shown, null);
  c.error(); c.error(); assert.equal(shown, null); c.error(); assert.equal(shown, CONN_HELP);   // three errors in a row
});

test('updates: version compare, changelog notes, git or ZIP, never touch data, turned off', async () => {
  const { compareVersions, notesFor, installKind, shouldCopy, copyRelease, createUpdater } = await import('../server/updater.js');
  assert.equal(compareVersions('0.2.10', '0.2.9'), 1);
  assert.equal(compareVersions('0.2.0', '0.2'), 0);
  assert.equal(compareVersions('1.0.0', '1.0.1'), -1);
  assert.equal(compareVersions('garbage', '0.0.1'), -1);
  const log = '## 0.3.0\n- c\n\n## 0.2.1\r\n- b\n## 0.2.0\n- a\n';
  assert.deepEqual(notesFor(log, '0.2.0', '0.3.0'), ['c', 'b']);
  assert.deepEqual(notesFor(log, '0.2.0', '0.2.1'), ['b']);
  assert.equal(installKind('/x', (f) => f === path.join('/x', '.git')), 'git');
  assert.equal(installKind('/x', () => false), 'zip');
  for (const p of ['data/config.json', 'data', '.env', '.env.local', 'node_modules/three/x.js', '.git/HEAD', 'life/board.json', '../evil']) assert.equal(shouldCopy(p), false, p);
  for (const p of ['server/index.js', 'public/main.js', 'README.md', 'package.json', 'Agents World.cmd']) assert.equal(shouldCopy(p), true, p);
  // a ZIP update copies app files, keeps data, and backs up what it replaced
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-up-')), from = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-new-')), backup = path.join(root, 'data', 'backups', 'b');
  fs.mkdirSync(path.join(root, 'data')); fs.writeFileSync(path.join(root, 'data', 'config.json'), 'mine'); fs.writeFileSync(path.join(root, 'app.js'), 'old');
  fs.mkdirSync(path.join(from, 'data')); fs.writeFileSync(path.join(from, 'data', 'config.json'), 'theirs'); fs.writeFileSync(path.join(from, 'app.js'), 'new');
  assert.equal(copyRelease(from, root, backup), 1);
  assert.equal(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), 'new');
  assert.equal(fs.readFileSync(path.join(root, 'data', 'config.json'), 'utf8'), 'mine');
  assert.equal(fs.readFileSync(path.join(backup, 'app.js'), 'utf8'), 'old');
  // the check: newer version found; nothing asked when turned off; quiet when GitHub says 404
  fs.writeFileSync(path.join(root, 'package.json'), '{"version":"0.2.0"}');
  const fake = async (url) => (url.endsWith('package.json') ? { ok: true, json: async () => ({ version: '0.2.1' }) } : { ok: true, text: async () => '## 0.2.1\n- fixed it\n' });
  const u = createUpdater({ root, doFetch: /** @type {any} */ (fake), log: () => {} });
  await u.check();
  assert.deepEqual([u.state.available, u.state.latest, u.state.notes, u.state.kind], [true, '0.2.1', ['fixed it'], 'zip']);
  let asked = 0;
  const off = createUpdater({ root, settings: { check: false }, doFetch: /** @type {any} */ (async () => { asked++; return fake(''); }), log: () => {} });
  await off.check(); assert.equal(asked, 0); assert.equal(off.state.available, false);
  const lines = [], gone = createUpdater({ root, doFetch: /** @type {any} */ (async () => ({ ok: false, status: 404 })), log: (m) => lines.push(m) });
  await gone.check(); assert.equal(gone.state.available, false); assert.match(lines[0], /404/);
  const busy = createUpdater({ root, busy: () => true, doFetch: /** @type {any} */ (fake), log: () => {} });
  assert.match((await busy.install()).error, /still working/);   // never while an agent works
  fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(from, { recursive: true, force: true });
});

test('git update: stops when you changed app files, else pulls fast-forward only', async () => {
  const { updateGit } = await import('../server/updater.js');
  const calls = [];
  assert.throws(() => updateGit('/x', (cmd, args) => { calls.push(args.join(' ')); return ' M server/index.js\n'; }), /changed some app files/);
  assert.equal(calls.length, 1);
  const ok = []; updateGit('/x', (cmd, args) => { ok.push(`${cmd} ${args.join(' ')}`); return ''; });
  assert.deepEqual(ok, ['git status --porcelain --untracked-files=no', 'git pull --ff-only origin main']);
});

test('git update: a package-lock.json changed by an older npm is reset, pulled, then rebuilt with npm ci', async () => {
  const { updateGit } = await import('../server/updater.js');
  const calls = []; updateGit('/x', (cmd, args) => { calls.push(`${cmd} ${args.join(' ')}`); return cmd === 'git' && args[0] === 'status' ? ' M package-lock.json\n' : ''; });
  assert.deepEqual(calls, ['git status --porcelain --untracked-files=no', 'git checkout -- package-lock.json', 'git pull --ff-only origin main', 'npm ci --no-audit --no-fund']);
  assert.throws(() => updateGit('/x', () => ' M package-lock.json\n M server/index.js\n'), /changed some app files/);
});

test('Instructions panel: save, keep Bella findable, size limits, reset to default, about line', async () => {
  const { saveOne, resetOne, readAll, checkBella, LIMITS } = await import('../server/instructions.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ins-'));
  const places = { bella: { file: path.join(dir, 'agents', 'bella.md'), starter: path.join(dir, 'bella.start.md') }, interstellar: { file: path.join(dir, 'data', 'AGENTS.md'), starter: path.join(dir, 'int.start.md') } };
  fs.writeFileSync(places.bella.starter, '---\nname: bella\n---\nDefault Bella.'); fs.writeFileSync(places.interstellar.starter, 'Default Interstellar.');
  let about = null; const saveAbout = (t) => { about = t; };
  assert.deepEqual(saveOne('bella', '---\r\nname: bella\r\n---\r\nKind and short.', { places, saveAbout }), { ok: true });
  assert.match(saveOne('bella', 'no header', { places, saveAbout }).error, /first lines/);
  assert.equal(checkBella('---\nname: other\n---\nx'), false);
  assert.match(saveOne('interstellar', '   ', { places, saveAbout }).error, /empty/);
  assert.match(saveOne('interstellar', 'x'.repeat(LIMITS.file + 1), { places, saveAbout }).error, /under/);
  assert.deepEqual(saveOne('interstellar', 'Builds things.', { places, saveAbout }), { ok: true });
  assert.match(saveOne('about', 'y'.repeat(LIMITS.about + 1), { places, saveAbout }).error, /under/);
  assert.deepEqual(saveOne('about', '  I am learning.  ', { places, saveAbout }), { ok: true }); assert.equal(about, 'I am learning.');
  assert.match(saveOne('robot', 'x', { places, saveAbout }).error, /Unknown/);
  assert.deepEqual(readAll(places, 'me'), { bella: '---\r\nname: bella\r\n---\r\nKind and short.', interstellar: 'Builds things.', about: 'me' });
  assert.equal(resetOne('interstellar', { places, saveAbout }).text, 'Default Interstellar.');
  assert.equal(fs.readFileSync(places.interstellar.file, 'utf8'), 'Default Interstellar.');
  resetOne('about', { places, saveAbout }); assert.equal(about, '');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a git clone checks for updates with git (private repos work, never a login prompt); a ZIP install uses HTTPS', async () => {
  const { latestFromGit, createUpdater } = await import('../server/updater.js');
  const calls = [], run = (cmd, args) => { calls.push(args.join(' ')); return args[0] === 'show' ? (args[1].endsWith('package.json') ? '{"version":"0.2.2"}' : '## 0.2.2\n- test update\n') : ''; };
  assert.deepEqual(latestFromGit('/x', run), { version: '0.2.2', changelog: '## 0.2.2\n- test update\n' });
  assert.deepEqual(calls, ['fetch --quiet origin main', 'show origin/main:package.json', 'show origin/main:CHANGELOG.md']);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-gitup-')); fs.mkdirSync(path.join(root, '.git')); fs.writeFileSync(path.join(root, 'package.json'), '{"version":"0.2.1"}');
  let https = 0;
  const u = createUpdater({ root, run, doFetch: /** @type {any} */ (async () => { https++; return { ok: false, status: 404 }; }), log: () => {} });
  await u.check();
  assert.deepEqual([u.state.kind, u.state.available, u.state.latest, u.state.notes, https], ['git', true, '0.2.2', ['test update'], 0]);
  const lines = [], fail = createUpdater({ root, run: () => { throw new Error('fatal: could not read Username\nmore'); }, log: (m) => lines.push(m) });
  await fail.check(); assert.equal(fail.state.available, false); assert.deepEqual(lines, ['update check skipped: fatal: could not read Username']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('?preview-update shows a pretend 9.9.9 with this copy\'s changelog lines, and installs nothing', async () => {
  const { previewState } = await import('../server/updater.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-prev-'));
  fs.writeFileSync(path.join(root, 'CHANGELOG.md'), '## 0.2.1\n- new panel\n## 0.2.0\n- updates\n');
  const p = previewState({ current: '0.2.1', available: false, latest: null, notes: [] }, root);
  assert.deepEqual([p.preview, p.available, p.latest, p.notes], [true, true, '9.9.9', ['new panel', 'updates']]);
  fs.rmSync(root, { recursive: true, force: true });
});

test('update checks are throttled: a page opening twice in 10 minutes asks GitHub once', async () => {
  const { createUpdater } = await import('../server/updater.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-thr-')); fs.writeFileSync(path.join(root, 'package.json'), '{"version":"0.2.2"}');
  let asked = 0; const fake = async (url) => { if (url.endsWith('package.json')) asked++; return url.endsWith('package.json') ? { ok: true, json: async () => ({ version: '0.2.2' }) } : { ok: false }; };
  const u = createUpdater({ root, doFetch: /** @type {any} */ (fake), log: () => {} });
  await u.check({ minAgeMs: 600_000 }); await u.check({ minAgeMs: 600_000 });
  assert.equal(asked, 1);
  await u.check(); assert.equal(asked, 2);                       // the hourly check always asks
  assert.equal(u.state.available, false);                         // same version: "You're on the newest version"
  fs.rmSync(root, { recursive: true, force: true });
});
