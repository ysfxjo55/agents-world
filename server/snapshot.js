import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { listClaude, claudeDetail, claudeTranscript, CLAUDE_ROOT } from './sources/claude.js';
import { listCodex, codexDetail, codexTranscript } from './sources/codex.js';
import { listOpenCode, opencodeDetail, opencodeTranscript } from './sources/opencode.js';
import { isArchived, getAlias } from './store.js';
import { listAgents } from './agents.js';
import { liveRuns, applyRuns } from './runs.js';
import { config } from './config.js';
import { INTERSTELLAR_DIR } from './chat.js';
import { loadDelegations, loadBella } from './bella.js';
import { loadCreated } from './newproject.js';
import { researchSessionMap, listJobs, runnerAlive, RESEARCH_DIR } from './research.js';

// Pluggable sources: add Gemini CLI / Cursor by pushing another entry here.
// list(now) -> sessions[]; detail(id) -> items[]; resume(session) -> shell command string.
export const SOURCES = {
  codex: { label: 'Codex CLI', list: listCodex, detail: codexDetail, transcript: codexTranscript, resume: (s) => `codex resume ${s.id}` },
  claude:   { label: 'Claude Code', list: listClaude,   detail: claudeDetail, transcript: claudeTranscript, resume: (s) => `claude --resume ${s.id}` },
  opencode: { label: 'OpenCode',    list: listOpenCode, detail: opencodeDetail, transcript: opencodeTranscript, resume: (s) => `opencode -s ${s.id}` },
};

const home = os.homedir();
export function projectName(p) {
  if (p === home) return '~ (home)';
  if (config.projectNames[p]) return config.projectNames[p];
  return path.basename(p) || p;
}

export const isInterstellarSession = (s) => s.tool === 'codex' && path.resolve(s.cwd || '.') === path.resolve(INTERSTELLAR_DIR);

export function interstellarSnapshot(sessions, runs) {
  const own = sessions.filter(isInterstellarSession);
  return { name: 'interstellar', displayName: 'Interstellar', color: '#ffb347', description: 'Your partner among the stars.', status: own.some(s => runs.codexIds?.has(s.id)) ? 'working' : 'idle', lastUsed: Math.max(0, ...own.map(s => s.lastActivity)) || null, uses: own.length };
}

export const guildAgents = (everyone) => everyone.filter(a => !['bella', 'deep-researcher', 'interstellar'].includes(a.name));

export function buildSnapshot(now = Date.now(), registry = new Map()) {
  const sessions = [];
  for (const [name, src] of Object.entries(SOURCES)) {
    try { sessions.push(...src.list(now)); } catch (e) { console.error(`[${name}]`, e.message); }
  }
  // Family chat keeps one persistent engine session per speaker. Keep them
  // available to the runner, but identify them separately from personal chats.
  let familySessions = {};
  try { familySessions = JSON.parse(fs.readFileSync(path.join(process.env.AGENT_WORLD_FAMILY_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'family'), 'sessions.json'), 'utf8')); } catch (e) { if (e.code !== 'ENOENT') console.error('Family sessions unreadable:', e.message); }
  const familyKeys = new Set([familySessions.bella && `claude:${familySessions.bella}`, familySessions.interstellar && `codex:${familySessions.interstellar}`].filter(Boolean));
  for (const s of sessions) s.familyChat = familyKeys.has(s.key);
  const runs = liveRuns(registry);
  applyRuns(sessions, runs, now);                       // a running agent is working, even while its model thinks silently
  for (const s of sessions) { s.projectPath = isInterstellarSession(s) ? '__interstellar__' : s.cwd; s.archived = isArchived(s.key); const al = getAlias(s.key); if (al) s.title = al; }
  const projects = new Map();
  for (const s of sessions) {
    if (!projects.has(s.projectPath)) projects.set(s.projectPath, { path: s.projectPath, name: s.projectPath === '__interstellar__' ? 'Interstellar' : projectName(s.projectPath), lastActivity: 0 });
    const p = projects.get(s.projectPath); p.lastActivity = Math.max(p.lastActivity, s.lastActivity);
  }
  const everyone = listAgents(sessions, CLAUDE_ROOT, now);
  const rmap = researchSessionMap();                        // sessions started by research jobs: give them their real names
  for (const s of sessions) { const r = rmap.get(s.key); if (r) { s.title = r.title; s.researchJob = r.job; s.agent = 'deep-researcher'; } }
  const deleg = loadDelegations();
  for (const s of sessions) if (deleg[s.key]) s.delegatedBy = deleg[s.key].by;
  const created = new Set(loadCreated());
  for (const s of sessions) if (created.has(s.cwd)) s.createdProject = true;    // work in a project folder Bella opened for a task: it belongs to that project's block
  const bs = loadBella(), bellaKeys = [bs.mainSession && `claude:${bs.mainSession}`, ...bs.history].filter(Boolean);
  const bella = everyone.find(a => a.name === 'bella') || null;
  if (bella && sessions.some(s => s.delegatedBy === 'bella' && s.status === 'working')) bella.status = 'working';   // she is busy while her agents are      // the manager has her own block, not a pedestal in the Guild
  const lab = everyone.find(a => a.name === 'deep-researcher') || null;      // the Research Lab has its own block, like Bella HQ
  if (lab) {
    const jobs = listJobs(), running = jobs.filter(j => j.status === 'running' && runnerAlive(j));
    lab.jobs = { running: running.length, total: jobs.length, done: jobs.filter(j => j.status === 'done').length };
    if (running.length) lab.status = 'working';
  }
  const interstellar = interstellarSnapshot(sessions, runs);
  const agents = guildAgents(everyone);
  // research job folders are not projects you can pick
  const visibleProjects = [...projects.values()].filter(p => !p.path.startsWith(RESEARCH_DIR + '/')).sort((a, b) => b.lastActivity - a.lastActivity);
  return { now, home: os.homedir(), agents, bella, bellaKeys, lab, interstellar, projects: visibleProjects, sessions: sessions.sort((a, b) => b.lastActivity - a.lastActivity) };
}
