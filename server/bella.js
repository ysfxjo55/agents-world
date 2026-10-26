import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setAlias } from './store.js';

// Bella has ONE ongoing conversation (a real Claude Code session run with her agent), plus older conversations that
// are shown above it as read-only history (for example the Terminal session where she was built).
//   data/bella/state.json = { "mainSession": "<claude session id> | <tool>:<id> | null", "history": ["claude:<id>", ...] }
const FILE = process.env.AGENT_WORLD_BELLA_STATE || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'bella', 'state.json');

export function loadBella() {
  try { const s = JSON.parse(fs.readFileSync(FILE, 'utf8')); return { mainSession: s.mainSession || null, history: Array.isArray(s.history) ? s.history : [] }; }
  catch { return { mainSession: null, history: [] }; }
}
function save(state) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(state, null, 2)); fs.renameSync(tmp, FILE);
}
// Sessions Bella started through the delegate tool (key -> { by, agent, job }). They are drawn at Bella HQ.
const DELEG = path.join(path.dirname(FILE), 'delegations.json');
export function loadDelegations() { try { return JSON.parse(fs.readFileSync(DELEG, 'utf8')); } catch { return {}; } }
export function recordDelegation(key, meta) {
  const all = loadDelegations(); all[key] = { ...meta, at: Date.now() };
  fs.mkdirSync(path.dirname(DELEG), { recursive: true });
  const tmp = DELEG + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(all, null, 2)); fs.renameSync(tmp, DELEG);
}

// A short record of everything Bella did with her extra powers (data/bella/actions.log, one JSON line each).
export function logAction(entry) {
  try { fs.mkdirSync(path.dirname(DELEG), { recursive: true }); fs.appendFileSync(path.join(path.dirname(DELEG), 'actions.log'), JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n'); } catch { /* logging must never break a request */ }
}

// The key of her main thread. Older files store a bare Claude id; a Codex thread is stored with its "codex:" prefix.
export const bellaMainKey = (s) => (!s.mainSession ? null : s.mainSession.includes(':') ? s.mainSession : `claude:${s.mainSession}`);

// Remember the first Bella session as her main thread (or replace it if the old one was deleted). key = "claude:<id>" or "codex:<id>".
export function recordMain(key, exists) {
  const s = loadBella();
  if (s.mainSession && exists(bellaMainKey(s))) return false;
  s.mainSession = key.startsWith('claude:') ? key.slice(7) : key; save(s); setAlias(key, 'Bella');
  return true;
}
