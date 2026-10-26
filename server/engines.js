import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { toolPath } from './util.js';

// Which AI programs ("engines") are on this computer, and which one each manager agent uses.
// Agent World has no AI account of its own: it runs Claude Code, Codex or OpenCode, logged in with your own subscription.
// We only look for files. We never read, store or send a password, key or token.

export const ENGINE_NAMES = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode' };
const DEFAULTS = { bella: 'claude', interstellar: 'codex' };   // with both engines, each agent gets its own brain

/**
 * Look for each engine on PATH and for its login file.
 * "loggedIn" is a best guess from files (a login can still be expired); null = we cannot tell.
 * @param {{ env?: NodeJS.ProcessEnv, platform?: string, home?: string, exists?: (f: string) => boolean, read?: (f: string) => string }} [deps]
 */
export function detectEngines({ env = process.env, platform = process.platform, home = os.homedir(), exists = fs.existsSync, read = (f) => fs.readFileSync(f, 'utf8') } = {}) {
  const dirs = toolPath(env, /** @type {NodeJS.Platform} */ (platform), home).split(platform === 'win32' ? ';' : ':').filter(Boolean);
  const exts = platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
  const onPath = (bin) => dirs.some(d => exts.some(x => exists(path.join(d, bin + x))));
  const claudeLogin = () => {
    if (env.ANTHROPIC_API_KEY || exists(path.join(home, '.claude', '.credentials.json'))) return true;
    try { return !!JSON.parse(read(path.join(home, '.claude.json'))).oauthAccount; } catch { return false; }   // only checks that an account is set, never reads a token
  };
  const out = {};
  out.claude = { installed: onPath('claude') };
  out.claude.loggedIn = out.claude.installed ? claudeLogin() : false;
  out.codex = { installed: onPath('codex') };
  out.codex.loggedIn = out.codex.installed ? !!env.OPENAI_API_KEY || exists(path.join(home, '.codex', 'auth.json')) : false;
  out.opencode = { installed: onPath('opencode') };
  out.opencode.loggedIn = out.opencode.installed ? exists(path.join(home, '.local', 'share', 'opencode', 'auth.json')) : false;
  return out;
}

/**
 * The engine for Bella or Interstellar: your setting ("agents": {"bella": {"engine": "codex"}}) if that engine is installed,
 * else the agent's usual one, else the other one. With only one engine, both agents use it. null = no engine at all.
 * @param {'bella' | 'interstellar'} agent
 * @param {Record<string, { installed: boolean }>} found
 * @param {Record<string, { engine?: string }>} [settings]
 */
export function engineFor(agent, found, settings = {}) {
  const ok = (e) => (e === 'claude' || e === 'codex') && !!found[e]?.installed;
  const wanted = settings[agent]?.engine, usual = DEFAULTS[agent], other = usual === 'claude' ? 'codex' : 'claude';
  return ok(wanted) ? wanted : ok(usual) ? usual : ok(other) ? other : null;
}

/** Everything the pages and the server need, in one object. */
export function engineSummary(found, settings = {}) {
  return { found, bella: engineFor('bella', found, settings), interstellar: engineFor('interstellar', found, settings), any: Object.values(found).some(e => e.installed) };
}

// What the running app uses. Until the server looks (at startup), each agent keeps its usual engine.
let current = { found: {}, bella: 'claude', interstellar: 'codex', any: true };
export const currentEngines = () => current;
export function setEngines(summary) { current = summary; return current; }
