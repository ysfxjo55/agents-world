const names = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode', chat: 'Chat', delegation: 'Delegated agents', family: 'Family chat', research: 'Research Lab', today: 'Today' };
const number = n => n == null ? '—' : new Intl.NumberFormat('en-US').format(n);
const total = row => row.totalTokens ?? (row.inputTokens == null && row.outputTokens == null ? null : (row.inputTokens ?? 0) + (row.outputTokens ?? 0));
const date = n => new Date(n).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export function renderUsage(doc, data) {
  const $ = id => doc.getElementById(id);
  const node = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const totals = data.totals;
  $('total').textContent = number(totals.totalTokens); $('input').textContent = number(totals.inputTokens); $('output').textContent = number(totals.outputTokens); $('runs').textContent = number(totals.runs);
  $('cache').textContent = totals.cachedInputTokens == null ? 'Cache reads not reported' : `${number(totals.cachedInputTokens)} input tokens read from cache`;
  $('coverage').textContent = `${totals.reportedRuns} of ${totals.runs} runs report input and output${totals.failedRuns ? ` · ${totals.failedRuns} failed or stopped` : ''}`;
  $('notice').textContent = data.truncated ? 'Showing the latest saved history only; older records exceed the read limit.' : data.trackingSince ? `Tracking since ${date(data.trackingSince)} · Updated ${date(data.now)} · Unknown counts stay unknown.` : 'Tracking is ready. Earlier usage is not imported. No new finished runs have been recorded yet.';
  if (data.correctedRuns) $('notice').textContent += ` Corrected ${data.correctedRuns} cumulative Codex ${data.correctedRuns === 1 ? 'entry' : 'entries'} against native records.`;
  if (data.unverifiedRuns) $('notice').textContent += ` ${data.unverifiedRuns} runs lack a reliable starting counter; their counts are excluded.`;
  const engines = $('engineCards'); engines.replaceChildren();
  for (const tool of ['claude', 'codex', 'opencode']) {
    const value = data.engines.find(r => r.label === tool), card = node('article', 'engine-card'); card.style.setProperty('--engine', `var(--${tool})`);
    const header = node('header'); header.append(node('h2', '', names[tool]), node('strong', '', value ? number(value.totalTokens) : '—'));
    card.append(header, node('p', '', value ? `${value.runs} ${value.runs === 1 ? 'run' : 'runs'} · ${value.reportedRuns} with input and output` : 'No recorded runs in this selection')); engines.append(card);
  }
  function bars(id, rows) {
    const box = $(id); box.replaceChildren();
    if (!rows.length) { box.append(node('p', 'empty', 'No reported usage in this selection.')); return; }
    const max = Math.max(1, ...rows.map(r => total(r) ?? 0));
    for (const row of rows) {
      const item = node('div', 'bar-row'), label = names[row.label] || row.label || 'Default / unreported', track = node('div', 'bar-track'), fill = node('div', 'bar-fill');
      fill.style.width = `${Math.max(0, (total(row) ?? 0) / max * 100)}%`; track.append(fill);
      const text = node('span', 'bar-label', label); text.title = label;
      item.append(text, track, node('span', 'bar-value', number(total(row)))); box.append(item);
    }
  }
  bars('daily', data.daily); bars('sources', data.sources.sort((a, b) => (b.totalTokens ?? 0) - (a.totalTokens ?? 0))); bars('models', data.models.sort((a, b) => (b.totalTokens ?? 0) - (a.totalTokens ?? 0)));
  const body = $('recent'); body.replaceChildren(); $('empty').hidden = data.recent.length > 0;
  for (const run of data.recent) {
    const row = node('tr'), engine = node('td');
    if (run.sessionId) {
      const link = node('a', '', names[run.tool]); link.href = `/chat.html#${run.tool}:${encodeURIComponent(run.sessionId)}`; link.target = '_top'; link.title = 'Open this session'; engine.append(link);
    } else engine.append(node('span', '', names[run.tool]));
    engine.append(node('small', '', run.agent || (run.sessionId ? run.sessionId.slice(0, 12) : 'Session not reported')));
    const model = node('td', 'model', run.model || 'Default / unreported'); model.title = run.model || 'CLI did not report a model';
    const duration = Math.max(0, Math.round((run.endedAt - run.startedAt) / 1000));
    const source = node('td', '', names[run.source] || run.source);
    if (run.attempt > 1) source.append(node('small', '', `Attempt ${run.attempt}`));
    row.append(node('td', '', date(run.endedAt)), engine, source, model, node('td', 'number', number(run.inputTokens)), node('td', 'number', number(run.cachedInputTokens)), node('td', 'number', number(run.outputTokens)), node('td', 'number', duration < 60 ? `${duration}s` : `${Math.floor(duration / 60)}m ${duration % 60}s`));
    const status = node('td'); status.append(node('span', `status ${run.status}`, run.status)); row.append(status); body.append(row);
    if (run.counterBefore && run.counterAfter && run.inputTokens != null) {
      const proofRow = node('tr'), cell = node('td'); cell.colSpan = 9;
      const details = node('details', 'count-proof'), summary = node('summary', '', 'Check this count');
      details.append(summary, node('p', '', `Input counter: ${number(run.counterAfter.input_tokens)} after − ${number(run.counterBefore.input_tokens)} before = ${number(run.inputTokens)} for this run.`), node('p', '', `Output counter: ${number(run.counterAfter.output_tokens)} after − ${number(run.counterBefore.output_tokens)} before = ${number(run.outputTokens)} for this run. Cached input is already included in input.`));
      cell.append(details); proofRow.append(cell); body.append(proofRow);
    }
  }
}
