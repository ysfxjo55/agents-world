/* board-clean.js: cleans what the board reads from data/board before it is shown.
   The board's files can be edited by hand or by an agent, so nothing in them is trusted: ids may only use letters,
   digits, "_" and "-", colours must be #hex, numbers must be numbers and dates must look like dates. Text (titles,
   notes, names) stays text and is escaped where it is shown. A bad value is replaced, never put into the page. */
(function (root) {
  const ID = /^[\w-]{1,80}$/, COLOR = /^#[0-9a-fA-F]{3,8}$/, DATE = /^\d{4}-\d{2}-\d{2}$/;
  const STATUS = ['later', 'todo', 'doing', 'done'];
  const str = (v, max = 20000) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
  const num = (v) => (Number.isFinite(+v) ? +v : 0);
  const id = (v, fallback) => (typeof v === 'string' && ID.test(v) ? v : fallback);
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

  function cfg(c) {
    c = obj(c);
    const areas = (Array.isArray(c.areas) ? c.areas : []).map(obj).filter(a => ID.test(String(a.id)))
      .map(a => ({ ...a, id: a.id, name: str(a.name, 80) || a.id, color: COLOR.test(String(a.color)) ? a.color : '#8C93A3' }));
    const habits = (Array.isArray(c.habits) ? c.habits : []).map(obj).filter(h => ID.test(String(h.id)))
      .map(h => ({ ...h, name: str(h.name, 200), target: str(h.target, 80), area: id(h.area, 'personal'), perWeek: Math.max(0, Math.min(7, num(h.perWeek))),
        days: (Array.isArray(h.days) ? h.days : []).map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6) }));
    return { ...c, areas, habits };
  }
  function task(t) {
    t = obj(t);
    return { ...t, title: str(t.title, 500), notes: str(t.notes), area: id(t.area, 'personal'), status: STATUS.includes(t.status) ? t.status : 'todo',
      due: DATE.test(String(t.due)) ? t.due : '', doneAt: t.doneAt == null ? null : num(t.doneAt),
      steps: (Array.isArray(t.steps) ? t.steps : []).map(obj).map(s => ({ ...s, t: str(s.t, 500), d: !!s.d })) };
  }
  function day(d) {
    d = obj(d);
    const habits = {}; for (const [k, v] of Object.entries(obj(d.habits))) if (ID.test(k)) habits[k] = !!v;
    return { ...d, date: DATE.test(String(d.date)) ? d.date : '', habits, note: str(d.note),
      sessions: (Array.isArray(d.sessions) ? d.sessions : []).map(obj).map(s => ({ ...s, title: str(s.title, 300), notes: str(s.notes), min: Math.max(0, num(s.min)), area: id(s.area, 'personal') })),
      carry: (Array.isArray(d.carry) ? d.carry : []).map(obj).map(c => ({ ...c, t: str(c.t, 500), done: !!c.done })) };
  }
  root.BoardClean = { cfg, task, day, ID, COLOR };
})(typeof window !== 'undefined' ? window : globalThis);
