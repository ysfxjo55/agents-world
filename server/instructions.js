import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENTS_DIR } from './agents.js';
import { config, saveSettings } from './config.js';

// The "Instructions" panel: read, save and reset Bella's and Interstellar's instructions, and the "about you" line.
// The files are the same ones the agents read, so a change applies to the next new chat.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LIMITS = { file: 20_000, about: 1500 };

/** Where each one lives, and the starter copy "Reset to default" brings back. */
export const defaultPlaces = () => ({
  bella: { file: path.join(AGENTS_DIR, 'bella.md'), starter: path.join(ROOT, 'agents', 'bella.md') },
  interstellar: { file: path.join(ROOT, 'data', 'interstellar', 'AGENTS.md'), starter: path.join(ROOT, 'starter', 'interstellar', 'AGENTS.md') },
});

/** Bella's file must keep its header (--- name: bella ---), or Claude Code no longer finds her. */
export function checkBella(text) {
  const m = text.replace(/\r\n?/g, '\n').match(/^---\n([\s\S]*?)\n---/);
  return !!m && /^name:\s*["']?bella["']?\s*$/m.test(m[1]);
}

export function readAll(places = defaultPlaces(), about = config.about) {
  const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
  return { bella: read(places.bella.file), interstellar: read(places.interstellar.file), about: about || '' };
}

/** Save one. Returns { ok } or { error } in plain words. */
export function saveOne(name, text, { places = defaultPlaces(), saveAbout = (t) => saveSettings({ about: t }) } = {}) {
  if (typeof text !== 'string') return { error: 'Nothing to save.' };
  if (name === 'about') {
    const t = text.trim();
    if (t.length > LIMITS.about) return { error: `Keep it under ${LIMITS.about} letters.` };
    saveAbout(t); return { ok: true };
  }
  const p = places[name]; if (!p) return { error: 'Unknown agent.' };
  if (!text.trim()) return { error: 'The instructions cannot be empty. Use "Reset to default" to start over.' };
  if (text.length > LIMITS.file) return { error: `Keep it under ${LIMITS.file} letters.` };
  if (name === 'bella' && !checkBella(text)) return { error: 'Keep the first lines as they are (--- name: bella ... ---), or Bella disappears.' };
  fs.mkdirSync(path.dirname(p.file), { recursive: true });
  fs.writeFileSync(p.file + '.tmp', text); fs.renameSync(p.file + '.tmp', p.file);
  return { ok: true };
}

/** Put the starter copy back (about: empty). */
export function resetOne(name, { places = defaultPlaces(), saveAbout = (t) => saveSettings({ about: t }) } = {}) {
  if (name === 'about') { saveAbout(''); return { ok: true, text: '' }; }
  const p = places[name]; if (!p) return { error: 'Unknown agent.' };
  const text = fs.readFileSync(p.starter, 'utf8');
  fs.mkdirSync(path.dirname(p.file), { recursive: true }); fs.writeFileSync(p.file, text);
  return { ok: true, text };
}
