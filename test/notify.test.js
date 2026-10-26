import test from 'node:test';
import assert from 'node:assert/strict';
import { createDoneWatcher, desktopNotify, ntfyNotify, makeNotifier } from '../server/notify.js';

const NOW = 1_000_000_000_000;
const ses = (key, status, extra = {}) => ({ key, status, cwd: `/p/${key}`, title: `task ${key}`, ...extra });
const watcher = (opts = {}) => { const sent = []; return { sent, check: createDoneWatcher({ notify: (a) => sent.push(a), nameOf: (s) => s.cwd.slice(3), ...opts }) }; };

test('a session going from working to finished alerts once, with its name', () => {
  const { sent, check } = watcher();
  check([ses('a', 'working')], NOW);
  check([ses('a', 'needs')], NOW + 2000);
  check([ses('a', 'needs')], NOW + 4000);
  check([ses('a', 'sleeping')], NOW + 90_000);
  assert.deepEqual(sent, [{ title: 'a', message: 'Finished: task a' }]);
});

test('no alerts at startup, even for sessions that are already idle', () => {
  const { sent, check } = watcher();
  check([ses('a', 'needs'), ses('b', 'sleeping'), ses('c', 'working')], NOW);
  check([ses('a', 'sleeping'), ses('b', 'sleeping'), ses('c', 'working')], NOW + 2000);
  assert.equal(sent.length, 0);
});

test('a new session that appears already finished does not alert', () => {
  const { sent, check } = watcher();
  check([], NOW);
  check([ses('a', 'needs')], NOW + 2000);
  assert.equal(sent.length, 0);
});

test('a session that keeps working does not alert', () => {
  const { sent, check } = watcher();
  for (let i = 0; i < 5; i++) check([ses('a', 'working')], NOW + i * 2000);
  assert.equal(sent.length, 0);
});

test('waiting on a long command or a permission prompt is not "finished"', () => {
  const { sent, check } = watcher();
  check([ses('a', 'working')], NOW);
  check([ses('a', 'needs', { currentTool: 'Bash' })], NOW + 2000);
  assert.equal(sent.length, 0);
});

test('a status that flickers does not repeat the alert within a minute', () => {
  const { sent, check } = watcher();
  check([ses('a', 'working')], NOW);
  check([ses('a', 'needs')], NOW + 2000);
  check([ses('a', 'working')], NOW + 4000);
  check([ses('a', 'needs')], NOW + 6000);
  assert.equal(sent.length, 1);
  check([ses('a', 'working')], NOW + 120_000);
  check([ses('a', 'needs')], NOW + 122_000);
  assert.equal(sent.length, 2, 'a real second task later on alerts again');
});

test('archived sessions stay quiet', () => {
  const { sent, check } = watcher();
  check([ses('a', 'working')], NOW);
  check([ses('a', 'needs', { archived: true })], NOW + 2000);
  assert.equal(sent.length, 0);
});

test('sessions marked quiet (family chat replies) never alert', () => {
  const { sent, check } = watcher({ quiet: (s) => s.key === 'fam' });
  check([ses('fam', 'working'), ses('a', 'working')], NOW);
  check([ses('fam', 'needs'), ses('a', 'needs')], NOW + 2000);
  assert.deepEqual(sent.map(x => x.title), ['a']);
});

test('a notifier that throws does not break the watcher', () => {
  const check = createDoneWatcher({ notify: () => { throw new Error('boom'); } });
  check([ses('a', 'working')], NOW);
  assert.equal(check([ses('a', 'needs')], NOW + 2000).length, 1);
});

test('macOS passes the text as arguments, never inside the script', async () => {
  let call;
  const run = (cmd, args, opts, cb) => { call = { cmd, args }; cb(null); };
  const evil = 'x" & do shell script "rm -rf ~" & "';
  assert.equal(await desktopNotify({ title: evil, message: 'm' }, { platform: 'darwin', run }), true);
  assert.equal(call.cmd, 'osascript');
  assert.equal(call.args[2], evil);
  assert.ok(!call.args[1].includes(evil));
});

test('Windows passes the text in environment variables', async () => {
  let call;
  const run = (cmd, args, opts, cb) => { call = { cmd, args, opts }; cb(null); };
  await desktopNotify({ title: 't', message: '$(evil)' }, { platform: 'win32', run });
  assert.equal(call.cmd, 'powershell.exe');
  assert.equal(call.opts.env.AW_MESSAGE, '$(evil)');
  assert.ok(!call.args.join(' ').includes('$(evil)'));
});

test('other systems skip desktop alerts quietly', async () => {
  let ran = false;
  assert.equal(await desktopNotify({ title: 't', message: 'm' }, { platform: 'linux', run: () => { ran = true; } }), false);
  assert.equal(ran, false);
});

test('ntfy posts the text in the body', async () => {
  let req;
  const ok = await ntfyNotify({ title: 'proj', message: 'Finished: x' }, 'https://ntfy.sh/topic', async (url, o) => { req = { url, o }; return { ok: true }; });
  assert.equal(ok, true);
  assert.equal(req.url, 'https://ntfy.sh/topic');
  assert.equal(req.o.method, 'POST');
  assert.equal(req.o.body, 'proj: Finished: x');
});

test('a failing ntfy never throws', async () => {
  assert.equal(await ntfyNotify({ title: 't', message: 'm' }, 'https://ntfy.sh/t', async () => { throw new Error('offline'); }), false);
});

test('settings: alerts can be turned off, ntfy is off by default', async () => {
  assert.equal(makeNotifier({ desktop: false, ntfy: '' }), null);
  const calls = [];
  const n = makeNotifier({ desktop: true }, { platform: 'darwin', run: (c, a, o, cb) => { calls.push(c); cb(null); }, fetch: async () => { calls.push('fetch'); return { ok: true }; } });
  await n({ title: 't', message: 'm' });
  assert.deepEqual(calls, ['osascript']);
  const both = makeNotifier({ desktop: false, ntfy: 'https://ntfy.sh/t' }, { fetch: async () => { calls.push('fetch'); return { ok: true }; } });
  await both({ title: 't', message: 'm' });
  assert.deepEqual(calls, ['osascript', 'fetch']);
});
