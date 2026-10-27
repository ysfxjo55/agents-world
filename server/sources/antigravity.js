import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeStatus, clip, bucketize, T } from '../status.js';

// Google Antigravity CLI (`agy`). Each conversation is a small database in ~/.gemini/antigravity-cli/conversations/,
// and conversation_summaries.db lists them all (id, title, folder, last change, run status). That list is all we read:
// the messages themselves are stored in a binary format we do not decode. For the chat page we keep our own short
// copy of what was said through Agents World (data/antigravity/<id>.jsonl).
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const AGY_DIR = () => process.env.AGENT_WORLD_AGY_DIR || path.join(os.homedir(), '.gemini', 'antigravity-cli');
export const LOG_DIR = () => process.env.AGENT_WORLD_AGY_LOG_DIR || path.join(ROOT, 'data', 'antigravity');
const SAFE = /^[\w-]{6,80}$/;

let sqlite = null; try { sqlite = await import('node:sqlite'); } catch { /* Node without SQLite: no Antigravity blocks, chat still works */ }
let cache = { key: '', rows: [] };

/** The rows of conversation_summaries.db (read-only; the CLI may be writing it at the same time). */
export function readSummaries(file = path.join(AGY_DIR(), 'conversation_summaries.db')) {
  let st; try { st = fs.statSync(file); } catch { return []; }
  const key = `${file}:${st.mtimeMs}:${st.size}`; if (cache.key === key) return cache.rows;
  if (!sqlite) return [];
  let db;
  try {
    db = new sqlite.DatabaseSync(file, { readOnly: true });
    const rows = db.prepare('SELECT conversation_id, title, preview, last_modified_time, last_user_input_time, workspace_uris, status FROM conversation_summaries').all();
    cache = { key, rows }; return rows;
  } catch { return cache.rows; }   // busy or changed under us: keep the last good list
  finally { try { db?.close(); } catch { /* closed */ } }
}

const time = (v) => { const t = Date.parse(String(v || '').replace(' ', 'T')); return Number.isFinite(t) ? t : 0; };
const folderOf = (uris) => { try { const u = JSON.parse(uris || '[]')[0]; return u?.startsWith('file://') ? fileURLToPath(u) : null; } catch { return null; } };

/** One session per Antigravity conversation, in the same shape as the other sources. */
export function sessionFromRow(r, now = Date.now()) {
  const id = String(r.conversation_id || ''), cwd = folderOf(r.workspace_uris);
  if (!SAFE.test(id) || !cwd) return null;
  const lastTs = Math.max(time(r.last_modified_time), time(r.last_user_input_time));
  const running = /RUNNING|ACTIVE/i.test(String(r.status || ''));
  const status = running && now - lastTs < T.SLEEP_MS ? 'working' : computeStatus({ lastEvent: 'assistant_end', lastTs }, now);
  return { key: `antigravity:${id}`, id, tool: 'antigravity', title: clip(r.title || r.preview || '(untitled)', 90), cwd, branch: null,
    status, lastActivity: lastTs, currentTool: null, activity: bucketize([lastTs], now), helpers: [] };
}
export function listAntigravity(now = Date.now()) {
  return readSummaries().map(r => sessionFromRow(r, now)).filter(Boolean);
}

/** Keep what was said through Agents World, so the chat page can show it again. */
export function rememberTurn(id, user, reply, ts = Date.now()) {
  if (!SAFE.test(String(id))) return;
  try {
    fs.mkdirSync(LOG_DIR(), { recursive: true });
    fs.appendFileSync(path.join(LOG_DIR(), `${id}.jsonl`), JSON.stringify({ ts, user: String(user).slice(0, 20000), reply: String(reply).slice(0, 50000) }) + '\n', { mode: 0o600 });
  } catch { /* the chat itself already showed it */ }
}

const NOTE = 'Antigravity keeps its full history in its own format, which Agents World cannot read. Messages you send from here are shown below. To see everything, continue it in a terminal: agy --conversation <id>';
export function antigravityTranscript(id, limit = 150) {
  const out = [{ role: 'assistant', ts: 0, blocks: [{ type: 'notice', text: NOTE.replace('<id>', id) }] }];
  if (!SAFE.test(String(id))) return out;
  let lines = []; try { lines = fs.readFileSync(path.join(LOG_DIR(), `${id}.jsonl`), 'utf8').split('\n').filter(Boolean); } catch { /* nothing sent from here yet */ }
  for (const l of lines.slice(-limit)) {
    try { const t = JSON.parse(l); out.push({ role: 'user', ts: t.ts, blocks: [{ type: 'text', text: t.user }] }, { role: 'assistant', ts: t.ts, blocks: [{ type: 'text', text: t.reply }] }); } catch { /* skip a broken line */ }
  }
  return out;
}
export const antigravityDetail = (id) => antigravityTranscript(id, 10).slice(1).flatMap(m => m.blocks.map(b => ({ ts: m.ts, role: m.role, kind: 'text', text: clip(b.text, 400) })));
