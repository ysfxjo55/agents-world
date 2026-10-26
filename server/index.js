import './env-names.js';   // first: new AGENTS_WORLD_* names also set the old AGENT_WORLD_* ones before anything reads them
import { modelRouterRoute } from './model-router.js';
import { usageRoute } from './usage-ledger.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import crypto from 'node:crypto';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildSnapshot, SOURCES } from './snapshot.js';
import { setArchived } from './store.js';
import { CLAUDE_ROOT } from './sources/claude.js';
import { OPENCODE_DIR } from './sources/opencode.js';
import { AGENTS_DIR } from './agents.js';
import { familyInboxRoute } from './family-inbox.js';
import { FamilyChat } from './family.js';
import { startRun, MODES, INTERSTELLAR_DIR, chatAccessError, maxModeForToken } from './chat.js';
import { trashSession, listTrash, restoreSession, emptyTrash } from './trash.js';
import { claudeProcessPattern, sessionBusy, liveRuns } from './runs.js';
import { config, saveName, saveSettings } from './config.js';
import { detectEngines, engineSummary, setEngines, currentEngines } from './engines.js';
import { checkRequest, originAllowed, HttpError, safeDecode, ownTailnetIps } from './auth.js';
import { body, rawBody, resolveCwd, isTodayChat, refreshUserPath } from './util.js';
import { resolveDownload } from './files.js';
import { saveAny, uploadPath, cleanUploads } from './uploads.js';
import { researchRoutes, resumeOrphans } from './research-api.js';
import { installAgents } from './research.js';
import { installStarter } from './starter.js';
import { loadBella, recordMain, logAction, bellaMainKey } from './bella.js';
import { createProject, loadCreated } from './newproject.js';
import { allowedDelegation, startJob, getJob, listJobs, resolveResume, ensureWorktree, canTrash } from './delegate.js';
import { autoOpen, localDateString } from './autoopen.js';
import { createDoneWatcher, makeNotifier } from './notify.js';

const PORT = Number(process.env.AGENT_WORLD_PORT) || 4321, HOST = '127.0.0.1';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const THREE = path.join(ROOT, 'node_modules', 'three');
const SAFE_ID = /^[A-Za-z0-9][\w.-]*$/;          // ids and names must not start with "-" (so they can never look like a CLI flag)

if (process.argv.includes('--snapshot')) {
  const s = buildSnapshot();
  console.log(JSON.stringify({ ...s, sessions: s.sessions.map(x => ({ ...x, ago: Math.round((s.now - x.lastActivity) / 60000) + 'm' })) }, null, 2));
  process.exit(0);
}
if (process.argv.includes('--test-notify')) {             // npm run test-notify: send one alert the way a finished session would
  const n = makeNotifier(config.notify);
  if (!n) console.log('All alerts are off in data/config.json ("notify").');
  else console.log('sent:', await n({ title: 'Agents World', message: 'Finished: this is a test alert' }));
  process.exit(0);
}

// Which AI programs are installed and logged in. Looked up at start and again when the guide asks ("Check again").
const refreshEngines = () => { refreshUserPath(); return setEngines(engineSummary(detectEngines(), config.agents)); };   // Windows: re-reads your saved PATH
refreshEngines();

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml' };
// Our own pages only: the Life board pages (proxied) load fonts/libraries from the web, so they do not get this policy.
const csp = (scriptHashes) => `default-src 'self'; script-src 'self' ${scriptHashes}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; frame-ancestors 'self'; base-uri 'self'; object-src 'none'; form-action 'self'`;
const clients = new Set();
const runs = new Map();   // runId -> { child, key }: chat turns in progress

const family = new FamilyChat({ runs });

/* ---------- live snapshot ---------- */
const notifier = makeNotifier(config.notify);
const familyKeys = () => { try { const f = family.sessions(); return [f.bella && `claude:${f.bella}`, f.interstellar && `codex:${f.interstellar}`]; } catch { return []; } };
const checkDone = notifier ? createDoneWatcher({
  notify: notifier,
  nameOf: (s) => snapshot.projects.find(p => p.path === s.projectPath)?.name,
  quiet: (s) => familyKeys().includes(s.key),                   // family chat replies show in the chat itself; no alert for them
}) : () => {};
let snapshot = buildSnapshot(Date.now(), runs), snapshotAt = Date.now(), lastJson = JSON.stringify({ ...snapshot, now: 0 });
checkDone(snapshot.sessions);                                  // first look: sessions already idle never alert
function refresh() {
  try {
    snapshot = buildSnapshot(Date.now(), runs); snapshotAt = Date.now();
    checkDone(snapshot.sessions);
    const json = JSON.stringify({ ...snapshot, now: 0 });          // ignore the clock when diffing
    if (json !== lastJson) { lastJson = json; broadcast(); }
  } catch (e) { console.error('refresh failed:', e.message); }
}
const fresh = () => { if (Date.now() - snapshotAt > 1500) refresh(); };   // API calls never act on stale data
const invalidate = () => { lastJson = ''; refresh(); };
function broadcast() {
  const msg = `event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`;
  for (const res of clients) res.write(msg);
}
let debounce;
const kick = () => { if (!clients.size) return; clearTimeout(debounce); debounce = setTimeout(refresh, 700); };
for (const dir of [CLAUDE_ROOT, OPENCODE_DIR, AGENTS_DIR]) {
  try { fs.watch(dir, { recursive: true }, kick); } catch (e) { console.warn('watch failed for', dir, e.message); }
}
setInterval(() => { if (clients.size) refresh(); }, 2000);   // drives time-based status changes; idle when nobody is watching
if (notifier) setInterval(() => { if (!clients.size) refresh(); }, 5000).unref();   // with no page open, still look every 5 s so "task done" alerts arrive
setInterval(() => { for (const r of clients) r.write(': ka\n\n'); }, 20000);
cleanUploads(); setInterval(cleanUploads, 6 * 3600_000).unref();   // pasted images are deleted after 7 days

/* ---------- opening Terminal ---------- */
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
function openTerminal(cwd, resume) {
  const cmd = `cd ${shq(cwd)} && ${resume}`;
  const asEsc = cmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  if (process.env.AGENT_WORLD_DRYRUN) { console.log('[dry-run] would run in Terminal:', cmd); return null; }
  if (process.platform === 'darwin') { execFile('osascript', ['-e', `tell application "Terminal"\nactivate\ndo script "${asEsc}"\nend tell`], (err) => err && console.error('osascript:', err.message)); return null; }
  if (process.platform === 'win32') {
    // A new Command Prompt window in that folder. `resume` is built from checked ids and agent names only, never free text.
    spawn('cmd.exe', ['/c', 'start', 'Agents World', 'cmd.exe', '/k', resume], { cwd, detached: true, stdio: 'ignore' }).on('error', (e) => console.error('terminal:', e.message)).unref();
    return null;
  }
  return `Opening a terminal is only supported on macOS and Windows. Run this yourself: ${cmd}`;
}

/* ---------- Optional life board: if you put your own small Python server in ./life (server.py), it is shown at /life/* ---------- */
const LIFE_DIR = path.join(ROOT, 'life'), LIFE_PORT = 4322;
let lifeChild = null, lifeStarting = false;
function ensureLife() {
  if (lifeChild || lifeStarting || !fs.existsSync(path.join(LIFE_DIR, 'server.py'))) return;
  lifeStarting = true;                                              // set at once, so a burst of failed requests starts only one
  const probe = net.connect(LIFE_PORT, '127.0.0.1');
  probe.on('connect', () => { probe.destroy(); lifeStarting = false; });   // something (e.g. your Terminal) already runs it: leave it alone
  probe.on('error', () => {
    lifeChild = spawn(process.platform === 'win32' ? 'python' : 'python3', ['server.py'], { cwd: LIFE_DIR, env: process.platform === 'win32' ? { ...process.env, LIFE_QUIET: '1' } : { ...process.env, LIFE_QUIET: '1', PATH: '/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin' }, stdio: 'ignore' });
    lifeStarting = false;
    lifeChild.on('exit', () => { lifeChild = null; });
  });
}
function shutdown() { lifeChild?.kill(); for (const r of runs.values()) r.child.kill('SIGTERM'); process.exit(0); }
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, shutdown);
ensureLife();
function proxyLife(req, res, target) {
  const headers = { host: `127.0.0.1:${LIFE_PORT}` };                  // Origin is dropped: it was already checked
  for (const h of ['content-type', 'content-length']) if (req.headers[h]) headers[h] = req.headers[h];
  const up = http.request({ host: '127.0.0.1', port: LIFE_PORT, path: target, method: req.method, headers }, (r) => {
    const out = { ...r.headers }; delete out['transfer-encoding'];
    res.writeHead(r.statusCode, { ...out, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); r.pipe(res);
  });
  up.on('error', () => { ensureLife(); if (!res.headersSent) json(res, 502, { error: 'The board server is starting. Try again in a few seconds.' }); else res.end(); });
  req.pipe(up);
}

/* ---------- small helpers ---------- */
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(obj)); };
function inUseByProcess(id) { try { execFileSync('pgrep', ['-f', claudeProcessPattern(id)], { stdio: 'ignore' }); return true; } catch { return false; } }
const findAgent = (name) => [...snapshot.agents, snapshot.bella].find(a => a && a.name === name);
const find = (key) => snapshot.sessions.find(s => s.key === key);
function serveFile(res, base, rel) {
  const file = path.normalize(path.join(base, rel));
  if (!file.startsWith(base + path.sep)) return json(res, 403, { error: 'forbidden' });
  fs.readFile(file, (err, data) => {
    if (err) return json(res, 404, { error: 'not found' });
    const ext = path.extname(file), headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
    if (ext === '.html') {
      const hashes = [...data.toString().matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(x => `'sha256-${crypto.createHash('sha256').update(x[1]).digest('base64')}'`).join(' ');
      headers['Content-Security-Policy'] = csp(hashes);
    }
    res.writeHead(200, headers); res.end(data);
  });
}

/* ---------- routes ---------- */
async function handle(req, res) {
  // 1) who is calling? (this computer, or the owner through Tailscale; nobody else)
  const auth = checkRequest({ host: req.headers.host, headers: req.headers, port: PORT, hosts: config.hosts, owner: config.owner, selfIps: ownTailnetIps() });
  if (!auth.ok) return json(res, auth.status, { error: auth.error });
  const write = req.method !== 'GET' && req.method !== 'HEAD';
  if (write && !originAllowed(req.headers.origin, { port: PORT, hosts: config.hosts })) return json(res, 403, { error: 'bad origin' });

  const url = new URL(req.url, `http://${req.headers.host}`), p = url.pathname;
  if (p.startsWith('/life/')) { const f = p.slice(5); if (/^\/(board\.html|localdb\.js)$/.test(f)) return proxyLife(req, res, f + url.search); return json(res, 404, { error: 'not found' }); }
  if (/^\/api\/(board)\//.test(p)) return proxyLife(req, res, p + url.search);

  if (await modelRouterRoute({ req, res, p, auth, json })) return;
  if (usageRoute({ req, res, p, url, json })) return;
  if (p === '/events') {
    fresh();
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Content-Type-Options': 'nosniff' });
    res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
    clients.add(res); req.on('close', () => clients.delete(res)); return;
  }
  if (p === '/api/snapshot') { fresh(); return json(res, 200, snapshot); }
  if (p === '/api/config') return json(res, 200, { links: config.links, remote: auth.remote, lifeDir: LIFE_DIR, name: config.name, today: config.today, startChosen: config.showSince !== null, engines: currentEngines() });
  if (p === '/api/engines' && !write) return json(res, 200, refreshEngines());   // "Check again" in the guide
  if (await familyInboxRoute({ req, res, p, auth, json, body, dir: process.env.AGENT_WORLD_FAMILY_DIR || path.join(ROOT, 'data', 'family'), logAction })) return;
  fresh();
  if (await researchRoutes({ req, res, p, write, auth, json, body })) return;

  let m;
  if ((m = p.match(/^\/api\/detail\/(.+)$/))) {
    const s = find(safeDecode(m[1])); if (!s) return json(res, 404, { error: 'unknown session' });
    return json(res, 200, { items: SOURCES[s.tool].detail(s.id, 20) });
  }
  if (!write && (m = p.match(/^\/api\/chat\/transcript\/(.+)$/))) {
    const s = find(safeDecode(m[1])); if (!s) return json(res, 404, { error: 'unknown session' });
    const lim = Math.min(Math.max(Number(url.searchParams.get('limit')) || 150, 1), 800);
    const messages = await SOURCES[s.tool].transcript(s.id, lim, { full: url.searchParams.has('full'), textOnly: url.searchParams.has('text') });
    return json(res, 200, { messages, busy: sessionBusy(runs, s.key) });
  }
  if (p === '/api/family/history' && !write) {
    res.setHeader('Cache-Control', 'no-store');
    return json(res, 200, { messages: family.history(Number(url.searchParams.get('limit'))), busy: !!family.active });
  }
  if (p === '/api/bella/thread' && !write) {
    const st = loadBella(), mainKey = bellaMainKey(st);
    return json(res, 200, { mainKey: mainKey && find(mainKey) ? mainKey : null, history: st.history.filter(k => find(k)) });
  }
  if (p === '/api/file' && !write) {                                 // hand a finished file back to you (Downloads / Desktop / Documents only)
    const f = resolveDownload(url.searchParams.get('path') || '', os.homedir()); if (!f) return json(res, 404, { error: 'That file is not available (only documents and pictures in Downloads, Desktop or Documents).' });
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': f.size, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'", 'Cache-Control': 'no-store' });
    return fs.createReadStream(f.file).pipe(res);
  }
  if (!write && (m = p.match(/^\/api\/upload\/([\w.-]+)$/))) {
    const file = uploadPath(m[1]); if (!file) return json(res, 404, { error: 'not found' });
    const ext = path.extname(file).slice(1), type = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" });
    return fs.createReadStream(file).pipe(res);
  }
  if (!write && (m = p.match(/^\/api\/delegate(?:\/([\w-]+))?$/))) {          // Bella follows the agents she started
    if (auth.remote) return json(res, 403, { error: 'Only from this computer.' });
    if (m[1] === 'sessions') return json(res, 200, { sessions: [...snapshot.sessions].sort((a, b) => b.lastActivity - a.lastActivity).slice(0, 40).map(s => ({ key: s.key, title: s.title, tool: s.tool, agent: s.agent || null, status: s.status, minutesAgo: Math.round((Date.now() - s.lastActivity) / 60000), folder: path.basename(s.cwd) })) });
    if (m[1] === 'repo') {                                              // what is the state of a project's git repo? (read-only, so a manager can check a builder's work)
      const dir = url.searchParams.get('cwd') || ROOT;
      if (dir !== ROOT && !snapshot.projects.some(x => x.path === dir)) return json(res, 400, { error: 'unknown folder' });
      const git = (...a) => { try { return execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', maxBuffer: 1 << 20 }).trim(); } catch (e) { return `(git error: ${String(e.message).split('\n')[0]})`; } };
      return json(res, 200, { folder: dir, branch: git('branch', '--show-current'), branches: git('branch', '--format=%(refname:short)'), status: git('status', '--short').slice(0, 4000) || '(clean)', recent: git('log', '--oneline', '-8'), vsMain: git('diff', '--stat', 'main...HEAD').slice(-3000) || '(no difference from main)' });
    }
    if (!m[1]) return json(res, 200, { jobs: listJobs() });
    const j = getJob(m[1]); return j ? json(res, 200, j) : json(res, 404, { error: 'unknown job' });
  }
  if (p === '/api/trash' && !write) return json(res, 200, { items: listTrash() });

  if (write && req.method === 'POST') {
    if (p === '/api/settings/name') {                                  // the first-steps guide: save your name
      if (auth.remote) return json(res, 403, { error: 'Only from this computer.' });
      const name = saveName((await body(req))?.name);
      return name ? json(res, 200, { ok: true, name }) : json(res, 400, { error: 'Type a name of 1 to 40 letters.' });
    }
    if (p === '/api/settings/start') {                                 // the guide's first step: an empty world, or your existing sessions
      if (auth.remote) return json(res, 403, { error: 'Only from this computer.' });
      saveSettings({ showSince: (await body(req))?.fresh === true ? Date.now() : 0 }); invalidate();
      return json(res, 200, { ok: true, showSince: config.showSince });
    }
    if (p === '/api/notify/test') {                                    // the first-steps guide: "Send a test alert"
      if (auth.remote) return json(res, 403, { error: 'Only from this computer.' });
      if (!notifier) return json(res, 200, { ok: false, error: 'Alerts are off in data/config.json ("notify").' });
      await notifier({ title: 'Agents World', message: 'Finished: this is a test alert' });
      return json(res, 200, { ok: true });
    }
    if (p === '/api/family/stop') return json(res, 200, { ok: family.stop() });
    if (p === '/api/family/send') {
      const b = await body(req); let open = true;
      const finished = family.send(b, auth.remote, ev => { if (open && !res.writableEnded) res.write(`data: ${JSON.stringify(ev)}\n\n`); });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff' });
      res.on('close', () => { open = false; });
      await finished;
      if (open && !res.writableEnded) res.end();
      kick(); return;
    }
    if (p === '/api/chat/stop') {
      const r = runs.get((await body(req)).runId); if (r) r.child.kill('SIGTERM');
      return json(res, 200, { ok: !!r });
    }
    if (p === '/api/delegate/trash' || p === '/api/delegate/restore') {     // Bella's guarded deletion: Trash only (recoverable), Mac only, logged
      if (auth.remote) return json(res, 403, { error: 'Only from this computer.' });
      const b = await body(req), maxMode = maxModeForToken(req.headers['x-bella-run-token']);
      if (p === '/api/delegate/restore') {
        const gate = canTrash(['x'], { maxMode }); if (!gate.ok) return json(res, 403, { error: gate.error });
        const r = await restoreSession(String(b.id || '')); logAction({ action: 'restore', id: b.id, ok: r.ok, maxMode }); invalidate(); return json(res, 200, r);
      }
      const st = loadBella(), keys = Array.isArray(b.keys) ? b.keys.map(String) : [];
      const protectedKeys = [...st.history, ...(st.mainSession ? [bellaMainKey(st)] : [])];
      const gate = canTrash(keys, { maxMode, protectedKeys }); if (!gate.ok) return json(res, 403, { error: gate.error });
      const results = await trashMany(keys);
      logAction({ action: 'trash', reason: String(b.reason || '').slice(0, 200), maxMode, results: results.map(x => ({ key: x.key, title: x.title, ok: x.ok, error: x.error })) });
      return json(res, 200, { results });
    }
    if (p === '/api/delegate/newproject') {                           // Bella opens a new project folder (= a new block) for a task
      if (auth.remote) return json(res, 403, { error: 'Only from this computer.' });
      const maxMode = maxModeForToken(req.headers['x-bella-run-token']);
      if (!allowedDelegation({ requestedMode: 'edits', maxMode, tool: 'claude' }).ok) return json(res, 403, { error: 'Creating a project folder needs the chat to be in "Can edit files" mode or higher.' });
      const b = await body(req), r = createProject({ name: b.name, brief: String(b.brief || '').slice(0, 60000) });
      logAction({ action: 'newproject', name: b.name, ok: r.ok, error: r.error, maxMode });
      return json(res, r.ok ? 200 : 400, r);
    }
    if (p === '/api/delegate/research') {                             // Bella starts an overnight research job (same rules as the Research page, plus: needs an editing chat)
      if (auth.remote) return json(res, 403, { error: 'Only from this computer.' });
      const maxMode = maxModeForToken(req.headers['x-bella-run-token']);
      if (!allowedDelegation({ requestedMode: 'edits', maxMode, tool: 'claude' }).ok) return json(res, 403, { error: 'Starting research needs the chat to be in "Can edit files" mode or higher.' });
      if (await researchRoutes({ req, res, p: '/api/research/start', write: true, auth, json, body })) return;
    }
    if (p === '/api/delegate/stop') { if (auth.remote) return json(res, 403, { error: 'Only from this computer.' }); const r = runs.get(String((await body(req)).job || '')); if (r) r.child.kill('SIGTERM'); return json(res, 200, { ok: !!r }); }
    if (p === '/api/delegate') {
      // Bella (through bin/delegate) starts a real agent session. Never more powerful than the chat that asked, never remote.
      if (auth.remote) return json(res, 403, { error: 'Only from this computer.' });
      const b = await body(req), text = String(b.text ?? '').trim();
      if (!text || text.length > 30000) return json(res, 400, { error: 'empty or too long' });
      const tool = b.tool === 'codex' ? 'codex' : b.tool === 'opencode' ? 'opencode' : 'claude', mode = String(b.mode || 'readonly');
      const maxMode = maxModeForToken(req.headers['x-bella-run-token']);
      const ok = allowedDelegation({ requestedMode: mode, maxMode, tool }); if (!ok.ok) return json(res, 403, { error: ok.error });
      if (b.resume) {                                                    // continue an old session instead of starting a new one
        const s = find(String(b.resume)); if (!s) return json(res, 404, { error: 'unknown session. Run: delegate sessions' });
        if (sessionBusy(runs, s.key)) return json(res, 409, { error: 'That session is already working.' });
        try { ensureWorktree(s.cwd, ROOT); } catch (e) { console.error('worktree:', e.message); }   // its folder was removed after a merge: bring it back
        const rr = resolveResume(s, b.cwd ? snapshot.projects.find(x => x.path === b.cwd)?.path : null, ROOT, fs.existsSync);
        const ok2 = allowedDelegation({ requestedMode: mode, maxMode, tool: rr.tool }); if (!ok2.ok) return json(res, 403, { error: ok2.error });
        if (!rr.cwd || !fs.existsSync(rr.cwd) || !SAFE_ID.test(rr.sessionId)) return json(res, 400, { error: 'cannot continue that session (folder missing)' });
        if (runs.size >= 3) return json(res, 429, { error: 'Three agents are already running. Wait for one to finish.' });
        const job = startJob({ ...rr, text, mode, title: '' }, runs, kick);
        return json(res, 200, { job: job.id, key: s.key, continued: true });
      }
      let agent = null;
      const accessError = chatAccessError({ tool, mode, agent: b.agent, remote: false });
      if (accessError) return json(res, accessError.status, { error: accessError.error });
      if (b.agent === 'interstellar') agent = 'interstellar';
      if (tool === 'claude' && b.agent) { const a = snapshot.agents.find(x => x.name === b.agent); if (!a || !SAFE_ID.test(a.name)) return json(res, 400, { error: `unknown agent "${b.agent}". Known: ${snapshot.agents.map(x => x.name).join(', ')}` }); agent = a.name; }
      const cwd = agent === 'interstellar' ? INTERSTELLAR_DIR : resolveCwd(b.cwd, [...snapshot.projects.map(x => x.path), ...loadCreated()], fs.existsSync(LIFE_DIR) ? LIFE_DIR : null, os.homedir());
      if (!cwd || !fs.existsSync(cwd)) return json(res, 400, { error: 'unknown folder (use a project folder Bella already knows)' });
      if (runs.size >= 3) return json(res, 429, { error: 'Three agents are already running. Wait for one to finish.' });
      const temp = b.temp === true;
      const job = startJob({ agent, tool, cwd, text, mode, title: typeof b.title === 'string' ? b.title.slice(0, 60) : '', temp, onTempDone: temp ? tempCleanup : null }, runs, kick);
      return json(res, 200, { job: job.id });
    }
    if (p === '/api/upload') {
      const saved = saveAny(await rawBody(req)); if (!saved) return json(res, 400, { error: 'I can read images (PNG, JPEG, GIF, WebP), PDF, Word (.docx/.doc), PowerPoint (.pptx), Excel (.xlsx, texts only), RTF and plain-text files (txt, md, csv, json, code).' });
      return json(res, 200, saved);
    }
    if (p === '/api/chat/send') return chatSend(req, res, auth);
    if (p === '/api/delete') {
      // moves sessions to Bella's Trash (recoverable). Refuses anything that looks in use.
      const b = await body(req);
      return json(res, 200, { results: await trashMany(Array.isArray(b.keys) ? b.keys.slice(0, 50) : []) });
    }
    if (p === '/api/today/close') {       // the Today popup was closed: its chat goes to Trash (recoverable), decided by this code, not by an AI
      if (auth.remote) return json(res, 403, { error: 'Only from this computer.' });
      const key = String((await body(req)).key || ''); invalidate(); const s = find(key);
      if (!isTodayChat(s, LIFE_DIR)) return json(res, 200, { ok: false, error: 'Not a Today chat.' });
      if (sessionBusy(runs, key)) return json(res, 200, { ok: false, error: 'It is still answering.' });
      const r = await trashSession(s); invalidate();
      logAction({ action: 'today-close', key, ok: r.ok, error: r.error, trashId: r.trashId });
      return json(res, 200, { ok: !!r.ok, error: r.error });
    }
    if (p === '/api/trash/restore') { const r = await restoreSession(String((await body(req)).id || '')); invalidate(); return json(res, 200, r); }
    if (p === '/api/trash/empty') {
      if (auth.remote) return json(res, 403, { error: 'Only from this computer.' });   // the one action that deletes for good
      if ((await body(req)).confirm !== true) return json(res, 400, { error: 'confirmation required' });   // permanent: the page asks first and sends confirm:true
      return json(res, 200, { ok: true, removed: emptyTrash() });
    }
    if ((p === '/api/open' || p === '/api/launch-agent') && auth.remote) return json(res, 403, { error: 'Opening Terminal is only allowed from this computer.' });
    if (p === '/api/open') {
      const s = find((await body(req)).key); if (!s) return json(res, 404, { error: 'unknown session' });
      if (!SAFE_ID.test(s.id) || !fs.existsSync(s.cwd)) return json(res, 400, { error: 'cannot open' });
      const err = openTerminal(s.cwd, SOURCES[s.tool].resume(s)); return json(res, err ? 501 : 200, err ? { error: err } : { ok: true });
    }
    if (p === '/api/launch-agent') {
      // a fresh session as one of your agents: only names from ~/.claude/agents, only folders Bella already knows (or home)
      const b = await body(req);
      const a = findAgent(b.name); if (!a || !SAFE_ID.test(a.name)) return json(res, 404, { error: 'unknown agent' });
      const dir = b.cwd ? snapshot.projects.find(x => x.path === b.cwd)?.path : os.homedir();
      if (!dir || !fs.existsSync(dir)) return json(res, 400, { error: 'unknown folder' });
      const err = openTerminal(dir, `claude --agent ${a.name}`); return json(res, err ? 501 : 200, err ? { error: err } : { ok: true });
    }
    if (p === '/api/archive') {
      const b = await body(req); const s = find(b.key); if (!s) return json(res, 404, { error: 'unknown session' });
      setArchived(s.key, b.archived !== false); invalidate();
      return json(res, 200, { ok: true });
    }
  }
  if (p.startsWith('/vendor/three/')) return serveFile(res, THREE, safeDecode(p.slice('/vendor/three/'.length)));
  serveFile(res, PUBLIC, p === '/' ? 'index.html' : safeDecode(p.slice(1)));
}

// A "quick" helper session (a calendar check, one small question) is moved to Trash by itself a few seconds after it finished OK.
// Recoverable (Trash page), logged, and the answer stays available to Bella through the job. Only sessions started as temporary, never old ones.
function tempCleanup(job) {
  const tryOnce = async (n) => {
    try {
      invalidate(); await new Promise(r => setTimeout(r, 1500));
      const s = find(job.key);
      if (!s) { if (n < 6) return setTimeout(() => tryOnce(n + 1), 5000); return logAction({ action: 'temp-cleanup', key: job.key, ok: false, error: 'session never appeared' }); }
      if (sessionBusy(runs, job.key)) { if (n < 6) return setTimeout(() => tryOnce(n + 1), 5000); return; }
      const r = await trashSession(s); invalidate();
      logAction({ action: 'temp-cleanup', key: job.key, title: s.title, ok: r.ok, error: r.error, trashId: r.trashId });
    } catch (e) { logAction({ action: 'temp-cleanup', key: job.key, ok: false, error: e.message }); }
  };
  setTimeout(() => tryOnce(0), 4000);
}

// Moves sessions to Trash (recoverable). Refuses anything that looks in use. Shared by the page and by Bella's delegate tool.
async function trashMany(keys) {
  const results = [];
  for (const key of keys) {
    const s = find(key);
    if (!s) { results.push({ key, ok: false, error: 'unknown session' }); continue; }
    if (sessionBusy(runs, key)) { results.push({ key, ok: false, error: 'it is answering right now' }); continue; }
    if (s.tool === 'claude' && inUseByProcess(s.id)) { results.push({ key, ok: false, error: 'it is still open in a Terminal window (close that window first)' }); continue; }
    if (s.tool === 'codex' && liveRuns(runs).codexIds.has(s.id)) { results.push({ key, ok: false, error: 'it is still open in a Terminal window (close that window first)' }); continue; }   // moving its file while Codex keeps writing would split the session
    if (s.status === 'working' || Date.now() - s.lastActivity < 90_000) { results.push({ key, ok: false, error: 'it was active in the last 90 seconds, so it is probably open somewhere' }); continue; }
    results.push({ key, title: s.title, ...(await trashSession(s)) });
  }
  invalidate();
  return results;
}

// Sends one message to a real Claude Code / OpenCode session and streams the reply back (SSE over POST).
async function chatSend(req, res, auth) {
  const b = await body(req);
  const text = String(b.text ?? '').trim();
  if (!text || text.length > 20000) return json(res, 400, { error: 'empty or too long' });
  if (!MODES[b.mode]) return json(res, 400, { error: 'bad mode' });
  const remoteError = chatAccessError({ tool: b.tool, mode: b.mode, agent: null, remote: auth.remote });
  if (remoteError) return json(res, remoteError.status, { error: remoteError.error });
  let tool, sessionId = null, cwd;
  if (b.key) {
    const s = find(b.key); if (!s) return json(res, 404, { error: 'unknown session' });
    tool = s.tool; sessionId = s.id; cwd = s.cwd;
  } else {
    tool = b.tool; if (!SOURCES[tool]) return json(res, 400, { error: 'bad tool' });
    cwd = resolveCwd(b.cwd, snapshot.projects.map(x => x.path), fs.existsSync(LIFE_DIR) ? LIFE_DIR : null, os.homedir());   // only folders Bella already knows (or the life board)
  }
  const accessError = chatAccessError({ tool, mode: b.mode, agent: b.agent, remote: auth.remote });
  if (accessError) return json(res, accessError.status, { error: accessError.error });
  if (b.agent === 'interstellar') {
    if (b.key && path.resolve(cwd) !== path.resolve(INTERSTELLAR_DIR)) return json(res, 400, { error: 'That session is not in the Interstellar folder.' });
    cwd = INTERSTELLAR_DIR;
    if (!fs.existsSync(cwd)) return json(res, 400, { error: 'Interstellar folder is missing: ' + cwd });
  }
  if (!cwd || !fs.existsSync(cwd)) return json(res, 400, { error: 'unknown folder' });
  if (sessionId !== null && !SAFE_ID.test(sessionId)) return json(res, 400, { error: 'bad session id' });
  let agent = null;
  if (b.agent === 'interstellar') agent = 'interstellar';
  else if (b.agent) { agent = findAgent(b.agent)?.name; if (!agent || !SAFE_ID.test(agent)) return json(res, 400, { error: 'unknown agent' }); }
  if (tool === currentEngines().interstellar && path.resolve(cwd) === path.resolve(INTERSTELLAR_DIR)) agent = 'interstellar';
  if (b.key && sessionBusy(runs, b.key)) return json(res, 409, { error: 'This session is already answering.' });
  if (runs.size >= 3) return json(res, 429, { error: 'Three things are already running (chats, agents Bella started, or the family chat). Wait for one to finish.' });
  const images = (Array.isArray(b.images) ? b.images.slice(0, 4) : []).map(uploadPath);
  if (images.some(x => !x)) return json(res, 400, { error: 'unknown image' });
  const runId = crypto.randomUUID().slice(0, 8); let open = true;
  const temp = b.temp === true && !b.key && !agent;                    // a throwaway one-shot (e.g. the Today calendar check): trashed by itself after it finished OK
  let tempKey = null, tempOk = false;
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff' });
  res.write(`data: ${JSON.stringify({ t: 'accepted', runId })}\n\n`);   // so Stop works even before the agent says anything (OpenCode can take 90 s to start)
  const emit = (ev) => {
    if (temp && ev.t === 'start') tempKey = ev.key; if (temp && ev.t === 'done') tempOk = !!ev.ok;
    if (ev.t === 'start' && agent === 'bella' && !b.key) { try { recordMain(ev.key, (k) => !!find(k)); } catch (e) { console.error('bella state:', e.message); } }   // her first chat becomes her main thread
    if (open && !res.writableEnded) res.write(`data: ${JSON.stringify({ ...ev, runId })}\n\n`);
  };
  res.on('close', () => { open = false; });   // closing the page does NOT kill the agent; it finishes in the background
  const run = startRun({ tool, sessionId, cwd, text, mode: b.mode, agent, images, remote: auth.remote, usageSource: b.source === 'today' ? 'today' : 'chat' }, emit, () => { runs.delete(runId); if (open && !res.writableEnded) res.end(); kick(); if (temp && tempKey && tempOk) tempCleanup({ key: tempKey }); });
  runs.set(runId, run);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {                                   // one bad request must never take the server down
    if (e instanceof HttpError) { if (!res.headersSent) json(res, e.status, { error: e.message }); else res.end(); return; }
    console.error('request failed:', req.method, req.url, e);
    if (!res.headersSent) json(res, 500, { error: 'server error' }); else res.end();
  });
});
if (!process.env.AGENT_WORLD_DRYRUN) { try { installAgents(); installStarter(ROOT); } catch { /* optional */ } }   // starter agents and memory, never overwriting yours
const resumeLoop = () => { try { const n = resumeOrphans(); if (n) console.log(`resumed ${n} research job(s) that were interrupted`); } catch (e) { console.error('resume orphans:', e.message); } };
setTimeout(resumeLoop, 8000).unref(); setInterval(resumeLoop, 60_000).unref();   // a runner that died at 3 am is restarted within a minute
server.listen(PORT, HOST, () => {
  console.log(`Agents World running at http://localhost:${PORT}`);
  // At login, open the Today page once a day (macOS only). Wait a moment so the page has a server to talk to.
  const delay = Number(process.env.AGENT_WORLD_AUTOOPEN_DELAY_MS) || 10000;
  if (config.today) setTimeout(() => autoOpen({   // the Today page is an opt-in extra ("today": true in data/config.json)
    url: `http://localhost:${PORT}/today.html?popup=1`,
    stateFile: process.env.AGENT_WORLD_TODAY_STATE || path.join(ROOT, 'data', 'today-opened.json'),
    today: localDateString(),
  }), delay).unref();
});
process.on('unhandledRejection', (e) => console.error('unhandled rejection:', e));
process.on('uncaughtException', (e) => { console.error('uncaught exception, restarting:', e); process.exit(1); });   // unknown state: let launchd start a clean copy
