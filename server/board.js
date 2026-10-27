import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Storage for the Tasks & habits board (public/board.html + localdb.js): one JSON file per document,
// in data/board/<collection>/<id>.json. That folder is yours (git ignores data/), and you or an agent can edit the files.
//   GET    /api/board/<collection>        -> [{ id, data }, ...]
//   GET    /api/board/<collection>/<id>   -> { id, exists, data }
//   PUT    /api/board/<collection>/<id>   body = a JSON object, replaces the document
//   DELETE /api/board/<collection>/<id>
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BOARD_DIR = () => process.env.AGENT_WORLD_BOARD_DIR || path.join(ROOT, 'data', 'board');
const SEG = /^(?!\.\.?$)[A-Za-z0-9_\-.~@+]{1,200}$/;   // safe as a file name on Windows, Mac and Linux
export const MAX_BODY = 1024 * 1024;

/** "/api/board/tasks/abc" -> { col, doc } ; null = not a board path ; 'bad' = refused */
export function boardPath(p) {
  if (!p.startsWith('/api/board/')) return null;
  const rest = p.slice('/api/board/'.length).split('/').filter(Boolean).map(s => { try { return decodeURIComponent(s); } catch { return '\0'; } });
  if (rest.length < 1 || rest.length > 2 || !rest.every(s => SEG.test(s))) return 'bad';
  return { col: rest[0], doc: rest[1] ?? null };
}

export function listDocs(col, dir = BOARD_DIR()) {
  let names; try { names = fs.readdirSync(path.join(dir, col)).filter(n => n.endsWith('.json') && !n.startsWith('.')).sort(); } catch { return []; }
  const rows = [];
  for (const n of names) { try { rows.push({ id: n.slice(0, -5), data: JSON.parse(fs.readFileSync(path.join(dir, col, n), 'utf8')) }); } catch { /* a broken file is skipped */ } }
  return rows;
}
export function getDoc(col, id, dir = BOARD_DIR()) {
  try { return { id, exists: true, data: JSON.parse(fs.readFileSync(path.join(dir, col, id + '.json'), 'utf8')) }; }
  catch (e) { if (e.code === 'ENOENT') return { id, exists: false, data: null }; throw e; }
}
export function putDoc(col, id, data, dir = BOARD_DIR()) {
  const folder = path.join(dir, col), file = path.join(folder, id + '.json'), tmp = path.join(folder, `.tmp-${process.pid}-${Date.now()}.json`);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);                                         // whole file or nothing, never half a file
}
export function deleteDoc(col, id, dir = BOARD_DIR()) { fs.rmSync(path.join(dir, col, id + '.json'), { force: true }); }

/** The route. Through Tailscale the board is read-only, like the chat. */
export async function boardRoute({ req, res, p, write, auth, json, readBody }) {
  const r = boardPath(p);
  if (r === null) return false;
  if (r === 'bad') { json(res, 400, { error: 'bad path' }); return true; }
  res.setHeader('Cache-Control', 'no-store');
  if (!write) {
    if (r.doc === null) json(res, 200, listDocs(r.col));
    else { try { json(res, 200, getDoc(r.col, r.doc)); } catch { json(res, 500, { error: 'that file is not valid JSON' }); } }
    return true;
  }
  if (auth.remote) { json(res, 403, { error: 'The board is read-only through Tailscale. Use this computer to change it.' }); return true; }
  if (r.doc === null) { json(res, 400, { error: 'bad path' }); return true; }
  if (req.method === 'DELETE') { deleteDoc(r.col, r.doc); json(res, 200, { ok: true }); return true; }
  if (req.method !== 'PUT') { json(res, 405, { error: 'use PUT or DELETE' }); return true; }
  const data = await readBody(req, MAX_BODY);
  if (!data || typeof data !== 'object' || Array.isArray(data)) { json(res, 400, { error: 'body must be a JSON object' }); return true; }
  putDoc(r.col, r.doc, data); json(res, 200, { ok: true });
  return true;
}
