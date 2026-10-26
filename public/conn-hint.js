// When the live connection to the app does not work, say so (with what to check) instead of "connecting" forever.
export const CONN_HELP = 'Cannot reach Agents World. Check that its window (Terminal or PowerShell) is still open and shows no error, then reload this page. If you use Brave, turn Shields off for localhost.';

/** Calls show(text) when no data arrived within ms, or after errors; hide() once data arrives. Returns { ok, error }. */
export function watchConnection({ show, hide, ms = 10000, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let got = false, errors = 0;
  const t = setTimer(() => { if (!got) show(CONN_HELP); }, ms);
  return {
    ok() { got = true; errors = 0; clearTimer(t); hide(); },
    error() { if (++errors >= 3) show(CONN_HELP); },   // EventSource retries by itself; a short blip is not worth a message
  };
}
