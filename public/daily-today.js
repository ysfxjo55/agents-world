// Show the Today page every time Bella opens — the chat page, the 3D world, or any
// other Bella page. Loaded as a module *after* the host page's own script, so it can
// borrow the chat page's app viewer; anywhere else it falls back to a full-screen
// overlay. Nothing here runs inside an iframe (so the embed and the in-page viewer
// never pop themselves), and "Don't show again today" silences it for the local day.
import { localDateString } from './today-logic.js';
import { KEY as GUIDE_KEY, load as loadGuide, isActive as guideOpen } from './guide-logic.js';

const KEY = 'bella.todayShown';
const today = localDateString();

function isTop() { try { return window.self === window.top; } catch { return false; } }
function snoozed() { try { return localStorage.getItem(KEY) === today; } catch { return false; } }

let overlay = null;
function close() { removeEventListener('keydown', onKey); if (overlay) { overlay.remove(); overlay = null; } }
function onKey(e) { if (e.key === 'Escape') close(); }

function buildOverlay() {
  // No bar of our own: the Today page has its Close / Don't-show buttons inside and tells us (postMessage) to close.
  const frame = document.createElement('iframe'); frame.className = 'today-overlay-frame'; frame.title = 'Today'; frame.src = '/today.html?popup=1';

  overlay = document.createElement('div'); overlay.className = 'today-overlay';
  overlay.append(frame);
  document.body.append(overlay);
  addEventListener('keydown', onKey);
}

// The Today page tells us when its own Close / don't-show buttons are used.
addEventListener('message', (e) => {
  if (e.origin !== location.origin) return;
  const type = e.data && e.data.type;
  if (type === 'bella-today-close' || type === 'bella-today-snooze') {
    if (typeof window.BellaCloseToday === 'function') window.BellaCloseToday();
    close();
  }
});

function guideRunning() { try { return guideOpen(loadGuide(localStorage.getItem(GUIDE_KEY))); } catch { return false; } }   // one popup at a time: the first-steps guide wins
if (isTop() && !snoozed() && !guideRunning()) {
  if (typeof window.BellaOpenToday === 'function') window.BellaOpenToday('/today.html?popup=1', 'Today');
  else buildOverlay();
}
