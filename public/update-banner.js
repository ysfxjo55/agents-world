// "A new version is ready" banner with Update now / Later. The server does the work (server/updater.js) and restarts;
// this page waits until the new version answers, then reloads.
const isTop = (() => { try { return window.self === window.top; } catch { return false; } })();
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const later = { get: () => { try { return localStorage.getItem('aw.updateLater'); } catch { return null; } }, set: (v) => { try { localStorage.setItem('aw.updateLater', v); } catch {} } };

const preview = new URLSearchParams(location.search).has('preview-update');   // ?preview-update: see the box with a pretend version; nothing is installed
async function show(when = 'open') {
  const u = await fetch('/api/update' + (preview ? '?preview=1' : `?check=${when}`)).then(r => r.json()).catch(() => null);
  if (when === 'now' && document.getElementById('awUpdate')) return u;
  if (!u?.available || (when !== 'now' && !u.preview && later.get() === u.latest) || document.getElementById('awUpdate')) return u;
  const box = el('div', 'aw-update'); box.id = 'awUpdate'; box.setAttribute('role', 'status');
  box.append(el('b', '', `A new version is ready (${u.latest}).`));
  if (u.notes?.length) { box.append(el('span', '', " What's new:")); const ul = el('ul'); for (const n of u.notes) ul.append(el('li', '', n)); box.append(ul); }
  const msg = el('p', 'aw-msg'), row = el('div', 'aw-row');
  const go = el('button', 'aw-go', 'Update now'), no = el('button', 'aw-later', 'Later'); go.type = no.type = 'button';
  no.onclick = () => { if (!u.preview) later.set(u.latest); box.remove(); };
  go.onclick = async () => {
    if (u.preview) { msg.textContent = 'This is a preview, nothing was installed.'; return; }
    go.disabled = no.disabled = true; msg.textContent = 'Updating... this can take a minute.';
    const r = await fetch('/api/update/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(x => x.json()).catch(() => null);
    if (!r?.ok) { msg.textContent = r?.error || 'The update did not work. Try again later.'; go.disabled = no.disabled = false; return; }
    msg.textContent = 'Updated. Restarting Agents World...';
    const t0 = Date.now(), wait = setInterval(async () => {   // the server restarts: reload once the new version answers
      const v = await fetch('/api/update').then(x => x.json()).catch(() => null);
      if (v && v.current === u.latest) { clearInterval(wait); location.reload(); }
      else if (Date.now() - t0 > 120_000) { clearInterval(wait); msg.textContent = 'It is taking long. Close Agents World and start it again.'; }
    }, 2000);
  };
  row.append(go, no); box.append(row, msg); document.body.append(box);
  return u;
}

/** "Check for updates" in the sidebar: look right away, then show the box or say you are up to date. */
export async function checkNow() {
  const u = await show('now');
  if (!u) alert('Could not check for updates. Is Agents World still running?');
  else if (u.enabled === false) alert('Update checks are turned off ("updates": {"check": false} in data/config.json).');
  else if (!u.available) alert(u.latest ? `You're on the newest version (${u.current}).` : `You have version ${u.current}. GitHub could not be reached, so I could not check.`);
}

if (isTop) {
  const css = el('style'); css.textContent = `.aw-update{position:fixed;right:16px;bottom:16px;z-index:8500;width:min(380px,calc(100vw - 32px));box-sizing:border-box;background:#1c1c21;color:#e8e8ee;border:1px solid #3a3a42;border-radius:12px;padding:12px 14px;font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.5)}
.aw-update ul{margin:6px 0 8px;padding-left:18px}.aw-row{display:flex;gap:8px;margin-top:6px}.aw-update button{border-radius:8px;padding:6px 12px;font:inherit;cursor:pointer;border:1px solid #44444d;background:#2c2c33;color:#e8e8ee}
.aw-update .aw-go{background:#e8e8ee;color:#151518;border-color:#e8e8ee;font-weight:600}.aw-update button:disabled{opacity:.6}.aw-msg{margin:6px 0 0;color:#a8a8b2}.aw-msg:empty{display:none}`;
  document.head.append(css);
  show(); setInterval(() => show(), 3600_000);
}
