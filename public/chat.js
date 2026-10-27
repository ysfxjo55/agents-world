import { icon, badge } from './icons.js';
import { watchConnection } from './conn-hint.js';
const $ = (id) => document.getElementById(id);
const ls = { get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TOOLS = { claude: 'Claude Code', opencode: 'OpenCode', codex: 'Codex', antigravity: 'Antigravity' };
const SHORT = { claude: 'CC', codex: 'Codex', opencode: 'OC', antigravity: 'AGY' };   // the small label on a row
const MODES = { readonly: 'Read-only', edits: 'Can edit files', build: 'Can build and test', full: 'Full access ⚠' };
const MODE_HELP = { readonly: 'Can look at files and search the web. It never changes your project files. Bella can still save to her own memory and the family folder.', edits: 'Can also create and edit files', build: 'Can also run git, npm and node to build and test (needed for the builder agent). Powerful: node can run any script.', full: 'Can run any command and change anything, without asking' };
const isMobile = () => matchMedia('(max-width:760px)').matches;
const guide = (detail) => dispatchEvent(new CustomEvent('aw-guide', { detail }));   // tells the first-steps guide (guide.js) what happened
const P = new URLSearchParams(location.search);
if (P.has('embed')) document.body.classList.add('embed');

const S = {
  snap: null, key: null, msgs: [], runs: new Map(), q: '', showOld: ls.get('aw.showOld', '0') === '1',
  attach: [], remote: false, bella: false, bellaMain: null, histEl: null, histCount: 0,
  mode: ls.get('aw.mode', 'readonly'), tool: ls.get('aw.newtool', 'claude'), dir: '', agent: '', loadSeq: 0, lastAct: 0,
  eng: { bella: 'claude', interstellar: 'codex' },
  failed: new Map(),   // session key -> messages that failed to send (shown under the saved conversation)   // which program each manager runs on (from the server: with one engine, both use it)
};
const engOf = (agent) => (agent === 'bella' || agent === 'interstellar' ? S.eng[agent] : 'claude');
if (!MODES[S.mode] || S.mode === 'full' || S.mode === 'build') S.mode = 'readonly';   // powerful modes are never remembered: pick them again each visit

import { md } from './md.js';

/* ---------- helpers ---------- */
const find = (key) => S.snap?.sessions.find(s => s.key === key);
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
function ago(ms) { const s = (Date.now() - ms) / 1000; if (s < 45) return 'just now'; const m = Math.round(s / 60); if (m < 60) return m + ' min ago'; const h = Math.round(m / 60); return h < 48 ? h + ' h ago' : Math.round(h / 24) + ' d ago'; }
function group(ms) {
  const d0 = new Date(); d0.setHours(0, 0, 0, 0); const day = 86400000, t = d0.getTime();
  if (ms >= t) return 'Today'; if (ms >= t - day) return 'Yesterday'; if (ms >= t - 7 * day) return 'Previous 7 days'; if (ms >= t - 14 * day) return 'Previous 14 days'; return 'Older';
}
function closeSide() { document.body.classList.remove('open'); }

/* ---------- sidebar ---------- */
S.view = 'chats'; S.sel = null; S.trash = [];
function visibleSessions() {
  if (!S.snap) return [];
  const now = Date.now(), q = S.q.toLowerCase();
  const since = S.snap.showSince || 0;   // "start with an empty world": older sessions wait behind "Show older & archived"
  return S.snap.sessions.filter(s => !s.familyChat && (S.showOld || (!s.archived && now - s.lastActivity < 14 * 86400000 && s.lastActivity >= since)) &&
    (!q || s.title.toLowerCase().includes(q) || (s.projectName || '').toLowerCase().includes(q)));
}
async function loadTrash() { S.trash = (await fetch('/api/trash').then(r => r.json()).catch(() => ({ items: [] }))).items; $('trashN').textContent = S.trash.length ? S.trash.length : ''; if (S.view === 'trash') renderSide(); }
function closeMenu() { document.querySelectorAll('.menu').forEach(m => m.remove()); }
function openMenu(btn, s) {
  closeMenu(); const m = el('div', 'menu'), r = btn.getBoundingClientRect();
  const item = (label, fn, cls) => { const b = el('button', cls || '', label); b.onclick = (e) => { e.stopPropagation(); closeMenu(); fn(); }; m.append(b); };
  item(s.archived ? 'Restore (unhide)' : 'Archive (hide)', () => post('/api/archive', { key: s.key, archived: !s.archived }));
  item('Select…', () => { S.sel = new Set([s.key]); renderSide(); });
  item('Delete…', () => deleteKeys([s.key]), 'danger');
  document.body.append(m); m.style.top = Math.min(r.bottom + 4, innerHeight - 140) + 'px'; m.style.left = Math.max(8, Math.min(r.left - 120, innerWidth - 190)) + 'px';
}
addEventListener('click', closeMenu);
async function deleteKeys(keys) {
  const titles = keys.map(k => find(k)?.title).filter(Boolean);
  const list = titles.slice(0, 6).map(t => '• ' + (t.length > 55 ? t.slice(0, 55) + '…' : t)).join('\n') + (titles.length > 6 ? `\n• …and ${titles.length - 6} more` : '');
  if (!confirm(`Move ${keys.length} chat${keys.length > 1 ? 's' : ''} to Trash?\n\n${list}\n\nYou can restore them from Trash. If one is still open in a Terminal window, close that window first.`)) return;
  const r = await post('/api/delete', { keys }).catch(() => null);
  S.sel = null;
  if (!r) { alert('Could not reach the server.'); return; }
  const bad = r.results.filter(x => !x.ok);
  if (bad.length) alert(bad.map(x => `${find(x.key)?.title || x.key}: ${x.error}`).join('\n'));
  if (keys.includes(S.key) && r.results.find(x => x.key === S.key)?.ok) newChat();
  loadTrash(); renderSide();
}
function renderSide() {
  const box = $('hist'), keep = box.scrollTop; box.replaceChildren();
  $('newBtn').parentElement.classList.toggle('sel-mode', !!S.sel);
  $('trashBtn').classList.toggle('on', S.view === 'trash');
  if (S.view === 'trash') {
    const bar = el('div', 'tbar'); bar.append(el('span', '', `${S.trash.length} in Trash`));
    if (S.trash.length) { const e = el('button', 'danger', 'Empty Trash'); e.onclick = async () => { if (confirm(`Permanently delete ${S.trash.length} chat${S.trash.length > 1 ? 's' : ''}? This cannot be undone.`)) { await post('/api/trash/empty', { confirm: true }); loadTrash(); } }; bar.append(e); }
    box.append(bar);
    for (const t of S.trash) {
      const r = el('div', 'row'); r.append(el('span', 't', t.title), el('span', 'tb', SHORT[t.tool] || t.tool));
      const b = el('button', 'mini', 'Restore'); b.onclick = async () => { const x = await post('/api/trash/restore', { id: t.id }); if (!x.ok) alert('Could not restore: ' + x.error); loadTrash(); }; r.append(b);
      r.title = `${t.cwd}\nDeleted ${ago(t.deletedAt)}`; box.append(r);
    }
    if (!S.trash.length) { const p = el('p', '', 'Trash is empty. Deleted chats wait here until you empty it.'); p.style.cssText = 'padding:12px;color:var(--faint)'; box.append(p); }
  } else {
    const groups = new Map();
    for (const s of visibleSessions()) { const g = group(s.lastActivity); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(s); }
    for (const [g, list] of groups) {
      const d = el('div', 'grp'); d.append(el('h4', '', g));
      for (const s of list) {
        const r = el('div', 'row' + (s.key === S.key ? ' sel' : '') + (s.archived ? ' arch' : '')); r.title = `${s.projectName} · ${TOOLS[s.tool]}`;
        const busy = S.runs.has(s.key) ? 'working' : s.status;
        if (S.sel) { const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = S.sel.has(s.key); cb.onclick = (e) => e.stopPropagation(); cb.onchange = () => { cb.checked ? S.sel.add(s.key) : S.sel.delete(s.key); renderSelBar(); }; r.append(cb); }
        r.append(el('span', 't', s.title), el('i', `dot ${busy}`), ...(s.tool !== 'claude' ? [el('span', 'tb', SHORT[s.tool] || s.tool)] : []));
        if (!S.sel) { const mb = el('button', 'more', '⋯'); mb.title = 'More'; mb.onclick = (e) => { e.stopPropagation(); openMenu(mb, s); }; r.append(mb); }
        r.onclick = () => { if (!S.sel && s.key === S.bellaMain) { openBella(); closeSide(); return; } if (S.sel) { const cb = r.querySelector('input'); cb.checked = !cb.checked; cb.onchange(); return; } openSession(s.key); closeSide(); };
        d.append(r);
      }
      box.append(d);
    }
    if (!groups.size) { const p = el('p', '', S.q ? 'No matches.' : 'No sessions yet.'); p.style.cssText = 'padding:12px;color:var(--faint)'; box.append(p); }
  }
  box.scrollTop = keep; renderSelBar();
  const ag = $('agentsList'); ag.replaceChildren();
  for (const a of S.snap?.agents || []) {
    const b = el('button', ''); b.innerHTML = badge(a.name, a.color, 20) + `<span>${esc(a.name)}</span>`; b.title = a.description;
    b.onclick = () => { newChat(a.name); closeSide(); }; ag.append(b);
  }
}
function renderSelBar() {
  const bar = $('selBar'); bar.hidden = !S.sel; if (!S.sel) return; bar.replaceChildren();
  const n = S.sel.size; bar.append(el('span', '', `${n} selected`));
  const mk = (t, fn, cls) => { const b = el('button', cls || '', t); b.disabled = !n && t !== 'Cancel'; b.onclick = fn; bar.append(b); };
  mk('Archive', async () => { for (const k of S.sel) await post('/api/archive', { key: k, archived: true }); S.sel = null; renderSide(); });
  mk('Delete', () => deleteKeys([...S.sel]), 'danger');
  mk('Cancel', () => { S.sel = null; renderSide(); });
}
function setView(v) { S.view = v; S.sel = null; if (v === 'trash') loadTrash(); renderSide(); }

/* ---------- header / controls ---------- */
function renderTop() {
  const s = S.key && find(S.key);
  $('title').textContent = S.bella ? 'Bella' : s ? s.title : 'New chat';
  $('sub').textContent = S.bella ? 'your assistant · remembers you' : s ? `${s.projectName} · ${TOOLS[s.tool]}` : '';
  $('termBtn').hidden = !s || S.bella;
  const tool = s ? s.tool : S.tool;
  $('toolLbl').textContent = TOOLS[tool];
  $('input').placeholder = S.bella ? 'Message Bella…' : s ? `Reply to ${TOOLS[tool]}…` : 'What should we work on?';
  const warn = $('warn'); warn.replaceChildren(); warn.hidden = true;
  if (S.remote) {
    warn.hidden = false; const n = el('div', 'notice', 'You are on the Tailscale address, so chat is read-only here (I can answer and read, but not save notes, change files or run commands). On the computer, open ');
    const a = el('a', '', 'localhost:4321'); a.href = `http://localhost:4321${location.pathname}${location.search}${location.hash}`; a.target = '_top'; a.style.color = 'inherit'; a.style.fontWeight = '700'; n.append(a, ' to unlock the other modes.'); warn.append(n);
  }
  if (S.bella && S.mode === 'build' && !S.remote) { warn.hidden = false; warn.append(el('div', 'notice', 'Bella herself can edit files in this mode, but not run commands. "Can build and test" only lets the agents she starts run builds and tests.')); }
  if (s?.inTerminal) { warn.hidden = false; warn.append(el('div', 'notice', 'This conversation is also open in a Terminal window. You can write here, but that Terminal will not see these messages. To keep one clear conversation, continue in one place.')); }
  if (tool === 'antigravity') { warn.hidden = false; warn.append(el('div', 'notice', 'Antigravity uses its own modes: Read-only = plan mode in its sandbox, Can edit files = accept edits in its sandbox, Can build and test = accept edits, Full access = everything without asking.')); }
  if (tool === 'opencode') { warn.hidden = false; const n = el('div', 'notice', 'OpenCode uses its own permission settings, not the access mode on the right.'); warn.append(n); }
  else if (s && s.status === 'working' && !S.runs.has(s.key)) { warn.hidden = false; warn.append(el('div', 'notice', 'This session is busy in another window right now. Messages can interleave.')); }
}
function fillSelects() {
  const m = $('mode'); m.replaceChildren(); for (const [k, v] of Object.entries(MODES)) { const locked = S.remote && k !== 'readonly'; const o = new Option(locked ? `${v} (open localhost:4321)` : v, k); o.title = locked ? 'Locked on the Tailscale address. On the computer, open http://localhost:4321' : MODE_HELP[k]; o.disabled = locked; m.append(o); } if (S.remote) S.mode = 'readonly'; m.value = S.mode; m.className = S.mode === 'full' || S.mode === 'build' ? 'full' : '';
  const a = $('agentSel'); a.replaceChildren(new Option('No agent', '')); if (S.snap?.interstellar) a.append(new Option('Interstellar', 'interstellar')); if (S.snap?.bella) a.append(new Option('Bella (manager)', 'bella')); for (const x of S.snap?.agents || []) a.append(new Option(x.name, x.name)); a.value = S.agent;
}
$('mode').onchange = (e) => {
  const codex = (find(S.key)?.tool || S.tool) === 'codex';
  if (e.target.value === 'build' && !confirm(codex ? 'Codex can run commands and edit files in its workspace sandbox. Continue?' : '"Can build and test" lets the AI run git, npm and node commands on your computer, so it can build and test code.\n\nIt cannot delete files with rm or use sudo, but node can run any script, so treat it as powerful. Use it for builds you asked for. Continue?')) { e.target.value = S.mode; return; }
  if (e.target.value === 'full' && !confirm('Full access lets the AI run any command and change any file on your computer without asking.\n\nOnly use it for work you trust. Continue?')) { e.target.value = S.mode; return; }
  S.mode = e.target.value; ls.set('aw.mode', S.mode); e.target.className = S.mode === 'full' || S.mode === 'build' ? 'full' : '';
};
$('agentSel').onchange = (e) => { const agent = e.target.value; if (S.key && agent && (agent === 'interstellar' || find(S.key)?.tool !== engOf(agent))) { newChat(agent); return; } S.agent = agent; if (agent && !S.key) { S.tool = engOf(agent); ls.set('aw.newtool', S.tool); } renderThread(); renderTop(); };

/* ---------- thread ---------- */
function toolEl(b) {
  const d = el('details', 'tool' + (b.error ? ' err' : '')), sm = el('summary');
  if (b.result == null) sm.append(el('i', 'spin'));
  sm.append(el('span', 'nm', b.summary || b.name)); d.append(sm);
  if (b.result) d.append(el('pre', '', b.result));
  return d;
}
function paintAssistant(root, m) {
  root.replaceChildren();
  for (const b of m.blocks) {
    if (b.type === 'text') { const p = el('div', 'prose'); p.innerHTML = md(b.text); linkFiles(p); root.append(p); }
    else if (b.type === 'tool') root.append(toolEl(b));
    else if (b.type === 'error') root.append(el('div', 'errbox', b.text));
    else if (b.type === 'notice') root.append(el('div', 'notice', b.text));
  }
  if (m.live) {
    const st = el('div', 'status'); const dots = el('span', 'dots'); dots.innerHTML = '<i></i><i></i><i></i>';
    const lab = el('span', '', `${m.status || 'Working…'}`); const t = el('span', ''); t.id = 'elapsed'; st.append(dots, lab, t); root.append(st);
  } else if (m.blocks.some(b => b.type === 'text')) {
    const a = el('div', 'acts'), c = el('button', '', 'Copy'); c.dataset.copyMsg = '1'; a.append(c); root.append(a);
  }
}
function msgEl(m) {
  const w = el('div', `msg ${m.role}`);
  if (m.role === 'user') { const b = el('div', 'bubble'); b.dir = 'auto'; if (m.images?.length) { const th = el('div', 'thumbs'); for (const u of m.images) { const im = document.createElement('img'); im.src = u; im.onerror = () => im.remove(); th.append(im); } b.append(th); } b.append(document.createTextNode(m.blocks.map(x => x.text).join('\n'))); w.append(b); }
  else paintAssistant(w, m);
  w._m = m; return w;
}
function nearBottom() { const s = $('scroll'); return s.scrollHeight - s.scrollTop - s.clientHeight < 140; }
function toBottom(smooth) { const s = $('scroll'); s.style.scrollBehavior = smooth ? 'smooth' : 'auto'; s.scrollTop = s.scrollHeight; }
function renderThread() {
  const th = $('thread'); th.replaceChildren();
  if (S.bella && S.histEl) { th.append(S.histEl); const d = el('div', 'bdivider'); d.append(el('span', '', 'Bella continues here')); th.append(d); }
  if (S.bella && !S.msgs.length) {
    const h = el('div', 'bintro'); h.innerHTML = badge('crown', '#ff6fae', 40);
    h.append(el('h2', '', 'Hi, I\'m Bella.'), el('p', '', 'I remember our Terminal conversation above and everything in my memory. Ask me anything, or tell me something new and I\'ll save it.'));
    const sg = el('div', 'suggest'); for (const t of ['What should I do today?', 'What do you still need to know about me?', 'Where did we stop?']) { const b = el('button', '', t); b.onclick = () => { $('input').value = t; $('input').focus(); autosize(); }; sg.append(b); }
    h.append(sg); th.append(h); return;
  }
  if (!S.key && !S.msgs.length) {
    const h = el('div', ''); h.id = 'hero';
    h.append(el('h1', '', 'What are we working on?'), el('p', '', 'Start a new session with Claude Code, OpenCode or Codex, or pick an old one on the left.'));
    const ctl = el('div', 'ctl'), seg = el('div', 'chipsel');
    for (const [k, v] of Object.entries(TOOLS)) { const b = el('button', S.tool === k ? 'on' : '', v); b.onclick = () => { S.tool = k; ls.set('aw.newtool', k); if (S.agent && k !== engOf(S.agent)) { S.agent = ''; $('agentSel').value = ''; } renderThread(); renderTop(); }; seg.append(b); }
    const dir = document.createElement('select'); dir.title = 'Project folder'; dir.append(new Option('~ Home', ''));
    for (const p of S.snap?.projects || []) dir.append(new Option(p.name, p.path));
    dir.disabled = S.agent === 'interstellar'; if (dir.disabled) { dir.replaceChildren(new Option('Interstellar folder', '')); dir.title = 'Interstellar uses its own folder'; }
    dir.value = S.agent === 'interstellar' ? '' : S.dir; dir.onchange = () => { S.dir = dir.value; };
    ctl.append(seg, dir); h.append(ctl);
    const sg = el('div', 'suggest');
    for (const t of ['Review this project for bugs', 'Explain this codebase to me', 'What should I do today?', 'Help me study for my midterm']) { const b = el('button', '', t); b.onclick = () => { $('input').value = t; $('input').focus(); autosize(); }; sg.append(b); }
    h.append(sg); th.append(h); return;
  }
  for (const m of S.msgs) th.append(msgEl(m));
}
let raf = 0;
function paintLive(run) {
  if (raf) return; raf = requestAnimationFrame(() => {
    raf = 0; const nb = nearBottom(), nodes = $('thread').children, node = nodes[nodes.length - 1];
    if (node && node._m === run.live) { paintAssistant(node, run.live); if (nb) toBottom(false); }
  });
}
setInterval(() => { const e = $('elapsed'); if (!e) return; const run = [...S.runs.values()].find(r => r.key === S.key || r.draft); if (run) e.textContent = ` ${Math.round((Date.now() - run.t0) / 1000)}s`; }, 1000);

/* ---------- data ---------- */
async function loadTranscript(key, keepScroll) {
  const seq = ++S.loadSeq;
  const r = await fetch('/api/chat/transcript/' + encodeURIComponent(key)).then(r => r.json()).catch(() => null);
  if (!r || seq !== S.loadSeq || S.key !== key || S.runs.has(key)) return;
  S.msgs = (r.messages || []).concat(S.failed.get(key) || []); renderThread(); if (!keepScroll) toBottom(false);   // a failed send was never saved: keep it and its error on screen
}
function openSession(key, opts = {}) {
  S.bella = !!opts.bella || (!!key && key === S.bellaMain);
  S.agent = S.bella ? 'bella' : find(key)?.tool === 'claude' ? (find(key)?.agent || '') : ''; $('agentSel').value = S.agent;
  S.key = key; S.msgs = []; history.replaceState(null, '', key ? '#' + key : location.pathname); S.lastAct = find(key)?.lastActivity || 0;
  renderSide(); renderTop(); renderThread();
  const run = S.runs.get(key); if (run) { S.msgs = run.msgs; renderThread(); toBottom(false); } else if (key) loadTranscript(key);
}
function newChat(agent) {
  S.bella = false;
  if (agent) { S.tool = engOf(agent); ls.set('aw.newtool', S.tool); }
  S.key = null; S.msgs = []; S.agent = agent || ''; $('agentSel').value = S.agent; history.replaceState(null, '', location.pathname);
  renderSide(); renderTop(); renderThread(); $('input').focus();
}

/* ---------- sending ---------- */
function setBusy() { const run = S.key ? S.runs.get(S.key) : [...S.runs.values()].find(r => r.draft); const b = $('send'); b.classList.toggle('stop', !!run); b.disabled = false;
  b.innerHTML = run ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>' : '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>'; }
async function send() {
  const input = $('input'); let text = input.value.trim();
  const active = S.key ? S.runs.get(S.key) : [...S.runs.values()].find(r => r.draft);
  if (active) { active.ctrl.abort(); post('/api/chat/stop', { runId: active.runId }); return; }       // button doubles as Stop
  if (!text && !S.attach.length) return;
  if (!text) text = 'Please look at the attached file.';
  let ids = [];
  if (S.attach.length) {
    try { ids = await Promise.all(S.attach.map(a => fetch('/api/upload', { method: 'POST', body: a.file }).then(r => r.json()).then(j => { if (!j.id) throw new Error(j.error || 'upload failed'); return j.id; }))); }
    catch (e) { alert('Could not upload the file: ' + e.message); return; }
  }
  const shown = S.attach.map(a => a.url).filter(Boolean), names = S.attach.filter(a => !a.url).map(a => a.file.name); S.attach = []; renderAttach();
  const key = S.key, body = { text, mode: S.mode };
  if (ids.length) body.images = ids;
  if (key) body.key = key; else { body.tool = S.tool; if (S.dir) body.cwd = S.dir; }
  if (S.agent && !(key && find(key)?.tool === 'opencode')) body.agent = S.agent;
  guide({ type: 'sent', mode: S.mode });
  const live = { role: 'assistant', blocks: [], live: true, status: 'Starting…' };
  const run = { key, mode: S.mode, draft: !key, ctrl: new AbortController(), runId: null, live, t0: Date.now(), msgs: S.msgs };
  S.msgs.push({ role: 'user', blocks: [{ type: 'text', text: names.length ? text + '\n\n[attached: ' + names.join(', ') + ']' : text }], images: shown }, live);
  if (key) S.runs.set(key, run); else S.runs.set('__draft__', run);
  input.value = ''; autosize(); renderThread(); toBottom(true); setBusy(); renderSide();
  try {
    const r = await fetch('/api/chat/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: run.ctrl.signal });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Error ${r.status}`);
    const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '';
    for (;;) {
      const { done, value } = await rd.read(); if (done) break;
      buf += dec.decode(value, { stream: true }); let i;
      while ((i = buf.indexOf('\n\n')) >= 0) { const chunk = buf.slice(0, i); buf = buf.slice(i + 2); if (chunk.startsWith('data: ')) onEvent(run, JSON.parse(chunk.slice(6))); }
    }
  } catch (e) { if (e.name !== 'AbortError') live.blocks.push({ type: 'error', text: e.message }); else live.blocks.push({ type: 'notice', text: 'Stopped.' }); }
  finish(run);
}
function onEvent(run, ev) {
  const live = run.live;
  if (ev.runId) run.runId = ev.runId;
  if (ev.t === 'start') {
    if (run.draft) { if (S.runs.get('__draft__') === run) S.runs.delete('__draft__'); run.key = ev.key; run.draft = false; S.runs.set(ev.key, run); if (!S.key) { S.key = ev.key; history.replaceState(null, '', '#' + ev.key); } renderTop(); }
    guide({ type: 'started', key: ev.key });
  } else if (ev.t === 'status') live.status = ev.text;
  else if (ev.t === 'delta') {
    live.status = 'Writing…';
    let b = live.blocks[live.blocks.length - 1];
    if (!b || b.type !== 'text' || b.owner !== ev.id) { b = { type: 'text', text: '', owner: ev.id }; live.blocks.push(b); }
    b.text += ev.text;
  } else if (ev.t === 'blocks') {
    live.blocks = live.blocks.filter(b => b.owner !== ev.id).concat(ev.blocks.map(b => ({ ...b, owner: ev.id })));
  } else if (ev.t === 'result') {
    const b = live.blocks.find(x => x.type === 'tool' && x.id === ev.id); if (b) { b.result = ev.text || '(no output)'; b.error = ev.error; }
  } else if (ev.t === 'done') {
    if (ev.denied?.length) live.blocks.push({ type: 'notice', text: `${[...new Set(ev.denied)].join(', ')} ${ev.denied.length > 1 ? 'were' : 'was'} blocked in "${MODES[run.mode]}" mode. Change the access mode (top right) and ask again if you want it to go ahead.` });
    if (ev.error && ev.error !== 'Stopped') live.blocks.push({ type: 'error', text: ev.error });
  } else if (ev.t === 'error') live.blocks.push({ type: 'error', text: ev.text });
  paintLive(run);
}
function finish(run) {
  run.live.live = false;
  for (const b of run.live.blocks) if (b.type === 'tool' && b.result == null) b.result = '';
  S.runs.delete(run.key); if (S.runs.get('__draft__') === run) S.runs.delete('__draft__');
  if (run.key && run.live.blocks.some(b => b.type === 'error')) {     // keep the message you wrote and the red error, with a hint
    const i = run.msgs.indexOf(run.live), mine = i > 0 ? run.msgs[i - 1] : null;
    run.live.blocks.push({ type: 'notice', text: 'This message was not saved in the conversation. The red text above says why. If this chat is also open in a Terminal, continue it there, or start a new chat.' });
    S.failed.set(run.key, [...(S.failed.get(run.key) || []), ...(mine ? [mine] : []), run.live]);
  } else if (run.key) S.failed.delete(run.key);
  paintLive(run); setBusy(); renderSide(); guide({ type: 'run-done', key: run.key });
  if (S.key === run.key) setTimeout(() => loadTranscript(run.key, true), 700);       // swap in the saved version of the conversation
}

/* ---------- events ---------- */
function autosize() { const t = $('input'); t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 220) + 'px'; }
$('input').addEventListener('input', autosize);
$('input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !isMobile()) { e.preventDefault(); send(); } });
$('send').onclick = send;
$('newBtn').onclick = () => { setView('chats'); newChat(); closeSide(); };
$('trashBtn').onclick = () => setView(S.view === 'trash' ? 'chats' : 'trash');
$('selectBtn').onclick = () => { setView('chats'); S.sel = S.sel ? null : new Set(); renderSide(); };
$('agentsBtn').onclick = () => { const l = $('agentsList'); l.hidden = !l.hidden; $('agentsChev').classList.toggle('open', !l.hidden); };
$('q').oninput = (e) => { S.q = e.target.value; renderSide(); };
$('showOld').checked = S.showOld;
$('showOld').onchange = (e) => { S.showOld = e.target.checked; ls.set('aw.showOld', S.showOld ? '1' : '0'); renderSide(); };
$('sideClose').onclick = () => { if (isMobile()) closeSide(); else $('side').classList.add('hidden'); };
$('menuBtn').onclick = () => { if (isMobile()) document.body.classList.add('open'); else $('side').classList.remove('hidden'); };
$('scrim').onclick = closeSide;
$('termBtn').onclick = async () => { const r = await post('/api/open', { key: S.key }); if (!r.ok) alert('Could not open Terminal: ' + (r.error || 'error')); };
$('thread').addEventListener('click', async (e) => {
  const c = e.target.closest('[data-copy]'); if (c) { await navigator.clipboard.writeText(c.nextElementSibling.textContent).catch(() => {}); c.textContent = 'Copied'; setTimeout(() => (c.textContent = 'Copy'), 1200); return; }
  const m = e.target.closest('[data-copy-msg]'); if (m) { const msg = m.closest('.msg')._m; await navigator.clipboard.writeText(msg.blocks.filter(b => b.type === 'text').map(b => b.text).join('\n\n')).catch(() => {}); m.textContent = 'Copied'; setTimeout(() => (m.textContent = 'Copy'), 1200); }
});
addEventListener('hashchange', () => { const k = decodeURIComponent(location.hash.slice(1)); if (k && k !== S.key && find(k)) openSession(k); });

/* ---------- live snapshot ---------- */
function apply(snap) {
  const names = new Map(snap.projects.map(p => [p.path, p.name]));
  for (const s of snap.sessions) s.projectName = names.get(s.projectPath);
  const first = !S.snap; S.snap = snap;
  $('bellaBtn').hidden = !snap.bella; document.querySelector('.seg a[href="/family.html"]').hidden = !(snap.bella && snap.interstellar);   // Claude only: Bella; Codex only: Interstellar; the family chat needs both
  if (first) { fillSelects(); const k = decodeURIComponent(location.hash.slice(1)), ag = P.get('agent'); if (ag === 'bella' && snap.bella) { openBella(); } else if (ag && snap.agents?.some(a => a.name === ag)) { newChat(ag); } else if (k && find(k)) openSession(k); else renderThread(); }
  renderSide(); renderTop(); guide({ type: 'status', sessions: snap.sessions });
  const s = S.key && find(S.key);       // a terminal elsewhere moved this session on: show it live
  if (s && !S.runs.has(S.key) && s.lastActivity !== S.lastAct) { S.lastAct = s.lastActivity; loadTranscript(S.key, true); }
}
const es = new EventSource('/events');
const conn = watchConnection({ show: (t) => { $('live').lastChild.textContent = 'not connected'; $('live').title = t; if (!S.snap) alert(t); }, hide: () => { $('live').title = ''; } });   // never "connecting" forever without a reason
es.addEventListener('snapshot', (e) => { conn.ok(); $('live').className = 'on'; $('live').lastChild.textContent = 'live'; apply(JSON.parse(e.data)); });
es.onerror = () => { conn.error(); $('live').className = ''; $('live').lastChild.textContent = 'reconnecting'; };
loadTrash(); setBusy(); autosize();

/* ---------- life board inside the chat page ---------- */
function openApp(url, title) { const f = $('avFrame'); if (f.dataset.url !== url) { f.dataset.url = url; f.src = url; } $('avTitle').textContent = title; $('avFull').href = url; $('appview').hidden = false; closeSide(); }
function closeApp() { $('appview').hidden = true; }
window.BellaOpenToday = openApp;    // used by daily-today.js to pop the Today page on open
window.BellaCloseToday = closeApp;
$('todayBtn').onclick = () => openApp('/today.html', 'Today');
$('researchBtn').onclick = () => openApp('/research.html', 'Research Lab');
$('usageBtn').onclick = () => openApp('/usage.html', 'Usage');
$('updBtn').onclick = () => { closeSide(); import('./update-banner.js').then(m => m.checkNow()); };
$('instrBtn').onclick = () => { closeSide(); import('./instructions.js').then(m => m.openInstructions()); };   // Bella's, Interstellar's and your own instructions
$('avClose').onclick = closeApp;
for (const id of ['newBtn', 'bellaBtn', 'agentsBtn']) $(id)?.addEventListener('click', closeApp);   // opening a chat must never stay hidden behind an app panel
document.addEventListener('click', (e) => { if (e.target.closest('#hist .row')) closeApp(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('appview').hidden) closeApp(); });
addEventListener('hashchange', closeApp);                       // a link to a chat (#claude:<id>) shows the chat, not the panel
// a panel page that never finishes loading (server restarting, sleeping computer) would stay blank: tell the user and offer a reload
$('avFrame').addEventListener('load', () => { clearTimeout(avWatch); $('avFail')?.remove(); });
let avWatch = 0;
const watchApp = () => { clearTimeout(avWatch); avWatch = setTimeout(() => { if ($('appview').hidden || $('avFail')) return; const m = el('div', 'avfail', 'This page did not load. '); m.id = 'avFail'; const r = el('button', 'ibtn', 'Reload'); r.type = 'button'; r.onclick = () => { m.remove(); $('avFrame').src = $('avFrame').dataset.url; watchApp(); }; m.append(r); $('appview').append(m); }, 6000); };
new MutationObserver(watchApp).observe($('avFrame'), { attributes: true, attributeFilter: ['src'] });

fetch('/api/config').then(r => r.json()).then(cfg => {
  const e = cfg.engines || {}; for (const a of ['bella', 'interstellar']) if (e[a]) S.eng[a] = e[a];
  if (e.found && !e.found[S.tool]?.installed) { const t = ['claude', 'codex', 'antigravity', 'opencode'].find(x => e.found[x]?.installed); if (t) { S.tool = t; if (!S.key) renderThread(); } }   // a new chat starts on a program you have
  $('todayBtn').hidden = !cfg.today;
  if (cfg.remote) { S.remote = true; S.mode = 'readonly'; fillSelects(); renderTop(); } const box = $('linksList'); for (const l of cfg.links || []) { const b = el('button', ''); b.innerHTML = `<span class="ic">${icon(l.icon === 'chess' ? 'chess' : 'link', 17)}</span>`; b.append(l.name); const ch = el('span', 'chev', '↗'); b.append(ch); b.onclick = () => window.open(l.url, '_blank', 'noopener'); box.append(b); } }).catch(() => {});

for (const [id, ic] of Object.entries({ bellaBtn: 'crown', newBtn: 'new', agentsBtn: 'guild', todayBtn: 'clock', researchBtn: 'research', usageBtn: 'usage', instrBtn: 'guild', updBtn: 'new', selectBtn: 'select', trashBtn: 'trash' })) { const s = $(id)?.querySelector('.ic'); if (s) s.innerHTML = icon(ic, 17); }

// Bella's one ongoing thread: her own session, with the older Terminal conversation shown above it (read-only)
async function openBella() {
  const t = await fetch('/api/bella/thread').then(r => r.json()).catch(() => ({}));
  S.bellaMain = t.mainKey || null; S.tool = S.eng.bella; S.agent = 'bella'; $('agentSel').value = 'bella';
  loadHistory(t.history || []);
  if (S.bellaMain) openSession(S.bellaMain, { bella: true });
  else { S.bella = true; S.key = null; S.msgs = []; history.replaceState(null, '', location.pathname); renderSide(); renderTop(); renderThread(); $('input').focus(); }
}
async function loadHistory(keys) {
  S.histEl = null; S.histCount = 0;
  const lists = await Promise.all(keys.map(k => fetch('/api/chat/transcript/' + encodeURIComponent(k) + '?full=1&text=1&limit=700').then(r => r.json()).then(r => r.messages || []).catch(() => [])));
  const msgs = lists.flat(); if (!msgs.length) return;
  const d = document.createElement('details'); d.className = 'hist'; d.open = true;
  d.append(el('summary', '', `Earlier, in Terminal: ${msgs.length} messages (read-only)`));
  for (const m of msgs) d.append(msgEl({ ...m, live: false }));
  S.histEl = d; S.histCount = msgs.length;
  if (S.bella) { renderThread(); toBottom(false); }
}
$('bellaBtn').onclick = () => { openBella(); closeSide(); };
fetch('/api/bella/thread').then(r => r.json()).then(t => { S.bellaMain = t.mainKey || null; }).catch(() => {});

/* ---------- image attachments: paste, drop, or pick ---------- */
function renderAttach() {
  const box = $('attach'); box.replaceChildren(); box.hidden = !S.attach.length;
  S.attach.forEach((a, i) => {
    const c = el('div', 'achip'), im = a.url ? document.createElement('img') : el('span', 'afile', a.file.name.slice(0, 28)); if (a.url) { im.src = a.url; im.alt = 'attached image'; }
    const x = el('button', '', '×'); x.type = 'button'; x.title = 'Remove'; x.onclick = () => { if (a.url) URL.revokeObjectURL(a.url); S.attach.splice(i, 1); renderAttach(); };
    c.append(im, x); box.append(c);
  });
}
// A file the agent saved in Downloads / Desktop / Documents becomes a download button (the server checks the path again).
const FILE_RE = /(?:~|\/Users\/[^\s/]+)\/(?:Downloads|Desktop|Documents)\/[^\s`"'<>()[\]]+?\.(?:docx?|pptx|xlsx|pdf|png|jpe?g|gif|webp|txt|md|csv|rtf)(?![\w])/gi;
function fileLink(path) { const a = el('a', 'filelink', 'Download ' + path.split('/').pop()); a.href = '/api/file?path=' + encodeURIComponent(path); a.setAttribute('download', ''); a.title = path; return a; }
function linkFiles(root) {
  for (const c of root.querySelectorAll('code')) { const t = c.textContent.trim(); if (/^(~|\/Users\/[^/]+)\/(Downloads|Desktop|Documents)\//i.test(t) && /\.(docx?|pptx|xlsx|pdf|png|jpe?g|gif|webp|txt|md|csv|rtf)$/i.test(t)) c.after(' ', fileLink(t)); }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => n.parentElement.closest('a,code,pre') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
  const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) {
    const t = n.nodeValue; FILE_RE.lastIndex = 0; if (!FILE_RE.test(t)) continue; FILE_RE.lastIndex = 0;
    const frag = document.createDocumentFragment(); let last = 0, m;
    while ((m = FILE_RE.exec(t))) { frag.append(t.slice(last, m.index), m[0], ' ', fileLink(m[0])); last = m.index + m[0].length; }
    frag.append(t.slice(last)); n.replaceWith(frag);
  }
}
function addFiles(files) {
  for (const f of files) {
    if (f.size > 12 * 1024 * 1024) { alert('That file is too large (max 12 MB).'); continue; }
    if (S.attach.length >= 4) { alert('Up to 4 files per message.'); break; }
    S.attach.push({ file: f, url: f.type.startsWith('image/') ? URL.createObjectURL(f) : null });
  }
  renderAttach(); $('input').focus();
}
$('attachBtn').innerHTML = icon('attach', 18);
$('attachBtn').onclick = () => $('file').click();
$('file').onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };
$('input').addEventListener('paste', (e) => { const imgs = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/')); if (imgs.length) { e.preventDefault(); addFiles(imgs); } });
const composerEl = document.querySelector('.composer');
composerEl.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); composerEl.classList.add('drop'); } });
composerEl.addEventListener('dragleave', () => composerEl.classList.remove('drop'));
composerEl.addEventListener('drop', (e) => { e.preventDefault(); composerEl.classList.remove('drop'); addFiles(e.dataTransfer?.files || []); });
