// Pure helpers for the Today screen: no DOM, no fetch. Dates are local "YYYY-MM-DD" strings.
const parse = (s) => new Date(s + 'T00:00:00');
const iso = (d) => { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };

// today as the user's local date (never UTC)
export function localDateString(date = new Date()) { return iso(date); }

// habits that apply on a date: perWeek habits every day, otherwise only on their weekdays (0 = Sunday)
export function habitsDueOn(habits, dateString) {
  const dow = parse(dateString).getDay();
  return (habits || []).filter(h => h.perWeek || (h.days || []).includes(dow));
}

// how many times this week (week starts Sunday) up to and including dateString
export function weekCount(habit, daysByDate, dateString) {
  const start = addDays(dateString, -parse(dateString).getDay());
  let n = 0;
  for (let i = 0; i < 7; i++) {
    const x = addDays(start, i);
    if (x > dateString) break;                       // only count the week so far
    const day = daysByDate[x];
    if (day && day.habits && day.habits[habit.id]) n++;
  }
  return n;
}

// tasks grouped for today, each task in exactly one group: overdue, then due today, then other work in progress
export function groupTasks(tasks, todayString) {
  const overdue = [], dueToday = [], inProgress = [];
  for (const t of tasks || []) {
    const d = t.data || t;
    if (d.status === 'done') continue;
    if (d.due && d.due < todayString) overdue.push(t);
    else if (d.due === todayString) dueToday.push(t);
    else if (d.status === 'doing') inProgress.push(t);
  }
  overdue.sort((a, b) => String((a.data || a).due).localeCompare(String((b.data || b).due)));   // oldest due first
  return { overdue, dueToday, inProgress };
}

// the one-line header summary
export function summaryLine(habitsLeft, tasksLeft) {
  const parts = [];
  if (habitsLeft) parts.push(`${habitsLeft} habit${habitsLeft === 1 ? '' : 's'}`);
  if (tasksLeft) parts.push(`${tasksLeft} task${tasksLeft === 1 ? '' : 's'}`);
  if (!parts.length) return 'All done for today';
  return parts.join(' and ') + ' left';
}

// The calendar check uses Claude, so it runs at most once an hour; in between, the last answer is shown.
export const CAL_CACHE_MS = 60 * 60 * 1000;
export function calendarCacheFresh(cache, now = Date.now()) {
  return !!cache && typeof cache.text === 'string' && !!cache.text && Number.isFinite(cache.t) && now - cache.t >= 0 && now - cache.t < CAL_CACHE_MS;
}
