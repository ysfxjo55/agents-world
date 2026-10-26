import { stripPersona } from '../family-persona.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { computeStatus, clip, bucketize, T } from '../status.js';

// Only these two session folders are read; credentials and CLI settings are never opened.
export const roots = () => [process.env.AGENT_WORLD_CODEX_SESSIONS_DIR || path.join(os.homedir(), '.codex', 'sessions'), process.env.AGENT_WORLD_CODEX_ARCHIVED_DIR || path.join(os.homedir(), '.codex', 'archived_sessions')];
const cache = new Map();

function* files(dir) {
  let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const file = path.join(dir, e.name);
    if (e.isDirectory()) yield* files(file);
    else if (e.isFile() && e.name.endsWith('.jsonl')) yield file;
  }
}

// Fixed-size reads, including a cap for giant image lines. Preserve UTF-8 across chunk boundaries.
function* entries(file) {
  const fd = fs.openSync(file, 'r'), buf = Buffer.alloc(64 * 1024), decoder = new StringDecoder('utf8');
  let pending = '', skipping = false;
  const parse = (line) => { try { return JSON.parse(line); } catch { return null; } };
  try {
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null))) {
      const parts = decoder.write(buf.subarray(0, n)).split('\n');
      for (let i = 0; i < parts.length; i++) {
        if (!skipping) pending += parts[i];
        if (pending.length > 8_000_000) { pending = ''; skipping = true; }
        if (i < parts.length - 1) {
          const d = skipping ? null : parse(pending); if (d) yield d;
          pending = ''; skipping = false;
        }
      }
    }
    if (!skipping) { const d = parse(pending + decoder.end()); if (d) yield d; }
  } finally { fs.closeSync(fd); }
}

const textOf = (p) => (Array.isArray(p.content) ? p.content : []).filter(b => b.type === 'input_text' || b.type === 'output_text' || b.type === 'text').map(b => b.text || '').join('\n').trim();
const realPrompt = (t) => t && !/^\s*<(?:environment_context|permissions instructions|instructions|user_instructions)\b/.test(t) && !t.startsWith('# AGENTS.md instructions');
function brief(p) {
  let input = p.input || p.arguments || '';
  try { const j = JSON.parse(input); input = j.cmd ?? j.command ?? j.path ?? j.query ?? input; } catch {}
  return `${p.name || 'tool'}${input ? ' · ' + clip(input, 160) : ''}`;
}

function parseSession(file) {
  let id, cwd, branch, model, title, signal = null, currentTool = null, lastTs = 0;
  const stamps = [], pending = new Map();
  for (const d of entries(file)) {
    const p = d.payload || {}, ts = Date.parse(d.timestamp) || 0;
    lastTs = Math.max(lastTs, ts);
    if (d.type === 'session_meta') { id = p.id; cwd = p.cwd; branch = p.git?.branch; model = p.model; }
    if (d.type === 'turn_context' && p.model) model = p.model;
    let event;
    if (d.type === 'event_msg') {
      if (p.type === 'task_started' || p.type === 'user_message') event = 'user';
      if (p.type === 'task_complete' || p.type === 'turn_aborted') { event = 'assistant_end'; pending.clear(); }
    }
    if (d.type === 'response_item') {
      if (p.type === 'message') {
        const text = p.role === 'user' ? stripPersona(textOf(p)) : textOf(p);
        if (p.role === 'user' && realPrompt(text)) { title ??= clip(text, 90); event = 'user'; }
        if (p.role === 'assistant' && text) event = p.phase === 'final_answer' ? 'assistant_end' : 'assistant_text';
      } else if (p.type === 'function_call' || p.type === 'custom_tool_call') {
        pending.set(p.call_id, ts); currentTool = brief(p); event = 'tool_call';
      } else if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') { pending.delete(p.call_id); event = 'tool_result'; }
    }
    if (event) { signal = { lastEvent: event, lastTs: ts }; stamps.push(ts); }
    if (stamps.length > 720) stamps.shift();
  }
  if (signal && pending.size) signal.pendingToolSince = Math.min(...pending.values());
  return { id, cwd, branch, model, title, signal, currentTool, lastTs, stamps };
}

export function listCodex(now = Date.now()) {
  const out = [], seen = new Set(), present = new Set();
  for (const root of roots()) for (const file of files(root)) {
    present.add(file);
    try {
      const st = fs.statSync(file);
      let c = cache.get(file);
      if (!c || c.mtimeMs !== st.mtimeMs || c.size !== st.size) { c = { mtimeMs: st.mtimeMs, size: st.size, parsed: parseSession(file) }; cache.set(file, c); }
      const p = c.parsed;
      if (typeof p.cwd !== 'string' || !p.cwd || !p.id || !/^[\w-]+$/.test(p.id) || seen.has(p.id)) continue;
      seen.add(p.id);
      let status = computeStatus(p.signal, now);
      if (status === 'working' && now - st.mtimeMs >= T.WORKING_MS) status = 'sleeping';
      out.push({ key: `codex:${p.id}`, id: p.id, tool: 'codex', title: p.title || '(untitled)', cwd: p.cwd, branch: p.branch || null, model: p.model || null,
        status, lastActivity: Math.max(st.mtimeMs, p.lastTs), size: st.size, currentTool: p.signal?.pendingToolSince ? p.currentTool : null,
        activity: bucketize(p.stamps, now), helpers: [] });
    } catch { /* a session may move while the CLI archives it */ }
  }
  for (const file of cache.keys()) if (!present.has(file)) cache.delete(file);
  return out;
}

export function codexFile(id) {
  if (!/^[\w-]+$/.test(id)) return null;
  for (const root of roots()) for (const file of files(root)) {
    if (!path.basename(file).endsWith(`-${id}.jsonl`)) continue;
    try { for (const d of entries(file)) if (d.type === 'session_meta') { if (d.payload?.id === id) return file; break; } } catch {}
  }
  return null;
}

export function codexTranscript(id, limit = 150, opts = {}) {
  const file = codexFile(id); if (!file) return [];
  const messages = [], tools = new Map();
  let cur = null;
  const cap = opts.textOnly ? 6000 : 100000;
  for (const d of entries(file)) {
    if (d.type !== 'response_item') continue;
    const p = d.payload || {}, ts = Date.parse(d.timestamp) || 0;
    if (p.type === 'message' && p.role === 'user') {
      const text = stripPersona(textOf(p)); if (!realPrompt(text)) continue;
      cur = null; messages.push({ role: 'user', ts, blocks: [{ type: 'text', text: text.slice(0, cap) }] });
    } else if ((p.type === 'message' && p.role === 'assistant') || p.type === 'function_call' || p.type === 'custom_tool_call') {
      if (!cur) { cur = { role: 'assistant', ts, blocks: [] }; messages.push(cur); }
      if (p.type === 'message') { const text = textOf(p); if (text) cur.blocks.push({ type: 'text', text: text.slice(0, cap) }); }
      else if (!opts.textOnly) { const b = { type: 'tool', id: p.call_id, name: p.name, summary: brief(p), result: undefined }; tools.set(p.call_id, b); cur.blocks.push(b); }
      if (cur.blocks.length > 1000) cur.blocks.shift();
    } else if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') {
      const b = tools.get(p.call_id); if (b) { b.result = clip(typeof p.output === 'string' ? p.output : JSON.stringify(p.output), 700); tools.delete(p.call_id); }
    }
    while (messages.length > limit) { const old = messages.shift(); for (const b of old.blocks) if (b.type === 'tool') tools.delete(b.id); }
    if (tools.size > 1000) tools.delete(tools.keys().next().value);
  }
  return messages.filter(m => m.blocks.length);
}

export function codexDetail(id, limit = 20) {
  return codexTranscript(id, limit).flatMap(m => m.blocks.map(b => ({ ts: m.ts, role: m.role, kind: b.type === 'tool' ? 'tool' : 'text', text: clip(b.type === 'tool' ? b.summary : b.text, 400) }))).slice(-limit);
}
