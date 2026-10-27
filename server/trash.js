import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { codexFile, roots as codexRoots } from './sources/codex.js';
import { claudeFile, CLAUDE_ROOT } from './sources/claude.js';
import { withToolPath, resolveBin } from './util.js';

// "Delete" = move to Bella's own Trash (recoverable). Only "Empty trash" removes anything for good.
const TRASH = process.env.AGENT_WORLD_TRASH_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'trash');
const ENV = withToolPath(process.env);
const run = (cmd, args, opts = {}) => new Promise((res, rej) => { const r = resolveBin(cmd, args, { env: ENV }); execFile(r.cmd, r.args, { env: ENV, maxBuffer: 64 * 1024 * 1024, ...opts }, (e, out, err) => e ? rej(new Error((err || e.message).toString().slice(0, 300))) : res(out)); });
const cwdOr = (dir) => (fs.existsSync(dir) ? dir : os.homedir());

// Run a command and write its output straight into a file. (Reading a big output through a pipe can be cut off at 64 KB when the
// program exits right after printing, which silently truncated OpenCode backups. A file is never cut.)
export function runToFile(cmd, args, opts, file) {
  return new Promise((res, rej) => {
    const fd = fs.openSync(file, 'w');
    const r = resolveBin(cmd, args, { env: ENV });
    const child = spawn(r.cmd, r.args, { env: ENV, ...opts, stdio: ['ignore', fd, 'pipe'] });
    let err = ''; child.stderr.on('data', (c) => { err = (err + c).slice(-500); });
    child.on('error', (e) => { fs.closeSync(fd); rej(e); });
    child.on('close', (code) => { fs.closeSync(fd); code === 0 ? res(undefined) : rej(new Error(err || `${cmd} exited with code ${code}`)); });
  });
}

function move(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try { fs.renameSync(from, to); } catch (e) { if (e.code !== 'EXDEV') throw e; fs.cpSync(from, to, { recursive: true }); fs.rmSync(from, { recursive: true }); }
}

export async function trashSession(s) {
  const id = `${Date.now()}_${s.tool}_${s.id}`, dir = path.join(TRASH, id);
  const undo = [];                                                   // moves to reverse if a later step fails
  try {
    fs.mkdirSync(dir, { recursive: true });
    const meta = { id, key: s.key, tool: s.tool, sessionId: s.id, title: s.title, cwd: s.cwd, deletedAt: Date.now() };
    if (s.tool === 'claude') {
      const file = claudeFile(s.id); if (!file) throw new Error('session file not found');
      meta.origDir = path.dirname(file);
      fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));   // label first: a half-finished trash is still listed
      move(file, path.join(dir, 'session.jsonl')); undo.push(() => move(path.join(dir, 'session.jsonl'), file));
      const side = path.join(meta.origDir, s.id);                    // sub-agent runs & saved tool results
      if (fs.existsSync(side)) { move(side, path.join(dir, 'extras')); undo.push(() => move(path.join(dir, 'extras'), side)); }
    } else if (s.tool === 'codex') {
      const file = codexFile(s.id); if (!file) throw new Error('session file not found');
      meta.origFile = file;
      fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
      move(file, path.join(dir, 'session.jsonl')); undo.push(() => move(path.join(dir, 'session.jsonl'), file));
    } else if (s.tool === 'antigravity') {
      throw new Error('Antigravity conversations cannot be moved to Trash from here yet');
    } else if (s.tool === 'opencode') {
      const file = path.join(dir, 'export.json');
      await runToFile('opencode', ['export', s.id], { cwd: cwdOr(s.cwd) }, file);
      const raw = fs.readFileSync(file, 'utf8'), text = raw.slice(raw.indexOf('{'));
      let j; try { j = JSON.parse(text); } catch { throw new Error('the backup export was incomplete, so nothing was deleted'); }   // the backup must be real before anything is deleted
      if (!j || !(j.messages || j.info)) throw new Error('backup export looked empty, nothing was deleted');
      if (text !== raw) fs.writeFileSync(file, text);                 // keep only the JSON
      fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
      await run('opencode', ['session', 'delete', s.id], { cwd: cwdOr(s.cwd) });
    } else throw new Error('unsupported tool');
    return { ok: true, trashId: id };
  } catch (e) {
    for (const u of undo.reverse()) { try { u(); } catch { /* best effort */ } }
    try { if (!fs.existsSync(path.join(dir, 'session.jsonl'))) fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    return { ok: false, error: e.message };
  }
}

export function listTrash() {
  let names; try { names = fs.readdirSync(TRASH); } catch { return []; }
  const out = [];
  for (const n of names) { try { out.push(JSON.parse(fs.readFileSync(path.join(TRASH, n, 'meta.json'), 'utf8'))); } catch { /* not a trash entry */ } }
  return out.sort((a, b) => b.deletedAt - a.deletedAt);
}

export async function restoreSession(trashId) {
  if (!/^[\w-]+$/.test(trashId)) return { ok: false, error: 'bad id' };
  const dir = path.join(TRASH, trashId); let meta;
  try { meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')); } catch { return { ok: false, error: 'not in trash' }; }
  try {
    if (meta.tool === 'claude') {
      // the label in meta.json is not trusted either: a Claude session may only go back into the Claude projects folder
      const target = path.resolve(String(meta.origDir || ''));
      if (target !== path.resolve(CLAUDE_ROOT) && !target.startsWith(path.resolve(CLAUDE_ROOT) + path.sep)) return { ok: false, error: 'that restore target is not inside the Claude sessions folder' };
      const dest = path.join(meta.origDir, meta.sessionId + '.jsonl'), side = path.join(meta.origDir, meta.sessionId);
      const hasExtras = fs.existsSync(path.join(dir, 'extras'));
      if (fs.existsSync(dest) || (hasExtras && fs.existsSync(side))) return { ok: false, error: 'something with this id already exists there' };   // check both before moving either
      move(path.join(dir, 'session.jsonl'), dest);
      if (hasExtras) move(path.join(dir, 'extras'), side);
    } else if (meta.tool === 'codex') {
      // the label in meta.json is not trusted: a Codex file may only go back into the Codex sessions folders
      const back = path.resolve(String(meta.origFile || ''));
      if (!codexRoots().some(r => back.startsWith(path.resolve(r) + path.sep))) return { ok: false, error: 'that restore target is not inside the Codex sessions folder' };
      if (fs.existsSync(meta.origFile)) return { ok: false, error: 'something with this id already exists there' };
      move(path.join(dir, 'session.jsonl'), meta.origFile);
    } else await run('opencode', ['import', path.join(dir, 'export.json')], { cwd: cwdOr(meta.cwd) });
    fs.rmSync(dir, { recursive: true, force: true });
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

export function emptyTrash() { const n = listTrash().length; fs.rmSync(TRASH, { recursive: true, force: true }); return n; }
