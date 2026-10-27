import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-board-'));
process.env.AGENT_WORLD_BOARD_DIR = dir;
const { boardPath, listDocs, getDoc, putDoc, deleteDoc, boardRoute } = await import('../server/board.js');

test('board paths: one collection or one document, nothing that could leave the board folder', () => {
  assert.deepEqual(boardPath('/api/board/tasks'), { col: 'tasks', doc: null });
  assert.deepEqual(boardPath('/api/board/config/settings'), { col: 'config', doc: 'settings' });
  assert.equal(boardPath('/api/other/x'), null);
  for (const bad of ['/api/board/', '/api/board/../data', '/api/board/tasks/..', '/api/board/a/b/c', '/api/board/tasks/%2e%2e%2fx', '/api/board/tasks/a:b', '/api/board/tasks/%ZZ'])
    assert.equal(boardPath(bad), 'bad', bad);
});

test('documents are saved as JSON files, listed, read and deleted', () => {
  assert.deepEqual(getDoc('tasks', 't1'), { id: 't1', exists: false, data: null });
  putDoc('tasks', 't1', { title: 'Write tests', status: 'todo' });
  putDoc('tasks', 't2', { title: 'Ship', status: 'done' });
  assert.deepEqual(getDoc('tasks', 't1'), { id: 't1', exists: true, data: { title: 'Write tests', status: 'todo' } });
  assert.deepEqual(listDocs('tasks').map(r => r.id), ['t1', 't2']);
  fs.writeFileSync(path.join(dir, 'tasks', 'broken.json'), '{nope');
  assert.deepEqual(listDocs('tasks').map(r => r.id), ['t1', 't2']);              // a broken file is skipped, not fatal
  deleteDoc('tasks', 't2'); assert.equal(getDoc('tasks', 't2').exists, false);
  assert.deepEqual(listDocs('nothing-here'), []);
});

test('the route: reads work everywhere, writes only from this computer and only JSON objects', async () => {
  const call = async ({ method = 'GET', p, remote = false, body = null }) => {
    const out = /** @type {any} */ ({}); const res = { setHeader() {} };
    const json = (_r, code, obj) => { out.code = code; out.obj = obj; };
    const handled = await boardRoute({ req: { method }, res, p, write: method !== 'GET', auth: { remote }, json, readBody: async () => body });
    return /** @type {any} */ ({ handled, ...out });
  };
  assert.equal((await call({ p: '/api/chat/x' })).handled, false);
  assert.equal((await call({ method: 'PUT', p: '/api/board/tasks/t9', body: { title: 'x' } })).code, 200);
  assert.equal((await call({ p: '/api/board/tasks/t9' })).obj.data.title, 'x');
  assert.equal((await call({ method: 'PUT', p: '/api/board/tasks/t9', body: { title: 'y' }, remote: true })).code, 403);
  assert.equal((await call({ method: 'PUT', p: '/api/board/tasks/t9', body: [1, 2] })).code, 400);
  assert.equal((await call({ method: 'PUT', p: '/api/board/tasks', body: { a: 1 } })).code, 400);
  assert.equal((await call({ p: '/api/board/../x' })).code, 400);
  assert.equal((await call({ method: 'DELETE', p: '/api/board/tasks/t9' })).code, 200);
});

test('the public board page ships without the chess game or internet libraries, and starts with neutral areas', () => {
  const html = fs.readFileSync(new URL('../public/board.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /chess|Chess|data-v="game"|game\/current/);
  assert.doesNotMatch(html, /https?:\/\/(?!www\.w3\.org)/);                     // no fonts or scripts from the internet
  assert.match(html, /name:'Work'.*name:'Study'.*name:'Personal'/);               // neutral starter areas
  fs.rmSync(dir, { recursive: true, force: true });
});
