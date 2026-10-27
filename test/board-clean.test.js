import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Load the page's cleaner exactly as the browser does (a plain script that sets BoardClean).
const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL('../public/board-clean.js', import.meta.url), 'utf8'), ctx);
const B = ctx.BoardClean, plain = (f) => (v) => JSON.parse(JSON.stringify(f(v)));   // values from the page's own context, compared as plain data
const cfg = plain(B.cfg), task = plain(B.task), day = plain(B.day);
const IMG = '<img src=x onerror=alert(1)>', SCRIPT = '<script>alert(1)</script>', QUOTE = '"><b x=\'y\'>';

test('board files cannot inject HTML through ids, colours, numbers or dates', () => {
  const c = cfg({ areas: [{ id: 'work', name: IMG, color: `red;" onmouseover="alert(1)` }, { id: `x" onclick="alert(1)`, name: 'evil', color: '#fff' }],
    habits: [{ id: QUOTE, name: 'h' }, { id: 'h1', name: SCRIPT, area: IMG, perWeek: '9; alert(1)', days: [1, 'x', 9] }] });
  assert.deepEqual(c.areas.map(a => [a.id, a.color]), [['work', '#8C93A3']]);      // the unsafe id is dropped, the unsafe colour replaced
  assert.equal(c.areas[0].name, IMG);                                             // text stays text: it is escaped where it is shown
  assert.deepEqual(c.habits.map(h => [h.id, h.area, h.perWeek, h.days]), [['h1', 'personal', 0, [1]]]);

  const t = task({ title: SCRIPT, notes: QUOTE, area: IMG, status: 'doing"><x', due: '2026-10-27"><img', steps: [{ t: IMG, d: 'yes' }], doneAt: 'soon' });
  assert.deepEqual([t.area, t.status, t.due, t.doneAt, t.steps[0].d], ['personal', 'todo', '', 0, true]);
  assert.equal(t.title, SCRIPT);

  const d = day({ date: '"><img', habits: { [QUOTE]: true, h1: 1 }, sessions: [{ title: IMG, min: '60"><img', area: SCRIPT }], carry: [{ t: QUOTE }], note: IMG });
  assert.deepEqual([d.date, Object.keys(d.habits), d.sessions[0].min, d.sessions[0].area], ['', ['h1'], 0, 'personal']);
  assert.deepEqual(cfg(null), { areas: [], habits: [] });
});

test('every user-written field the board shows goes through esc()', () => {
  const html = fs.readFileSync(new URL('../public/board.html', import.meta.url), 'utf8');
  const fields = /\$\{\s*[\w.]+\.(title|notes|name|note|target|t)\s*\}/g;            // e.g. ${t.title} written straight into the page
  // the reminder builds plain text first (text=`...`) and escapes it on the next line with esc(text)
  const bad = html.split('\n').filter(l => { fields.lastIndex = 0; return fields.test(l) && !/\btext=/.test(l); });
  assert.ok(html.includes('<p>${esc(text)}</p>'));
  assert.deepEqual(bad, []);
  assert.match(html, /<script src="board-clean\.js"><\/script>/);
  for (const use of ['BoardClean.task(', 'BoardClean.cfg(', 'BoardClean.day(']) assert.ok(html.includes(use), use);
});
