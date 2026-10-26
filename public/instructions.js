// The "Instructions" panel on the Chat page: Bella's and Interstellar's instructions, and a few lines about you.
// It edits the same files the agents read (see server/instructions.js); changes apply to the next new chat.
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
const TABS = {
  bella: { label: 'Bella', help: 'Bella\'s instructions: who she is, how she talks, her rules. Keep the first lines (--- name: bella ---) as they are.' },
  interstellar: { label: 'Interstellar', help: 'Interstellar\'s instructions: who he is, how he works, his rules.' },
  about: { label: 'About me', help: 'A few lines about you that every agent should know: your level, your language, how you like answers. No passwords or private numbers.' },
};

let box = null, lastFocus = null, dirty = () => false;
export async function openInstructions() {
  if (box) return;
  const data = await fetch('/api/instructions').then(r => r.json()).catch(() => null);
  if (!data || data.error) { alert(data?.error || 'Could not load the instructions.'); return; }
  lastFocus = document.activeElement;
  box = el('div', 'ins-shade'); const card = el('div', 'ins-card'); card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true'); card.setAttribute('aria-label', 'Instructions');
  const top = el('div', 'ins-top'); top.append(el('h2', '', 'Instructions'));
  const x = el('button', 'ins-x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Close'); x.onclick = close; top.append(x);
  const tabs = el('div', 'ins-tabs'); tabs.setAttribute('role', 'tablist');
  const help = el('p', 'ins-help'), ta = el('textarea', 'ins-text'), msg = el('p', 'ins-msg');
  ta.setAttribute('aria-label', 'Instructions text'); ta.spellcheck = false;
  const row = el('div', 'ins-row'), save = el('button', 'ins-save', 'Save'), reset = el('button', 'ins-reset', 'Reset to default');
  save.type = reset.type = 'button';
  let cur = null, saved = {};
  const names = ['bella', 'interstellar', 'about'].filter(n => n === 'about' || data.shown?.[n]);
  const show = (n) => {
    if (cur && ta.value !== saved[cur] && !confirm('You have unsaved changes. Leave them?')) return;
    cur = n; ta.value = saved[n] = data[n] || ''; help.textContent = TABS[n].help; msg.textContent = '';
    ta.rows = n === 'about' ? 6 : 18; for (const b of tabs.children) b.setAttribute('aria-selected', String(b.dataset.n === n));
  };
  for (const n of names) { const b = el('button', 'ins-tab', TABS[n].label); b.type = 'button'; b.dataset.n = n; b.setAttribute('role', 'tab'); b.onclick = () => show(n); tabs.append(b); }
  save.onclick = async () => {
    const r = await post('/api/instructions', { name: cur, text: ta.value }).catch(() => ({ error: 'Could not reach the app.' }));
    if (r.ok) { data[cur] = saved[cur] = ta.value; msg.textContent = 'Saved. It applies to your next new chat.'; } else msg.textContent = r.error;
  };
  reset.onclick = async () => {
    if (!confirm(cur === 'about' ? 'Clear the lines about you?' : `Put back the original ${TABS[cur].label} instructions? Your changes are lost.`)) return;
    const r = await post('/api/instructions/reset', { name: cur }).catch(() => ({ error: 'Could not reach the app.' }));
    if (r.ok) { ta.value = data[cur] = saved[cur] = r.text; msg.textContent = 'Back to the default. It applies to your next new chat.'; } else msg.textContent = r.error;
  };
  row.append(save, reset); card.append(top, tabs, help, ta, row, msg); box.append(card); document.body.append(box);
  box.addEventListener('keydown', onKey); box.addEventListener('mousedown', (e) => { if (e.target === box) close(); });
  dirty = () => !!cur && ta.value !== saved[cur];
  show(names[0]); ta.focus();
}
function close() {
  if (dirty() && !confirm('Close without saving?')) return;
  box?.remove(); box = null; try { lastFocus?.focus(); } catch {}
}
function onKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); close(); return; }
  if (e.key !== 'Tab') return;   // keep the keyboard inside the panel
  const list = [...box.querySelectorAll('button, textarea')]; const i = list.indexOf(document.activeElement);
  e.preventDefault(); list[(i + (e.shiftKey ? -1 : 1) + list.length) % list.length].focus();
}
