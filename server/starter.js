import fs from 'node:fs';
import path from 'node:path';

// First start: copy the starter files (starter/) into data/, so Bella and Interstellar have instructions and an empty memory.
// A file that already exists is never overwritten: once copied, the files are yours to edit.
export function installStarter(root, dataDir = path.join(root, 'data')) {
  const src = path.join(root, 'starter'), copied = [];
  const walk = (from, to) => {
    for (const e of fs.readdirSync(from, { withFileTypes: true })) {
      const a = path.join(from, e.name), b = path.join(to, e.name);
      if (e.isDirectory()) walk(a, b);
      else if (e.name !== 'README.md' && !fs.existsSync(b)) { fs.mkdirSync(to, { recursive: true }); fs.copyFileSync(a, b); copied.push(path.relative(dataDir, b)); }
    }
  };
  try { walk(src, dataDir); } catch (e) { console.warn('starter files:', e.message); }
  return copied;
}
