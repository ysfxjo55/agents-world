import os from 'node:os';

// Who may call this server? Kept as pure functions so they are easy to test.
//  - Requests addressed to localhost / 127.0.0.1 come from this computer: allowed.
//  - Requests addressed to an extra hostname (your Tailscale name) arrive through `tailscale serve`, which adds the
//    caller's identity in the Tailscale-User-Login header. They are allowed only if that matches the configured owner.
//  - Everything else is refused (this also stops DNS-rebinding from web pages).
export function checkRequest({ host, headers = {}, port, hosts = [], owner = '', selfIps = [] }) {
  const local = [`localhost:${port}`, `127.0.0.1:${port}`];
  if (local.includes(host)) return { ok: true, remote: false };
  if (hosts.includes(host)) {
    if (!owner) return { ok: false, status: 403, error: 'remote access needs an owner login configured' };
    if (headers['tailscale-user-login'] !== owner) return { ok: false, status: 403, error: 'not the owner' };
    // Tailscale reports who is calling. If it is THIS Mac itself (a web page, or a tool it runs, fetching our own tailnet address), refuse:
    // the computer has localhost, and a sandboxed tool must not be able to read everything as "the owner".
    const from = String(headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (from && selfIps.includes(from)) return { ok: false, status: 403, error: 'This computer cannot use its own Tailscale address. Open http://localhost:4321 on the computer.' };
    return { ok: true, remote: true };
  }
  return { ok: false, status: 403, error: 'bad host' };
}

// A browser sends Origin on cross-site writes. Accept only our own addresses.
// Sec-Fetch-Site is a second, independent check: modern browsers say "cross-site" or "same-site" for requests that another
// website (or another app on localhost) makes, and that header cannot be faked by a web page.
export function originAllowed(origin, { port, hosts = [], fetchSite = '' }) {
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return false;
  if (!origin) return true;
  const own = [`localhost:${port}`, `127.0.0.1:${port}`, ...hosts];
  return own.some(h => origin === `http://${h}` || origin === `https://${h}`);
}

export class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
export const safeDecode = (s) => { try { return decodeURIComponent(s); } catch { throw new HttpError(400, 'bad url'); } };

// This computer's own Tailscale addresses (100.64.0.0/10 and fd7a:...), cached for a minute.
let ipCache = { at: 0, ips: [] };
export function ownTailnetIps(nets) {
  if (!nets && Date.now() - ipCache.at < 60_000) return ipCache.ips;
  const all = nets || os.networkInterfaces();
  const ips = Object.values(all).flat().filter(Boolean).map(i => i.address).filter(a => /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a) || /^fd7a:/i.test(a));
  if (!nets) ipCache = { at: Date.now(), ips };
  return ips;
}
