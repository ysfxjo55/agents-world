import { THEMES, STATUS, TOOLS } from './themes.js';
import { icon, badge } from './icons.js';
import { nullWorld, NO_3D } from './null-world.js';
import { watchConnection } from './conn-hint.js';

const $ = (id) => document.getElementById(id);
const ls = { get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
const DAY = 14 * 24 * 3600_000;

const state = { snap: null, showAll: ls.get('aw.showAll', '0') === '1', selected: null, theme: ls.get('aw.theme', 'island'), firstSeen: new Map(), panelKey: null, framed: false, links: [] };
// The 3D world needs WebGL. If it cannot start (old graphics driver, a fresh Windows laptop, a browser setting), the rest of the page still works.
let world;
try { const { World } = await import('./world.js'); world = new World($('world')); }
catch (e) {
  console.error('3D view off:', e);
  world = nullWorld(document.createElement('canvas'));
  const n = document.createElement('div'); n.className = 'note3d'; n.textContent = NO_3D; $('world').append(n);
}
world.setTheme(state.theme, false);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

/* ---------- helpers ---------- */
function ago(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}
const short = (ms) => ago(ms).replace(' min ago', 'm').replace(' h ago', 'h').replace(' d ago', 'd').replace('just now', 'now');
const toast = (msg) => { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 2600); };
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
const robotSvg = (color) => `<svg viewBox="0 0 40 40" width="34" height="34"><rect x="7" y="12" width="26" height="22" rx="6" fill="${color}"/><rect x="11" y="17" width="18" height="9" rx="3" fill="#2a2f45"/><circle cx="16" cy="21.5" r="2.2" fill="#8ff7ff"/><circle cx="24" cy="21.5" r="2.2" fill="#8ff7ff"/><rect x="19" y="5" width="2" height="7" fill="#2a2f45"/><circle cx="20" cy="5" r="2.6" fill="#fff"/></svg>`;

/* ---------- data ---------- */
function visible(snap) {
  const now = Date.now();
  return snap.sessions.filter(s => !s.familyChat && (state.showAll || (!s.archived && now - s.lastActivity < DAY && s.lastActivity >= (snap.showSince || 0))));   // "start with an empty world" hides what came before
}
// Bella's own conversation threads, and agents she started for small jobs, live at her HQ. Sessions in a project folder she created for a task do not.
const isBellaChat = (s) => (state.snap?.bellaKeys || []).includes(s.key) || (s.agent === 'bella' && s.cwd === state.snap?.home);
const isBellaOwn = (s) => isBellaChat(s) || (s.delegatedBy === 'bella' && !s.createdProject);
function apply(snap) {
  state.snap = snap;
  const names = new Map(snap.projects.map(p => [p.path, p.name]));
  const list = visible(snap);
  for (const s of snap.sessions) { s.projectName = names.get(s.projectPath); if (!state.firstSeen.has(s.key)) state.firstSeen.set(s.key, state.firstSeen.size); s.firstSeen = state.firstSeen.get(s.key); }
  for (const s of list) if (snap.interstellar && s.projectPath === '__interstellar__') { s.projectName = 'Interstellar'; } else if (s.agent === 'deep-researcher') { s.projectPath = '__lab__'; s.projectName = 'Research Lab'; } else if (isBellaOwn(s)) { s.projectPath = '__bella__'; s.projectName = 'Bella HQ'; }   // her own chats and the agents she started belong to her block; work in a project folder she opened, or an old chat held in a project, stays in that project's block
  world.setInterstellar(snap.interstellar || null); world.setBella(snap.bella || null); world.setLab(snap.lab || null); world.setAgents(snap.agents || []);
  world.sync(list.filter(s => !isBellaChat(s)), true); // Bella's own chat is her HQ + robot, not a building in the home block
  renderSidebar(list); renderCounts(list); refreshCard(); $('empty').hidden = list.length > 0;
  if (!state.framed && (list.length || snap.interstellar)) { state.framed = true; setTimeout(() => world.home(), 300); }
  const needs = list.filter(s => s.status === 'needs').length;
  document.title = needs ? `(${needs}) Agents World` : 'Agents World';
}
const find = (key) => state.snap?.sessions.find(s => s.key === key);
const findAgent = (key) => (key === 'interstellar' ? state.snap?.interstellar : key === 'bella' ? state.snap?.bella : key === 'lab' ? state.snap?.lab : state.snap?.agents?.find(a => 'agent:' + a.name === key));

const EMPTY = $('empty').textContent;   // "No sessions..."; the same box shows the connection help when needed
function connect() {
  const es = new EventSource('/events');
  const conn = watchConnection({ show: (t) => { $('live').lastChild.textContent = 'not connected'; $('live').title = t; $('empty').textContent = t; $('empty').hidden = false; }, hide: () => { $('live').title = 'Live connection'; $('empty').textContent = EMPTY; } });
  es.addEventListener('snapshot', (e) => { conn.ok(); $('live').className = 'on'; $('live').lastChild.textContent = 'live'; apply(JSON.parse(e.data)); });
  es.onerror = () => { conn.error(); $('live').className = ''; $('live').lastChild.textContent = 'reconnecting'; };
}

/* ---------- sidebar ---------- */
function renderCounts(list) {
  const c = $('counts'); c.replaceChildren();
  for (const k of ['working', 'needs', 'idle', 'sleeping']) {
    const n = list.filter(s => s.status === k).length; if (!n && k !== 'working') continue;
    const chip = el('span', 'chip'); chip.append(el('i', `dot ${k}`), document.createTextNode(`${n} ${STATUS[k].label.toLowerCase()}`)); c.append(chip);
  }
}
function renderSidebar(list) {
  const box = $('list'), scroll = box.scrollTop; box.replaceChildren();
  if (state.snap?.bella) {                                          // Bella, the manager: always at the very top
    const b0 = state.snap.bella, g = el('div', 'grp bella'), h = el('h3'); { const t = el('span', 'gt'); t.innerHTML = icon('crown', 14) + ' Manager'; h.append(t, el('span', '', '')); } g.append(h);
    const b = el('button', 'row bellarow' + (state.selected === 'bella' ? ' sel' : '')); b.dataset.key = 'bella';
    const em = el('span', 'em'); em.innerHTML = badge('crown', '#ff6fae'); b.append(em, el('span', 't', 'Bella'), el('span', 'a', b0.status === 'working' ? 'working' : 'ready'));
    b.onclick = () => { select('bella', true); closeSide?.(); }; g.append(b); box.append(g);
  }
  if (state.snap?.interstellar) {
    const a = state.snap.interstellar, g = el('div', 'grp interstellar'), h = el('h3', '', 'Partner'); g.append(h);
    const b = el('button', 'row interstellarrow' + (state.selected === 'interstellar' ? ' sel' : '')); b.dataset.key = 'interstellar';
    const em = el('span', 'em'); em.innerHTML = badge('interstellar', '#ffb347'); b.append(em, el('span', 't', 'Interstellar'), el('span', 'a', a.status === 'working' ? 'working' : 'ready'));
    b.onclick = () => { select('interstellar', true); closeSide(); }; g.append(b); box.append(g);
  }
  if (state.snap?.bella && state.snap?.interstellar) {   // the family chat needs both managers
    const g = el('div', 'grp'), b = el('button', 'row');
    const em = el('span', 'em'); em.innerHTML = badge('chat', '#ffb347');
    b.append(em, el('span', 't', 'Family chat'), el('span', 'a', 'open'));
    b.onclick = () => openApp('/family.html', 'Family chat'); g.append(b); box.append(g);
  }
  if (state.snap?.lab) {                                            // the Research Lab: its own block, its own page
    const l0 = state.snap.lab, g = el('div', 'grp lab'), h = el('h3'); { const t = el('span', 'gt'); t.innerHTML = icon('research', 14) + ' Research Lab'; h.append(t, el('span', '', '')); } g.append(h);
    const b = el('button', 'row labrow' + (state.selected === 'lab' ? ' sel' : '')); b.dataset.key = 'lab';
    const em = el('span', 'em'); em.innerHTML = badge('research', '#4fd1e8'); const jr = l0.jobs?.running || 0;
    b.append(em, el('span', 't', 'Deep Researcher'), el('span', 'a', jr ? `${jr} running` : 'ready'));
    b.onclick = () => { select('lab', true); closeSide(); }; g.append(b);
    const n = el('button', 'row'); const em2 = el('span', 'em'); em2.innerHTML = badge('new', '#4fd1e8'); n.append(em2, el('span', 't', 'New research'), el('span', 'a', 'open'));
    n.onclick = () => openApp('/research.html', 'Research Lab'); g.append(n); box.append(g);
  }
  if (state.today || state.links.length) { // your own pages: Today (when "today" is on in data/config.json) and your links
    const g = el('div', 'grp life'), h = el('h3'); { const t = el('span', 'gt'); t.innerHTML = icon('life', 14) + ' My life'; h.append(t, el('span', '', '')); } g.append(h);
    for (const [ic, col, name, url] of state.today ? [['clock', '#d97757', 'Today', '/today.html']] : []) {
      const b = el('button', 'row'); const em = el('span', 'em'); em.innerHTML = badge(ic, col); b.append(em, el('span', 't', name), el('span', 'a', 'open'));
      b.onclick = () => openApp(url, name); g.append(b);
    }
    for (const l of state.links) { const b = el('button', 'row'); const em2 = el('span', 'em'); em2.innerHTML = badge(l.icon === 'chess' ? 'chess' : 'link', '#e8c46b'); b.append(em2, el('span', 't', l.name), el('span', 'a', '↗'));   // other sites may forbid framing, so they open in a new tab
      b.onclick = () => window.open(l.url, '_blank', 'noopener'); g.append(b); }
    box.append(g);
  }
  const ag = state.snap?.agents || [];
  if (ag.length) {
    const g = el('div', 'grp agents'), h = el('h3'); { const t = el('span', 'gt'); t.innerHTML = icon('guild', 14) + ' Agent Guild'; h.append(t, el('span', '', String(ag.length))); } g.append(h);
    for (const a of ag) {
      const key = 'agent:' + a.name, b = el('button', 'row' + (key === state.selected ? ' sel' : '')); b.dataset.key = key;
      b.append((() => { const em = el('span', 'em'); em.innerHTML = badge(a.name, a.color); return em; })(), el('span', 't', a.name), el('span', 'a', a.lastUsed ? short(a.lastUsed) : 'new'));
      b.onclick = () => { select(key, true); closeSide(); }; g.append(b);
    }
    box.append(g);
  }
  const groups = new Map();
  for (const s of list) { if (!groups.has(s.projectPath)) groups.set(s.projectPath, []); groups.get(s.projectPath).push(s); }
  for (const [path, items] of [...groups].sort((a, b) => Math.max(...b[1].map(x => x.lastActivity)) - Math.max(...a[1].map(x => x.lastActivity)))) {
    const g = el('div', 'grp'), h = el('h3'); h.title = path; h.append(el('span', '', items[0].projectName), el('span', '', String(items.length))); g.append(h);
    for (const s of items) {
      const b = el('button', 'row' + (s.key === state.selected ? ' sel' : '') + (s.archived ? ' arch' : ''));
      b.dataset.key = s.key;
      b.append(el('i', `dot ${s.status}`), el('span', `tool ${s.tool}`), el('span', 't', s.title), el('span', 'a', short(s.lastActivity)));
      b.onclick = () => { select(s.key, true); closeSide(); };
      g.append(b);
    }
    box.append(g);
  }
  box.scrollTop = scroll;
}

/* ---------- selection / card ---------- */
function select(key, fly) {
  state.selected = key; world.setSelected(key);
  dispatchEvent(new CustomEvent('aw-guide', { detail: { type: 'selected', session: !!(key && find(key)) } }));   // the first-steps guide waits for this
  document.querySelectorAll('.row').forEach(r => r.classList.toggle('sel', r.dataset.key === key));
  if (key && fly) {
    // Old chats with Bella are not buildings (her chat is her HQ and robot): fly there instead of doing nothing
    const sess = state.snap?.sessions.find(x => x.key === key);
    world.flyToSession(sess && !world.buildings.has(key) && isBellaOwn(sess) ? 'bella' : key);
  }
  const cardEl = $('card'); cardEl.classList.remove('pop'); void cardEl.offsetWidth; if (key) cardEl.classList.add('pop');
  buildCard();
  if (key && !$('chatpanel').hidden && find(key)) openPanel(key);
}
function buildAgentCard(a) {
  const card = $('card'); card.replaceChildren();
  const x = el('button', 'x', '×'); x.onclick = () => select(null);
  const top = el('div', 'top'), av = el('div', 'av'); av.style.background = a.color + '26'; av.style.color = a.color; av.innerHTML = icon(a.name, 28);
  const isI = a.name === 'interstellar', isB = a.name === 'bella', isL = a.name === 'deep-researcher'; const h = el('h2', '', isI ? 'Interstellar' : isB ? 'Bella' : isL ? 'Deep Researcher' : a.name); top.append(av, h);
  const meta = el('div', 'meta'); meta.id = 'cardMeta';
  const stat = el('span', 'st'); stat.append(el('i', `dot ${a.status}`), document.createTextNode(a.status === 'working' ? 'Working now' : a.status === 'needs' ? 'Needs you' : 'Ready'));
  const eng = isI ? state.eng?.interstellar || 'codex' : isB ? state.eng?.bella || 'claude' : 'claude', engName = eng === 'codex' ? 'Codex' : 'Claude Code';   // the program it really runs on
  meta.append(el('span', 'badge ' + eng, isI ? `Partner · ${engName}` : isB ? `Manager · ${engName}` : isL ? 'Researcher' : 'Agent'), stat, document.createTextNode(a.lastUsed ? '· used ' + ago(a.lastUsed) : '· never used yet'));
  const desc = el('div', 'desc', a.description);
  const launch = el('div', 'launch'), sel = document.createElement('select');
  sel.title = 'Folder to start in';
  sel.append(new Option('~ Home', ''));
  for (const p of state.snap.projects) sel.append(new Option(p.name, p.path));
  sel.value = state.launchDir || ''; sel.onchange = () => { state.launchDir = sel.value; };
  const go = el('button', 'btn primary', 'Launch');
  go.onclick = async () => { const r = await post('/api/launch-agent', { name: a.name, cwd: sel.value || undefined }); toast(r.ok ? `Starting ${a.name} in Terminal…` : 'Could not launch: ' + (r.error || 'error')); };
  launch.append(sel, go);
  const chatA = el('button', 'btn'); chatA.innerHTML = icon('chat', 15) + (isI ? ' Chat with Interstellar' : isB ? ' Chat with Bella' : ' Chat with this agent'); chatA.style.cssText = 'width:100%;margin-top:8px'; chatA.onclick = () => openPanel(null, a.name);
  // what has this agent actually been doing? its latest sessions, one tap to read them or fly to their building
  const recent = (state.snap?.sessions || []).filter(s => (isI ? s.projectPath === '__interstellar__' : s.agent === a.name)).sort((p, q) => q.lastActivity - p.lastActivity).slice(0, 3);
  const work = el('div', 'work'); work.append(el('h4', '', recent.length ? 'Latest work' : 'No sessions yet'));
  for (const s of recent) {
    const row = el('div', 'wrow'); row.append(el('i', `dot ${s.status}`), el('span', 't', s.title.replace(/^[\w-]+: /, '')), el('span', 'a', short(s.lastActivity)));
    const read = el('button', 'mini', 'Read'); read.onclick = () => openPanel(s.key);
    const go = el('button', 'mini', 'Show'); go.title = 'Fly to its building'; go.onclick = () => { world.flyToSession(s.key); };
    row.append(read, go); work.append(row);
  }
  if (isL) {                                                         // the lab is used through its own page, not a terminal
    const open = el('button', 'btn primary'); open.innerHTML = icon('research', 15) + ' Open the Research Lab'; open.style.cssText = 'width:100%;margin-top:12px'; open.onclick = () => openApp('/research.html', 'Research Lab');
    const st = a.jobs ? el('div', 'desc', `${a.jobs.running} running · ${a.jobs.done} finished report${a.jobs.done === 1 ? '' : 's'}`) : null;
    card.append(x, top, meta, desc, ...(st ? [st] : []), work, open); card.hidden = false; placeCard(); return;
  }
  card.append(x, top, meta, desc, work, ...(isI ? [] : [launch]), chatA);
  card.hidden = false; placeCard();
}
function buildCard() {
  const card = $('card');
  const ag = state.selected && findAgent(state.selected);
  if (ag) return buildAgentCard(ag);
  const s = find(state.selected);
  if (!s) { card.hidden = true; return; }
  card.replaceChildren();
  const tool = TOOLS[s.tool] || TOOLS.claude;
  const x = el('button', 'x', '×'); x.onclick = () => select(null);
  const top = el('div', 'top'), av = el('div', 'av'); av.style.background = tool.color + '33'; av.innerHTML = robotSvg(tool.color);
  const h = el('h2', '', s.title); h.title = s.title; top.append(av, h);
  const meta = el('div', 'meta'); meta.id = 'cardMeta';
  const now = el('div', 'now'); now.id = 'cardNow'; const prog = el('div', 'prog'); prog.id = 'cardProg'; const bars = el('div', 'bars'); bars.id = 'cardBars';
  const btns = el('div', 'btns');
  const open = el('button', 'btn primary', 'Open'); open.onclick = async () => { const r = await post('/api/open', { key: s.key }); toast(r.ok ? 'Opening Terminal…' : 'Could not open: ' + (r.error || 'error')); };
  const chat = el('button', 'btn', 'Chat'); chat.onclick = () => openPanel(s.key);
  const arch = el('button', 'btn', s.archived ? 'Restore' : 'Archive'); arch.id = 'cardArch';
  arch.onclick = async () => { await post('/api/archive', { key: s.key, archived: !s.archived }); if (!s.archived) select(null); };
  const del = el('button', 'btn danger', 'Delete');
  del.title = 'Move to Trash (you can restore it from the chat page)';
  del.onclick = async () => {
    if (!confirm(`Move this session to Trash?\n\n"${s.title.slice(0, 80)}"\n\nYou can restore it later from Trash in the chat page. If it is still open in a Terminal window, close that window first.`)) return;
    const r = await post('/api/delete', { keys: [s.key] }).catch(() => null), x = r?.results?.[0];
    if (x?.ok) { toast('Moved to Trash. Restore it from the chat page: Trash.'); select(null); } else toast('Could not delete: ' + (x?.error || 'server error'));
  };
  btns.append(open, chat, arch, del);
  card.append(x, top, meta, prog, now, bars, btns);
  card.hidden = false; refreshCard(); placeCard();
}
function refreshCard() {
  const ag = state.selected && findAgent(state.selected);
  if (ag) { if (document.activeElement?.tagName !== 'SELECT') buildAgentCard(ag); return; }
  const s = find(state.selected); if (!s || $('card').hidden) return;
  const tool = TOOLS[s.tool] || TOOLS.claude, st = STATUS[s.status];
  const meta = $('cardMeta'); meta.replaceChildren();
  const badge = el('span', `badge ${s.tool}`, tool.label);
  const stat = el('span', 'st'); const d = el('i', `dot ${s.status}`); stat.append(d, document.createTextNode(st.label));
  meta.append(badge, stat, document.createTextNode('· ' + ago(s.lastActivity)));
  if (s.branch) meta.append(document.createTextNode('· ⎇ ' + s.branch));
  $('cardProg').className = 'prog' + (s.status === 'working' ? ' run' : s.status === 'needs' ? ' wait' : '');
  $('cardNow').textContent = s.status === 'sleeping' ? '' : s.currentTool || (s.status === 'needs' ? 'Waiting for your reply' : s.status === 'working' ? 'Thinking…' : '');
  const bars = $('cardBars'); bars.replaceChildren(); const max = Math.max(1, ...s.activity);
  s.activity.forEach(v => { const i = el('i', v ? 'on' : ''); i.style.height = Math.max(12, (v / max) * 100) + '%'; i.title = `${v} events`; bars.append(i); });
  bars.title = 'Activity, last hour (5-min buckets)';
  $('cardArch').textContent = s.archived ? 'Restore' : 'Archive';
  if (s.helpers.length) { const hp = el('span', '', `· ${s.helpers.length} helper${s.helpers.length > 1 ? 's' : ''}`); hp.title = s.helpers.map(h => h.label).join('\n'); meta.append(hp); }
}
const isMobile = () => matchMedia('(max-width:760px)').matches;
function placeCard() {
  const card = $('card'); if (card.hidden || isMobile()) return; // on phones the card is a fixed bottom sheet
  const p = world.screenPos(state.selected); if (!p || p.behind) { card.style.visibility = 'hidden'; return; }
  card.style.visibility = 'visible';
  const w = $('stage').clientWidth, h = $('stage').clientHeight;
  card.style.left = Math.min(w - 160, Math.max(160, p.x)) + 'px';
  card.style.top = Math.min(h - 10, Math.max(card.offsetHeight + 30, p.y)) + 'px';
}
(function loop() { placeCard(); requestAnimationFrame(loop); })();

/* ---------- chat panel: the real chat page, docked inside the world (same sessions, same engine) ---------- */
function openPanel(key, agent) {
  const frame = $('cpFrame'); let url, title, full;
  if (agent) { url = '/chat.html?embed=1&agent=' + encodeURIComponent(agent); title = `New chat · ${agent}`; full = '/chat.html'; }
  else { const s = find(key); if (!s) return; url = '/chat.html?embed=1#' + encodeURIComponent(key); title = s.title; full = '/chat.html#' + key; }
  if (frame.dataset.url !== url) { frame.dataset.url = url; frame.src = url; }
  $('cpTitle').textContent = title; $('cpFull').href = full;
  state.panelKey = key || null; $('chatpanel').hidden = false; $('chatpanel').classList.remove('wide'); document.body.classList.add('panel-open'); $('card').hidden = true;
}
function openApp(url, title) {
  const frame = $('cpFrame');
  if (frame.dataset.url !== url) { frame.dataset.url = url; frame.src = url; }
  $('cpTitle').textContent = title; $('cpFull').href = url;
  state.panelKey = null; $('chatpanel').hidden = false; $('chatpanel').classList.add('wide'); document.body.classList.add('panel-open'); $('card').hidden = true; select(null);
  document.body.classList.remove('side-open');
}
function closePanel() { $('chatpanel').classList.remove('wide'); state.panelKey = null; $('chatpanel').hidden = true; document.body.classList.remove('panel-open'); const f = $('cpFrame'); f.dataset.url = ''; f.src = 'about:blank'; }
$('cpClose').onclick = closePanel;

/* ---------- world interaction ---------- */
const canvas = world.renderer.domElement;
let down = null;
canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
  const key = world.pick(e); select(key, false);
  if (key) world.flyToSession(key);
});
let moveT = 0;
canvas.addEventListener('pointermove', (e) => {
  const n = performance.now(); if (n - moveT < 60) return; moveT = n;
  const k = world.pick(e); world.hover = k; canvas.style.cursor = k ? 'pointer' : 'grab';
});
addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (!$('chatpanel').hidden) closePanel(); else select(null); } });

/* ---------- toolbar ---------- */
function setThemeBtn() { const t = THEMES[state.theme]; $('themeBtn').innerHTML = icon(t.icon, 16) + ' ' + t.name; }
$('themeBtn').onclick = () => {
  const ids = Object.keys(THEMES); state.theme = ids[(ids.indexOf(state.theme) + 1) % ids.length];
  ls.set('aw.theme', state.theme); world.setTheme(state.theme); setThemeBtn();
  select(null);
};
$('timeSel').onchange = (e) => world.setTimeOverride(e.target.value === 'auto' ? null : parseFloat(e.target.value));
$('homeBtn').onclick = () => world.home();
function closeSide() { document.body.classList.remove('side-open'); }
$('scrim').onclick = closeSide;
$('sideBtn').onclick = () => {
  if (isMobile()) { document.body.classList.toggle('side-open'); return; }
  $('side').classList.toggle('hidden'); setTimeout(() => world.resize(), 280);
};
// "hide UI": immersive full-view; also real fullscreen where the browser allows it (not iPhone Safari)
$('focusBtn').onclick = () => {
  const on = document.body.classList.toggle('immersive'); closeSide(); select(null);
  try { if (on && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen(); else if (!on && document.fullscreenElement) document.exitFullscreen(); } catch {}
};
$('updBtn').onclick = () => import('./update-banner.js').then(m => m.checkNow());   // sidebar footer: look for a new version now
$('showAll').checked = state.showAll;
$('showAll').onchange = (e) => { state.showAll = e.target.checked; ls.set('aw.showAll', state.showAll ? '1' : '0'); if (state.snap) apply(state.snap); };
setInterval(() => { if (state.snap) { renderSidebar(visible(state.snap)); refreshCard(); } }, 20000);

$('chatBtn').innerHTML = icon('chat', 16) + ' Chat'; setThemeBtn(); connect();
fetch('/api/config').then(r => r.json()).then(c => {
  if (c.remote) { const a = document.createElement('a'); a.id = 'remotePill'; a.href = 'http://localhost:4321/'; a.target = '_top'; a.textContent = 'Read-only link. On the computer, open localhost:4321 to edit'; $('toolbar').prepend(a); }
  state.links = c.links || []; state.today = !!c.today; state.eng = c.engines; if (state.snap) renderSidebar(visible(state.snap)); }).catch(() => {});
window.__aw = { world, state };
