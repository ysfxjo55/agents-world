import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Your agent roster = the markdown files in ~/.claude/agents. Drop a new file there and a new robot appears.
const DIR = path.join(os.homedir(), '.claude', 'agents');
export const AGENTS_DIR = DIR;

const LOOK = {
  'code-reviewer':   { emoji: '🔍', color: '#ef5350' },
  'architect':       { emoji: '📐', color: '#5c8df6' },
  'tester-debugger': { emoji: '🧪', color: '#f5a524' },
  'study-teacher':   { emoji: '📚', color: '#2fb5a6' },
  'planner':         { emoji: '🗓️', color: '#7bd36b' },
  'builder':         { emoji: '🔨', color: '#f08a4b' },
  'deep-researcher': { emoji: '🔭', color: '#4fd1e8' },
  'bella':           { emoji: '👑', color: '#ff6fae' },
};
const PALETTE = ['#e86bb0', '#6bd3e8', '#e8c46b', '#9b8cf5', '#6be8a4', '#f58f6b'];
const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

function parseDef(file) {
  let txt; try { txt = fs.readFileSync(path.join(DIR, file), 'utf8').replace(/\r\n?/g, '\n'); } catch { return null; }   // Windows line ends (CRLF) too
  const m = txt.match(/^---\n([\s\S]*?)\n---/); if (!m) return null;
  const get = (k) => (m[1].match(new RegExp(`^${k}:\\s*(.+)$`, 'm')) || [])[1]?.trim().replace(/^["']|["']$/g, '');
  const name = get('name'); if (!name || !/^[\w-]+$/.test(name)) return null;
  const look = LOOK[name] || { emoji: '🤖', color: PALETTE[hash(name) % PALETTE.length] };
  return { name, description: get('description') || '', ...look };
}

const metaCache = new Map(); // meta file -> { mtimeMs, type }
// Sub-agent runs: <project>/<session>/subagents/agent-*.meta.json has agentType; the sibling .jsonl mtime = last activity.
function subagentUse(projectsRoot) {
  const use = new Map();
  let projects; try { projects = fs.readdirSync(projectsRoot, { withFileTypes: true }); } catch { return use; }
  for (const p of projects) {
    if (!p.isDirectory()) continue;
    let sess; try { sess = fs.readdirSync(path.join(projectsRoot, p.name), { withFileTypes: true }); } catch { continue; }
    for (const s of sess) {
      if (!s.isDirectory()) continue;
      const dir = path.join(projectsRoot, p.name, s.name, 'subagents');
      let files; try { files = fs.readdirSync(dir); } catch { continue; }
      for (const f of files) {
        if (!f.endsWith('.meta.json')) continue;
        const mf = path.join(dir, f);
        try {
          const st = fs.statSync(mf); let c = metaCache.get(mf);
          if (!c || c.mtimeMs !== st.mtimeMs) { c = { mtimeMs: st.mtimeMs, type: JSON.parse(fs.readFileSync(mf, 'utf8')).agentType }; metaCache.set(mf, c); }
          if (!c.type) continue;
          let ts = st.mtimeMs; try { ts = Math.max(ts, fs.statSync(mf.replace('.meta.json', '.jsonl')).mtimeMs); } catch {}
          const u = use.get(c.type) || { last: 0, n: 0 }; u.n++; u.last = Math.max(u.last, ts); use.set(c.type, u);
        } catch {}
      }
    }
  }
  return use;
}

export function listAgents(sessions, projectsRoot, now = Date.now()) {
  let files; try { files = fs.readdirSync(DIR).filter(f => f.endsWith('.md')); } catch { files = []; }
  const defs = files.map(parseDef).filter(Boolean);
  const sub = subagentUse(projectsRoot);
  return defs.map(d => {
    // used as a whole session (claude --agent <name>) or as a sub-agent inside another session
    const own = sessions.filter(s => s.agent === d.name);
    const s = sub.get(d.name);
    const last = Math.max(0, s?.last ?? 0, ...own.map(x => x.lastActivity));
    const working = own.some(x => x.status === 'working') || (s && now - s.last < 60_000);
    const waiting = own.some(x => x.status === 'needs');
    return { ...d, status: working ? 'working' : waiting ? 'needs' : 'idle', lastUsed: last || null, uses: own.length + (s?.n ?? 0) };
  }).sort((a, b) => a.name.localeCompare(b.name));
}
