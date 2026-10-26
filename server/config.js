import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Personal settings live in data/config.json, which git ignores. Copy config.example.json there and edit it.
// Env vars override it: AGENT_WORLD_HOSTS, AGENT_WORLD_OWNER.
const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'config.json');
let file = {};
try { file = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { /* no config yet: local-only defaults */ }

/** "now", an ISO date or a number of ms -> ms; 0 = show everything; null = not chosen yet. */
export function parseSince(v, now = Date.now()) {
  if (v === undefined || v === null || v === '') return null;
  if (v === 'now') return now;
  const n = typeof v === 'number' ? v : /^\d+$/.test(String(v)) ? Number(v) : Date.parse(String(v));
  return Number.isFinite(n) && n >= 0 ? n : null;
}
const list = (v) => (Array.isArray(v) ? v : String(v ?? '').split(',')).map(s => String(s).trim()).filter(Boolean);
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
export const config = {
  name: text(file.name, 40),                                          // your first name, used by the agents and on the screens
  about: text(file.about, 1500),                                      // a few lines about you (level, language, how you like answers)
  hosts: list(process.env.AGENT_WORLD_HOSTS ?? file.hosts),          // extra hostnames allowed, e.g. your Tailscale name
  owner: String(process.env.AGENT_WORLD_OWNER ?? file.owner ?? ''),   // the Tailscale login allowed to use remote hostnames
  projectNames: file.projectNames && typeof file.projectNames === 'object' ? Object.fromEntries(Object.entries(file.projectNames).filter(([, v]) => typeof v === 'string' && v.length < 60)) : {},   // folder path -> the name shown in the app
  notify: {                                                           // "task done" alerts; see README
    desktop: file.notify?.desktop !== false,
    ntfy: /^https:\/\/[^\s]+$/.test(file.notify?.ntfy ?? '') ? file.notify.ntfy : '',   // phone push via an ntfy topic URL; off when empty
  },
  links: Array.isArray(file.links) ? file.links.filter(l => l && /^https:\/\//.test(l.url) && l.name).slice(0, 8) : [],
  showSince: parseSince(process.env.AGENT_WORLD_SHOW_SINCE ?? file.showSince),   // "start fresh": hide sessions not active since then. null = never chosen, 0 = show all
  today: process.env.AGENT_WORLD_TODAY ? process.env.AGENT_WORLD_TODAY === '1' : file.today === true,   // the Today page and its daily popup; off unless you turn it on
  agents: file.agents && typeof file.agents === 'object' ? file.agents : {},   // which engine each manager uses, e.g. {"interstellar": {"engine": "claude"}}
};

/** Your name in agent prompts ("the user" until you set "name" in data/config.json). */
export const USER = config.name || 'the user';
/** Your name on the screens ("you" until you set it). */
export const userLabel = () => config.name || 'You';

/**
 * Change a few settings in data/config.json, keeping every other one. Writes a temp file first, so a crash never leaves half a file.
 * @param {Record<string, unknown>} patch
 * @param {string} [file]
 */
export function saveSettings(patch, file = FILE) {
  let cur = {};
  try { cur = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* no config yet */ }
  if (!cur || typeof cur !== 'object' || Array.isArray(cur)) cur = {};
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ ...cur, ...patch }, null, 2) + '\n');
  fs.renameSync(tmp, file);
  if (file === FILE) Object.assign(config, patch);
}

/**
 * Save your first name (from the first-steps guide). Returns the cleaned name, or null when it is empty or too long.
 * The agents' prompts pick it up after a restart.
 * @param {unknown} name
 * @param {string} [file]
 */
export function saveName(name, file = FILE) {
  const clean = typeof name === 'string' ? [...name].filter(c => c >= ' ' && c !== '\u007f').join('').trim() : '';
  if (!clean || clean.length > 40) return null;
  saveSettings({ name: clean }, file);
  return clean;
}
