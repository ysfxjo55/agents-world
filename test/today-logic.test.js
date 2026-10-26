import test from 'node:test';
import assert from 'node:assert/strict';
import { localDateString, habitsDueOn, weekCount, groupTasks, summaryLine } from '../public/today-logic.js';

test('localDateString uses the local date, not UTC', () => {
  assert.equal(localDateString(new Date(2026, 9, 9, 12, 0)), '2026-10-09');
  assert.equal(localDateString(new Date(2026, 0, 1, 23, 30)), '2026-01-01');   // still the 1st locally
});

test('habitsDueOn returns nothing when there are no habits', () => {
  assert.deepEqual(habitsDueOn([], '2026-10-09'), []);
  assert.deepEqual(habitsDueOn(undefined, '2026-10-09'), []);
});

test('habitsDueOn: a perWeek habit applies every day', () => {
  const habits = [{ id: 'gym', perWeek: 3, days: [] }];
  assert.deepEqual(habitsDueOn(habits, '2026-10-04'), habits);   // Sunday
  assert.deepEqual(habitsDueOn(habits, '2026-10-09'), habits);   // Friday
});

test('habitsDueOn: a days habit only applies on its weekdays', () => {
  const habits = [{ id: 'read', perWeek: 0, days: [5] }];        // Friday
  assert.deepEqual(habitsDueOn(habits, '2026-10-09'), habits);
  assert.deepEqual(habitsDueOn(habits, '2026-10-10'), []);
});

test('weekCount counts done days since Sunday and stops after today', () => {
  const habit = { id: 'read' };
  const days = {
    '2026-10-03': { habits: { read: true } },   // the Saturday before this week
    '2026-10-04': { habits: { read: true } },   // Sunday, week start
    '2026-10-09': { habits: { read: true } },   // today
    '2026-10-10': { habits: { read: true } },   // Saturday, still in the future
  };
  assert.equal(weekCount(habit, days, '2026-10-09'), 2);
  assert.equal(weekCount(habit, {}, '2026-10-09'), 0);
});

test('groupTasks: a task due today that is already done is excluded', () => {
  const tasks = [{ id: 'a', data: { status: 'done', due: '2026-10-09' } }];
  assert.deepEqual(groupTasks(tasks, '2026-10-09'), { overdue: [], dueToday: [], inProgress: [] });
});

test('groupTasks: overdue tasks, oldest due first', () => {
  const tasks = [
    { id: 'b', data: { status: 'todo', due: '2026-10-05' } },
    { id: 'a', data: { status: 'todo', due: '2026-10-01' } },
    { id: 'c', data: { status: 'todo', due: '2026-10-09' } },
    { id: 'd', data: { status: 'todo', due: '2026-11-01' } },   // not today: hidden
  ];
  const g = groupTasks(tasks, '2026-10-09');
  assert.deepEqual(g.overdue.map(t => t.id), ['a', 'b']);
  assert.deepEqual(g.dueToday.map(t => t.id), ['c']);
  assert.deepEqual(g.inProgress, []);
});

test('groupTasks: a task with no due date but doing is in progress', () => {
  const tasks = [{ id: 'z', data: { status: 'doing', due: '' } }];
  const g = groupTasks(tasks, '2026-10-09');
  assert.deepEqual(g.inProgress.map(t => t.id), ['z']);
  assert.deepEqual(g.overdue, []);
  assert.deepEqual(g.dueToday, []);
});

test('summaryLine', () => {
  assert.equal(summaryLine(3, 2), '3 habits and 2 tasks left');
  assert.equal(summaryLine(1, 1), '1 habit and 1 task left');
  assert.equal(summaryLine(0, 2), '2 tasks left');
  assert.equal(summaryLine(2, 0), '2 habits left');
  assert.equal(summaryLine(0, 0), 'All done for today');
});

import { calendarCacheFresh } from '../public/today-logic.js';
test('the calendar answer is reused for an hour, then checked again', () => {
  const t = Date.UTC(2026, 9, 23, 12);
  assert.equal(calendarCacheFresh({ t, text: 'ok' }, t + 59 * 60_000), true);
  assert.equal(calendarCacheFresh({ t, text: 'ok' }, t + 61 * 60_000), false);
  assert.equal(calendarCacheFresh({ t, text: '' }, t + 1000), false);
  assert.equal(calendarCacheFresh(null, t), false);
  assert.equal(calendarCacheFresh({ t: t + 5000, text: 'ok' }, t), false);   // a clock that went backwards
});
