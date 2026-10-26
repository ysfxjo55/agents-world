import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { knownDirs, savedUserPath } from './util.js';

// Which AI programs ("engines") are on this computer, and which one each manager agent uses.
// Agents World has no AI account of its own: it runs Claude Code, Codex or OpenCode, logged in with your own subscription.
// We only look for files. We never read, store or send a password, key or token.

export const ENGINE_NAMES = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode' };
const DEFAULTS = { bella: 'claude', interstellar: 'codex' };   // with both engines, each agent gets its own brain

/**
 * Look for each engine on PATH and in the folders installers use, and for its login file.
 * dir = the folder it was found in; onPath = that folder is on your PATH, so typing its name in a terminal works.
 * "loggedIn" is a best guess from files (a login can still be expired).
 * @param {{ env?: NodeJS.ProcessEnv, platform?: string, home?: string, userPath?: string, exists?: (f: string) => boolean, read?: (f: string) => string }} [deps]
 */
export function detectEngines({ env = process.env, platform = process.platform, home = os.homedir(), userPath = savedUserPath(), exists = fs.existsSync, read = (f) => fs.readFileSync(f, 'utf8') } = {}) {
  const win = platform === 'win32', p = win ? path.win32 : path.posix, sep = win ? ';' : ':';
  const shell = [env.PATH || env.Path || '', win ? userPath : ''].join(sep).split(sep).filter(Boolean).map(d => p.normalize(d).toLowerCase());
  const dirs = [...knownDirs(env, /** @type {NodeJS.Platform} */ (platform), home), ...String(env.PATH || env.Path || '').split(sep), ...(win ? userPath.split(sep) : [])].filter(Boolean);
  const exts = win ? ['.exe', '.cmd'] : [''];
  const find = (bin) => {
    const dir = dirs.find(d => exts.some(x => exists(p.join(d, bin + x))));
    // only Windows can tell for sure (its saved PATH is in the registry); a Mac app started by double-click never sees your shell's PATH
    return dir ? { installed: true, dir, onPath: !win || shell.includes(p.normalize(dir).toLowerCase()) } : { installed: false };
  };
  const claudeLogin = () => {
    if (env.ANTHROPIC_API_KEY || exists(p.join(home, '.claude', '.credentials.json'))) return true;
    try { return !!JSON.parse(read(p.join(home, '.claude.json'))).oauthAccount; } catch { return false; }   // only checks that an account is set, never reads a token
  };
  const claude = find('claude'), codex = find('codex'), opencode = find('opencode');
  return {
    claude: { ...claude, loggedIn: claude.installed ? claudeLogin() : false },
    codex: { ...codex, loggedIn: codex.installed ? !!env.OPENAI_API_KEY || exists(p.join(home, '.codex', 'auth.json')) : false },
    opencode: { ...opencode, loggedIn: opencode.installed ? exists(p.join(home, '.local', 'share', 'opencode', 'auth.json')) : false },
  };
}

/**
 * The engine for Bella or Interstellar: your setting ("agents": {"bella": {"engine": "codex"}}) if that engine is installed,
 * else the agent's own one (Bella: Claude Code, Interstellar: Codex). null = not available: with only Claude you get Bella,
 * with only Codex you get Interstellar, with both you get both.
 * @param {'bella' | 'interstellar'} agent
 * @param {Record<string, { installed: boolean }>} found
 * @param {Record<string, { engine?: string }>} [settings]
 */
export function engineFor(agent, found, settings = {}) {
  const ok = (e) => (e === 'claude' || e === 'codex') && !!found[e]?.installed;
  const wanted = settings[agent]?.engine, usual = DEFAULTS[agent];
  return ok(wanted) ? wanted : ok(usual) ? usual : null;
}

/** Everything the pages and the server need, in one object. */
export function engineSummary(found, settings = {}) {
  return { found, bella: engineFor('bella', found, settings), interstellar: engineFor('interstellar', found, settings), any: Object.values(found).some(e => e.installed) };
}

/** Is this manager shown at all? Yes when it has an engine. With neither Claude Code nor Codex (nothing set up yet, or only OpenCode) both stay, as before. */
export function agentShown(agent, eng = current) {
  const f = /** @type {Record<string, { installed?: boolean }>} */ (eng.found || {});
  if (!f.claude?.installed && !f.codex?.installed) return true;
  return !!eng[agent];
}

// What the running app uses. Until the server looks (at startup), each agent keeps its usual engine.
let current = { found: {}, bella: 'claude', interstellar: 'codex', any: true };
export const currentEngines = () => current;
export function setEngines(summary) { current = summary; return current; }
