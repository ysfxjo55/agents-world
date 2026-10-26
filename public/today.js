import { localDateString, habitsDueOn, weekCount, groupTasks, summaryLine, calendarCacheFresh } from './today-logic.js';
import { icon } from './icons.js';

const $ = (id) => document.getElementById(id);
const emptyDay = (date) => ({ date, habits: {}, sessions: [], carry: [], note: '' });
const CAL = 'Check my Google Calendar for today and tell me what is still ahead. Compare it with my board and tell me anything I may have forgotten.';
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const S = { today: '', habits: [], areas: [], tasks: [], day: emptyDay(''), week: {}, lifeDir: '', key: null, busy: false, calBusy: false, loading: false, reload: false, expanded: new Set(), saving: false, remote: false };

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const getJSON = (u) => fetch(u).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
const put = (u, data) => fetch(u, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
  .then(r => { if (!r.ok) throw new Error('save failed'); return r.json().catch(() => ({})); });

// local date arithmetic, week starts Sunday
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return localDateString(d); };
const sundayOf = (s) => addDays(s, -new Date(s + 'T00:00:00').getDay());
const longDate = (s) => { const d = new Date(s + 'T00:00:00'); return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`; };
const fmtMin = (m) => { m = Math.round(m || 0); const h = Math.floor(m / 60), r = m % 60; return h ? (r ? h + 'h ' + r + 'm' : h + 'h') : r + 'm'; };

/* ---------- data ---------- */
async function load() {
  if (S.loading) { S.reload = true; return; }
  S.loading = true;
  try {
    S.today = localDateString();
    const today = S.today;
    const [settings, tasks, day] = await Promise.all([
      getJSON('/api/board/config/settings').catch(() => null),
      getJSON('/api/board/tasks').catch(() => []),
      getJSON('/api/board/days/' + today).catch(() => null),
    ]);
    S.habits = settings?.data?.habits || [];
    S.areas = settings?.data?.areas || [];
    S.tasks = Array.isArray(tasks) ? tasks : [];
    S.day = (day && day.exists && day.data) ? day.data : emptyDay(today);

    const week = {};
    for (let s = sundayOf(today); s <= today; s = addDays(s, 1)) week[s] = s === today ? S.day : null;   // filled below
    const dates = Object.keys(week).filter(d => d !== today);
    await Promise.all(dates.map(async (d) => {
      try { const r = await getJSON('/api/board/days/' + d); week[d] = (r && r.exists && r.data) ? r.data : emptyDay(d); }
      catch { week[d] = null; }
    }));
    S.week = week;
    render();
  } finally {
    S.loading = false;
    if (S.reload) { S.reload = false; await load(); }
  }
}

/* ---------- header ---------- */
function render() {
  const habits = habitsDueOn(S.habits, S.today);
  const done = habits.filter(h => S.day.habits && S.day.habits[h.id]).length;
  const g = groupTasks(S.tasks, S.today);
  const left = new Set([...g.overdue, ...g.dueToday, ...g.inProgress].map(t => t.id)).size;

  $('date').textContent = longDate(S.today);
  $('summary').textContent = summaryLine(habits.length - done, left);
  const pct = habits.length ? Math.round(done / habits.length * 100) : 0;
  $('barFill').style.width = pct + '%';
  $('bar').classList.toggle('full', habits.length > 0 && done === habits.length);

  renderHabits(habits);
  renderTasks(g);
  renderSessions();
}

/* ---------- habits ---------- */
function renderHabits(habits) {
  const box = $('habits'); box.replaceChildren();
  $('habitsSec').hidden = habits.length === 0;
  for (const h of habits) {
    const isDone = !!(S.day.habits && S.day.habits[h.id]);
    const b = el('button', 'habit' + (isDone ? ' done' : ''));
    b.setAttribute('aria-pressed', String(isDone));
    const check = el('span', 'hcheck'); check.innerHTML = icon('select', 18);
    const text = el('span', 'htext');
    text.append(el('span', 'hname', h.name || h.id));
    const bits = [];
    if (h.perWeek) bits.push(`${weekCount(h, S.week, S.today)} of ${h.perWeek} this week`);
    if (h.target) bits.push(h.target);
    if (bits.length) text.append(el('span', 'hsub', bits.join(' · ')));
    b.append(check, text);
    b.onclick = () => toggleHabit(h);
    box.append(b);
  }
}

async function toggleHabit(h) {
  if (S.saving) return;
  S.saving = true;
  try {
    const r = await getJSON('/api/board/days/' + S.today).catch(() => null);
    const data = (r && r.exists && r.data) ? r.data : emptyDay(S.today);
    data.habits = data.habits || {};
    if (data.habits[h.id]) delete data.habits[h.id]; else data.habits[h.id] = true;
    await put('/api/board/days/' + S.today, data);
  } catch (e) { console.error(e); }
  S.saving = false;
  await load();
}

/* ---------- tasks ---------- */
function areaOf(id) { return S.areas.find(a => a.id === id); }
function renderTasks(g) {
  const box = $('tasks'); box.replaceChildren();
  $('tasksSec').hidden = !(g.overdue.length + g.dueToday.length + g.inProgress.length);
  addTaskGroup(box, 'Overdue', g.overdue, 'over');
  addTaskGroup(box, 'Due today', g.dueToday, 'today');
  addTaskGroup(box, 'In progress', g.inProgress, 'doing');
}
function addTaskGroup(box, title, list, cls) {
  if (!list.length) return;
  const s = el('div', 'tgroup ' + cls);
  s.append(el('h3', '', title));
  const inner = el('div', 'tasks');
  for (const t of list) inner.append(taskCard(t));
  s.append(inner); box.append(s);
}
function taskCard(t) {
  const d = t.data || {};
  const card = el('div', 'task');
  const row = el('div', 'trow');
  const title = el('button', 'ttitle', d.title || t.id);
  title.onclick = () => { if (S.expanded.has(t.id)) S.expanded.delete(t.id); else S.expanded.add(t.id); stepsBox.hidden = !S.expanded.has(t.id); };
  const meta = el('div', 'tmeta');
  const area = areaOf(d.area);
  if (area) { const dot = el('span', 'tdot'); dot.style.background = area.color; meta.append(dot, el('span', '', area.name)); }
  if (d.due) meta.append(el('span', 'tdue', d.due === S.today ? 'today' : d.due));
  const steps = Array.isArray(d.steps) ? d.steps : [];
  if (steps.length) meta.append(el('span', 'tsteps', `${steps.filter(s => s.d).length}/${steps.length}`));
  row.append(title, meta);

  const actions = el('div', 'tactions');
  if (d.status === 'todo') {
    const start = el('button', 'btn', 'Start');
    start.onclick = () => updateTask(t.id, x => { x.status = 'doing'; });
    actions.append(start);
  }
  const done = el('button', 'btn primary', 'Done');
  done.onclick = () => updateTask(t.id, x => { x.status = 'done'; x.doneAt = Date.now(); });
  actions.append(done);

  const stepsBox = el('div', 'steps');
  stepsBox.hidden = !S.expanded.has(t.id);
  if (!steps.length) stepsBox.append(el('p', 'hsub', 'No steps.'));
  for (const st of steps) {
    const line = el('div', 'step' + (st.d ? ' done' : ''));
    line.append(el('span', 'sdot'), el('span', '', st.t || ''));
    stepsBox.append(line);
  }
  card.append(row, actions, stepsBox);
  return card;
}
async function updateTask(id, fn) {
  if (S.saving) return;
  S.saving = true;
  try {
    const list = await getJSON('/api/board/tasks');
    const item = (list || []).find(t => t.id === id);
    if (item) { fn(item.data); await put('/api/board/tasks/' + id, item.data); }
  } catch (e) { console.error(e); }
  S.saving = false;
  await load();
}

/* ---------- sessions ---------- */
function renderSessions() {
  const list = S.day.sessions || [];
  const box = $('sessions'); box.replaceChildren();
  $('sessionsSec').hidden = list.length === 0;
  let min = 0;
  for (const x of list) {
    min += Number(x.min) || 0;
    const area = areaOf(x.area);
    const row = el('div', 'sess');
    row.append(el('span', 'sess-t', x.title || 'Session'));
    if (area) row.append(el('span', 'sess-m', area.name));
    row.append(el('span', 'sess-min', fmtMin(x.min)));
    box.append(row);
  }
  $('sessTotal').textContent = list.length ? `${fmtMin(min)} logged` : '';
}

/* ---------- chat + calendar ---------- */
const POPUP = new URLSearchParams(location.search).has('popup');   // opens from the auto-show (with Close / Don't-show buttons)
const SNOOZE_KEY = 'bella.todayShown';
const isTop = () => { try { return window.self === window.top; } catch { return false; } };

function refreshStrip() { $('answerWrap').hidden = !$('answer').textContent && !$('status').textContent; }
// Two small sinks: one paints the chat strip, one paints the "Calendar today" section.
const chatSink = { t: '', reset() { this.t = ''; $('answer').textContent = ''; $('status').textContent = ''; refreshStrip(); }, text(s) { $('answer').textContent = s; refreshStrip(); }, status(s) { $('status').textContent = s || ''; refreshStrip(); } };
const calSink = { t: '', reset() { this.t = ''; $('calAnswer').textContent = ''; $('calStatus').textContent = ''; }, text(s) { $('calAnswer').textContent = s; $('calSec').hidden = false; }, status(s) { $('calStatus').textContent = s || ''; $('calSec').hidden = false; } };

async function chatTurn(text, sink, body) {
  sink.status('Starting…');
  body.source = 'today';
  try {
    const r = await fetch('/api/chat/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status === 403) { sink.status('Editing is only possible on this computer itself.'); return; }
    if (!r.ok) { const e = await r.json().catch(() => ({})); sink.status(e.error || ('Error ' + r.status)); return; }
    const reader = r.body.getReader(), dec = new TextDecoder(); let buf = '';
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        if (chunk.startsWith('data: ')) { try { onEvent(JSON.parse(chunk.slice(6)), sink); } catch { /* ignore a partial line */ } }
      }
    }
  } catch (e) { sink.status(e.message || 'Could not reach the server.'); }
}
function onEvent(ev, sink) {
  if (ev.t === 'start') { if (ev.key && sink === chatSink) S.key = ev.key; sink.status(''); }
  else if (ev.t === 'delta') { sink.t += ev.text || ''; sink.text(sink.t); }
  else if (ev.t === 'blocks') {
    const txt = (ev.blocks || []).filter(b => b.type === 'text').map(b => b.text).join('\n\n');
    if (txt) { sink.t = txt; sink.text(txt); }
  } else if (ev.t === 'status') sink.status(ev.text || '');
  else if (ev.t === 'error') { sink.t = (sink.t ? sink.t + '\n\n' : '') + (ev.text || 'Something went wrong.'); sink.text(sink.t); }
  else if (ev.t === 'done') {
    if (ev.error && ev.error !== 'Stopped') { sink.t = (sink.t ? sink.t + '\n\n' : '') + ev.error; sink.text(sink.t); }
    if (ev.denied?.length) { sink.t = (sink.t ? sink.t + '\n\n' : '') + 'Some steps were blocked in "Can edit files" mode.'; sink.text(sink.t); }
    sink.status('');
  }
}
async function send(input) {
  const text = String(input || '').trim();
  if (!text || S.busy) return;
  S.busy = true; chatSink.reset(); $('sendBtn').disabled = true;
  const body = { tool: 'claude', mode: S.remote ? 'readonly' : 'edits', text };   // through Tailscale the server only allows read-only chat
  if (S.key && !S.calBusy) body.key = S.key; else body.cwd = S.lifeDir;
  try { await chatTurn(text, chatSink, body); }
  finally { S.busy = false; $('sendBtn').disabled = false; }
  await load();
}
const CAL_KEY = 'bella.calendarCheck';
async function runCalendar(auto = false) {
  if (S.calBusy) return;
  if (auto) { try { const c = JSON.parse(localStorage.getItem(CAL_KEY) || 'null'); if (calendarCacheFresh(c)) { calSink.reset(); calSink.t = c.text; calSink.text(c.text); return; } } catch { /* no saved answer */ } }
  S.calBusy = true; calSink.reset(); $('calSec').hidden = false; $('calBtn').disabled = true;
  const body = { tool: 'claude', mode: S.remote ? 'readonly' : 'edits', text: CAL };
  if (S.key && !S.busy) body.key = S.key; else { body.cwd = S.lifeDir; body.temp = true; }   // reuse the chat when we can, otherwise a fresh one-shot that removes itself (Trash) when done
  try { await chatTurn(CAL, calSink, body); if (calSink.t) { try { localStorage.setItem(CAL_KEY, JSON.stringify({ t: Date.now(), text: calSink.t })); } catch { /* private mode */ } } }
  finally { S.calBusy = false; $('calBtn').disabled = false; }
}

/* ---------- popup bar (Close / don't show again) + "show again" ---------- */
function tellParent(type) { if (!isTop()) { try { window.parent.postMessage({ type }, location.origin); } catch { /* not embedded */ } } }
// Closing the popup removes its chat: the app does this itself (to Trash, recoverable), no AI is asked.
function removeChat() { if (!S.key || S.remote) return; const key = S.key; S.key = null; try { fetch('/api/today/close', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) }).catch(() => {}); } catch { /* page is closing */ } }
$('popupClose').onclick = () => { removeChat(); tellParent('bella-today-close'); if (isTop()) window.close(); };
$('popupSnooze').onclick = () => {
  try { localStorage.setItem(SNOOZE_KEY, S.today || localDateString()); } catch { /* private mode */ }
  removeChat();
  tellParent('bella-today-snooze');
  if (isTop()) window.close();
};
$('showAgain').onclick = () => { try { localStorage.removeItem(SNOOZE_KEY); } catch { /* private mode */ } $('showAgain').hidden = true; };
function refreshShowAgain() {
  let paused = false; try { paused = localStorage.getItem(SNOOZE_KEY) === (S.today || localDateString()); } catch { /* private mode */ }
  $('showAgain').hidden = POPUP || !paused;
}

/* ---------- events ---------- */
$('sendBtn').onclick = () => { const v = $('chatInput').value; $('chatInput').value = ''; send(v); };
$('chatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('sendBtn').click(); } });
$('calBtn').onclick = () => runCalendar();
addEventListener('focus', () => load());

async function init() {
  try { const cfg = await getJSON('/api/config'); S.lifeDir = cfg.lifeDir || ''; S.remote = !!cfg.remote; } catch { /* config is optional */ }
  if (S.remote) $('chatInput').placeholder = 'Ask about today (read-only from here; tap items to update)…';
  await load();
  refreshShowAgain();
  if (POPUP) {
    $('popupBar').hidden = false;
    $('ask').hidden = false;
    $('ask').textContent = S.remote
      ? 'Read-only through Tailscale — open Bella on this computer itself to change the board.'
      : 'Anything else to add, or any task to change?';
    if (!S.remote) $('chatInput').placeholder = 'Anything else to add, or any task to change?';
    $('chatInput').focus();
    runCalendar(true);
  }
  setInterval(load, 5000);
}
init();
