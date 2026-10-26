// A tiny, safe markdown renderer used by the chat page and the research reports.
// Everything is HTML-escaped FIRST, then formatted; links may only be http(s) or a same-page #anchor.
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// heading ids are prefixed (they can never collide with page ids like "toc" or "report") and made unique
const uniqueId = (t, used) => { const base = 'r-' + (slug(t) || 'section'); let id = base, n = 2; while (used.has(id)) id = `${base}-${n++}`; used.add(id); return id; };
export const slug = (t) => String(t).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60);
function inline(t) {
  t = esc(t);
  t = t.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  t = t.replace(/\[([^\]\n]+)\]\((https?:\/\/(?:[^\s()]|\([^\s()]*\))+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\[([^\]\n]+)\]\((#[\w-]{1,60})\)/g, '<a href="$2">$1</a>');   // same-page anchors, e.g. [1](#src-1)
  return t;
}
export function md(src, opts = {}) {
  src = String(src).replace(/\uE000/g, '');                          // our own placeholder character must never come from the text
  const used = new Set();
  if ((src.match(/```/g) || []).length % 2) src += '\n```';              // close a fence still streaming in
  const codes = [];
  src = src.replace(/```([\w+-]*)\n?([\s\S]*?)```/g, (_, lang, code) => { codes.push({ lang, code: code.replace(/\n$/, '') }); return `\uE000${codes.length - 1}\uE000`; });
  const lines = src.split('\n'), out = []; let i = 0;
  const para = [];
  const flush = () => { if (para.length) { out.push(`<p dir="auto">${inline(para.join('\n')).replace(/\n/g, '<br>')}</p>`); para.length = 0; } };
  while (i < lines.length) {
    const l = lines[i];
    let m;
    if (!l.trim()) { flush(); i++; continue; }
    if ((m = l.match(/^\uE000(\d+)\uE000$/))) { flush(); out.push(`\uE000${m[1]}\uE000`); i++; continue; }
    if ((m = l.match(/^(#{1,3})\s+(.*)$/))) { flush(); out.push(`<h${m[1].length}${opts.ids ? ` id="${uniqueId(m[2], used)}"` : ''} dir="auto">${inline(m[2])}</h${m[1].length}>`); i++; continue; }
    if (/^\s*([-*_])\1{2,}\s*$/.test(l)) { flush(); out.push('<hr>'); i++; continue; }
    if (/^\s*>/.test(l)) { flush(); const q = []; while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, '')); out.push(`<blockquote dir="auto">${inline(q.join('\n')).replace(/\n/g, '<br>')}</blockquote>`); continue; }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(l)) {
      flush(); const ord = /^\s*\d+[.)]/.test(l), items = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*+]|\d+[.)])\s+/, ''));
      out.push(`<${ord ? 'ol' : 'ul'}>${items.map(x => `<li dir="auto">${inline(x)}</li>`).join('')}</${ord ? 'ol' : 'ul'}>`); continue;
    }
    if (/^\s*\|.*\|\s*$/.test(l) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
      flush(); const rows = []; while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(lines[i++]);
      const cells = (r) => r.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(c => inline(c.trim().replace(/\\\|/g, '|')));
      const head = cells(rows[0]), body = rows.slice(2).map(cells);
      out.push(`<table><thead><tr>${head.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${body.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`); continue;
    }
    para.push(l); i++;
  }
  flush();
  return out.join('').replace(/\uE000(\d+)\uE000/g, (_, n) => { const c = codes[+n]; return `<pre><button class="copy" data-copy>Copy</button><code>${esc(c.code)}</code></pre>`; });
}

