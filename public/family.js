import { md } from './md.js';
import { icon } from './icons.js';

const $ = id => document.getElementById(id);
const names = { owner: 'You', bella: 'Bella', interstellar: 'Interstellar' };
let busy = false, hasHistory = false, streaming = false, attach = [];
const live = new Map();
function message(from, text, images = []) {
  const node = document.createElement('article'); node.className = 'message ' + from;
  const name = document.createElement('div'); name.className = 'name';
  if (from !== 'owner') name.innerHTML = icon(from === 'bella' ? 'crown' : 'interstellar', 18);
  name.append(names[from]);
  const bubble = document.createElement('div'); bubble.className = 'bubble'; bubble.dir = 'auto';
  if (images.length) { const thumbs = document.createElement('div'); thumbs.className = 'thumbs'; for (const id of images) { const img = document.createElement('img'); img.src = '/api/upload/' + encodeURIComponent(id); img.alt = 'attached image'; img.onerror = () => img.remove(); thumbs.append(img); } bubble.append(thumbs); }   // uploads are deleted after 7 days
  if (from === 'owner') bubble.append(text); else bubble.insertAdjacentHTML('beforeend', md(text));
  node.append(name, bubble); $('thread').append(node); return node;
}
function bottom() { $('scroll').scrollTop = $('scroll').scrollHeight; }
function setBusy(value) {
  busy = value;
  for (const id of ['send', 'other', 'discuss']) $(id).disabled = value || (id !== 'send' && !hasHistory);
  $('mode').disabled = value || $('mode').dataset.remote === '1'; $('stop').disabled = !value;
}
async function history() {
  const r = await fetch('/api/family/history?limit=800');
  if (!r.ok) throw new Error('Could not load family history.');
  const data = await r.json();
  $('thread').replaceChildren(); live.clear();
  for (const m of data.messages) message(m.from, m.text, m.images);
  hasHistory = data.messages.some(m => m.from === 'owner'); setBusy(data.busy); bottom();
  return data.busy;
}
function event(ev) {
  if (ev.t === 'message') { message(ev.message.from, ev.message.text, ev.message.images); hasHistory = true; }
  if (ev.t === 'status') $(ev.speaker + 'Status').textContent = ev.text;
  if (ev.t === 'blocks' || ev.t === 'delta') {
    let state = live.get(ev.speaker);
    if (!state) { state = { node: message(ev.speaker, ''), parts: new Map() }; live.set(ev.speaker, state); }
    if (ev.t === 'blocks') state.parts.set(ev.id, ev.blocks.filter(b => b.type === 'text').map(b => b.text).join('\n'));
    else state.parts.set(ev.id, (state.parts.get(ev.id) || '') + ev.text);
    const text = [...state.parts.values()].join('\n\n');
    state.node.hidden = 'PASS'.startsWith(text.trim());
    state.node.querySelector('.bubble').innerHTML = md(text);
  }
  if (ev.t === 'done' && ev.speaker) {
    const state = live.get(ev.speaker); state?.node.remove(); live.delete(ev.speaker);
    if (ev.message) message(ev.speaker, ev.message.text);
    if (!ev.ok) $('notice').textContent = ev.error || 'The turn could not finish.';
    if (ev.denied?.length) $('notice').textContent = 'Some tools were blocked by the selected access mode.';
    if (ev.pass) { const note = document.createElement('p'); note.className = 'note'; note.textContent = names[ev.speaker] + ' had nothing to add'; $('thread').append(note); }
    $(ev.speaker + 'Status').textContent = '';
  }
  if (ev.t === 'error') $('notice').textContent = ev.text;
  if (ev.final) { $('usage').textContent = `This exchange: ${ev.usage.claude} Claude turns · ${ev.usage.codex} Codex turns`; if (ev.stopped) $('notice').textContent = 'Stopped.'; }
  bottom();
}
async function send(action) {
  if (busy) return;
  const text = $('input').value.trim(); if (action === 'send' && !text && !attach.length) return;
  streaming = true; setBusy(true); $('notice').textContent = '';
  try {
    const images = action === 'send' ? await Promise.all(attach.map(a => fetch('/api/upload', { method: 'POST', body: a.file }).then(r => r.json()).then(j => { if (j.kind !== 'image') throw new Error(j.error || 'Could not upload the image.'); return j.id; }))) : [];
    const r = await fetch('/api/family/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, action, mode: $('mode').value, images }) });
    if (!r.ok) throw new Error((await r.json()).error || 'Could not send.');
    if (action === 'send') { $('input').value = ''; attach = []; renderAttach(); }
    $('mentions').hidden = true;
    const reader = r.body.getReader(), decoder = new TextDecoder(); let buffer = '';
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      buffer += decoder.decode(value, { stream: true }); let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) { const line = buffer.slice(0, end); buffer = buffer.slice(end + 2); if (line.startsWith('data: ')) event(JSON.parse(line.slice(6))); }
    }
  } catch (e) { $('notice').textContent = e.message; }
  finally { streaming = false; setBusy(false); $('bellaStatus').textContent = ''; $('interstellarStatus').textContent = ''; }
}
$('composer').onsubmit = e => { e.preventDefault(); send('send'); };
$('other').onclick = () => send('other');
$('discuss').onclick = () => send('discuss');
$('stop').onclick = async () => { try { await fetch('/api/family/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); } catch { $('notice').textContent = 'Could not stop. Try again.'; } };
$('mode').onchange = () => { if ($('mode').value === 'full' && !confirm('Full access lets both partners run commands and change files without asking. Allow full access?')) $('mode').value = 'readonly'; };
$('input').oninput = () => { $('mentions').hidden = !/@[a-z]*$/i.test($('input').value.slice(0, $('input').selectionStart)); };
for (const button of document.querySelectorAll('[data-mention]')) button.onclick = () => {
  const input = $('input'), pos = input.selectionStart, prefix = input.value.slice(0, pos).replace(/@[a-z]*$/i, '@' + button.dataset.mention + ' ');
  input.value = prefix + input.value.slice(pos); input.focus(); input.setSelectionRange(prefix.length, prefix.length); $('mentions').hidden = true;
};
$('input').onkeydown = e => { if (e.key === 'Escape') $('mentions').hidden = true; if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !matchMedia('(pointer: coarse)').matches) { e.preventDefault(); send('send'); } };
// Images: pick, paste or drop, up to 4 per message.
function renderAttach() {
  const box = $('attach'); box.replaceChildren(); box.hidden = !attach.length;
  attach.forEach((a, i) => {
    const chip = document.createElement('div'); chip.className = 'achip';
    const img = document.createElement('img'); img.src = a.url; img.alt = 'attached image';
    const x = document.createElement('button'); x.type = 'button'; x.title = 'Remove'; x.textContent = '×'; x.onclick = () => { attach.splice(i, 1); renderAttach(); };
    chip.append(img, x); box.append(chip);
  });
}
function addFiles(files) {
  for (const f of files) {
    if (!/^image\/(png|jpeg|gif|webp)$/.test(f.type)) { $('notice').textContent = 'Only images (PNG, JPEG, GIF, WebP) can be sent here.'; continue; }
    if (f.size > 12 * 1024 * 1024) { $('notice').textContent = 'That image is too large (max 12 MB).'; continue; }
    if (attach.length >= 4) { $('notice').textContent = 'Up to 4 images per message.'; break; }
    const a = { file: f, url: '' }; attach.push(a);
    const reader = new FileReader(); reader.onload = () => { a.url = reader.result; renderAttach(); }; reader.readAsDataURL(f);   // the page's security policy allows data: images, not blob:
  }
  renderAttach(); $('input').focus();
}
$('attachBtn').innerHTML = icon('attach', 18);
$('attachBtn').onclick = () => $('file').click();
$('file').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
$('input').addEventListener('paste', e => { const imgs = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/')); if (imgs.length) { e.preventDefault(); addFiles(imgs); } });
$('composer').addEventListener('dragover', e => e.preventDefault());
$('composer').addEventListener('drop', e => { e.preventDefault(); addFiles(e.dataTransfer?.files || []); });
async function init() {
  try {
    const r = await fetch('/api/config'); if (!r.ok) throw new Error('Could not load access settings.');
    const config = await r.json();
    if (config.remote) { $('mode').value = 'readonly'; $('mode').dataset.remote = '1'; }
    await history();
  } catch (e) { $('notice').textContent = e.message; }
}
setBusy(true); init();
// Reopening the page follows a background exchange without starting another turn.
setInterval(async () => { if (busy && !streaming) { try { await history(); } catch {} } }, 4000);
