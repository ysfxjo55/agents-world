import { renderUsage } from './usage-view.js';
const $ = id => document.getElementById(id);
let sequence = 0;
async function load() {
  const current = ++sequence;
  $('refresh').disabled = true; $('notice').className = ''; $('notice').textContent = 'Loading usage…';
  try {
    const response = await fetch(`/api/usage?days=${$('period').value}&tool=${$('engine').value}`, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Usage could not be loaded.');
    if (current !== sequence) return;
    renderUsage(document, data); $('content').hidden = false;
  } catch (e) { if (current === sequence) { $('notice').className = 'error'; $('notice').textContent = e.message; } }
  finally { if (current === sequence) $('refresh').disabled = false; }
}
async function allowances() {
  try {
    const response = await fetch('/api/models', { cache: 'no-store' });
    if (!response.ok) throw new Error('unavailable');
    const data = await response.json(), box = $('allowances'); box.replaceChildren();
    for (const [tool, label] of [['claude', 'Claude'], ['codex', 'Codex']]) {
      const value = data.usage?.[tool], chip = document.createElement('span');
      chip.className = `quota ${value?.status || 'unknown'}`;
      const status = { available: 'Available', near: 'Nearly full', exhausted: 'Limit reached', unknown: 'Unknown' }[value?.status] || 'Unknown';
      chip.textContent = `${label}: ${status}${value?.usedPercent != null ? ` · ${Math.round(value.usedPercent)}% used` : ''}`;
      chip.title = value?.observedAt ? `Account observation: ${new Date(value.observedAt).toLocaleString()}. ${value.source === 'manual' ? 'Manually reported.' : 'Reported by CLI.'}` : 'No recent account observation. This is not inferred from token counts.';
      box.append(chip);
    }
  } catch { $('allowances').textContent = 'Account status unavailable. Token history is separate.'; }
}
$('period').onchange = load; $('engine').onchange = load;
$('refresh').onclick = () => { void load(); void allowances(); };
void load(); void allowances();
