#!/usr/bin/env node
// Runs one research job to the end, in the background: node bin/research-run.mjs <job-id>
//   PLAN -> one fresh INVESTIGATE session per sub-question -> WRITE the report -> REVIEW and verify it.
// Safe to start again: finished phases are skipped, an interrupted phase is continued (so a restart, a crash or a reboot costs little).
// The agent can only touch <job>/work. job.json (this runner's own state) is next to it, out of its reach.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { config } from '../server/config.js';
import { RunUsage } from '../server/usage-ledger.js';
import { resolveBin } from '../server/util.js';
import { readJob, writeJob, workDir, validatePlan, buildPrompts, limitHit, resetWaitMs, transientHit, noSuchSession, cleanEnv, runnerAlive, agentJson } from '../server/research.js';

const id = process.argv[2];
let job = readJob(id);
if (!job) { console.error('unknown job', id); process.exit(1); }
if (job.runnerPid && job.runnerPid !== process.pid && runnerAlive(job)) { console.log('another runner is already working on this job'); process.exit(0); }   // never two runners for one job

const work = workDir(id);
fs.mkdirSync(path.join(work, 'notes'), { recursive: true });
const BIN = process.env.AGENT_WORLD_RESEARCH_BIN || 'claude';
const num = (v, d) => Number(v) || d;
const RETRY_MS = num(process.env.AGENT_WORLD_RESEARCH_RETRY_MS, 20 * 60_000);       // after a usage limit / overload
const NET_MS = num(process.env.AGENT_WORLD_RESEARCH_NET_MS, 2 * 60_000);            // after a network problem
const IDLE_MS = num(process.env.AGENT_WORLD_RESEARCH_IDLE_MS, 25 * 60_000);         // a claude run silent this long is hung
const HARD_MS = num(process.env.AGENT_WORLD_RESEARCH_HARD_MS, 150 * 60_000);        // one run never lasts longer than this
const SOFT_EXTRA_MS = 2 * 3600_000;                                                 // the report/review phases may run this long past the deadline
const env = cleanEnv(process.env, process.platform === 'win32' ? [path.join(os.homedir(), '.local', 'bin')] : [path.join(os.homedir(), '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin']);   // no tokens or keys from your shell
env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = '150000';   // summarize old history at 150k tokens instead of ~967k (same as COMPACT_TOKENS in server/chat.js)
if (process.env.AGENT_WORLD_RESEARCH_BIN) for (const [k, v] of Object.entries(process.env)) if (k.startsWith('FAKE_')) env[k] = v;   // tests only: switches for the fake claude
// --restricted: no shell, and file tools confined to the work folder. Web search/fetch and writing there are all it gets.
const TOOLS = 'Read,Grep,Glob,WebSearch,WebFetch,Write,Edit';
// The web tool must never reach this computer's own servers: not localhost, and not the Tailscale name that leads back here.
const NO_FETCH = ['localhost', '127.0.0.1', '0.0.0.0', '::1', ...config.hosts.map(h => h.split(':')[0])].map(h => `WebFetch(domain:${h})`).join(',');
let AGENTS; try { AGENTS = agentJson(); } catch (e) { job.status = 'error'; job.error = `Cannot load the researcher definition: ${e.message}`; job.runnerPid = null; writeJob(job); console.error(job.error); process.exit(1); }

const log = (...a) => console.log(new Date().toISOString(), ...a);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const exists = (f, min = 1) => { try { return fs.statSync(path.join(work, f)).size >= min; } catch { return false; } };
let child = null, lastSave = 0, stopping = false, activeUsage = null;

function die(why) { stopping = true; activeUsage?.finish({ status: 'stopped' }); log('stopping:', why); try { child?.kill('SIGKILL'); } catch { /* gone */ } process.exit(0); }
// Saving never crashes the run. If the user pressed Stop (the server wrote "stopped" first), obey and leave the file alone.
function save(force = false) {
  if (!force && Date.now() - lastSave < 4000) return;
  lastSave = Date.now();
  try { const cur = readJob(id); if (cur && cur.status === 'stopped' && !stopping) die('stopped by the user'); writeJob(job); }
  catch (e) { log('save failed (will retry):', e.message); }
}

// keep the computer awake for as long as this process lives (idle sleep; -s needs the charger)
try { const c = spawn('caffeinate', ['-i', '-s', '-w', String(process.pid)], { stdio: 'ignore', detached: true }); c.on('error', () => {}); c.unref(); } catch { /* not macOS */ }

job.runnerPid = process.pid; job.status = 'running'; job.error = null;
job.startedAt ||= Date.now();
job.deadline ||= job.startedAt + (job.maxHours || 10) * 3600_000;
job.stats ||= { searches: 0, pages: 0, repos: 0 }; job.phases ||= []; job.warnings ||= [];
save(true);
// A shutdown or reboot (SIGTERM) is NOT a user stop: the status stays "running", so the job resumes by itself at the next start.
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { stopping = true; activeUsage?.finish({ status: 'stopped' }); try { child?.kill('SIGKILL'); } catch { /* gone */ } try { const cur = readJob(id); if (cur?.status !== 'stopped') { job.runnerPid = null; writeJob(job); } } catch { /* ignore */ } process.exit(0); });

// one claude run for one phase; resolves { ok, text, limit }
function runClaude(phase, prompt, resume) {
  return new Promise((resolve) => {
    const usage = new RunUsage({ tool: 'claude', source: 'research', agent: 'deep-researcher', sessionId: phase.sessionId, contextId: job.id + ':' + phase.key, attempt: phase.attempts });
    activeUsage = usage;
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--agents', AGENTS, '--agent', 'deep-researcher', '--restricted', '--strict-mcp-config', '--disallowedTools', NO_FETCH, '--tools', TOOLS, '--permission-mode', 'acceptEdits', '--allowedTools', 'WebSearch,WebFetch,Write,Edit', '--add-dir', work];
    if (resume) args.push('--resume', phase.sessionId); else args.push('--session-id', phase.sessionId);
    const r = resolveBin(BIN, args, { env });
    child = spawn(r.cmd, r.args, { cwd: work, env, stdio: ['pipe', 'pipe', 'pipe'] });
    const me = child; let buf = '', text = '', err = '', isErr = false, lastData = Date.now(), finished = false, forced = '';
    const done = (r) => { if (finished) return; finished = true; clearInterval(watch); clearTimeout(hard); usage.finish({ status: r.ok ? 'completed' : stopping ? 'stopped' : 'failed' }); resolve(r); };
    const kill = (why) => { forced = why; try { me.kill('SIGKILL'); } catch { /* gone */ } };
    const watch = setInterval(() => { if (Date.now() - lastData > IDLE_MS) kill(`no output for ${Math.round(IDLE_MS / 60000)} minutes (network stall)`); }, Math.min(30_000, IDLE_MS));
    const hard = setTimeout(() => kill(`one run took longer than ${Math.round(HARD_MS / 60000)} minutes`), HARD_MS);
    me.stdin.on('error', () => {}); me.stdin.end(prompt);
    me.stdout.setEncoding('utf8');
    me.stdout.on('data', (c) => {
      lastData = Date.now(); buf += c; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let d; try { d = JSON.parse(line); } catch { continue; }
        usage.observe(d);
        if (d.type === 'assistant') for (const b of d.message?.content || []) {
          if (b.type !== 'tool_use') continue;
          phase.tools = (phase.tools || 0) + 1;
          const url = String(b.input?.url || '');
          if (b.name === 'WebSearch') job.stats.searches++;
          else if (b.name === 'WebFetch') { job.stats.pages++; if (/^https?:\/\/(www\.|api\.|raw\.)?(github\.com|githubusercontent\.com|api\.github\.com)/i.test(url)) job.stats.repos++; }   // repo lookups = GitHub pages
          job.lastActivity = Date.now(); job.lastTool = `${b.name} ${String(b.input?.query || url || b.input?.file_path || b.input?.pattern || '').slice(0, 90)}`; save();
        }
        if (d.type === 'result') { text = String(d.result || ''); isErr = !!d.is_error; }
      }
    });
    me.stderr.on('data', (c) => { err = (err + c).slice(-800); });
    me.on('error', (e) => done({ ok: false, text: String(e.message), limit: false }));
    me.on('close', (code) => {
      if (buf.trim()) try { const d = JSON.parse(buf); usage.observe(d); if (d.type === 'result') { text = String(d.result || ''); isErr = !!d.is_error; } } catch { /* non-JSON diagnostics are not usage */ }
      const ok = !forced && code === 0 && !isErr; done({ ok, text: forced || text || err, limit: !ok && limitHit(text + ' ' + err), forced: !!forced });
    });
  });
}

const CONTINUE = 'Continue where you stopped and finish this phase. First look at the files already written in the current folder (do not throw away good work), then complete the missing parts.';
// run a phase until its output file exists: wait out usage limits and network trouble, give real failures three tries
async function runPhase(phase, prompt, produced, { soft = false } = {}) {
  if (phase.status === 'done' && produced()) return true;
  let resumeNext = !!phase.sessionId && ['running', 'waiting'].includes(phase.status);     // this phase was interrupted earlier: continue its session
  phase.status = 'running'; phase.startedAt ||= Date.now(); save(true);
  const hardDeadline = job.deadline + (soft ? SOFT_EXTRA_MS : 0);
  let hardFails = 0, netFails = 0;
  for (let attempt = 1; attempt <= 40; attempt++) {
    if (attempt > 1 && Date.now() > hardDeadline) break;
    phase.attempts = (phase.attempts || 0) + 1;
    if (!resumeNext) phase.sessionId = crypto.randomUUID();
    log(`phase ${phase.key} attempt ${phase.attempts}${resumeNext ? ' (continuing)' : ''}`);
    const r = await runClaude(phase, resumeNext ? CONTINUE : prompt, resumeNext);
    if (produced()) { phase.status = 'done'; phase.endedAt = Date.now(); phase.note = undefined; save(true); return true; }
    log(`phase ${phase.key} produced nothing: ${r.text.slice(0, 160).replace(/\n/g, ' ')}`);
    if (!r.ok && noSuchSession(r.text)) { resumeNext = false; continue; }                // that session never existed: start it fresh
    resumeNext = true;
    if (!r.ok && r.limit) { phase.status = 'waiting'; phase.note = 'Claude usage limit or overload. Waiting, then continuing.'; const wait = resetWaitMs(r.text) || RETRY_MS; phase.note = `Claude usage limit. Waiting ${Math.round(wait / 60000)} minutes, then continuing.`; save(true); await sleep(wait); phase.status = 'running'; continue; }
    if (!r.ok && (transientHit(r.text) || r.forced)) {                                    // judged only when the run really failed, never from the model's own wording
      if (++netFails > 12) break;
      phase.status = 'waiting'; phase.note = 'Network problem (the computer may have slept). Waiting, then continuing.'; save(true); await sleep(NET_MS); phase.status = 'running'; continue;
    }
    if (++hardFails >= 3) break;
    phase.note = `attempt ${phase.attempts} failed: ${r.text.slice(0, 120)}`; save(true);
    await sleep(Math.min(RETRY_MS, 15_000));
  }
  phase.status = 'failed'; phase.endedAt = Date.now(); save(true); return false;
}

const find = (key, title) => { let p = job.phases.find(x => x.key === key); if (!p) { p = { key, title, status: 'pending', tools: 0 }; job.phases.push(p); } return p; };
const fail = (msg) => { job.status = 'error'; job.error = msg; job.runnerPid = null; save(true); };

(async () => {
  const short = job.topic.replace(/\s+/g, ' ').slice(0, 48), prompts = buildPrompts(job);
  // 1. plan
  const planOk = await runPhase(find('plan', `Research plan: ${short}`), prompts.plan, () => { try { return validatePlan(JSON.parse(fs.readFileSync(path.join(work, 'plan.json'), 'utf8')), job.depth).ok; } catch { return false; } });
  if (!planOk) return fail('Could not make a research plan.');
  const plan = validatePlan(JSON.parse(fs.readFileSync(path.join(work, 'plan.json'), 'utf8')), job.depth).plan;
  job.plan = plan.questions.map(q => ({ id: q.id, title: q.title }));
  // 2. investigate every sub-question in its own fresh session
  let done = 0;
  for (const [i, q] of plan.questions.entries()) {
    const ph = find(`q-${q.id}`, `Research Q${i + 1}: ${q.title.slice(0, 60)}`);
    if (Date.now() > job.deadline && ph.status !== 'done') { job.warnings = job.warnings.filter(w => !/^Time limit/.test(w)); job.warnings.push(`Time limit reached: ${done} of ${plan.questions.length} sub-questions were researched.`); break; }
    if (await runPhase(ph, prompts.question(q, i + 1, plan.questions.length), () => exists(`notes/${q.id}.md`, 300))) done++;
    else job.warnings.push(`Sub-question ${i + 1} ("${q.title}") could not be finished.`);
    save(true);
  }
  if (!done) return fail('No sub-question produced findings.');
  // 3. write the report, 4. review it
  if (!await runPhase(find('report', 'Research report: writing'), prompts.synth, () => exists('report.md', 1500), { soft: true })) return fail('The report could not be written (your notes are saved in the job folder).');
  if (!await runPhase(find('review', 'Research report: verifying'), prompts.review, () => exists('review.md', 100), { soft: true })) job.warnings.push('The final verification pass did not finish; the report is unreviewed.');
  job.status = 'done'; job.finishedAt = Date.now(); job.runnerPid = null; save(true);
  log('job finished');
})().catch((e) => { log('runner crashed', e); try { if (readJob(id)?.status === 'stopped') process.exit(0); job.error = String(e.message || e); job.runnerPid = null; job.status = 'error'; writeJob(job); } catch { /* ignore */ } process.exit(1); });
