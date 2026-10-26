import fs from 'node:fs';
import path from 'node:path';

// Lets the chat hand a finished file (a report, a presentation, a picture) back to you as a download.
// Deliberately narrow: only your Downloads, Desktop and Documents folders, only document/picture types, no hidden files or folders.
export const DOWNLOAD_ROOTS = ['Downloads', 'Desktop', 'Documents'];
export const DOWNLOAD_EXT = new Set(['.docx', '.doc', '.pptx', '.xlsx', '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.txt', '.md', '.csv', '.rtf']);
const MAX_BYTES = 300 * 1024 * 1024;

export function resolveDownload(input, home) {
  if (typeof input !== 'string' || !input || input.length > 1000 || input.includes('\0')) return null;
  const p = input.startsWith('~/') ? path.join(home, input.slice(2)) : input;
  if (!path.isAbsolute(p)) return null;
  let real; try { real = fs.realpathSync(p); } catch { return null; }                       // follows symlinks: a link cannot lead outside
  const roots = DOWNLOAD_ROOTS.map(r => { try { return fs.realpathSync(path.join(home, r)); } catch { return null; } }).filter(Boolean);
  const root = roots.find(r => real.startsWith(r + path.sep)); if (!root) return null;
  if (path.relative(root, real).split(path.sep).some(part => part.startsWith('.'))) return null;
  if (!DOWNLOAD_EXT.has(path.extname(real).toLowerCase())) return null;
  let st; try { st = fs.statSync(real); } catch { return null; }
  return st.isFile() && st.size <= MAX_BYTES ? { file: real, size: st.size, name: path.basename(real) } : null;
}
