import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'archived.json');

// Archive state lives only in this app's own JSON file. Real session files are never touched.
let set = new Set();
try { set = new Set(JSON.parse(fs.readFileSync(FILE, 'utf8')).archived ?? []); } catch (e) { if (e.code !== 'ENOENT') console.error('archived.json unreadable, starting empty:', e.message); }

const save = () => {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';                                   // write then rename, so a crash can't leave half a file
  fs.writeFileSync(tmp, JSON.stringify({ archived: [...set] }, null, 2));
  fs.renameSync(tmp, FILE);
};
export const isArchived = (key) => set.has(key);

// Display names: a session can be shown under a name we choose (the file on disk is never touched).
const ALIASES = path.join(path.dirname(FILE), 'aliases.json');
let aliases = {};
try { aliases = JSON.parse(fs.readFileSync(ALIASES, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') console.error('aliases.json unreadable:', e.message); }
export const getAlias = (key) => aliases[key];
export function setAlias(key, title) {
  aliases[key] = title;
  const tmp = ALIASES + '.tmp'; fs.mkdirSync(path.dirname(ALIASES), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(aliases, null, 2)); fs.renameSync(tmp, ALIASES);
}
export const setArchived = (key, on) => { on ? set.add(key) : set.delete(key); save(); };
