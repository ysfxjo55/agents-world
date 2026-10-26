import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { STEPS, fresh, load, save, onEvent, current, close, restart, isActive, onPage, label } from '../public/guide-logic.js';
import { saveName } from '../server/config.js';

const at = (id) => ({ ...fresh(), step: STEPS.findIndex(s => s.id === id) });
const idOf = (s) => current(s)?.id;

test('a first visit (nothing saved) opens the guide at step 1', () => {
  const s = load(null);
  assert.equal(isActive(s), true);
  assert.equal(idOf(s), 'welcome');
  assert.equal(label(s), `Step 1 of ${STEPS.length}`);
});

test('each step moves on only on its own event', () => {
  const cases = [
    ['welcome', { type: 'selected', session: true }, { type: 'next' }],
    ['name', { type: 'next' }, { type: 'name-saved' }],
    ['world', { type: 'selected', session: false }, { type: 'selected', session: true }],
    ['chat', { type: 'sent', mode: 'full' }, { type: 'sent', mode: 'readonly' }],
    ['wait', { type: 'sent', mode: 'readonly' }, { type: 'run-done', key: 'k' }],
    ['access', { type: 'run-done', key: 'k' }, { type: 'mode-opened' }],
  ];
  for (const c of cases) {
    const id = String(c[0]), wrong = /** @type {any} */ (c[1]), right = /** @type {any} */ (c[2]);
    const s = at(id);
    assert.equal(onEvent(s, wrong), s, `${id} ignores ${wrong.type}`);
    assert.equal(onEvent(s, right).step, s.step + 1, `${id} moves on with ${right.type}`);
  }
});

test('the wait step only finishes on the run it started', () => {
  let s = onEvent(at('wait'), { type: 'started', key: 'claude:abc' });
  assert.equal(s.runKey, 'claude:abc');
  assert.equal(idOf(s), 'wait');
  assert.equal(onEvent(s, { type: 'run-done', key: 'claude:other' }), s);
  assert.equal(idOf(onEvent(s, { type: 'run-done', key: 'claude:abc' })), 'access');
});

test('"started" outside the wait step changes nothing', () => {
  const s = at('chat');
  assert.equal(onEvent(s, { type: 'started', key: 'x' }), s);
});

test('skip moves on one step; the last step finishes the guide', () => {
  assert.equal(idOf(onEvent(at('name'), { type: 'skip' })), 'world');
  const end = onEvent(at('done'), { type: 'next' });
  assert.equal(end.status, 'done');
  assert.equal(current(end), null);
  assert.equal(onEvent(end, { type: 'next' }), end);            // a finished guide ignores events
});

test('progress survives a reload (save then load)', () => {
  const s = onEvent(at('wait'), { type: 'started', key: 'claude:abc' });
  const back = load(save(s));
  assert.deepEqual(back, s);
  assert.equal(idOf(back), 'wait');
});

test('closed stays closed after a reload, and the Guide button starts again', () => {
  const s = load(save(close(at('world'))));
  assert.equal(isActive(s), false);
  assert.equal(current(s), null);
  assert.equal(idOf(restart()), 'welcome');
});

test('broken saved data starts a fresh guide', () => {
  for (const raw of ['nope', '{}', '{"v":1,"status":"active","step":99}', '{"v":1,"status":"weird","step":0}', 'null']) assert.deepEqual(load(raw), fresh(), raw);
});

test('steps know their page', () => {
  assert.equal(onPage(STEPS.find(s => s.id === 'world'), 'chat'), false);
  assert.equal(onPage(STEPS.find(s => s.id === 'chat'), 'chat'), true);
  assert.equal(onPage(STEPS.find(s => s.id === 'welcome'), 'world'), true);
});

test('saveName keeps the other settings and refuses empty or long names', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-name-')), file = path.join(dir, 'data', 'config.json');
  assert.equal(saveName('  Sam\n ', file), 'Sam');                                  // creates the file and folder
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { name: 'Sam' });
  fs.writeFileSync(file, JSON.stringify({ name: 'Sam', links: [{ name: 'x', url: 'https://x.dev/' }] }));
  assert.equal(saveName('Lee', file), 'Lee');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { name: 'Lee', links: [{ name: 'x', url: 'https://x.dev/' }] });
  assert.equal(saveName('', file), null);
  assert.equal(saveName('x'.repeat(41), file), null);
  assert.equal(saveName(42, file), null);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).name, 'Lee');
  fs.rmSync(dir, { recursive: true, force: true });
});
