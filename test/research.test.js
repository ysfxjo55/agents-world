import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

const RDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-research-'));
process.env.AGENT_WORLD_RESEARCH_DIR = RDIR;
process.env.AGENT_WORLD_UPLOADS = path.join(RDIR, 'uploads');
const R = await import('../server/research.js');
const RUNNER = path.join(import.meta.dirname, '..', 'bin', 'research-run.mjs');
const { md } = await import('../public/md.js');

test('depth levels get deeper, and unknown ones fall back to deep', () => {
  assert.ok(R.DEPTHS.standard.minSearches < R.DEPTHS.deep.minSearches && R.DEPTHS.deep.minSearches < R.DEPTHS.exhaustive.minSearches);
  assert.equal(R.depthConfig('nonsense'), R.DEPTHS.deep);
});
test('job ids are strict, so a path can never be smuggled in', () => {
  assert.match(R.newJobId(), R.JOB_ID);
  for (const bad of ['../etc', '20261010-zzzzzz', '', '20261010-abc', 'x/y']) assert.throws(() => R.jobDir(bad), /bad job id/);
});
test('a plan must have the right number of well-formed questions', () => {
  const q = (n) => Array.from({ length: n }, (_, i) => ({ id: `Q ${i}`, title: `Question number ${i}`, brief: 'Find out the details from official and press sources.' }));
  assert.equal(R.validatePlan({ questions: q(8) }, 'deep').ok, true);
  assert.equal(R.validatePlan({ questions: q(3) }, 'deep').ok, false);
  assert.equal(R.validatePlan({ questions: q(20) }, 'deep').ok, false);
  assert.equal(R.validatePlan({ questions: [{ title: 'x', brief: 'y' }] }, 'smoke').ok, false);
  assert.equal(R.validatePlan(null).ok, false);
  const ok = R.validatePlan({ questions: q(8) }, 'deep'); assert.equal(new Set(ok.plan.questions.map(x => x.id)).size, 8);   // ids are cleaned and unique
});
test('usage-limit style failures are recognised, normal failures are not', () => {
  for (const t of ["You've hit your session limit · resets 5:20am (Asia/Riyadh)", 'Claude AI usage limit reached', 'API Error: 429 rate limit', 'overloaded_error', 'Your limit resets at 3pm']) assert.equal(R.limitHit(t), true, t);
  for (const t of ['syntax error in plan', 'ENOENT: no such file', '']) assert.equal(R.limitHit(t), false, t);
});
test('network trouble is recognised as temporary, real errors are not', () => {
  for (const x of ['fetch failed', 'getaddrinfo EAI_AGAIN api.anthropic.com', 'read ECONNRESET', 'The network connection was lost', 'request timed out']) assert.equal(R.transientHit(x), true, x);
  for (const x of ['plan.json is not valid', 'Permission denied', 'syntax error']) assert.equal(R.transientHit(x), false, x);
});
test('prompts carry the topic, the input files, and the depth minimums', () => {
  const job = { topic: 'Topic ABC', depth: 'deep', docs: ['a.pdf'] };
  const p = R.buildPrompts(job), q = p.question({ id: 'q1', title: 'T?', brief: 'B' }, 2, 7);
  assert.match(p.plan, /Topic ABC/); assert.match(p.plan, /inputs\/a\.pdf/);
  assert.match(q, /sub-question 2 of 7/); assert.match(q, /notes\/q1\.md/); assert.match(q, new RegExp(`${R.DEPTHS.deep.minSearches} different searches`));
  assert.match(p.review, new RegExp(`${R.DEPTHS.deep.verify} most important`));
});

// a fake `claude`: understands the four phases, counts as web activity, can pretend to hit a usage limit once
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-fakeclaude-'));
const FAKE = path.join(dir, 'claude.cjs');   // .cjs: run with Node on every system, Windows too
fs.writeFileSync(FAKE, `#!/usr/bin/env node
const fs = require('fs'), path = require('path');
let p = ''; process.stdin.on('data', c => p += c); process.stdin.on('end', () => {
  const out = (o) => console.log(JSON.stringify(o));
  // like the real thing, a resumed session remembers its original task
  const av = process.argv, flag = (n) => (av.includes(n) ? av[av.indexOf(n) + 1] : null), sid = flag('--session-id') || flag('--resume'), memo = path.join(process.env.FAKE_STATE || '.', 'sess-' + sid);
  if (/PHASE \\d/.test(p)) fs.writeFileSync(memo, p); else if (fs.existsSync(memo)) p = fs.readFileSync(memo, 'utf8');
  const limitMark = path.join(process.env.FAKE_STATE || '.', 'limit-done');
  if (process.env.FAKE_NET_ONCE && /PHASE 2/.test(p) && !fs.existsSync(limitMark)) { fs.writeFileSync(limitMark, '1'); out({ type: 'result', is_error: true, result: 'API Error: fetch failed' }); process.exit(1); }
  if (process.env.FAKE_LIMIT_ONCE && /PHASE 2/.test(p) && !fs.existsSync(limitMark)) { fs.writeFileSync(limitMark, '1'); out({ type: 'result', is_error: true, result: 'Claude AI usage limit reached' }); process.exit(1); }
  out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'WebSearch', input: { query: 'x' } }, { type: 'tool_use', name: 'WebFetch', input: { url: 'https://a.b' } }] } });
  if (/PHASE 1/.test(p)) fs.writeFileSync('plan.json', JSON.stringify({ topic: 't', questions: [{ id: 'q1', title: 'What is X exactly?', brief: 'Find out what X is from official sources.' }] }));
  else if (/PHASE 2/.test(p)) fs.writeFileSync('notes/' + p.match(/notes\\/([\\w-]+)\\.md/)[1] + '.md', '# Findings\\n' + 'detail '.repeat(80));
  else if (/PHASE 3/.test(p)) fs.writeFileSync('report.md', '# Report\\n' + 'content '.repeat(300));
  else if (/PHASE 4/.test(p)) fs.writeFileSync('review.md', 'Checked 2 claims against their sources and changed nothing. ' + 'verified '.repeat(20));
  out({ type: 'result', is_error: false, result: 'ok' });
});
`, { mode: 0o755 });

const runJob = (extraEnv = {}) => new Promise((resolve, reject) => {
  const job = { id: R.newJobId(), topic: 'Testing the pipeline with a fake agent', depth: 'smoke', maxHours: 1, docs: [], createdAt: Date.now(), status: 'queued' };
  R.writeJob(job);
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-state-'));
  execFile(process.execPath, [RUNNER, job.id], { env: { ...process.env, AGENT_WORLD_RESEARCH_BIN: FAKE, AGENT_WORLD_RESEARCH_RETRY_MS: '300', FAKE_STATE: state, ...extraEnv }, timeout: 60000 }, (err) => err ? reject(err) : resolve(R.readJob(job.id)));
});

test('the runner plans, investigates, writes, reviews, and counts the web activity', async () => {
  const job = await runJob();
  assert.equal(job.status, 'done', JSON.stringify({ error: job.error, warnings: job.warnings }));
  assert.deepEqual(job.phases.map(p => p.key), ['plan', 'q-q1', 'report', 'review']);
  assert.ok(job.phases.every(p => p.status === 'done' && p.sessionId));
  assert.ok(R.readReport(job.id).startsWith('# Report'));
  assert.equal(job.stats.searches, 4); assert.equal(job.stats.pages, 4);          // 4 phases x (1 search + 1 page)
  assert.equal(job.runnerPid, null);
});
test('research usage records every phase separately without inventing missing counts', async () => {
  const file = path.join(dir, 'research-usage.jsonl');
  const job = await runJob({ AGENT_WORLD_USAGE_FILE: file });
  const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(rows.length, 4);
  assert.ok(rows.every(r => r.tool === 'claude' && r.source === 'research' && r.status === 'completed' && r.inputTokens === null && r.contextId.startsWith(job.id + ':')));
});
test('a usage limit in the night is waited out, then the work continues', async () => {
  const job = await runJob({ FAKE_LIMIT_ONCE: '1' });
  assert.equal(job.status, 'done', JSON.stringify({ error: job.error, warnings: job.warnings, phases: job.phases.map(p => [p.key, p.status, p.attempts, p.note]) }));
  assert.equal(job.phases.find(p => p.key === 'q-q1').attempts, 2, 'the investigation was retried once after the limit');
});
test('a network drop is waited out and does not use up the failure allowance', async () => {
  const job = await runJob({ FAKE_NET_ONCE: '1', AGENT_WORLD_RESEARCH_NET_MS: '300' });
  assert.equal(job.status, 'done', JSON.stringify(job.warnings));
  assert.equal(job.phases.find(p => p.key === 'q-q1').attempts, 2);
});
test('finished jobs are listed newest first and the session map links sessions to their job', async () => {
  const jobs = R.listJobs(); assert.ok(jobs.length >= 2); assert.ok(jobs[0].createdAt >= jobs[1].createdAt);
  const map = R.researchSessionMap();
  assert.ok([...map.values()].some(v => /Research plan/.test(v.title)));
});

test('uploaded documents are checked by their content, not their name', async () => {
  const { docType } = await import('../server/uploads.js');
  assert.equal(docType(Buffer.from('%PDF-1.7\n...')), 'pdf');
  assert.equal(docType(Buffer.from('plain notes about my topic\nline two')), 'txt');
  assert.equal(docType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2])), null);        // a PNG with a .pdf name is still refused
  assert.equal(docType(Buffer.from([0x4d, 0x5a, 0, 0, 1, 2, 3])), null);               // a program (contains NUL bytes)
  assert.equal(docType(Buffer.from([0xff, 0xfe, 0xfd, 0xc3, 0x28])), null);            // not valid UTF-8 text
});

/* ---------- the review's findings, as tests ---------- */
test('the researcher environment is an allow-list: tokens and keys never reach it', () => {
  const env = R.cleanEnv({ PATH: '/usr/bin', HOME: '/h', GH_TOKEN: 'secret1', AWS_SECRET_ACCESS_KEY: 'secret2', OPENAI_API_KEY: 'secret3', ANTHROPIC_API_KEY: 'ok', LANG: 'en_US.UTF-8' }, ['/extra']);
  assert.equal(env.GH_TOKEN, undefined); assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined); assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.ANTHROPIC_API_KEY, 'ok'); assert.equal(env.HOME, '/h'); assert.ok(env.PATH.startsWith('/extra:'));
});
test('a pid only counts as the runner if its command line says so (pids get reused after a reboot)', () => {
  const job = { id: '20261010-abcdef', runnerPid: 4242 };
  const io = (cmd, alive = true) => ({ alive: () => alive, cmd: () => cmd });
  assert.equal(R.runnerAlive(job, io('/usr/local/bin/node /app/bin/research-run.mjs 20261010-abcdef')), true);
  assert.equal(R.runnerAlive(job, io('/Applications/Safari.app/Contents/MacOS/Safari')), false);          // some other program got the pid
  assert.equal(R.runnerAlive(job, io('node bin/research-run.mjs 20261010-ffffff')), false);                // the runner of a different job
  assert.equal(R.runnerAlive(job, io('node bin/research-run.mjs 20261010-abcdef', false)), false);
  assert.equal(R.runnerAlive({ id: job.id }, io('x')), false);
});
test('a resume of a session that never existed is recognised', () => {
  assert.equal(R.noSuchSession('No conversation found with session ID: abc'), true);
  assert.equal(R.noSuchSession('fetch failed'), false);
});
test('the renderer is safe and robust: no HTML from the text, safe links only, no crash on odd input', () => {
  const evil = md('<img src=x onerror=alert(1)> <script>x</script>\n\n[click](javascript:alert(1)) [ok](https://a.b/c) [n](#r-sources)');
  assert.ok(!/<img|<script/.test(evil)); assert.ok(!/href="javascript/.test(evil)); assert.match(evil, /href="https:\/\/a\.b\/c"/); assert.match(evil, /href="#r-sources"/);
  assert.doesNotThrow(() => md('text with the placeholder char \uE000 0 \uE000 inside'));
  assert.match(md('[w](https://en.wikipedia.org/wiki/Foo_(bar))'), /Foo_\(bar\)"/);                      // parentheses inside a URL
  assert.match(md('| a | b |\n|---|---|\n| x \\| y | z |'), /<td>x \| y<\/td>/);                      // an escaped pipe stays inside its cell
  const ids = [...md('## Sources\n\n## Sources\n\n## toc', { ids: true }).matchAll(/id="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(ids, ['r-sources', 'r-sources-2', 'r-toc']);                                          // prefixed and unique
});

// a fake claude that is slow, to test Stop and shutdown behaviour of the runner
const slow = path.join(dir, 'claude-slow.cjs');
fs.writeFileSync(slow, 'setTimeout(() => {}, 60000);\n');
const startSlow = () => {
  const job = { id: R.newJobId(), topic: 'Testing stop and shutdown semantics', depth: 'smoke', maxHours: 1, docs: [], createdAt: Date.now(), status: 'running' };
  R.writeJob(job);
  const { spawn } = require_child();
  const c = spawn(process.execPath, [RUNNER, job.id], { env: { ...process.env, AGENT_WORLD_RESEARCH_BIN: slow }, stdio: 'ignore', detached: true });
  return { job, c };
};
import * as childProcess from 'node:child_process';
const require_child = () => childProcess;
const waitFor = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await new Promise(r => setTimeout(r, 100)); } return false; };

test('Stop (status written first) ends the runner and the status stays "stopped"', async () => {
  const { job, c } = startSlow();
  assert.ok(await waitFor(() => R.readJob(job.id)?.phases?.some(p => p.status === 'running')), 'runner started its first phase');
  const j = R.readJob(job.id); j.status = 'stopped'; R.writeJob(j); process.kill(-c.pid, 'SIGTERM');                     // exactly what the Stop route does
  assert.ok(await waitFor(() => !R.pidAlive(c.pid)), 'runner exited');
  assert.equal(R.readJob(job.id).status, 'stopped');
});
test('a Mac shutdown (plain SIGTERM) leaves the job "running", so it resumes by itself later', async () => {
  const { job, c } = startSlow();
  assert.ok(await waitFor(() => R.readJob(job.id)?.phases?.some(p => p.status === 'running')));
  process.kill(c.pid, 'SIGTERM');
  assert.ok(await waitFor(() => !R.pidAlive(c.pid)), 'runner exited');
  const after = R.readJob(job.id); assert.equal(after.status, 'running'); assert.equal(after.runnerPid, null);          // resumeOrphans will pick this up
});
test('a second runner for the same job exits at once instead of doubling the work', async t => {
  try { childProcess.execFileSync('ps', ['-p', String(process.pid), '-o', 'command='], { stdio: 'pipe' }); }
  catch (e) {
    if (e.code === 'EPERM') return t.skip('Sandbox denies ps; duplicate runner detection requires process inspection.');
    throw e;
  }
  const { job, c } = startSlow();
  assert.ok(await waitFor(() => R.readJob(job.id)?.runnerPid === c.pid));
  const { spawn } = childProcess; let out = '';
  const second = spawn(process.execPath, [RUNNER, job.id], { env: { ...process.env, AGENT_WORLD_RESEARCH_BIN: slow }, timeout: 8000 }); second.stdout.on('data', d => { out += d; });
  const code = await new Promise(r => second.on('close', r));
  process.kill(-c.pid, 'SIGKILL');
  assert.equal(code, 0); assert.match(out, /already working/);
});
test('a hung claude (no output) is killed by the idle watchdog and the run is retried', async () => {
  const job = { id: R.newJobId(), topic: 'Testing the idle watchdog now', depth: 'smoke', maxHours: 1, docs: [], createdAt: Date.now(), status: 'running' };
  R.writeJob(job);
  const { spawn } = childProcess; const c = spawn(process.execPath, [RUNNER, job.id], { env: { ...process.env, AGENT_WORLD_RESEARCH_BIN: slow, AGENT_WORLD_RESEARCH_IDLE_MS: '700', AGENT_WORLD_RESEARCH_NET_MS: '200' }, stdio: 'ignore', detached: true });
  assert.ok(await waitFor(() => (R.readJob(job.id)?.phases?.[0]?.attempts || 0) >= 2, 15000), 'the hung run was killed and retried');
  process.kill(-c.pid, 'SIGKILL');
});

test('the researcher definition is read from the repo and handed to the CLI as JSON', () => {
  const j = JSON.parse(R.agentJson());
  assert.ok(j['deep-researcher'].description.length > 20); assert.ok(j['deep-researcher'].prompt.includes('Short conclusion'));
  const bad = path.join(dir, 'bad.md'); fs.writeFileSync(bad, 'no front matter here');
  assert.throws(() => R.agentJson(bad), /front matter/);
});

test('chat attachments: PDF, text and Word files are accepted by content; junk is refused', async () => {
  const { saveAny, uploadPath } = await import('../server/uploads.js');
  const pdf = saveAny(Buffer.from('%PDF-1.4\n%fake')), txt = saveAny(Buffer.from('hello notes'));
  assert.equal(pdf.kind, 'file'); assert.equal(txt.kind, 'file');
  assert.ok(uploadPath(pdf.id) && uploadPath(txt.id));
  assert.equal(saveAny(Buffer.from([0, 1, 2, 3, 250, 251])), null);                   // binary junk
  assert.equal(uploadPath('../../etc/passwd'), null);
});

test('file downloads: only documents in Downloads/Desktop/Documents, no hidden files, no symlink escape', async () => {
  const { resolveDownload } = await import('../server/files.js');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-'));
  fs.mkdirSync(path.join(home, 'Downloads')); fs.mkdirSync(path.join(home, '.ssh')); fs.mkdirSync(path.join(home, 'Downloads', '.hid'));
  fs.writeFileSync(path.join(home, 'Downloads', 'a b.docx'), 'x'); fs.writeFileSync(path.join(home, 'Downloads', 'run.sh'), 'x');
  fs.writeFileSync(path.join(home, '.ssh', 'key.txt'), 'secret'); fs.writeFileSync(path.join(home, 'Downloads', '.hid', 'n.txt'), 'x');
  fs.symlinkSync(path.join(home, '.ssh', 'key.txt'), path.join(home, 'Downloads', 'link.txt'));
  assert.equal(resolveDownload(path.join(home, 'Downloads', 'a b.docx'), home)?.name, 'a b.docx');
  assert.equal(resolveDownload('~/Downloads/a b.docx', home)?.name, 'a b.docx');
  for (const bad of ['Downloads/a b.docx', path.join(home, 'Downloads', 'run.sh'), path.join(home, '.ssh', 'key.txt'), path.join(home, 'Downloads', '.hid', 'n.txt'), path.join(home, 'Downloads', 'link.txt'), path.join(home, 'Downloads', '..', '.ssh', 'key.txt'), '/etc/passwd']) assert.equal(resolveDownload(bad, home), null, bad);
});

test('the wait after a usage limit follows the reset time in the message', () => {
  const at = (h, m = 0) => new Date(2026, 9, 14, h, m, 0);
  assert.equal(R.resetWaitMs("You've hit your session limit · resets 5:20am (Asia/Riyadh)", at(1, 0)), (4 * 60 + 20) * 60_000 + 60_000);
  assert.equal(R.resetWaitMs('resets 9pm', at(20, 0)), 3600_000 + 60_000);
  assert.equal(R.resetWaitMs('resets 5:20am', at(9, 0)) , null);                 // tomorrow is more than 9 hours away: use the normal retry instead
  assert.equal(R.resetWaitMs('API Error 429', at(1)), null);
});

test('a job whose runner died before saving a deadline still gets one from its start time', () => {
  const start = Date.UTC(2026, 9, 23);
  assert.equal(R.jobDeadline({ createdAt: start, maxHours: 2 }), start + 2 * 3600_000);
  assert.equal(R.jobDeadline({ startedAt: start, deadline: 5 }), 5);
  assert.ok(R.jobDeadline({}) > 0);
});
