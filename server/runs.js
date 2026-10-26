import { execFileSync } from 'node:child_process';

// Which agents are running right now? A model can think for minutes without writing anything, so "no new messages"
// does not mean "asleep". We look at the process list instead.
//   claude -p ... --resume <id> | --session-id <id>   (headless runs, including the ones started from the chat page)
//   opencode run ... --dir <folder> [-s <id>]
export function parseRuns(psOutput) {
  const claudeIds = new Set(), opencodeDirs = new Set(), opencodeIds = new Set(), codexIds = new Set();
  for (const line of String(psOutput).split('\n')) {
    let m;
    if (/(^|\/|\s)claude\s/.test(line) && /\s(-p|--print)(\s|$)/.test(line)) {
      for (const x of line.matchAll(/--(?:resume|session-id)\s+([A-Za-z0-9][\w.-]*)/g)) claudeIds.add(x[1]);
    } else if ((m = line.match(/^(?:node\s+\S*\/)?(?:\S*\/)?codex\s+(?:exec\s+(?:--skip-git-repo-check\s+|(?:-C|--cd|--sandbox|--add-dir|-c)\s+(?:"[^"]*"|'[^']*'|.+?)\s+)*)?resume\s+([\w-]+)(?:\s|$)/))) {
      codexIds.add(m[1]);
    } else if (/(^|\/|\s)opencode\s+run(\s|$)/.test(line)) {
      if ((m = line.match(/--dir\s+(\S+)/))) opencodeDirs.add(m[1]);
      if ((m = line.match(/\s(?:-s|--session)\s+([A-Za-z0-9][\w.-]*)/))) opencodeIds.add(m[1]);
    }
  }
  return { claudeIds, opencodeDirs, opencodeIds, codexIds };
}

// Is a Claude Code session still open in a Terminal (or running headless)? Only a real `claude ... --resume <id>` / `--session-id <id>` process counts.
// (A command that merely MENTIONS the id, like `delegate trash claude:<id>`, must not match: that made every delete look "in use".)
export const claudeProcessPattern = (id) => `(^|/)claude .*(--resume|--session-id|-r) ?${id}`;

export const sessionBusy = (runs, key) => [...runs.values()].some(r => r.key === key);

export function registeredRuns(detected, registry) {
  for (const run of registry.values()) {
    const [tool, id] = (run.key || '').split(':');
    if (id) detected[tool + 'Ids']?.add(id);
  }
  return detected;
}

export function liveRuns(registry = new Map()) {
  try { return registeredRuns(parseRuns(execFileSync('ps', ['-axo', 'command='], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })), registry); }
  catch { return registeredRuns(parseRuns(''), registry); }
}

// Mark sessions that have a live run as working. A run in a folder only counts for sessions touched in the last 6 hours.
export function applyRuns(sessions, runs, now = Date.now()) {
  for (const s of sessions) {
    const live = s.tool === 'claude' ? runs.claudeIds.has(s.id)
      : s.tool === 'codex' ? runs.codexIds?.has(s.id)
      : s.tool === 'opencode' && (runs.opencodeIds.has(s.id) || (runs.opencodeDirs.has(s.cwd) && now - s.lastActivity < 6 * 3600_000));
    if (live) { s.status = 'working'; s.lastActivity = Math.max(s.lastActivity, now - 1000); }
  }
}
