import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { HttpError } from './auth.js';

// Picks the folder a chat may start in: an empty request means home; a requested folder must be a folder
// Bella already knows, or the life board folder (when it exists). Anything else is refused (null).
export function resolveCwd(requested, knownProjectPaths, lifeDir, home) {
  if (!requested) return home;
  if ((knownProjectPaths || []).includes(requested)) return requested;
  if (lifeDir && requested === lifeDir) return lifeDir;
  return null;
}

// Reads a raw binary request body (an image). Rejects with 413 when it is larger than the limit.
export function rawBody(req, limit = 12 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0, done = false;
    const fail = (e) => { if (!done) { done = true; reject(e); } };
    req.on('data', (c) => { size += c.length; if (size > limit) { fail(new HttpError(413, 'file too large')); req.pause(); } else chunks.push(c); });
    req.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
    req.on('error', () => fail(new HttpError(400, 'request aborted')));
    req.on('close', () => fail(new HttpError(400, 'request aborted')));
  });
}

// Reads a JSON request body. Rejects (never hangs) when it is too large, invalid, or the client went away.
export function body(req, limit = 1e5) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0, done = false;
    const fail = (e) => { if (!done) { done = true; reject(e); } };
    // keep raw bytes and decode once at the end: a letter (e.g. Arabic, 2 bytes) can be split between two chunks
    req.on('data', (c) => { const buf = Buffer.from(c); chunks.push(buf); size += buf.length; if (size > limit) { fail(new HttpError(413, 'request too large')); req.pause(); } });
    req.on('end', () => { if (done) return; done = true; try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new HttpError(400, 'bad JSON')); } });
    req.on('error', () => fail(new HttpError(400, 'request aborted')));
    req.on('close', () => fail(new HttpError(400, 'request aborted')));
  });
}

// Only a Claude chat that lives in the life folder (where the Today popup starts its chats) may be removed by the Today popup.
export function isTodayChat(session, lifeDir) {
  return !!session && !!lifeDir && session.tool === 'claude' && !!session.cwd && path.resolve(session.cwd) === path.resolve(lifeDir);
}

// PATH for starting claude / codex / opencode. Mac and Linux: the usual install folders first, joined with ":".
// Windows: PATH is separated by ";" and is called "Path"; the native Claude Code installer uses %USERPROFILE%\.local\bin.
// The folders installers put these programs in, even when they are not on PATH yet (the Claude Code installer on Windows says so).
export function knownDirs(env = process.env, platform = process.platform, home = os.homedir()) {
  if (platform === 'win32') return [path.win32.join(home, '.local', 'bin'), ...(env.APPDATA ? [path.win32.join(env.APPDATA, 'npm')] : [])];
  return [path.join(home, '.local/bin'), path.join(home, '.npm-global/bin'), '/opt/homebrew/bin', '/usr/local/bin'];
}
export function toolPath(env = process.env, platform = process.platform, home = os.homedir()) {
  if (platform === 'win32') return [...knownDirs(env, platform, home), env.PATH || env.Path || '', userPath].filter(Boolean).join(';');
  return [...knownDirs(env, platform, home), '/usr/bin', '/bin', env.PATH || ''].join(':');
}

// Windows only: the user's PATH as saved now (System Properties or the guide's fix), not as it was when the app started.
// "Check again" calls this, so a PATH fix works without restarting the app.
let userPath = '';
export function refreshUserPath({ platform = process.platform, env = process.env, run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', timeout: 5000, windowsHide: true }) } = {}) {
  if (platform !== 'win32') return '';
  try {
    const m = run('reg', ['query', 'HKCU\\Environment', '/v', 'Path']).match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.*)/i);
    userPath = m ? m[1].trim().replace(/%([^%]+)%/g, (all, k) => env[k] ?? env[k.toUpperCase()] ?? all) : '';
  } catch { userPath = ''; }
  return userPath;
}
export const savedUserPath = () => userPath;

// The environment for a child process with PATH set as above. On Windows the "Path" key is replaced, not doubled.
export function withToolPath(env = process.env, platform = process.platform, home = os.homedir()) {
  const out = Object.fromEntries(Object.entries(env).filter(([k]) => k.toUpperCase() !== 'PATH'));
  out.PATH = toolPath(env, platform, home);
  return out;
}

// On Windows, npm installs command line tools as .cmd files. Node can only start those through a shell, and a shell would read
// the user's text in the arguments as commands. So we start the real program: an .exe on PATH, or node + the script the .cmd runs.
/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ platform?: string, env?: Record<string, string | undefined>, exists?: (f: string) => boolean, read?: (f: string) => string }} [io]
 */
export function resolveBin(cmd, args, { platform = process.platform, env = process.env, exists = fs.existsSync, read = (f) => fs.readFileSync(f, 'utf8') } = {}) {
  if (platform !== 'win32' || /[\\/]/.test(cmd)) return { cmd, args };
  const dirs = String(env.PATH || env.Path || '').split(';').filter(Boolean);
  for (const d of dirs) { const exe = path.win32.join(d, cmd + '.exe'); if (exists(exe)) return { cmd: exe, args }; }
  for (const d of dirs) {
    const shim = path.win32.join(d, cmd + '.cmd');
    if (!exists(shim)) continue;
    const m = read(shim).match(/"%~?dp0%\\?([^"]+?\.(?:js|cjs|mjs))"/i);
    if (m) return { cmd: process.execPath, args: [path.win32.join(d, m[1]), ...args] };
  }
  return { cmd, args };
}
