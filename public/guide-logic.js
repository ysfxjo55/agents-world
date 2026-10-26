// The first-steps guide: the steps and the rules for moving between them. No DOM, no fetch, so it is tested in Node.
// A step moves on only when its own event happens (or the user skips it). Progress is saved as JSON in localStorage.

export const KEY = 'aw.guide';

// page: where the step happens ('world' = the 3D page, 'chat' = the chat page, 'any' = either).
// target: the real element to highlight (a CSS selector), or null for a card in the middle.
// accepts(ev, state): true when this event finishes the step.
export const STEPS = [
  { id: 'welcome', page: 'any', target: null, action: 'Start the tour', choice: 'start',
    title: 'Welcome to Agents World',
    text: 'See all your AI sessions in one place, and get told the moment one finishes. This short tour shows you how, one step at a time. You do each step yourself.',
    accepts: (ev) => ev.type === 'next' },
  { id: 'connect', page: 'any', target: null, engines: true,
    title: 'Connect your AI',
    text: 'Agents World has no AI account of its own. It runs Claude Code or Codex on this computer, logged in with your own subscription. One is enough. It never asks for your password or keys.',
    accepts: (ev) => ev.type === 'engine-ok' },
  { id: 'name', page: 'any', target: null, input: 'name',
    title: 'What should the agents call you?',
    text: 'Type your first name. It is saved on this computer only, in data/config.json. The agents use it after the app restarts.',
    accepts: (ev) => ev.type === 'name-saved' },
  { id: 'chat', page: 'chat', target: '.composer',
    title: 'Start an agent',
    text: 'This is a new chat. Keep the access mode on "Read-only" (top right), type a tiny task like "say hello", and send it.',
    wrongMode: 'Switch the access mode (top right) back to "Read-only" for this test, then send again.',
    accepts: (ev) => ev.type === 'sent' && ev.mode === 'readonly' },
  { id: 'wait', page: 'chat', target: '#thread', notify: true,
    title: 'Wait for the "task done" alert',
    text: 'The agent is working now. When it finishes, you get a desktop notification with the project name and the task. You can do other things meanwhile.',
    accepts: (ev, st) => ev.type === 'run-done' && (!st.runKey || ev.key === st.runKey) },
  { id: 'access', page: 'chat', target: '#mode',
    title: 'Access levels',
    text: 'This menu decides what the agent may do on your computer. Read-only: it can look, never change your files. Can edit files: it can also create and edit files. Can build and test: it can also run git, npm and node. Full access: it can run any command and change anything, without asking.',
    warn: 'Only give more access for work you trust, and check what the agent did. Strong modes are never remembered: you pick them again each visit. Click the menu to see the levels.',
    accepts: (ev) => ev.type === 'mode-opened' },
  { id: 'world', page: 'world', target: '#world',
    title: 'Your world',
    text: 'Each project folder is an island, and each session is a building on it. The robot works, waits or sleeps, like your agent. Your "say hello" task is a building now: click it (or its row in the list).',
    empty: 'No sessions are shown yet. If you started with an empty world, sessions appear here as soon as you start one.',
    accepts: (ev) => ev.type === 'selected' && !!ev.session },
  { id: 'done', page: 'any', target: '#guideBtn', action: 'Finish',
    title: 'You are ready',
    text: 'That is the whole loop: start agents, watch them in the world, get told when they finish. Open this guide again any time with the "Guide" button.',
    accepts: (ev) => ev.type === 'next' },
];

// How to get each engine, from the official docs (checked October 2026). Shown with Copy buttons; you run them yourself in a terminal.
export const ENGINES = {
  claude: { name: 'Claude Code', plan: 'a Claude Pro or Max plan (the free plan does not include Claude Code)', docs: 'https://code.claude.com/docs/en/setup',
    install: { mac: 'curl -fsSL https://claude.ai/install.sh | bash', win: 'irm https://claude.ai/install.ps1 | iex' },
    login: 'claude', loginHow: 'Run it, then log in with your Claude account in the browser window that opens. Type /exit when done.' },
  codex: { name: 'Codex', plan: 'a ChatGPT Plus or Pro plan', docs: 'https://github.com/openai/codex',
    install: { mac: 'npm install -g @openai/codex', win: 'npm install -g @openai/codex' },
    login: 'codex', loginHow: 'Run it and choose "Sign in with ChatGPT". Close it when you are logged in.' },
  opencode: { name: 'OpenCode', plan: 'an OpenCode account or another provider', docs: 'https://opencode.ai/docs/',
    install: { mac: 'curl -fsSL https://opencode.ai/install | bash', win: 'npm install -g opencode-ai' },
    login: 'opencode', loginHow: 'Run it, type /connect and follow the steps. Optional: Bella and Interstellar need Claude Code or Codex.' },
};

/**
 * Installed, but its folder is not on PATH (the Claude Code installer on Windows warns about this): the commands that fix it.
 * fix adds the folder to your PATH for good; run starts it once by its full path, so you can log in right away.
 * @param {string} bin  'claude' | 'codex' | 'opencode'
 * @param {string} dir  the folder it was found in
 * @param {'win' | 'mac'} os
 */
export function pathFix(bin, dir, os) {
  if (os === 'win') {
    const folder = /\\\.local\\bin$/i.test(dir) ? '$env:USERPROFILE\\.local\\bin' : dir;
    return { fix: `[Environment]::SetEnvironmentVariable("Path", [Environment]::GetEnvironmentVariable("Path","User") + ";${folder}", "User")`,
      run: `& "${dir}\\${bin}${/\\npm$/i.test(dir) ? '.cmd' : '.exe'}"`, where: 'Windows', shell: 'PowerShell' };
  }
  return { fix: `echo 'export PATH="${dir}:$PATH"' >> ~/.zshrc`, run: `"${dir}/${bin}"`, where: 'your terminal', shell: 'Terminal' };
}

/** Does at least one engine work (installed and logged in)? Bella and Interstellar need Claude Code or Codex; OpenCode alone runs plain chats. */
export const engineWorks = (found = {}) => Object.values(found).some(e => e && e.installed && e.loggedIn !== false);

/** A fresh guide, open at the first step. */
export const fresh = () => ({ v: 2, status: 'active', step: 0, runKey: null });

/** Read saved progress. Nothing saved yet (a first visit) means a fresh, open guide. Broken data also starts fresh. */
export function load(raw) {
  if (raw == null) return fresh();
  try {
    const s = JSON.parse(raw);
    if (!s || s.v !== 2 || !['active', 'closed', 'done'].includes(s.status) || !Number.isInteger(s.step) || s.step < 0 || s.step >= STEPS.length) return fresh();
    return { v: 2, status: s.status, step: s.step, runKey: typeof s.runKey === 'string' ? s.runKey : null };
  } catch { return fresh(); }
}
export const save = (s) => JSON.stringify(s);
export const isActive = (s) => s.status === 'active';
export const current = (s) => (isActive(s) ? STEPS[s.step] : null);

function next(s) {
  return s.step + 1 >= STEPS.length ? { ...s, status: 'done', runKey: null } : { ...s, step: s.step + 1 };
}

/** Feed one event to the guide; returns the new state (the same object when nothing changed). */
export function onEvent(s, ev) {
  const step = current(s);
  if (!step || !ev) return s;
  if (ev.type === 'skip') return next(s);
  if (ev.type === 'started' && step.id === 'wait' && !s.runKey && typeof ev.key === 'string') return { ...s, runKey: ev.key };
  return step.accepts(ev, s) ? next(s) : s;
}
export const close = (s) => ({ ...s, status: 'closed' });
export const restart = () => fresh();

/** Is the step on this page? 'any' steps show everywhere. */
export const onPage = (step, page) => step.page === 'any' || step.page === page;
/** "Step 2 of 7" */
export const label = (s) => `Step ${s.step + 1} of ${STEPS.length}`;
