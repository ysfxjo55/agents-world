// At login, on the computer, open the Today page once a day so you see it as soon as
// the server starts. Every side effect lives in autoOpen() so the decision itself
// (shouldOpen) stays a pure function that is easy to unit-test. The whole thing is
// best-effort: a failure here must never stop the server from running.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

// today as the user's local date (never UTC), e.g. "2026-10-10"
export function localDateString(date = new Date()) {
  const z = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
}

// Only open when we have not already opened it on this local day (or never opened it).
export function shouldOpen(lastDate, todayDate) {
  return lastDate !== todayDate;
}

// The date we last auto-opened, or null when the file is missing or unreadable.
export function readOpenedDate(file) {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    return s && typeof s.date === 'string' ? s.date : null;
  } catch {
    return null;
  }
}

// Open `url` once a day at login (macOS and Windows), then remember the date. Returns whether
// it opened. `run` and the environment are injectable so tests can watch the command
// and point the state file somewhere safe.
export function autoOpen({ url = '', stateFile = '', today = '', platform = process.platform, env = process.env, run = execFile, log = console.log } = {}) {
  try {
    if (platform !== 'darwin' && platform !== 'win32') return false;
    if (env.AGENT_WORLD_DRYRUN || env.AGENT_WORLD_NO_AUTOOPEN === '1') return false;   // opt-out for tests and dry runs
    if (!shouldOpen(readOpenedDate(stateFile), today)) return false;
    const cmd = env.AGENT_WORLD_OPEN_CMD || (platform === 'win32' ? 'explorer.exe' : 'open');   // explorer.exe opens a URL in the default browser
    run(cmd, [url], (err) => { if (err) log(`auto-open failed: ${err.message}`); });
    try {
      fs.mkdirSync(path.dirname(stateFile), { recursive: true });
      fs.writeFileSync(stateFile, JSON.stringify({ date: today }, null, 2));
    } catch (e) {
      log(`auto-open state write failed: ${e.message}`);   // opening already happened; do not fail the server
    }
    log(`Opened Today at ${url}`);
    return true;
  } catch (e) {
    log(`auto-open skipped: ${e.message}`);
    return false;
  }
}
