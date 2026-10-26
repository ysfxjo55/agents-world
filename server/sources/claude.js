import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { computeStatus, clip, bucketize } from '../status.js';

const ROOT = path.join(os.homedir(), '.claude', 'projects');
const HEAD = 256 * 1024, TAIL = 768 * 1024;
const cache = new Map(); // file -> { mtimeMs, size, parsed }

function readWindows(file, size) {
  const fd = fs.openSync(file, 'r');
  try {
    const rd = (pos, len) => { const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, pos); return b.toString('utf8'); };
    if (size <= HEAD + TAIL) return { head: rd(0, size).split('\n'), tail: [] };
    const head = rd(0, HEAD).split('\n'); head.pop();
    const tail = rd(size - TAIL, TAIL).split('\n'); tail.shift();
    return { head, tail };
  } finally { fs.closeSync(fd); }
}
const parseLines = (lines) => {
  const out = [];
  for (const l of lines) { if (!l) continue; try { out.push(JSON.parse(l)); } catch {} }
  return out;
};
const blocks = (c) => (typeof c === 'string' ? [{ type: 'text', text: c }] : Array.isArray(c) ? c : []);
const userText = (d) => blocks(d.message?.content).filter(b => b.type === 'text').map(b => b.text).join(' ').trim();
const isRealPrompt = (t) => t && !t.startsWith('<') && !t.startsWith('[Request interrupted') && !t.startsWith('Caveat:');
// pasted text arrives wrapped in <pasted_content> tags and hidden system notes in <system-reminder> blocks: show the text, drop the notes
// (the note Bella adds for attached images is replaced by a short marker)
const ATTACH_NOTE = /\n*\[The user attached \d+ images?:[^\]]*\]/g;
const uploadIds = (t) => [...t.matchAll(/uploads\/([0-9a-f-]{36}\.(?:png|jpg|gif|webp))/g)].map(x => x[1]);
const cleanPrompt = (t) => t.replace(ATTACH_NOTE, ' [image attached]').replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').replace(/<\/?pasted_content[^>]*>/g, '').trim();

export function toolBrief(b) {
  const i = b.input || {};
  const v = i.command ?? i.file_path ?? i.path ?? i.pattern ?? i.url ?? i.description ?? i.prompt ?? i.query ?? '';
  return `${b.name}${v ? ' · ' + clip(v, 160) : ''}`;
}

function parseSession(file, st) {
  const { head, tail } = readWindows(file, st.size);
  const entries = parseLines(head).concat(parseLines(tail));
  let cwd, branch, sessionId, title, custom, summary, firstPrompt, agent;
  let last = null;                  // last meaningful event
  const pending = new Map();        // tool_use id -> { ts, name }
  const stamps = [];
  let currentTool = null;
  for (const d of entries) {
    if (d.cwd) cwd ??= d.cwd; // first cwd = the project the session started in
    if (d.gitBranch && d.gitBranch !== 'HEAD') branch = d.gitBranch;
    if (d.sessionId) sessionId ??= d.sessionId;
    if (d.type === 'ai-title' && d.aiTitle) title = d.aiTitle;
    else if (d.type === 'custom-title' && d.customTitle) custom = d.customTitle;
    else if (d.type === 'summary' && d.summary) summary = d.summary;
    else if (d.type === 'agent-setting' && d.agentSetting) agent = d.agentSetting; // session started with `claude --agent <name>`
    if (d.type !== 'user' && d.type !== 'assistant') continue;
    if (d.isSidechain) continue;
    const ts = Date.parse(d.timestamp);
    if (!ts) continue;
    const bs = blocks(d.message?.content);
    if (d.type === 'user') {
      const results = bs.filter(b => b.type === 'tool_result');
      if (results.length) {
        for (const r of results) pending.delete(r.tool_use_id);
        last = { lastEvent: 'tool_result', lastTs: ts };
        stamps.push(ts);
      } else if (!d.isMeta) {
        const t = cleanPrompt(userText(d));
        if (isRealPrompt(t)) { firstPrompt ??= t; last = { lastEvent: 'user', lastTs: ts }; stamps.push(ts); }
        else if (t.startsWith('[Request interrupted')) last = { lastEvent: 'assistant_end', lastTs: ts };
      }
    } else {
      const uses = bs.filter(b => b.type === 'tool_use');
      if (uses.length) {
        for (const u of uses) pending.set(u.id, { ts, name: u.name });
        currentTool = toolBrief(uses[uses.length - 1]);
        last = { lastEvent: 'tool_call', lastTs: ts };
        stamps.push(ts);
      } else if (d.message?.stop_reason === 'end_turn' || d.message?.stop_reason === 'stop_sequence') {
        last = { lastEvent: 'assistant_end', lastTs: ts };
      } else if (bs.some(b => b.type === 'text')) {
        last = { lastEvent: 'assistant_text', lastTs: ts };
      }
    }
  }
  let pendingToolSince = null;
  for (const p of pending.values()) pendingToolSince = pendingToolSince ? Math.min(pendingToolSince, p.ts) : p.ts;
  return {
    cwd, branch, sessionId, currentTool, stamps, agent,
    title: clip(custom || title || summary || firstPrompt || '(untitled)', 90),
    signal: last ? { ...last, pendingToolSince } : null,
  };
}

function subagents(sessionFile, sessionId, now) {
  const dir = path.join(path.dirname(sessionFile), sessionId, 'subagents');
  let names; try { names = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const n of names) {
    if (!n.endsWith('.jsonl')) continue;
    try {
      const m = fs.statSync(path.join(dir, n)).mtimeMs;
      let label = 'helper';
      try { const meta = JSON.parse(fs.readFileSync(path.join(dir, n.replace('.jsonl', '.meta.json')), 'utf8')); label = meta.description || meta.agentType || label; } catch {}
      out.push({ id: n.slice(0, -6), label: clip(label, 60), active: now - m < 60_000, ts: m });
    } catch {}
  }
  return out.filter(h => now - h.ts < 10 * 60_000).sort((a, b) => b.ts - a.ts);
}

export function listClaude(now = Date.now()) {
  const sessions = [];
  let dirs; try { dirs = fs.readdirSync(ROOT, { withFileTypes: true }); } catch { return sessions; }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const dir = path.join(ROOT, d.name);
    let files; try { files = fs.readdirSync(dir); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const file = path.join(dir, f);
      let st; try { st = fs.statSync(file); } catch { continue; }
      let c = cache.get(file);
      if (!c || c.mtimeMs !== st.mtimeMs || c.size !== st.size) {
        try { c = { mtimeMs: st.mtimeMs, size: st.size, parsed: parseSession(file, st) }; cache.set(file, c); } catch { continue; }
      }
      const p = c.parsed;
      const id = f.slice(0, -6);
      if (!p.cwd || !p.signal) continue; // metadata-only files
      const helpers = now - st.mtimeMs < 30 * 60_000 ? subagents(file, id, now) : [];
      const busyChild = helpers.some(h => h.active) && !!p.signal.pendingToolSince;
      const signal = { ...p.signal, busyChild };
      sessions.push({
        key: `claude:${id}`, id, tool: 'claude', agent: p.agent || null, title: p.title, cwd: p.cwd, branch: p.branch || null,
        status: computeStatus(signal, now), lastActivity: Math.max(p.signal.lastTs, helpers[0]?.ts ?? 0),
        size: st.size, currentTool: p.signal.pendingToolSince || signal.lastEvent === 'tool_call' ? p.currentTool : null,
        activity: bucketize(p.stamps, now), helpers: helpers.slice(0, 6),
      });
    }
  }
  return sessions;
}

export function claudeFile(id) {
  if (!/^[\w-]+$/.test(id)) return null;
  let dirs; try { dirs = fs.readdirSync(ROOT); } catch { return null; }
  for (const d of dirs) { const f = path.join(ROOT, d, id + '.jsonl'); if (fs.existsSync(f)) return f; }
  return null;
}

export function claudeDetail(id, limit = 20) {
  const file = claudeFile(id); if (!file) return [];
  const st = fs.statSync(file);
  const { head, tail } = readWindows(file, st.size);
  const entries = parseLines(tail.length ? tail : head);
  const items = [];
  for (const d of entries) {
    if ((d.type !== 'user' && d.type !== 'assistant') || d.isSidechain) continue;
    const ts = Date.parse(d.timestamp);
    for (const b of blocks(d.message?.content)) {
      if (b.type === 'text' && b.text.trim()) {
        if (d.type === 'user' && !isRealPrompt(b.text.trim())) continue;
        items.push({ ts, role: d.type, kind: 'text', text: clip(b.text, 400) });
      } else if (b.type === 'tool_use') items.push({ ts, role: 'assistant', kind: 'tool', text: toolBrief(b) });
      else if (b.type === 'tool_result') {
        const t = typeof b.content === 'string' ? b.content : blocks(b.content).map(x => x.text || '').join(' ');
        items.push({ ts, role: 'user', kind: 'result', text: clip(t, 200) || '(no output)' });
      }
    }
  }
  return items.slice(-limit);
}

export const CLAUDE_ROOT = ROOT;

/** Full conversation for the chat view: user prompts and assistant turns (text + tool calls with results). */
function feedTranscript(st, d, opts) {
  if ((d.type !== 'user' && d.type !== 'assistant') || d.isSidechain) return;
  const ts = Date.parse(d.timestamp), bs = blocks(d.message?.content), cap = opts.textOnly ? 6000 : 100000;
  if (d.type === 'assistant') {
    if (!st.cur) { st.cur = { role: 'assistant', ts, blocks: [] }; st.msgs.push(st.cur); }
    for (const b of bs) {
      if (b.type === 'text' && b.text?.trim()) st.cur.blocks.push({ type: 'text', text: b.text.length > cap ? b.text.slice(0, cap) + '…' : b.text });
      else if (b.type === 'tool_use' && !opts.textOnly) { const t = { type: 'tool', id: b.id, name: b.name, summary: toolBrief(b) }; st.tools.set(b.id, t); st.cur.blocks.push(t); }
    }
  } else {
    const results = bs.filter(b => b.type === 'tool_result');
    if (results.length) {
      for (const r of results) {
        const t = st.tools.get(r.tool_use_id); if (!t) continue;
        t.result = clip(typeof r.content === 'string' ? r.content : blocks(r.content).map(x => x.text || '').join(' '), 700); t.error = !!r.is_error;
      }
    } else if (!d.isMeta) {
      const raw = userText(d), text = cleanPrompt(raw), imgs = bs.filter(b => b.type === 'image').length, ids = uploadIds(raw);
      if (isRealPrompt(text) || imgs) { st.msgs.push({ role: 'user', ts, blocks: [{ type: 'text', text: (imgs ? `[${imgs} image${imgs > 1 ? 's' : ''}] ` : '') + (text.length > cap ? text.slice(0, cap) + '…' : text) }], ...(ids.length ? { images: ids.map(i => '/api/upload/' + i) } : {}) }); st.cur = null; }
    }
  }
}
const finishTranscript = (st, limit) => st.msgs.filter(m => m.blocks.length).slice(-limit);

export function claudeTranscript(id, limit = 150, opts = {}) {
  if (opts.full) return claudeTranscriptFull(id, limit, opts);                 // a promise: the whole file, read as a stream
  const file = claudeFile(id); if (!file) return [];
  const st = { msgs: [], tools: new Map(), cur: null };
  const { head, tail } = readWindows(file, fs.statSync(file).size);   // the real size: only the last TAIL bytes are read, so the newest messages always show
  for (const d of parseLines(tail.length ? tail : head)) feedTranscript(st, d, opts);
  return finishTranscript(st, limit);
}

// The whole conversation, line by line, so a huge session (tens of MB) never sits in memory at once.
async function claudeTranscriptFull(id, limit, opts) {
  const file = claudeFile(id); if (!file) return [];
  const st = { msgs: [], tools: new Map(), cur: null };
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line || line.length > 8_000_000) continue;                            // skip giant lines (pasted images)
    if (!line.includes('"type":"user"') && !line.includes('"type":"assistant"')) continue;
    let d; try { d = JSON.parse(line); } catch { continue; }
    feedTranscript(st, d, opts);
  }
  return finishTranscript(st, limit);
}
