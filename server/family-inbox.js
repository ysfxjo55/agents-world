import fs from 'node:fs';
import path from 'node:path';
import { rememberNote } from './family-remember.js';

export function inboxLines(dir) {
  try { return fs.readFileSync(path.join(dir, 'inbox.md'), 'utf8').split(/\r?\n/).filter(Boolean); }
  catch (e) { if (e.code !== 'ENOENT') throw e; return []; }
}

// Synchronous validation and append keep concurrent requests inside one shared limit.
export async function familyInboxRoute({ req, res, p, auth, json, body, dir, logAction }) {
  if (!['/api/family/remember', '/api/family/inbox'].includes(p)) return false;
  res.setHeader('Cache-Control', 'no-store');
  if (auth.remote) { json(res, 403, { error: 'Only from this computer.' }); return true; }
  if (p === '/api/family/inbox' && req.method === 'GET') { json(res, 200, { lines: inboxLines(dir) }); return true; }
  if (p !== '/api/family/remember' || req.method !== 'POST') { json(res, 405, { error: 'Method not allowed.' }); return true; }
  const b = await body(req), now = Date.now(), rateFile = path.join(dir, 'remember-times.json');
  let times = [];
  try { times = JSON.parse(fs.readFileSync(rateFile, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  times = times.filter(t => typeof t === 'number' && t > now - 3600000);
  const note = rememberNote(b || {}, { lines: inboxLines(dir), times, now });
  if (note.error) { json(res, 400, { error: note.error }); return true; }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(rateFile, JSON.stringify([...times, now]), { mode: 0o600 });
  const file = path.join(dir, 'inbox.md');
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  fs.appendFileSync(file, (existing && !existing.endsWith('\n') ? '\n' : '') + note.line + '\n', { mode: 0o600 });
  logAction({ action: 'remember', ok: true });
  json(res, 200, { ok: true, message: 'Saved a note to the family inbox.' }); return true;
}
