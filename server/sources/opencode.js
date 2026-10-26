import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { computeStatus, clip, bucketize } from '../status.js';

// SECURITY: this DB also holds account/credential tables. Only project/session/message/part are ever queried.
export const OPENCODE_DIR = path.join(os.homedir(), '.local', 'share', 'opencode');
const DB = path.join(OPENCODE_DIR, 'opencode.db');
let db = null;

function open() {
  if (db) return db;
  if (!fs.existsSync(DB)) return null;
  try { db = new DatabaseSync(DB, { readOnly: true }); db.exec('PRAGMA query_only = ON'); } catch { db = null; }
  return db;
}
const j = (s) => { try { return JSON.parse(s); } catch { return {}; } };

function signalFor(d, sid, updated) {
  const m = d.prepare('SELECT data, time_created FROM message WHERE session_id = ? ORDER BY time_created DESC LIMIT 1').get(sid);
  if (!m) return { signal: { lastEvent: 'user', lastTs: updated }, currentTool: null };
  const md = j(m.data);
  const parts = d.prepare('SELECT data FROM part WHERE session_id = ? ORDER BY time_created DESC LIMIT 8').all(sid).map(r => j(r.data));
  const running = parts.find(p => p.type === 'tool' && (p.state?.status === 'running' || p.state?.status === 'pending'));
  const lastTool = parts.find(p => p.type === 'tool');
  const brief = (p) => p ? `${p.tool}${p.state?.input ? ' · ' + clip(p.state.input.command ?? p.state.input.filePath ?? p.state.input.pattern ?? p.state.input.description ?? '', 140) : ''}` : null;
  let sig;
  if (md.role === 'user') sig = { lastEvent: 'user', lastTs: Math.max(m.time_created, updated) };
  else if (md.finish && md.finish !== 'tool-calls' && md.time?.completed) sig = { lastEvent: 'assistant_end', lastTs: md.time.completed };
  else if (md.finish === 'tool-calls') sig = { lastEvent: 'tool_result', lastTs: Math.max(md.time?.completed ?? 0, updated) };
  else sig = { lastEvent: 'assistant_text', lastTs: Math.max(m.time_created, updated) };
  if (running) sig.pendingToolSince = running.state?.time?.start ?? sig.lastTs;
  return { signal: sig, currentTool: running ? brief(running) : null, lastTool: brief(lastTool) };
}

export function listOpenCode(now = Date.now()) {
  const d = open(); if (!d) return [];
  try {
    const rows = d.prepare('SELECT id, project_id, parent_id, directory, title, agent, model, time_created, time_updated, time_archived FROM session').all();
    const kids = new Map();
    for (const r of rows) if (r.parent_id) {
      if (!kids.has(r.parent_id)) kids.set(r.parent_id, []);
      kids.get(r.parent_id).push({ id: r.id, label: clip(r.title, 60), active: now - r.time_updated < 60_000, ts: r.time_updated });
    }
    const out = [];
    for (const r of rows) {
      if (r.parent_id) continue;
      const helpers = (kids.get(r.id) || []).filter(h => now - h.ts < 10 * 60_000).sort((a, b) => b.ts - a.ts);
      const recent = now - r.time_updated < 35 * 60_000;
      let signal = { lastEvent: 'assistant_end', lastTs: r.time_updated }, currentTool = null, stamps = [];
      if (recent) {
        const s = signalFor(d, r.id, r.time_updated);
        signal = s.signal; currentTool = s.currentTool;
        stamps = d.prepare('SELECT time_created FROM part WHERE session_id = ? AND time_created > ?').all(r.id, now - 3600_000).map(x => x.time_created);
      } else {
        const m = d.prepare('SELECT data FROM message WHERE session_id = ? ORDER BY time_created DESC LIMIT 1').get(r.id);
        if (m && j(m.data).role === 'user') signal = { lastEvent: 'user', lastTs: r.time_updated };
      }
      signal.busyChild = helpers.some(h => h.active);
      const model = j(r.model);
      out.push({
        key: `opencode:${r.id}`, id: r.id, tool: 'opencode', title: clip(r.title, 90), cwd: r.directory, branch: null,
        agent: r.agent, model: model.id || null,
        status: computeStatus(signal, now), lastActivity: Math.max(signal.lastTs, r.time_updated),
        size: 0, currentTool, activity: bucketize(stamps, now), helpers: helpers.slice(0, 6),
        archivedInTool: !!r.time_archived,
      });
    }
    return out;
  } catch (e) { db = null; return []; }
}

export function opencodeDetail(id, limit = 20) {
  const d = open(); if (!d) return [];
  try {
    const rows = d.prepare('SELECT p.data, p.time_created, m.data AS mdata FROM part p JOIN message m ON m.id = p.message_id WHERE p.session_id = ? ORDER BY p.time_created DESC LIMIT 80').all(id).reverse();
    const items = [];
    for (const r of rows) {
      const p = j(r.data), role = j(r.mdata).role || 'assistant';
      if (p.type === 'text' && p.text?.trim()) items.push({ ts: r.time_created, role, kind: 'text', text: clip(p.text, 400) });
      else if (p.type === 'tool') items.push({ ts: r.time_created, role: 'assistant', kind: 'tool', text: `${p.tool} · ${clip(p.state?.input?.command ?? p.state?.input?.filePath ?? p.state?.input?.pattern ?? p.state?.title ?? '', 160)} [${p.state?.status}]` });
    }
    return items.slice(-limit);
  } catch { return []; }
}

export function opencodeTranscript(id, limit = 150) {
  const d = open(); if (!d) return [];
  try {
    const ms = d.prepare('SELECT id, data, time_created FROM message WHERE session_id = ? ORDER BY time_created ASC').all(id);
    const parts = d.prepare('SELECT message_id, data FROM part WHERE session_id = ? ORDER BY time_created ASC').all(id);
    const by = new Map(); for (const p of parts) { if (!by.has(p.message_id)) by.set(p.message_id, []); by.get(p.message_id).push(j(p.data)); }
    const out = [];
    for (const m of ms) {
      const role = j(m.data).role === 'user' ? 'user' : 'assistant', bl = [];
      for (const p of by.get(m.id) || []) {
        if (p.type === 'text' && p.text?.trim() && !p.synthetic) bl.push({ type: 'text', text: p.text });
        else if (p.type === 'tool') bl.push({ type: 'tool', id: p.callID || p.id, name: p.tool, summary: `${p.tool}${p.state?.input ? ' · ' + clip(p.state.input.command ?? p.state.input.filePath ?? p.state.input.pattern ?? p.state.input.description ?? '', 160) : ''}`, result: clip(p.state?.output ?? '', 700), error: p.state?.status === 'error' });
      }
      if (!bl.length) continue;
      const last = out[out.length - 1];
      if (role === 'assistant' && last?.role === 'assistant') last.blocks.push(...bl); else out.push({ role, ts: m.time_created, blocks: bl });
    }
    return out.slice(-limit);
  } catch { return []; }
}
