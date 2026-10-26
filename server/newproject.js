import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { config, USER } from './config.js';

// Bella can open a NEW project folder for a task: the folder becomes its own block in the world, and the project's
// context lives in its root (BRIEF.md + CLAUDE.md, which Claude Code reads by itself in that folder).
const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'bella');
const RECORD = process.env.AGENT_WORLD_NEWPROJECTS || path.join(DATA, 'created-projects.json');
export const PROJECTS_DIR = process.env.AGENT_WORLD_PROJECTS_DIR || path.join(os.homedir(), 'Desktop', 'projects');
export const PROJECT_NAME = /^[a-z0-9][a-z0-9-]{1,40}$/;

export function loadCreated(file = RECORD) { try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(j) ? j.filter(x => typeof x === 'string') : []; } catch { return []; } }

const CLAUDE_MD = `# Project context

Read BRIEF.md in this folder first: it is the goal, the rules and the plan of this project. Keep it up to date.

${config.about ? `- About ${USER}: ${config.about}\n` : ''}- Use short, plain English.
- Work on a git branch for each step, not on main. Write tests. Say what you verified and what you could not.
- Privacy: personal or health data never goes into git, logs or screenshots. Nothing is pushed, emailed or deleted for good without asking.
- Do not choose or change any medicine or dose in any health project: only specialists do.
`;

// Creates <base>/<name> with git, BRIEF.md and CLAUDE.md. Refuses names that are invalid or folders that already exist
// (unless Bella made them earlier). Returns { ok, path } or { ok:false, error }.
export function createProject({ name, brief = '', base = PROJECTS_DIR, file = RECORD, git = (dir) => { execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, stdio: 'ignore' }); } }) {
  if (typeof name !== 'string' || !PROJECT_NAME.test(name)) return { ok: false, error: 'Project name: 2-41 characters, lowercase letters, digits and dashes only (for example diabetes-nutrition-app).' };
  const dir = path.join(base, name);
  const mine = loadCreated(file).includes(dir);
  if (fs.existsSync(dir) && !mine) return { ok: false, error: `A folder named "${name}" already exists and Bella did not create it. Pick another name.` };
  if (!mine && loadCreated(file).length >= 30) return { ok: false, error: 'Too many projects created by Bella already.' };
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(path.join(dir, '.git'))) { try { git(dir); } catch { /* git is optional here */ } }
  if (brief.trim() && !fs.existsSync(path.join(dir, 'BRIEF.md'))) fs.writeFileSync(path.join(dir, 'BRIEF.md'), brief.trim() + '\n');
  if (!fs.existsSync(path.join(dir, 'CLAUDE.md'))) fs.writeFileSync(path.join(dir, 'CLAUDE.md'), CLAUDE_MD);
  if (!fs.existsSync(path.join(dir, '.gitignore'))) fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\n.env\n.env.*\n*.db\ndata/\n.DS_Store\n');
  if (!mine) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify([...loadCreated(file), dir], null, 2)); }
  return { ok: true, path: dir, existed: mine };
}
