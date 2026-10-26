// The first-steps guide on screen: dims the page, rings the real button, and shows one small card.
// The rules live in guide-logic.js. The pages tell us what happened with window events named 'aw-guide'
// (detail = { type: 'selected' | 'sent' | 'started' | 'run-done' | 'status', ... }).
import { KEY, ENGINES, load, save, onEvent, current, close, restart, onPage, label, engineWorks } from './guide-logic.js';

const isTop = (() => { try { return window.self === window.top; } catch { return false; } })();
const page = document.getElementById('world') ? 'world' : 'chat';
const ls = { get: () => { try { return localStorage.getItem(KEY); } catch { return null; } }, set: (v) => { try { localStorage.setItem(KEY, v); } catch {} } };
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());

let st = load(ls.get()), shown = null, localRun = false, lastFocus = null, cfg = null;   // cfg = /api/config: start choice, engines, name
const set = (s) => { if (s === st) return; st = s; ls.set(save(st)); render(); };
const feed = (ev) => set(onEvent(st, ev));

/* ---------- the elements ---------- */
const css = el('link'); css.rel = 'stylesheet'; css.href = '/guide.css';
const shade = el('div', 'gd-shade');          // dims everything when there is nothing to point at
const ring = el('div', 'gd-ring');            // the hole: its huge shadow dims the rest, the real element stays clickable
const card = el('div', 'gd-card'); card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'false'); card.setAttribute('aria-labelledby', 'gdTitle');
const btn = el('button', 'gd-open', '? Guide'); btn.id = 'guideBtn'; btn.type = 'button'; btn.title = 'Show the first-steps guide';

function mountButton() {
  const bar = page === 'world' ? document.getElementById('toolbar') : document.querySelector('#top .right');
  if (bar) bar.prepend(btn); else { btn.classList.add('float'); document.body.append(btn); }
}
btn.onclick = () => { lastFocus = btn; set(restart()); };

/* ---------- where to point ---------- */
function goTarget() {            // the step lives on the other page: point at the link that goes there
  if (page === 'world') return { sel: '#chatBtn', title: 'Open the Chat page', text: 'The next step happens on the Chat page. Click "Chat" to go there. The guide continues by itself.' };
  return { sel: '.seg a[href="/"]', title: 'Open the World page', text: 'The next step happens in the 3D world. Click "World" (open the sidebar first on a phone). The guide continues by itself.' };
}
function buildingSpot() {        // a real building in the 3D world, if there is one
  const aw = /** @type {any} */ (window).__aw; if (!aw?.state?.snap) return null;
  const key = [...(aw.world.buildings?.keys?.() || [])].find(k => aw.state.snap.sessions.some(s => s.key === k));
  const p = key && aw.world.screenPos(key); if (!p || p.behind || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  const r = document.getElementById('stage').getBoundingClientRect();
  return { left: r.left + p.x - 36, top: r.top + p.y - 60, width: 72, height: 72 };
}
function hasSessions() { const aw = /** @type {any} */ (window).__aw; return !!aw?.state?.snap?.sessions?.some(s => !s.familyChat); }

/* ---------- drawing ---------- */
function render() {
  const step = current(st);
  if (!step || !isTop) { [shade, ring, card].forEach(x => x.remove()); shown = null; document.removeEventListener('keydown', onKey, true); return; }
  if (!card.isConnected) { document.body.append(shade, ring, card); document.addEventListener('keydown', onKey, true); lastFocus ||= /** @type {HTMLElement} */ (document.activeElement); }
  const away = !onPage(step, page) ? goTarget() : null;
  const key = step.id + (away ? ':away' : '') + (cfg ? ':cfg' : '');
  if (shown !== key) { shown = key; fill(step, away); }
  place();
}
function fill(step, away) {
  card.replaceChildren();
  const top = el('div', 'gd-top'); top.append(el('span', 'gd-n', label(st)));
  const x = el('button', 'gd-x', '×'); x.type = 'button'; x.title = 'Close the guide (Esc)'; x.setAttribute('aria-label', 'Close the guide'); x.onclick = quit; top.append(x);
  const h = el('h2', '', away ? away.title : step.title); h.id = 'gdTitle';
  card.append(top, h, el('p', '', away ? away.text : step.text));
  if (!away) {
    if (step.id === 'world') { const e = el('p', 'gd-soft', step.empty); e.id = 'gdEmpty'; e.hidden = true; card.append(e); }
    if (step.warn) card.append(el('p', 'gd-warn', step.warn));
    if (step.wrongMode) { const w = el('p', 'gd-warn', step.wrongMode); w.id = 'gdWrong'; w.hidden = true; card.append(w); }
    if (step.input === 'name') card.append(nameForm());
    if (step.choice === 'start' && cfg && !cfg.startChosen) card.append(startChoice());
    if (step.engines) card.append(engineList());
    if (step.notify) card.append(notifyHelp());
  }
  const row = el('div', 'gd-row');
  if (!away && step.action && !(step.choice === 'start' && cfg && !cfg.startChosen)) { const go = el('button', 'gd-btn primary', step.action); go.type = 'button'; go.onclick = () => feed({ type: 'next' }); row.append(go); }
  if (!(step.id === 'welcome' || step.id === 'done')) { const sk = el('button', 'gd-link', 'Skip this step'); sk.type = 'button'; sk.onclick = () => feed({ type: 'skip' }); row.append(sk); }
  if (step.id === 'welcome') { const no = el('button', 'gd-link', 'Not now'); no.type = 'button'; no.onclick = quit; row.append(no); }
  card.append(row);
  const box = !away && step.target ? targetEl()?.querySelector('textarea') : null;   // the chat step: the cursor goes in the message box
  setTimeout(() => (box || card.querySelector('input, .gd-btn.primary') || card.querySelector('button'))?.focus(), 0);
}
function nameForm() {
  const f = el('form', 'gd-form'), inp = el('input'); inp.id = 'gdName'; inp.maxLength = 40; inp.autocomplete = 'given-name'; inp.placeholder = 'Your first name'; inp.setAttribute('aria-label', 'Your first name');
  const ok = el('button', 'gd-btn primary', 'Save'); ok.type = 'submit'; const msg = el('p', 'gd-soft');
  if (cfg?.name) inp.value = cfg.name;
  f.onsubmit = async (e) => {
    e.preventDefault(); ok.disabled = true;
    const r = await post('/api/settings/name', { name: inp.value }).catch(() => ({ error: 'Could not reach the app.' }));
    ok.disabled = false; if (r.ok) feed({ type: 'name-saved' }); else msg.textContent = r.error || 'Could not save it.';
  };
  f.append(inp, ok, msg); return f;
}
// Step 1 on a new install: an empty world, or the sessions already on this computer. Nothing is deleted either way.
function startChoice() {
  const box = el('div', 'gd-choice');
  const pick = async (fresh) => {
    const r = await post('/api/settings/start', { fresh }).catch(() => null);
    if (r?.ok) { cfg.startChosen = true; feed({ type: 'next' }); }
  };
  const a = el('button', 'gd-btn primary', 'Start with an empty world (recommended)'); a.type = 'button'; a.onclick = () => pick(true);
  const b = el('button', 'gd-btn', 'Show my existing sessions'); b.type = 'button'; b.onclick = () => pick(false);
  box.append(a, b, el('p', 'gd-soft', 'Your older sessions stay on your computer. Tick "Show older & archived" in the list to see them any time.'));
  return box;
}
// Step 2: which AI programs are on this computer, and how to get the missing ones. We only show commands; you run them.
function engineList() {
  const box = el('div', 'gd-engines'), found = cfg?.engines?.found || {};
  const os = /Win/i.test(navigator.platform) ? 'win' : 'mac';
  const copy = (cmd) => { const row = el('div', 'gd-cmd'), code = el('code', '', cmd), b = el('button', 'gd-btn', 'Copy'); b.type = 'button';
    b.onclick = () => navigator.clipboard.writeText(cmd).then(() => { b.textContent = 'Copied'; setTimeout(() => (b.textContent = 'Copy'), 1200); }).catch(() => {}); row.append(code, b); return row; };
  for (const [id, e] of Object.entries(ENGINES)) {
    const f = found[id] || {}, ok = f.installed && f.loggedIn !== false;
    const d = el('details', 'gd-eng' + (ok ? ' ok' : '')); d.open = !ok && id !== 'opencode' && !engineWorks(found);
    d.append(el('summary', '', `${e.name}: ${ok ? (f.loggedIn ? 'ready' : 'installed') : f.installed ? 'installed, not logged in' : 'not found'}`));
    if (!ok) {
      d.append(el('p', 'gd-soft', `Needs ${e.plan}.`));
      if (!f.installed) { d.append(el('p', '', '1. Install it (in Terminal):')); d.append(copy(e.install[os])); }
      d.append(el('p', '', `${f.installed ? '1' : '2'}. Log in: ${e.loginHow}`)); d.append(copy(e.login));
    }
    box.append(d);
  }
  const eng = cfg?.engines || {}, name = (x) => ENGINES[x]?.name;
  if (eng.bella || eng.interstellar) box.append(el('p', 'gd-soft', `Bella will use ${name(eng.bella)}. Interstellar will use ${name(eng.interstellar)}.${eng.bella === eng.interstellar ? ' With one program, they share it.' : ''}`));
  const row = el('div', 'gd-row'), again = el('button', 'gd-btn', 'Check again'); again.type = 'button';
  const go = el('button', 'gd-btn primary', 'Continue'); go.type = 'button'; go.disabled = !engineWorks(found); go.onclick = () => feed({ type: 'engine-ok' });
  again.onclick = async () => { again.disabled = true; const r = await fetch('/api/engines').then(x => x.json()).catch(() => null); if (r) cfg.engines = r; shown = null; render(); };
  row.append(go, again); box.append(row);
  if (!engineWorks(found)) box.append(el('p', 'gd-soft', 'After installing, run the login command once, then press "Check again". Still "not found"? Restart Agent World.'));
  return box;
}
function notifyHelp() {
  const d = el('details', 'gd-help'); d.append(el('summary', '', 'No notification?'));
  const mac = el('p', '', 'Mac: open System Settings, Notifications, find "Script Editor" and allow notifications. Also check that Focus (Do Not Disturb) is off.');
  const win = el('p', '', 'Windows: open Settings, System, Notifications, turn notifications on, and allow "Windows PowerShell". Also check that Do not disturb is off.');
  const test = el('button', 'gd-btn', 'Send a test alert'); test.type = 'button'; const msg = el('p', 'gd-soft');
  test.onclick = async () => { const r = await post('/api/notify/test', {}).catch(() => ({ error: 'Could not reach the app.' })); msg.textContent = r.ok ? 'Sent. If nothing showed up, use the steps above.' : (r.error || 'Could not send it.'); };
  d.append(mac, win, test, msg); return d;
}
function targetEl() {
  const step = current(st); if (!step) return null;
  const sel = !onPage(step, page) ? goTarget().sel : step.target;
  const t = sel && document.querySelector(sel);
  return t && t.getClientRects().length ? /** @type {HTMLElement} */ (t) : null;
}
function place() {
  const step = current(st); if (!step) return;
  const t = targetEl(); let r = t ? t.getBoundingClientRect() : null;
  if (step.id === 'world' && onPage(step, page)) r = buildingSpot() || r;
  shade.hidden = !!r; ring.hidden = !r;
  const empty = document.getElementById('gdEmpty');               // "no sessions yet", only once the list has loaded
  if (empty) empty.hidden = !(/** @type {any} */ (window).__aw?.state?.snap) || hasSessions();
  if (r) { const pad = 6; Object.assign(ring.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' }); }
  card.classList.toggle('center', !r);
  card.classList.toggle('high', !!r && r.top + r.height / 2 > innerHeight / 2);   // phones: the sheet moves up when the target is low
  if (!r || matchMedia('(max-width:760px)').matches) { card.style.left = card.style.top = ''; return; }   // centered, or a bottom sheet on phones
  const cw = card.offsetWidth, ch = card.offsetHeight, m = 12;
  let top = r.bottom + m; if (top + ch > innerHeight - m) top = r.top - ch - m; if (top < m) top = Math.max(m, Math.min(innerHeight - ch - m, r.top + r.height / 2 - ch / 2));
  const big = r.width > innerWidth * 0.6 && r.height > innerHeight * 0.5;     // the whole world: put the card in a corner of it
  const left = big ? innerWidth - cw - 24 : Math.max(m, Math.min(innerWidth - cw - m, r.left + r.width / 2 - cw / 2));
  card.style.left = left + 'px'; card.style.top = (big ? 80 : top) + 'px';
}
(function loop() { if (current(st)) place(); requestAnimationFrame(loop); })();
addEventListener('resize', () => current(st) && place());

/* ---------- keyboard: Esc closes, Tab stays in the card (and the highlighted element) ---------- */
function quit() { set(close(st)); try { lastFocus?.focus(); } catch {} lastFocus = null; }
function onKey(e) {
  if (!current(st)) return;
  if (e.key === 'Escape' && !e.isComposing) { e.preventDefault(); e.stopPropagation(); quit(); return; }
  if (e.key !== 'Tab') return;
  const q = 'a[href], button:not([disabled]), input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';
  const t = targetEl(), inT = t ? (t.matches(q) ? [t] : [...t.querySelectorAll(q)]) : [];
  const list = [...inT, ...card.querySelectorAll(q)].filter(x => x.getClientRects().length && !x.closest('[hidden]'));
  if (!list.length) return;
  const i = list.indexOf(/** @type {HTMLElement} */ (document.activeElement));
  e.preventDefault();
  list[(i + (e.shiftKey ? -1 : 1) + list.length) % list.length].focus();
}

/* ---------- what happened on the page ---------- */
addEventListener('aw-guide', (/** @type {CustomEvent} */ e) => {
  const ev = e.detail || {}, step = current(st);
  if (ev.type === 'sent') { localRun = true; const w = document.getElementById('gdWrong'); if (w) w.hidden = ev.mode === 'readonly'; }
  if (ev.type === 'run-done') localRun = false;
  if (ev.type === 'status') {          // after a reload the page no longer follows the run: the session list tells us when it ended
    if (step?.id === 'wait' && st.runKey && !localRun) { const s = ev.sessions?.find(x => x.key === st.runKey); if (s && s.status !== 'working') feed({ type: 'run-done', key: st.runKey }); }
    return;
  }
  feed(ev);
});
function watchMode() { const m = document.getElementById('mode'); if (!m) return; const hit = () => feed({ type: 'mode-opened' }); m.addEventListener('pointerdown', hit); m.addEventListener('focus', hit); }

function resumeWait() {           // reloaded while waiting: check once whether that run already ended
  if (current(st)?.id !== 'wait' || !st.runKey) return;
  fetch('/api/snapshot').then(r => r.json()).then(snap => dispatchEvent(new CustomEvent('aw-guide', { detail: { type: 'status', sessions: snap.sessions } }))).catch(() => {});
}

function noEngineNote() {        // no AI program at all: say so on the page, guide or not
  if (cfg?.engines?.any !== false || document.getElementById('gdNoEngine')) return;
  const n = el('div', 'gd-noengine'); n.id = 'gdNoEngine'; n.setAttribute('role', 'status');
  n.append(el('b', '', 'No AI program found. '), document.createTextNode('Agent World runs Claude Code or Codex with your own subscription. Install one: '));
  for (const [id, href] of [['claude', ENGINES.claude.docs], ['codex', ENGINES.codex.docs]]) { const a = el('a', '', ENGINES[id].name); a.href = href; a.target = '_blank'; a.rel = 'noopener'; n.append(a, document.createTextNode(id === 'claude' ? ' or ' : '. Then press "? Guide".')); }
  document.body.append(n);
}

if (isTop) {
  document.head.append(css); mountButton(); if (page === 'chat') { watchMode(); resumeWait(); } render();
  fetch('/api/config').then(r => r.json()).then(c => { cfg = c; noEngineNote(); render(); }).catch(() => {});
}
