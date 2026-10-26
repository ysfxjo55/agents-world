import { modelUsage, refreshCodexUsage } from './model-usage.js';

// Only route left: the account allowance strip at the top of the Usage page reads this.
export async function modelRouterRoute({ req, res, p, auth, json }) {
  if (p !== '/api/models') return false;
  if (auth.remote) { json(res, 403, { error: 'Account status is only available on this computer.' }); return true; }
  if (req.method !== 'GET') { json(res, 405, { error: 'Use GET.' }); return true; }
  void refreshCodexUsage().catch(() => {});
  json(res, 200, { usage: modelUsage.snapshot() });
  return true;
}
