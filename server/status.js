// Shared status rules. Each source reduces a session to a "signal"; this turns it into a status.
export const T = {
  WORKING_MS: 60_000,        // activity fresher than this + tool/user event = working
  THINKING_MS: 120_000,      // a user prompt / tool result with no reply yet: model is probably thinking
  PERMISSION_MS: 10_000,     // tool call without result for longer than this = probably waiting on you
  WAIT_SLEEP_MS: 60_000,     // finished and waiting for you with no reply for this long = sleeping ("z")
  SLEEP_MS: 30 * 60_000,     // anything else (e.g. a stuck tool call) sleeps after this long
  HIDE_MS: 14 * 24 * 3600_000,
};

/**
 * signal: { lastEvent: 'user'|'tool_call'|'tool_result'|'assistant_text'|'assistant_end',
 *           lastTs, pendingToolSince?: ms, busyChild?: boolean }
 */
export function computeStatus(sig, now = Date.now()) {
  if (!sig || !sig.lastTs) return 'sleeping';
  const age = now - sig.lastTs;
  if (sig.busyChild && age < T.SLEEP_MS) return 'working';
  if (age > T.SLEEP_MS) return 'sleeping';
  if (sig.pendingToolSince) {
    return now - sig.pendingToolSince > T.PERMISSION_MS ? 'needs' : 'working';
  }
  switch (sig.lastEvent) {
    case 'assistant_end': return age > T.WAIT_SLEEP_MS ? 'sleeping' : 'needs';
    case 'assistant_text': return age < T.WORKING_MS ? 'working' : age > T.WAIT_SLEEP_MS ? 'sleeping' : 'needs';
    case 'tool_call':
    case 'tool_result':
    case 'user': return age < T.THINKING_MS ? 'working' : 'sleeping';
    default: return 'idle';
  }
}

export const clip = (s, n = 300) => {
  s = String(s ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

/** 12 five-minute buckets covering the last hour, oldest first. */
export function bucketize(timestamps, now = Date.now()) {
  const b = new Array(12).fill(0);
  for (const t of timestamps) {
    const i = 11 - Math.floor((now - t) / 300_000);
    if (i >= 0 && i < 12) b[i]++;
  }
  return b;
}
