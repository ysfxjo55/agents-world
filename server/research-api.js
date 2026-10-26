import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { HttpError } from './auth.js';
import { rawBody } from './util.js';
import { saveDoc, docPath } from './uploads.js';
import * as R from './research.js';

const RUNNER = path.join(R.ROOT, 'bin', 'research-run.mjs');
const safeName = (n, i) => (String(n || '').replace(/[^\w. -]+/g, '_').replace(/^\.+/, '').slice(0, 80) || `document-${i + 1}`);

// Start (or restart) the detached background runner for a job. It keeps going if this server restarts.
export function launchRunner(id) {
  const logFile = path.join(R.jobDir(id), 'runner.log');
  try { if (fs.statSync(logFile).size > 5 * 1024 * 1024) fs.renameSync(logFile, logFile + '.1'); } catch { /* no log yet */ }
  const out = fs.openSync(logFile, 'a');
  const child = spawn(process.execPath, [RUNNER, id], { detached: true, windowsHide: true, stdio: ['ignore', out, out], env: process.env });
  child.unref(); fs.closeSync(out);
  const j = R.readJob(id); if (j) { j.runnerPid = child.pid; j.status = 'running'; R.writeJob(j); }   // remembered right away, so nothing else starts a second runner
  return child.pid;
}

// jobs that were running when the app (or the Mac) went down are continued, not forgotten
export function resumeOrphans() {
  let n = 0;
  for (const j of R.listJobs()) {
    if (j.status !== 'running' || R.runnerAlive(j)) continue;
    if (Date.now() > R.jobDeadline(j) + 2 * 3600_000) continue;
    // a runner that keeps dying must not be restarted (and paid for) forever: at most 5 automatic restarts in 15 minutes
    const now = Date.now(), recent = (j.restarts || []).filter(t => now - t < 15 * 60_000);
    if (recent.length >= 5) { j.status = 'error'; j.error = 'The research runner kept stopping, so it was not restarted again. Press Resume to try once more.'; j.runnerPid = null; R.writeJob(j); continue; }
    j.restarts = [...recent, now]; R.writeJob(j);
    try { launchRunner(j.id); n++; } catch (e) { console.error('resume failed', j.id, e.message); }
  }
  return n;
}

const summary = (j) => ({ id: j.id, topic: j.topic, depth: j.depth, status: j.status, createdAt: j.createdAt, startedAt: j.startedAt, finishedAt: j.finishedAt, deadline: j.deadline, maxHours: j.maxHours,
  stats: j.stats, lastActivity: j.lastActivity, lastTool: j.lastTool, error: j.error, warnings: j.warnings || [], plan: j.plan || [], docs: j.docs || [],
  alive: R.runnerAlive(j), phases: (j.phases || []).map(p => ({ key: p.key, title: p.title, status: p.status, tools: p.tools || 0, attempts: p.attempts || 0, note: p.note })) });

// Returns true if it handled the request. Reading is allowed for the owner anywhere; starting/stopping only on this computer.
export async function researchRoutes({ req, res, p, write, auth, json, body }) {
  if (!p.startsWith('/api/research') && p !== '/api/upload-doc') return false;
  const local = () => { if (auth.remote) { json(res, 403, { error: 'Only from this computer.' }); return false; } return true; };
  let m;
  if (p === '/api/upload-doc' && write) {
    if (!local()) return true;
    const id = saveDoc(await rawBody(req, 25 * 1024 * 1024)); if (!id) return json(res, 400, { error: 'Only PDF files (up to 25 MB) or plain-text files (up to 5 MB) can be attached.' }), true;
    return json(res, 200, { id }), true;
  }
  if (p === '/api/research' && !write) return json(res, 200, { jobs: R.listJobs().map(summary), power: R.powerInfo() }), true;
  if (p === '/api/research/env' && !write) return json(res, 200, R.powerInfo()), true;
  if (!write && (m = p.match(/^\/api\/research\/([\w-]+)$/))) {
    if (!R.JOB_ID.test(m[1])) return json(res, 400, { error: 'bad id' }), true;
    const j = R.readJob(m[1]); if (!j) return json(res, 404, { error: 'unknown research job' }), true;
    return json(res, 200, { ...summary(j), report: R.readReport(j.id), review: R.readReview(j.id) }), true;
  }
  if (write && p === '/api/research/start') {
    if (!local()) return true;
    const b = await body(req), topic = String(b.topic || '').trim();
    if (topic.length < 10 || topic.length > 6000) return json(res, 400, { error: 'Describe what to research in 10 to 6000 characters.' }), true;
    const depth = R.DEPTHS[b.depth] ? b.depth : 'deep', defaultHours = { smoke: 1, standard: 4, deep: 10, exhaustive: 16 }[depth];
    const maxHours = Math.min(Math.max(Number(b.maxHours) || defaultHours, 0.25), 24);
    if (R.listJobs().filter(j => j.status === 'running' && R.runnerAlive(j)).length >= 2) return json(res, 429, { error: 'Two research jobs are already running. Wait for one to finish.' }), true;
    const id = R.newJobId(), dir = R.jobDir(id); fs.mkdirSync(path.join(R.workDir(id), 'inputs'), { recursive: true });
    const docs = [];
    for (const [i, d] of (Array.isArray(b.docs) ? b.docs.slice(0, 5) : []).entries()) {
      const src = docPath(String(d.id || d)); if (!src) { fs.rmSync(dir, { recursive: true, force: true }); return json(res, 400, { error: 'An attached file expired or is unknown. Attach it again.' }), true; }
      let name = safeName(d.name, i); if (docs.includes(name)) name = `${i + 1}-${name}`;
      if (!/\.(pdf|txt)$/i.test(name)) name += src.endsWith('.pdf') ? '.pdf' : '.txt';
      fs.copyFileSync(src, path.join(R.workDir(id), 'inputs', name)); docs.push(name);
    }
    const job = { id, topic, depth, maxHours, docs, createdAt: Date.now(), status: 'running', stats: { searches: 0, pages: 0, repos: 0 }, phases: [], warnings: [] };
    R.writeJob(job);
    try { launchRunner(id); } catch (e) { return json(res, 500, { error: `Could not start the researcher: ${e.message}` }), true; }
    return json(res, 200, { id }), true;
  }
  if (write && (m = p.match(/^\/api\/research\/([\w-]+)\/(stop|resume)$/))) {
    if (!local()) return true;
    if (!R.JOB_ID.test(m[1])) return json(res, 400, { error: 'bad id' }), true;
    const j = R.readJob(m[1]); if (!j) return json(res, 404, { error: 'unknown research job' }), true;
    const alive = R.runnerAlive(j);
    if (m[2] === 'stop') {
      // write "stopped" FIRST, then signal: the runner can tell a user stop from a Mac shutdown (which must resume)
      const latest = R.readJob(j.id) || j; if (latest.status === 'running') { latest.status = 'stopped'; R.writeJob(latest); }   // re-read right before writing
      if (alive) { try { process.kill(-j.runnerPid, 'SIGTERM'); } catch { try { process.kill(j.runnerPid, 'SIGTERM'); } catch { /* already gone */ } } }   // only ever a verified runner
      return json(res, 200, { ok: true }), true;
    }
    if (j.status === 'done') return json(res, 400, { error: 'This job is already finished.' }), true;
    if (alive) return json(res, 409, { error: 'It is already running.' }), true;
    if (Date.now() > (j.deadline || 0)) { j.deadline = Date.now() + Math.min(j.maxHours || 4, 4) * 3600_000; j.warnings = (j.warnings || []).filter(w => !/^Time limit/.test(w)); }   // resuming after the limit gives it a fresh, shorter budget
    j.status = 'running'; R.writeJob(j);
    launchRunner(j.id); return json(res, 200, { ok: true }), true;
  }
  throw new HttpError(404, 'not found');
}
