import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Updates: compare our version with the one on GitHub, and install a newer one when you click "Update now"
// (or by itself with "updates": {"auto": true}). A git clone is updated with git pull; a ZIP install by downloading the
// new files. Your data (data/, .env) and your ~/.claude files are never touched.

export const REPO = 'ysfxjo55/agents-world';   // owner/name on GitHub: change this one line when the repo is renamed
export const BRANCH = 'main';
export const RESTART_CODE = 75;                // server/start.js starts the server again when it exits with this code
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** "0.2.10" vs "0.2.9" -> 1 (a is newer), 0 (same), -1 (older). Anything that is not a version counts as 0.0.0. */
export function compareVersions(a, b) {
  const parts = (v) => (/^\d+(\.\d+)*$/.test(String(v || '').trim()) ? String(v).trim().split('.').map(Number) : [0]);
  const x = parts(a), y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0 ? 1 : -1; }
  return 0;
}

/** The changelog lines for the versions after `from`, up to and including `to`. CHANGELOG.md: "## 0.2.1" then "- line" items. */
export function notesFor(changelog, from, to) {
  const out = []; let take = false;
  for (const line of String(changelog || '').replace(/\r\n?/g, '\n').split('\n')) {
    const m = line.match(/^##\s+v?(\d+(?:\.\d+)*)/);
    if (m) { take = compareVersions(m[1], from) > 0 && compareVersions(m[1], to) <= 0; continue; }
    if (take && /^\s*[-*]\s+/.test(line)) out.push(line.replace(/^\s*[-*]\s+/, '').trim());
  }
  return out.slice(0, 12);
}

/** 'git' when the app folder is a git clone, else 'zip' (downloaded as a ZIP). */
export const installKind = (root = ROOT, exists = fs.existsSync) => (exists(path.join(root, '.git')) ? 'git' : 'zip');

/** Files an update may replace. Your data, secrets, installed packages and git's own folder are never touched. */
export function shouldCopy(rel) {
  const p = rel.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!p || p.split('/').includes('..')) return false;
  const top = p.split('/')[0];
  return !['data', 'node_modules', '.git', 'life'].includes(top) && !/^\.env(\..*)?$/.test(p);
}

export const currentVersion = (root = ROOT) => { try { return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version || '0.0.0'; } catch { return '0.0.0'; } };

/** Ask GitHub for the newest version (plain HTTPS, no token). Throws when offline or when the repo is private (404). */
export async function fetchLatest({ doFetch = fetch, repo = REPO, branch = BRANCH } = {}) {
  const raw = (f) => doFetch(`https://raw.githubusercontent.com/${repo}/${branch}/${f}`, { signal: AbortSignal.timeout(10_000) });
  const r = await raw('package.json');
  if (!r.ok) throw new Error(`GitHub answered ${r.status}${r.status === 404 ? ' (the repo may be private)' : ''}`);
  const version = String((await r.json()).version || '');
  let changelog = ''; try { const c = await raw('CHANGELOG.md'); if (c.ok) changelog = await c.text(); } catch { /* notes are optional */ }
  return { version, changelog };
}

const hashFile = (f) => { try { return crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'); } catch { return ''; } };
// Git never asks for a login here: no terminal prompt and no Git Credential Manager window. It uses the login you already saved, or fails quietly.
const QUIET_GIT = { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
const runDefault = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', timeout: 300_000, windowsHide: true, env: { ...process.env, ...QUIET_GIT }, shell: process.platform === 'win32' && cmd === 'npm' });

/** A git clone asks git for the newest version (works for a private repo you are logged in to); a ZIP install asks GitHub over HTTPS. */
export function latestFromGit(root = ROOT, run = runDefault) {
  run('git', ['fetch', '--quiet', 'origin', BRANCH], root);
  const version = String(JSON.parse(run('git', ['show', `origin/${BRANCH}:package.json`], root)).version || '');
  let changelog = ''; try { changelog = run('git', ['show', `origin/${BRANCH}:CHANGELOG.md`], root); } catch { /* notes are optional */ }
  return { version, changelog };
}   // npm is npm.cmd on Windows; the arguments are fixed, never user text

/** git clone: refuse when you changed app files, else fast-forward only. Returns a short message.
 * A changed package-lock.json is not your work (an older npm rewrites it during install), so it is reset and rebuilt after the pull. */
export function updateGit(root = ROOT, run = runDefault) {
  const changed = run('git', ['status', '--porcelain', '--untracked-files=no'], root).split('\n').map(l => l.slice(3).trim()).filter(Boolean);
  if (changed.some(f => f !== 'package-lock.json')) throw new Error('You changed some app files, so I did not update. Undo your changes (or commit them), then try again.');
  if (changed.length) run('git', ['checkout', '--', 'package-lock.json'], root);
  const lock = hashFile(path.join(root, 'package-lock.json'));
  run('git', ['pull', '--ff-only', 'origin', BRANCH], root);
  if (changed.length || hashFile(path.join(root, 'package-lock.json')) !== lock) run('npm', ['ci', '--no-audit', '--no-fund'], root);
  return 'Updated with git.';
}

/** Every file below dir, as paths relative to it. */
function walk(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, base, out); else if (e.isFile()) out.push(path.relative(base, f));
  }
  return out;
}

/** Copy the new app files from `from` over `root`, backing up each file it replaces into backupDir. Returns how many it copied. */
export function copyRelease(from, root, backupDir) {
  let n = 0;
  for (const rel of walk(from)) {
    if (!shouldCopy(rel)) continue;
    const dst = path.join(root, rel);
    if (fs.existsSync(dst)) { const b = path.join(backupDir, rel); fs.mkdirSync(path.dirname(b), { recursive: true }); fs.copyFileSync(dst, b); }
    fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(path.join(from, rel), dst); n++;
  }
  return n;
}

/** ZIP install: download the newest code as a .tar.gz, unpack it with the system tar (Mac, Linux, Windows 10+), copy it over. */
export async function updateZip(root = ROOT, { doFetch = fetch, run = runDefault, repo = REPO } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-world-update-'));
  try {
    const r = await doFetch(`https://codeload.github.com/${repo}/tar.gz/refs/heads/${BRANCH}`, { signal: AbortSignal.timeout(120_000) });
    if (!r.ok) throw new Error(`Download failed (${r.status}).`);
    const file = path.join(tmp, 'update.tar.gz'); fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    const out = path.join(tmp, 'x'); fs.mkdirSync(out);
    run('tar', ['-xzf', file, '-C', out], tmp);
    const top = fs.readdirSync(out).map(d => path.join(out, d)).find(d => fs.statSync(d).isDirectory());
    if (!top || !fs.existsSync(path.join(top, 'package.json'))) throw new Error('The download did not look like Agents World.');
    const lock = hashFile(path.join(root, 'package-lock.json'));
    const backup = path.join(root, 'data', 'backups', `update-${currentVersion(root)}-${Date.now()}`);
    const n = copyRelease(top, root, backup);
    if (hashFile(path.join(root, 'package-lock.json')) !== lock) run('npm', ['ci', '--no-audit', '--no-fund'], root);
    return `Updated ${n} files. The old ones are in ${path.relative(root, backup)}.`;
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

/**
 * The update state the page shows, plus check() and install(). Quiet when offline: one log line, no banner.
 * @param {{ settings?: { check?: boolean, auto?: boolean }, busy?: () => boolean, onInstalled?: () => void, doFetch?: typeof fetch, root?: string, log?: (m: string) => void, run?: (cmd: string, args: string[], cwd: string) => string }} opts
 */
export function createUpdater({ settings = {}, busy = () => false, onInstalled = () => {}, doFetch = fetch, root = ROOT, log = (m) => console.log(m), run = runDefault } = {}) {
  const state = { enabled: settings.check !== false, auto: settings.auto === true, current: currentVersion(root), latest: null, notes: [], available: false, kind: installKind(root), installing: false, error: null, checkedAt: null };
  /** Look on GitHub, unless we already looked less than minAgeMs ago (keeps us far below GitHub's limits). */
  async function check({ minAgeMs = 0 } = {}) {
    if (!state.enabled) return state;
    if (minAgeMs && state.checkedAt && Date.now() - state.checkedAt < minAgeMs) return state;
    try {
      const { version, changelog } = state.kind === 'git' ? latestFromGit(root, run) : await fetchLatest({ doFetch });
      state.latest = version; state.checkedAt = Date.now(); state.error = null;
      state.available = compareVersions(version, state.current) > 0;
      state.notes = state.available ? notesFor(changelog, state.current, version) : [];
      if (state.available && state.auto && !busy()) await install();
    } catch (e) { log(`update check skipped: ${String(e.message).split('\n')[0]}`); }
    return state;
  }
  async function install() {
    if (state.installing) return { ok: false, error: 'An update is already running.' };
    if (busy()) return { ok: false, error: 'An agent is still working. Try again when it has finished.' };
    state.installing = true; state.error = null;
    try {
      const message = state.kind === 'git' ? updateGit(root, run) : await updateZip(root, { doFetch, run });
      log(message); onInstalled();
      return { ok: true, message };
    } catch (e) { state.error = e.message; return { ok: false, error: e.message }; }
    finally { state.installing = false; }
  }
  return { state, check, install };
}

/** For http://localhost:4321/?preview-update: the real banner with a pretend newer version and this copy's newest changelog lines. Nothing is installed. */
export function previewState(state, root = ROOT) {
  let changelog = ''; try { changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'); } catch { /* none */ }
  return { ...state, preview: true, available: true, latest: '9.9.9', notes: notesFor(changelog, '0.0.0', state.current).slice(0, 6) };
}
