import { execFile } from 'node:child_process';
import { clip } from './status.js';

// "Task done" alerts: when a session goes from working to not working, tell the owner once.
// The watcher only compares statuses; the way the alert is shown is passed in, so tests never pop real notifications.

const GAP_MS = 60_000;   // at most one alert per session per minute, even if its status flickers

/** notify({ title, message }) is called once for every session that just stopped working. quiet(s) = true skips a session. */
export function createDoneWatcher({ notify, nameOf = (s) => s.cwd, quiet = (_s) => false, gapMs = GAP_MS }) {
  let last = null;                  // key -> status at the previous check; null until the first check
  const sentAt = new Map();         // key -> when we last alerted for it
  return function check(sessions, now = Date.now()) {
    const prev = last; last = new Map();
    for (const s of sessions) last.set(s.key, s.status);
    if (!prev) return [];           // first look at the world: everything already idle stays quiet
    const done = [];
    for (const s of sessions) {
      if (prev.get(s.key) !== 'working' || s.status === 'working' || s.archived) continue;
      if (s.currentTool) continue;  // a long command or a permission prompt, not a finished task
      if (quiet(s)) continue;
      if (now - (sentAt.get(s.key) ?? -Infinity) < gapMs) continue;
      sentAt.set(s.key, now);
      const alert = { title: clip(nameOf(s) || 'Agents World', 60), message: `Finished: ${clip(s.title || 'your task', 100)}` };
      done.push(alert);
      try { notify(alert)?.catch?.(() => {}); } catch (e) { console.warn('notify failed:', e.message); }
    }
    return done;
  };
}

// AppleScript reads the text from its arguments, so a session name can never become code.
const MAC_SCRIPT = 'on run argv\ndisplay notification (item 2 of argv) with title (item 1 of argv)\nend run';
// PowerShell reads the text from environment variables and XML-escapes it. Windows only shows toasts from a registered app,
// so the toast is sent under PowerShell's own app id (a made-up name like "Agents World" is silently dropped).
const WIN_SCRIPT = [
  '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null',
  '$e = { param($t) [System.Security.SecurityElement]::Escape($t) }',
  '$xml = New-Object Windows.Data.Xml.Dom.XmlDocument',
  '$xml.LoadXml("<toast><visual><binding template=\'ToastGeneric\'><text>$(& $e $env:AW_TITLE)</text><text>$(& $e $env:AW_MESSAGE)</text></binding></visual></toast>")',
  '[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier(\'{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe\').Show([Windows.UI.Notifications.ToastNotification]::new($xml))',
].join('; ');

/** @typedef {(cmd: string, args: string[], opts: object, cb: (err: Error | null) => void) => unknown} Runner */
/**
 * Show a desktop notification. macOS and Windows only; other systems are skipped quietly.
 * @param {{ title: string, message: string }} alert
 * @param {{ platform?: string, run?: Runner }} [deps]
 */
export function desktopNotify({ title, message }, { platform = process.platform, run = execFile } = {}) {
  return new Promise((resolve) => {
    const done = (err) => { if (err) console.warn('desktop notification failed:', err.message); resolve(!err); };
    if (platform === 'darwin') run('osascript', ['-e', MAC_SCRIPT, String(title), String(message)], { timeout: 10_000 }, done);
    else if (platform === 'win32') run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WIN_SCRIPT], { timeout: 15_000, windowsHide: true, env: { ...process.env, AW_TITLE: String(title), AW_MESSAGE: String(message) } }, done);
    else resolve(false);
  });
}

/**
 * Send the alert to an ntfy.sh topic (phone push). The text goes in the body, never in a URL.
 * @param {{ title: string, message: string }} alert
 * @param {string} url
 * @param {(url: string, init: object) => Promise<{ ok: boolean, status?: number }>} [doFetch]
 */
export async function ntfyNotify({ title, message }, url, doFetch = fetch) {
  try {
    const r = await doFetch(url, { method: 'POST', body: `${title}: ${message}`, signal: AbortSignal.timeout(8000) });
    if (!r.ok) console.warn('ntfy failed:', r.status);
    return r.ok;
  } catch (e) { console.warn('ntfy failed:', e.message); return false; }
}

/**
 * The notifier the app uses, built from data/config.json "notify". Returns null when every alert is off.
 * @param {{ desktop?: boolean, ntfy?: string }} settings
 * @param {{ platform?: string, run?: Runner, fetch?: (url: string, init: object) => Promise<{ ok: boolean, status?: number }> }} [deps]
 */
export function makeNotifier(settings, deps = {}) {
  const { desktop = true, ntfy = '' } = settings || {};
  if (!desktop && !ntfy) return null;
  return (alert) => Promise.all([desktop && desktopNotify(alert, deps), ntfy && ntfyNotify(alert, ntfy, deps.fetch)]);
}
