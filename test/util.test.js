import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { body, resolveCwd } from '../server/util.js';

// a fake request: emits the given chunks, then "end"
const makeReq = () => /** @type {any} */ (Object.assign(new EventEmitter(), { pause() {} }));
const fake = (chunks, { end = true } = {}) => { const r = makeReq(); setImmediate(() => { chunks.forEach(c => r.emit('data', c)); if (end) r.emit('end'); }); return r; };

test('body() parses JSON', async () => assert.deepEqual(await body(fake(['{"a":', '1}'])), { a: 1 }));
test('body() treats an empty body as {}', async () => assert.deepEqual(await body(fake([])), {}));
test('body() rejects invalid JSON with 400', async () => await assert.rejects(body(fake(['{bad'])), { status: 400 }));
test('body() rejects an oversized body with 413 instead of hanging', async () => await assert.rejects(body(fake(['x'.repeat(200)], { end: false }), 100), { status: 413 }));
test('body() rejects when the client disconnects mid-way', async () => {
  const r = makeReq(); setImmediate(() => r.emit('close'));
  await assert.rejects(body(r), { status: 400 });
});

test('resolveCwd: no request falls back to home', () => {
  assert.equal(resolveCwd(undefined, ['/p'], '/life', '/home/me'), '/home/me');
  assert.equal(resolveCwd('', ['/p'], '/life', '/home/me'), '/home/me');
});
test('resolveCwd: a known project folder is allowed', () => {
  assert.equal(resolveCwd('/p', ['/p', '/q'], '/life', '/home/me'), '/p');
});
test('resolveCwd: the life folder is allowed when it exists', () => {
  assert.equal(resolveCwd('/life', ['/p'], '/life', '/home/me'), '/life');
});
test('resolveCwd: the life folder is refused when it does not exist', () => {
  assert.equal(resolveCwd('/life', ['/p'], null, '/home/me'), null);
});
test('resolveCwd: unknown folders are refused', () => {
  assert.equal(resolveCwd('/etc', ['/p'], '/life', '/home/me'), null);
});

test('body() keeps a 2-byte letter that is split between two network chunks', async () => {
  const bytes = Buffer.from(JSON.stringify({ t: 'مرحبا' }));
  const cut = bytes.indexOf(0xd9) + 1;                     // in the middle of the first Arabic letter
  assert.deepEqual(await body(fake([bytes.subarray(0, cut), bytes.subarray(cut)])), { t: 'مرحبا' });
});

import { isTodayChat } from '../server/util.js';
test('isTodayChat only accepts Claude chats in the life folder', () => {
  assert.equal(isTodayChat({ tool: 'claude', cwd: '/app/life' }, '/app/life'), true);
  assert.equal(isTodayChat({ tool: 'claude', cwd: '/app/life/' }, '/app/life'), true);
  assert.equal(isTodayChat({ tool: 'claude', cwd: '/app/other' }, '/app/life'), false);
  assert.equal(isTodayChat({ tool: 'codex', cwd: '/app/life' }, '/app/life'), false);
  assert.equal(isTodayChat(undefined, '/app/life'), false);
  assert.equal(isTodayChat({ tool: 'claude', cwd: '/app/life' }, null), false);
});

test('PATH for the agents: ":" on Mac and Linux, ";" and the native Claude folder on Windows', async () => {
  const { toolPath, withToolPath } = await import('../server/util.js');
  assert.match(toolPath({ PATH: '/x' }, 'darwin', '/h'), /^\/h\/\.local\/bin:.*:\/x$/);
  assert.equal(toolPath({ Path: 'C:\\Windows' }, 'win32', 'C:\\Users\\a'), 'C:\\Users\\a\\.local\\bin;C:\\Windows');
  const env = withToolPath({ Path: 'C:\\Windows', TEMP: 't' }, 'win32', 'C:\\Users\\a');
  assert.deepEqual(Object.keys(env).filter(k => k.toUpperCase() === 'PATH'), ['PATH'], 'one PATH key, not two');
});

test('Windows: an npm .cmd tool is started as node + its script, never through a shell', async () => {
  const { resolveBin } = await import('../server/util.js');
  const files = { 'C:\\npm\\claude.cmd': '@ECHO off\r\n"%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*\r\n' };
  const io = { platform: 'win32', env: { PATH: 'C:\\bin;C:\\npm' }, exists: (f) => f in files, read: (f) => files[f] };
  const r = resolveBin('claude', ['-p', 'hi & del *'], io);
  assert.equal(r.cmd, process.execPath);
  assert.deepEqual(r.args, ['C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js', '-p', 'hi & del *']);
  files['C:\\bin\\claude.exe'] = '';
  assert.equal(resolveBin('claude', [], io).cmd, 'C:\\bin\\claude.exe', 'a real .exe wins');
  assert.deepEqual(resolveBin('claude', ['x'], { platform: 'darwin' }), { cmd: 'claude', args: ['x'] });
});

test('new AGENTS_WORLD_* setting names work, and an old AGENT_WORLD_* name that is set wins', async () => {
  const { applyNewEnvNames } = await import('../server/env-names.js');
  const env = applyNewEnvNames({ AGENTS_WORLD_PORT: '4400', AGENTS_WORLD_HOSTS: 'new', AGENT_WORLD_HOSTS: 'old' });
  assert.equal(env.AGENT_WORLD_PORT, '4400');
  assert.equal(env.AGENT_WORLD_HOSTS, 'old');
});

test('CSP hash of an inline script is the same for a page with Windows (CRLF) line ends', async () => {
  const { inlineScriptHashes } = await import('../server/util.js');
  const lf = '<script type="importmap">\n{ "imports": {} }\n</script><script src="x.js"></script>';
  const want = `'sha256-${(await import('node:crypto')).createHash('sha256').update('\n{ "imports": {} }\n').digest('base64')}'`;
  assert.equal(inlineScriptHashes(lf), want);
  assert.equal(inlineScriptHashes(lf.replace(/\n/g, '\r\n')), want);   // what the browser hashes after it turns CRLF into LF
});

test('Windows: our bin tools run as "node <path>", folder rules use Claude Code\'s /c/... form, script fakes run with Node', async () => {
  const { toolCommand, rulePath, resolveBin } = await import('../server/util.js');
  assert.equal(toolCommand('C:\\app\\bin\\remember', 'win32'), 'node C:/app/bin/remember');
  assert.equal(toolCommand('/app/bin/remember', 'darwin'), '/app/bin/remember');
  assert.equal(rulePath('C:\\Users\\USER3\\agents-world\\data\\bella\\memory', 'win32'), '/c/Users/USER3/agents-world/data/bella/memory');
  assert.equal(rulePath('/Users/u/data', 'darwin'), '/Users/u/data');
  assert.deepEqual(resolveBin('C:\\t\\fake.mjs', ['-p'], { platform: 'win32' }), { cmd: process.execPath, args: ['C:\\t\\fake.mjs', '-p'] });
  assert.deepEqual(resolveBin('/t/fake.cjs', [], { platform: 'darwin' }), { cmd: process.execPath, args: ['/t/fake.cjs'] });
});
