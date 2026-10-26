import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startRun, INTERSTELLAR_DIR } from './chat.js';
import { recordDelegation } from './bella.js';
import { setAlias } from './store.js';

// Bella starts real agent sessions through this module (via bin/delegate). They are ordinary sessions, so they show up in the
// world at Bella HQ, light up the agent's pedestal in the Guild, and she can read their result and review it.
export const RANK = { readonly: 0, edits: 1, build: 2, full: 3 };
// A delegated agent may never be more powerful than the chat that asked for it. OpenCode runs commands under its own permissions, so it counts as "build".
export function allowedDelegation({ requestedMode, maxMode, tool }) {
  if (!(requestedMode in RANK) || !(maxMode in RANK)) return { ok: false, error: 'unknown mode' };
  if (RANK[requestedMode] > RANK[maxMode]) return { ok: false, error: `This chat is in "${maxMode}" mode, so I can only start agents in "${maxMode}" mode. Switch the chat to a higher access mode first (top right of the chat).` };
  if (tool === 'opencode' && RANK[maxMode] < RANK.build) return { ok: false, error: 'Starting OpenCode needs the chat to be in "Can build and test" mode.' };
  return { ok: true };
}

// What may Bella move to Trash? Never her own current thread or the old Terminal history, never in a read-only chat, at most 5 at a time.
// (It only moves things to Trash: she can restore them, and she can never empty the Trash.)
export function canTrash(keys, { maxMode, protectedKeys = [] }) {
  if (!Array.isArray(keys) || !keys.length) return { ok: false, error: 'No session given.' };
  if (keys.length > 5) return { ok: false, error: 'At most 5 sessions at a time.' };
  if (!(maxMode in RANK) || RANK[maxMode] < RANK.edits) return { ok: false, error: 'Moving sessions to Trash needs the chat to be in "Can edit files" mode or higher.' };
  const bad = keys.filter(k => protectedKeys.includes(k));
  if (bad.length) return { ok: false, error: `Protected, I will not move these to Trash: ${bad.join(', ')}` };
  return { ok: true };
}

const jobs = new Map();                         // jobId -> { id, agent, tool, status, key, text, error, startedAt, finishedAt }
export const getJob = (id) => jobs.get(id) || null;
export const listJobs = () => [...jobs.values()].sort((a, b) => b.startedAt - a.startedAt).slice(0, 20);

// Continue an OLD session (same conversation, same memory of what it did) instead of starting a new one.
// The tool (Claude Code / OpenCode) is the session's own: a session cannot switch tool. If its folder is gone (e.g. a deleted worktree), continue in `fallbackCwd`.
export function resolveResume(session, requestedCwd, fallbackCwd, exists) {
  if (!session || !['claude', 'opencode', 'codex'].includes(session.tool)) return null;
  if (session.tool === 'codex' && path.resolve(session.cwd) === path.resolve(INTERSTELLAR_DIR)) return { tool: 'codex', sessionId: session.id, cwd: INTERSTELLAR_DIR, agent: 'interstellar' };
  const cwd = requestedCwd || (exists(session.cwd) ? session.cwd : fallbackCwd);
  return { tool: session.tool, sessionId: session.id, cwd, agent: session.tool === 'claude' ? (session.agent || null) : null };
}

// An old builder session may point at a worktree that was deleted after its work was merged. OpenCode refuses to start without its
// original folder, so bring the folder back as a fresh git worktree of the app. Only siblings named "<app folder>-<something>" qualify.
export function ensureWorktree(dir, repoRoot, io = {}) {
  const exists = io.exists || fs.existsSync, run = io.run || ((...a) => execFileSync('git', a, { stdio: 'ignore' })), link = io.link || ((t, p) => fs.symlinkSync(t, p));
  if (exists(dir)) return { made: false };
  const base = path.basename(repoRoot), name = path.basename(dir);
  if (path.dirname(dir) !== path.dirname(repoRoot) || !name.startsWith(base + '-') || !/^[\w.-]+$/.test(name)) return { made: false, refused: true };
  const branch = 'wt-' + name.slice(base.length + 1);
  try { run('-C', repoRoot, 'worktree', 'prune'); } catch { /* nothing to prune */ }
  try { run('-C', repoRoot, 'worktree', 'add', dir, '-b', branch, 'main'); }
  catch { run('-C', repoRoot, 'worktree', 'add', dir, branch); }       // the branch already exists
  try { if (exists(path.join(repoRoot, 'node_modules'))) link(path.join(repoRoot, 'node_modules'), path.join(dir, 'node_modules')); } catch { /* optional */ }
  return { made: true, branch };
}

export function startJob({ agent, tool, cwd, text, mode, title, sessionId = null, temp = false, onTempDone = null }, runs, kick) {
  const id = crypto.randomUUID().slice(0, 8);
  const job = { id, agent: agent || null, tool, resumed: !!sessionId, temp: !!temp, status: 'running', key: null, text: '', error: null, startedAt: Date.now(), finishedAt: null };
  jobs.set(id, job);
  const label = `${temp ? 'Quick: ' : ''}${agent || (tool === 'codex' ? 'Codex' : 'OpenCode')}: ${title || text.split('\n')[0]}`.slice(0, 70);
  const emit = (ev) => {
    if (ev.t === 'start') { job.key = ev.key; if (sessionId) return;   // an old session keeps its place and its name
      try { recordDelegation(ev.key, { by: 'bella', agent: agent || null, job: id }); setAlias(ev.key, label); } catch (e) { console.error('delegation record:', e.message); } }
    else if (ev.t === 'blocks') { const t = ev.blocks.filter(b => b.type === 'text').map(b => b.text).join('\n\n'); if (t) job.text = t; }
    else if (ev.t === 'error') job.error = ev.text;
    else if (ev.t === 'done') { job.status = ev.ok ? 'done' : 'error'; if (ev.error) job.error = ev.error; }
  };
  const run = startRun({ tool, sessionId, cwd, text, mode, agent: tool === 'claude' ? agent : null, images: [], usageSource: 'delegation' }, emit, () => {
    runs.delete(id); if (job.status === 'running') job.status = job.error ? 'error' : 'done'; job.finishedAt = Date.now(); kick();
    if (temp && !sessionId && job.status === 'done' && job.key && onTempDone) onTempDone(job);     // a quick helper that finished fine cleans up after itself
  });
  runs.set(id, run);
  return job;
}
