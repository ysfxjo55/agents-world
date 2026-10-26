import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { USER } from './config.js';

// The Research Lab: a topic goes in at night, a long investigation runs in a detached background process (bin/research-run.mjs),
// and a full report is waiting in the morning. All job files live in data/research/<id>/ (git-ignored, private).
export const RESEARCH_DIR = process.env.AGENT_WORLD_RESEARCH_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'research');
export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// How deep each level goes. "smoke" exists only for testing the pipeline cheaply.
export const DEPTHS = {
  smoke:      { label: 'Smoke test', questions: [1, 1], minSearches: 2,  minPages: 2,  verify: 2,  hint: 'a tiny test run' },
  standard:   { label: 'Standard',   questions: [4, 6],   minSearches: 15, minPages: 12, verify: 8,  hint: 'about 1-2 hours' },
  deep:       { label: 'Deep',       questions: [7, 10],  minSearches: 30, minPages: 25, verify: 15, hint: 'about 3-5 hours' },
  exhaustive: { label: 'Exhaustive', questions: [10, 14], minSearches: 50, minPages: 40, verify: 25, hint: 'about 6-10 hours' },
};
export const depthConfig = (d) => DEPTHS[d] || DEPTHS.deep;

export const JOB_ID = /^[0-9]{8}-[0-9a-f]{6}$/;
export const newJobId = () => new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + crypto.randomBytes(3).toString('hex');
export const jobDir = (id) => { if (!JOB_ID.test(id)) throw new Error('bad job id'); return path.join(RESEARCH_DIR, id); };
// The agent works ONLY inside <job>/work: it cannot see or change job.json (the runner's own state) next to it.
export const workDir = (id) => path.join(jobDir(id), 'work');

// The environment the researcher gets: an allow-list, so tokens and keys in your shell (GH_TOKEN, AWS_*, ...) never reach it.
export function cleanEnv(src = process.env, extraPath = [], platform = process.platform) {
  // Windows needs a few more of its own variables (profile folders, temp, system root) to start programs at all.
  const ok = /^(PATH|HOME|USER|LOGNAME|SHELL|LANG|LC_[A-Z]+|TMPDIR|TERM|TZ|ANTHROPIC_[A-Z_]+|CLAUDE_[A-Z_]+|XDG_[A-Z_]+|HTTPS?_PROXY|NO_PROXY|USERPROFILE|APPDATA|LOCALAPPDATA|SYSTEMROOT|WINDIR|COMSPEC|PATHEXT|TEMP|TMP|HOMEDRIVE|HOMEPATH|USERNAME|PROGRAMFILES|PROGRAMDATA)$/i;
  const env = Object.fromEntries(Object.entries(src).filter(([k]) => ok.test(k) && k.toUpperCase() !== 'PATH'));
  const own = Object.entries(src).find(([k]) => k.toUpperCase() === 'PATH')?.[1];
  env.PATH = platform === 'win32' ? [...extraPath, own || ''].join(';') : [...extraPath, own || '/usr/bin:/bin'].join(':');
  return env;
}

// Is this job's runner really alive? A bare pid can be reused by another program after a reboot, so check the command line too.
// When a job must be finished by. A runner that died before saving its deadline has none yet, so work it out from the start time.
export const jobDeadline = (job) => job.deadline || (job.startedAt || job.createdAt || 0) + (job.maxHours || 10) * 3600_000;
// The command line of a running process. Windows has no "ps", so ask PowerShell (the pid is a number, never text from outside).
const commandOf = (pid) => process.platform === 'win32'
  ? execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter 'ProcessId=${Number(pid)}').CommandLine`], { encoding: 'utf8', windowsHide: true })
  : execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
export function runnerAlive(job, io = {}) {
  if (!job || !job.runnerPid) return false;
  const alive = io.alive || pidAlive;
  if (!alive(job.runnerPid)) return false;
  try { const cmd = (io.cmd || commandOf)(job.runnerPid); return cmd.includes('research-run.mjs') && cmd.includes(job.id); }
  catch { return false; }
}

// A plan is the list of sub-questions the investigation will answer, one fresh session each.
export function validatePlan(plan, depth = 'deep') {
  const [min, max] = depthConfig(depth).questions;
  if (!plan || !Array.isArray(plan.questions)) return { ok: false, error: 'plan.json needs a "questions" array' };
  const qs = plan.questions;
  if (qs.length < min || qs.length > max) return { ok: false, error: `expected ${min} to ${max} questions, got ${qs.length}` };
  const seen = new Set();
  for (const q of qs) {
    if (!q || typeof q.title !== 'string' || q.title.length < 5 || typeof q.brief !== 'string' || q.brief.length < 20) return { ok: false, error: 'every question needs a title and a brief (at least 20 characters)' };
    q.id = String(q.id || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || `q${seen.size + 1}`;
    if (seen.has(q.id)) q.id = `${q.id}-${seen.size + 1}`;
    seen.add(q.id);
  }
  return { ok: true, plan: { topic: String(plan.topic || ''), questions: qs } };
}

// Did a run fail because the Claude usage limit (or a temporary overload) was reached? Then waiting and retrying is right.
export const limitHit = (text) => /usage limit|limit reached|rate.?limit|too many requests|\b429\b|overloaded|credit balance|quota|session limit|hit your .{0,30}limit|resets? (at|in|\d)/i.test(String(text || ''));

// "You've hit your session limit · resets 5:20am (Asia/Riyadh)" -> how long to wait (until that time on this computer's clock, +1 minute), or null if no time is given.
export function resetWaitMs(text, now = new Date()) {
  const m = String(text || '').match(/resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i); if (!m) return null;
  let h = Number(m[1]) % 12; if (/pm/i.test(m[3])) h += 12;
  const t = new Date(now); t.setHours(h, Number(m[2] || 0), 0, 0); if (t <= now) t.setDate(t.getDate() + 1);
  const ms = t.getTime() - now.getTime() + 60_000; return ms > 0 && ms <= 9 * 3600_000 ? ms : null;
}

// The 'claude' CLI says this when we try to resume a session that was never created (the first attempt failed before it started)
export const noSuchSession = (text) => /no conversation found|session .*not found|no such session/i.test(String(text || ''));

// A temporary network problem (the computer slept, Wi-Fi dropped, a site timed out): wait a little and continue, never count it as a real failure.
export const transientHit = (text) => /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EPIPE|socket hang up|fetch failed|network|timed? ?out|connection (reset|closed|lost|error)|offline|unable to connect|ssl|certificate/i.test(String(text || ''));

export function buildPrompts(job) {
  const cfg = depthConfig(job.depth);
  const docs = job.docs?.length ? `\nInput files provided by ${USER} (read them first): ${job.docs.map(d => 'inputs/' + d).join(', ')}.` : '';
  const topic = `TOPIC (from ${USER}): ${job.topic}${docs}`;
  const notes = (id) => `notes/${id}.md`;
  return {
    plan: `${topic}\n\nPHASE 1 of 4: PLAN. Do a few quick searches to understand the landscape, then write the file plan.json in the current folder: {"topic":"<restated, precise>","questions":[{"id":"short-slug","title":"<sub-question as a question>","brief":"<what exactly to find out, what to compare, which kinds of sources to check, which languages>"}]}. Write between ${cfg.questions[0]} and ${cfg.questions[1]} sub-questions that together fully cover the topic: definitions, current state, rules or technical details, risks, alternatives, costs, recent changes, expert disagreement, practical next steps. Valid JSON only in that file. Then reply with one short line.`,
    question: (q, i, n) => `${topic}\n\nPHASE 2 of 4: INVESTIGATE sub-question ${i} of ${n}: "${q.title}"\nBrief: ${q.brief}\n\nResearch this ONE sub-question exhaustively. Minimum: ${cfg.minSearches} different searches and ${cfg.minPages} pages actually opened; use more if the answer is not solid. Search from different angles, check primary sources, check GitHub repos or issues if software is involved, look for the opposing view and for the newest changes. Write your findings to ${notes(q.id)} as Markdown: key findings with details, numbers and dates; then a "Sources" list where EACH item has the full URL, title, type (official/press/repo/paper/forum/vendor), the page date if shown, the date you opened it, and a short quote or paraphrase of what it says; then "Disagreements and gaps" and "Confidence (high/medium/low) and why". Never cite a page you did not open. Reply with one short line when the file is written.`,
    synth: `${topic}\n\nPHASE 3 of 4: WRITE THE REPORT. Read plan.json and every file in notes/ completely. Write the final report to report.md following your report format exactly. Use only what is in the notes; if two notes disagree, say so. Number the sources once (merge duplicates) and make the citation numbers match the sources table. Be specific, clear, and complete: this is what ${USER} will read. If a section is weakly supported, say so instead of padding. Reply with one short line when done.`,
    review: `${topic}\n\nPHASE 4 of 4: REVIEW AND VERIFY. You are the critic. Read report.md and the notes. Pick the ${cfg.verify} most important or risky claims, re-open their sources (search again if a link is dead) and check that the report says exactly what the source says. Fix errors, soften or remove anything unsupported, add missing caveats, and make sure every citation number is right and the sources table is complete. Edit report.md in place. Then write review.md: what you checked, what you changed, what you could not verify. Reply with one short line when done.`,
  };
}

/* ---------- job files ---------- */
export function readJob(id) { try { return JSON.parse(fs.readFileSync(path.join(jobDir(id), 'job.json'), 'utf8')); } catch { return null; } }
export function writeJob(job) {
  const dir = jobDir(job.id); fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `job.json.${process.pid}.${Math.random().toString(36).slice(2, 6)}.tmp`);   // unique name: the server and the runner may save at the same moment
  fs.writeFileSync(tmp, JSON.stringify(job, null, 2)); fs.renameSync(tmp, path.join(dir, 'job.json'));
}
export function listJobs() {
  let names; try { names = fs.readdirSync(RESEARCH_DIR); } catch { return []; }
  return names.filter(n => JOB_ID.test(n)).map(readJob).filter(Boolean).sort((a, b) => b.createdAt - a.createdAt);
}
export function readReport(id) { try { return fs.readFileSync(path.join(workDir(id), 'report.md'), 'utf8').slice(0, 2_000_000); } catch { return null; } }
export function readReview(id) { try { return fs.readFileSync(path.join(workDir(id), 'review.md'), 'utf8').slice(0, 100000); } catch { return null; } }
/** Stop a research runner and the AI program it started. Mac/Linux: SIGTERM to its whole process group.
 * Windows has no process groups or SIGTERM, so taskkill /T ends the runner and everything it started.
 * @param {number} pid
 * @param {{ platform?: string, kill?: (pid: number, sig: string) => unknown, run?: (cmd: string, args: string[]) => unknown }} [io] */
export function stopRunner(pid, { platform = process.platform, kill = process.kill.bind(process), run = (cmd, args) => execFileSync(cmd, args, { stdio: 'ignore', windowsHide: true }) } = {}) {
  if (platform === 'win32') { try { run('taskkill', ['/PID', String(Number(pid)), '/T', '/F']); } catch { /* already gone */ } return; }
  try { kill(-pid, 'SIGTERM'); } catch { try { kill(pid, 'SIGTERM'); } catch { /* already gone */ } }
}
export const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

// session key -> { job, title } for every session a research job started (so the world can draw them at the Lab)
let mapCache = { at: 0, map: new Map() };
export function researchSessionMap() {
  if (Date.now() - mapCache.at < 1500) return mapCache.map;
  const map = new Map();
  for (const j of listJobs()) for (const p of j.phases || []) if (p.sessionId) map.set(`claude:${p.sessionId}`, { job: j.id, title: p.title });
  mapCache = { at: Date.now(), map }; return map;
}

// Is the computer plugged in? (A night of research needs power.) Cached for 30 s: the page asks every few seconds.
let powerCache = { at: 0, v: null };
export function powerInfo() {
  if (Date.now() - powerCache.at < 30_000 && powerCache.v) return powerCache.v;
  const v = readPower(); powerCache = { at: Date.now(), v }; return v;
}
function readPower() {
  try {
    const out = execFileSync('pmset', ['-g', 'batt'], { encoding: 'utf8' });
    const onAC = /AC Power/.test(out), m = out.match(/(\d+)%/);
    return { onAC, percent: m ? Number(m[1]) : null, platform: os.platform() };
  } catch { return { onAC: null, percent: null, platform: os.platform() }; }
}

// The researcher's definition is read from the repo (agents/deep-researcher.md) and handed to the CLI directly (--agents): the locked-down
// --restricted mode ignores the personal ~/.claude folder, and this way the run never depends on it.
export function agentJson(file = path.join(ROOT, 'agents', 'deep-researcher.md')) {
  const s = fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n'), m = s.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error('agents/deep-researcher.md has no front matter');
  const description = (m[1].match(/^description:\s*(.+)$/m) || [])[1]?.trim(), prompt = m[2].trim();
  if (!description || prompt.length < 200) throw new Error('agents/deep-researcher.md is missing its description or prompt');
  return JSON.stringify({ 'deep-researcher': { description, prompt } });
}

// The agent definitions that ship with Bella (agents/*.md) are copied into ~/.claude/agents when missing, so a fresh install works.
export function installAgents(home = os.homedir()) {
  const src = path.join(ROOT, 'agents'), dst = path.join(home, '.claude', 'agents'); let n = 0;
  try {
    fs.mkdirSync(dst, { recursive: true });
    for (const f of fs.readdirSync(src)) if (f.endsWith('.md') && !fs.existsSync(path.join(dst, f))) { fs.copyFileSync(path.join(src, f), path.join(dst, f)); n++; }
  } catch { /* nothing to install */ }
  return n;
}
