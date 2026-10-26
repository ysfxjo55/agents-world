import { md } from './md.js';
import { icon } from './icons.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const S = { depth: 'deep', files: [], jobs: [], remote: false, openId: null, busy: false, openPlans: new Set(), cards: new Map() };
$('logo').innerHTML = icon('research', 26);

/* ---------- helpers ---------- */
const getJSON = (u) => fetch(u).then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `Error ${r.status}`); return j; });
const post = (u, body) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `Error ${r.status}`); return j; });
const dur = (ms) => { ms = Math.max(0, ms); const m = Math.round(ms / 60000), h = Math.floor(m / 60); return h ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`; };
const when = (t) => new Date(t).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
const say = (t, err) => { const m = $('msg'); m.textContent = t || ''; m.className = err ? 'err' : ''; };

/* ---------- the form ---------- */
document.querySelectorAll('#depth button').forEach(b => b.onclick = () => { S.depth = b.dataset.d; document.querySelectorAll('#depth button').forEach(x => x.classList.toggle('on', x === b)); $('hours').value = { standard: '3', deep: '10', exhaustive: '16' }[S.depth]; });
function addFiles(list) {
  for (const f of list) {
    if (S.files.length >= 5) { say('Up to 5 files.', true); break; }
    if (!/\.(pdf|txt|md)$/i.test(f.name)) { say(`${f.name}: only PDF or text files.`, true); continue; }
    if (f.size > 25 * 1024 * 1024) { say(`${f.name} is larger than 25 MB.`, true); continue; }
    S.files.push(f);
  }
  renderChips();
}
function renderChips() {
  const box = $('chips'); box.replaceChildren();
  S.files.forEach((f, i) => { const c = el('span', 'chip', `${f.name} (${Math.max(1, Math.round(f.size / 1024))} KB)`); const x = el('button', '', '×'); x.type = 'button'; x.title = 'Remove'; x.onclick = () => { S.files.splice(i, 1); renderChips(); }; c.append(x); box.append(c); });
}
$('pick').onclick = () => $('files').click();
$('files').onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };
const drop = $('drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles(e.dataTransfer?.files || []); });

$('start').onclick = async () => {
  const topic = $('topic').value.trim();
  if (topic.length < 10) { say('Describe what to research (at least a sentence).', true); return; }
  S.busy = true; $('start').disabled = true; say('Uploading…');
  try {
    const docs = [];
    for (const f of S.files) { const r = await fetch('/api/upload-doc', { method: 'POST', body: f }); const j = await r.json(); if (!r.ok) throw new Error(`${f.name}: ${j.error}`); docs.push({ id: j.id, name: f.name }); }
    const j = await post('/api/research/start', { topic, depth: S.depth, maxHours: Number($('hours').value), docs });
    $('topic').value = ''; S.files = []; renderChips();
    say('Started. You can close this page and lock the screen. Keep the lid open and the charger plugged in.'); await refresh();
    document.getElementById('jobs').scrollIntoView({ behavior: 'smooth' }); S.lastStarted = j.id;
  } catch (e) { say(e.message, true); }
  S.busy = false; $('start').disabled = S.remote;
};

/* ---------- power ---------- */
function renderPower(p) {
  const box = $('power'); box.className = 'power';
  if (!p || p.onAC === null) { box.textContent = 'Could not read the power status. Make sure the charger is plugged in.'; return; }
  if (p.onAC) { box.classList.add('ok'); box.textContent = `Plugged in${p.percent != null ? ` (${p.percent}%)` : ''}. Good for an overnight run.`; }
  else { box.classList.add('bad'); box.textContent = `On battery${p.percent != null ? ` (${p.percent}%)` : ''}. Plug in the charger before you sleep, or the battery may run out and stop the research.`; }
}

/* ---------- job cards ---------- */
function chipFor(j) {
  const waiting = j.phases.some(p => p.status === 'waiting');
  if (j.status === 'done') return ['done', 'Done'];
  if (j.status === 'error') return ['error', 'Problem'];
  if (j.status === 'stopped') return ['stopped', 'Stopped'];
  if (!j.alive) return ['stopped', 'Interrupted'];
  return waiting ? ['waiting', 'Waiting for limit'] : ['running', 'Researching'];
}
function jobCard(j) {
  const card = el('div', 'job'), head = el('div', 'head'), left = el('div');
  left.append(el('div', 'title', j.topic.length > 160 ? j.topic.slice(0, 160) + '…' : j.topic));
  const end = j.finishedAt || Date.now(), spent = j.startedAt ? dur(end - j.startedAt) : '0m';
  left.append(el('div', 'sub', `${j.depth[0].toUpperCase() + j.depth.slice(1)} · started ${j.startedAt ? when(j.startedAt) : 'just now'} · ${j.status === 'done' ? 'took' : 'running for'} ${spent}${j.status === 'running' && j.deadline ? ` · stops at most at ${when(j.deadline)}` : ''}`));
  const [cls, label] = chipFor(j); head.append(left, el('span', `status ${cls}`, label)); card.append(head);

  const bar = el('div', 'bar'); for (const p of j.phases) { const i = el('i', p.status); i.title = `${p.title} (${p.status})`; bar.append(i); }
  if (!j.phases.length) bar.append(el('i', 'running'));
  card.append(bar);
  const stats = el('div', 'stats'); for (const [n, v] of [['searches', j.stats?.searches || 0], ['pages read', j.stats?.pages || 0], ['repo lookups', j.stats?.repos || 0]]) { const s = el('span'); s.append(el('b', '', String(v)), ` ${n}`); stats.append(s); }
  const doneQ = j.phases.filter(p => p.key.startsWith('q-') && p.status === 'done').length;
  if (j.plan.length) { const s = el('span'); s.append(el('b', '', `${doneQ}/${j.plan.length}`), ' sub-questions done'); stats.append(s); }
  card.append(stats);
  if (j.status === 'running' && j.alive && j.lastTool) card.append(el('div', 'last', `${j.lastTool}`));
  const waiting = j.phases.find(p => p.status === 'waiting'); if (waiting) card.append(el('div', 'warn', `${waiting.note || 'Waiting.'} It carries on by itself.`));
  if (j.error) card.append(el('div', 'warn', j.error));
  for (const w of j.warnings) card.append(el('div', 'warn', w));
  if (j.plan.length) { const d = el('details'); d.open = S.openPlans.has(j.id); d.ontoggle = () => { d.open ? S.openPlans.add(j.id) : S.openPlans.delete(j.id); }; d.append(el('summary', '', `The plan: ${j.plan.length} sub-questions`)); const ol = el('ol'); ol.style.cssText = 'color:var(--muted);font-size:13.5px;margin:6px 0 0'; for (const q of j.plan) { const ph = j.phases.find(p => p.key === `q-${q.id}`); ol.append(el('li', '', `${q.title}${ph ? ` (${ph.status})` : ''}`)); } d.append(ol); card.append(d); }

  const btns = el('div', 'jbtns');
  if (j.status === 'done') { const b = el('button', 'primary', 'Open the report'); b.onclick = () => openReport(j.id); btns.append(b); }
  if (!S.remote) {
    if (j.status === 'running') { const b = el('button', 'ghost', j.alive ? 'Stop' : 'Stop (not running)'); b.onclick = async () => { if (confirm('Stop this research? Your notes so far are kept, and you can resume it later.')) { await post(`/api/research/${j.id}/stop`).catch(e => alert(e.message)); refresh(); } }; btns.append(b); }
    if (j.status !== 'done' && !(j.status === 'running' && j.alive)) { const b = el('button', 'ghost', 'Resume'); b.onclick = async () => { await post(`/api/research/${j.id}/resume`).catch(e => alert(e.message)); refresh(); }; btns.append(b); }
  }
  if (j.status !== 'done' && j.phases.some(p => p.key === 'report' && p.status === 'done')) { const b = el('button', 'ghost', 'Open the report so far'); b.onclick = () => openReport(j.id); btns.append(b); }
  card.append(btns); return card;
}
function renderJobs() {
  const box = $('jobs'); box.replaceChildren();
  if (!S.jobs.length) { box.append(el('div', 'empty', 'No research yet. Your first one will show up here, with live progress.')); return; }
  const card = (j) => {                                              // a card is rebuilt only when something in it changed (so open sections stay open)
    const sig = JSON.stringify([j.status, j.alive, j.stats, j.lastTool, j.error, j.warnings, j.plan.length, j.phases.map(p => [p.status, p.attempts, p.tools, p.note]), Math.floor(Date.now() / 60000), S.remote]);
    const old = S.cards.get(j.id); if (old && old.sig === sig) return old.el;
    const e = jobCard(j); S.cards.set(j.id, { sig, el: e }); return e;
  };
  for (const k of [...S.cards.keys()]) if (!S.jobs.some(j => j.id === k)) S.cards.delete(k);
  const active = S.jobs.filter(j => j.status !== 'done'), done = S.jobs.filter(j => j.status === 'done');
  if (active.length) { box.append(el('h3', '', 'In progress')); active.forEach(j => box.append(card(j))); }
  if (done.length) { box.append(el('h3', '', 'Finished reports')); done.forEach(j => box.append(card(j))); }
}

/* ---------- the report ---------- */
function decorate(art, job) {
  const p1 = art.querySelector('h1 + p');
  if (p1 && /^Prepared for/i.test(p1.textContent)) { const parts = p1.textContent.split('·').map(s => s.trim()).filter(Boolean); p1.replaceChildren(); p1.className = 'meta'; parts.forEach(t => p1.append(el('span', '', t))); }
  const bq = art.querySelector('blockquote'); if (bq && /^\s*Note:/i.test(bq.textContent)) bq.classList.add('caution');
  const KINDS = ['high', 'medium', 'low', 'official', 'press', 'repo', 'paper', 'forum', 'vendor'];
  art.querySelectorAll('td').forEach(td => { const t = td.textContent.trim().toLowerCase().replace(/[^a-z]/g, ''); if (KINDS.includes(t)) { const label = td.textContent.trim(); td.replaceChildren(el('span', `badge ${t}`, label)); } });
  const src = art.querySelector('h2#r-sources');
  if (src) for (let n = src.nextElementSibling; n && n.tagName !== 'H2'; n = n.nextElementSibling) if (n.tagName === 'TABLE') n.querySelectorAll('tbody tr').forEach(tr => { const num = (tr.cells[0]?.textContent || '').replace(/\D/g, ''); if (num) tr.id = `src-${num}`; });
  const c = art.querySelector('h2#r-short-conclusion');
  if (c) { const box = el('div', 'conclusion'); c.before(box); box.append(c); while (box.nextElementSibling && box.nextElementSibling.tagName !== 'H2') box.append(box.nextElementSibling); }
  if (job.review) { const d = el('div', 'reviewbox'), det = el('details'); det.append(el('summary', '', 'How this report was checked')); const inner = el('div'); inner.innerHTML = md(job.review, { ids: false }); det.append(inner); d.append(det); art.append(d); }
}
function buildToc(art) {
  const toc = $('toc'); toc.replaceChildren();
  art.querySelectorAll('h2').forEach(h => { const a = el('a', '', h.textContent); a.href = `#${h.id}`; toc.append(a); });
}
function flashTo(id) { const t = document.getElementById(id); if (!t) return; t.scrollIntoView({ behavior: 'smooth', block: 'center' }); t.style.transition = 'background .3s'; const old = t.style.background; t.style.background = '#fff3c4'; setTimeout(() => { t.style.background = old; }, 1600); }
document.addEventListener('click', (e) => { const a = e.target.closest('#report a[href^="#"], #toc a[href^="#"]'); if (a) { e.preventDefault(); flashTo(a.getAttribute('href').slice(1)); } });

async function openReport(id) {
  let job; try { job = await getJSON(`/api/research/${id}`); } catch (e) { alert(e.message); return; }
  if (!job.report) { alert('No report yet.'); return; }
  S.openId = id; history.replaceState(null, '', `#job=${id}`);
  $('listView').hidden = true; $('reportView').hidden = false; $('backBtn').hidden = false;
  const art = $('report'); art.innerHTML = md(job.report, { ids: true }); decorate(art, job); buildToc(art);
  const bar = $('reportBar'); bar.replaceChildren();
  bar.append(el('span', 'sub', `${job.depth[0].toUpperCase() + job.depth.slice(1)} research · ${job.stats?.searches || 0} searches · ${job.stats?.pages || 0} pages read`));
  const act = el('div'); act.style.cssText = 'display:flex;gap:8px';
  const pr = el('button', 'ghost', 'Print or save as PDF'); pr.onclick = () => window.print();
  const dl = el('button', 'ghost', 'Download .md'); dl.onclick = () => { const a = el('a'); a.href = URL.createObjectURL(new Blob([job.report], { type: 'text/markdown' })); a.download = `research-${job.id}.md`; a.click(); URL.revokeObjectURL(a.href); };
  act.append(pr, dl); bar.append(act); window.scrollTo(0, 0);
}
$('backBtn').onclick = () => { S.openId = null; history.replaceState(null, '', location.pathname); $('reportView').hidden = true; $('listView').hidden = false; $('backBtn').hidden = true; };

/* ---------- live refresh ---------- */
async function refresh() {
  try { const j = await getJSON('/api/research'); S.jobs = j.jobs; renderPower(j.power); if ($('reportView').hidden) renderJobs(); } catch { /* server restarting */ }
}
(async function init() {
  try { const c = await getJSON('/api/config'); S.remote = !!c.remote; } catch { /* ok */ }
  if (S.remote) { $('remoteNote').hidden = false; $('start').disabled = true; $('topic').disabled = true; $('pick').disabled = true; }
  await refresh(); setInterval(refresh, 5000);
  const m = location.hash.match(/job=([\w-]+)/); if (m) openReport(m[1]);
})();
