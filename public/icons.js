// Bella's own icon set: simple rounded line icons (24x24), tinted per agent. No emoji.
const P = {
  usage: '<path d="M4 20h16M7 16v-5M12 16V5M17 16V8"/>',
  interstellar: '<circle cx="12" cy="12" r="4"/><ellipse cx="12" cy="12" rx="10" ry="3.5" transform="rotate(-20 12 12)"/><path d="M7 9a5.8 5.8 0 0 1 10 0"/>',
  planner: '<rect x="4" y="5" width="16" height="15" rx="3.5"/><path d="M8 3v4M16 3v4M4 10h16"/><path d="M9 15l2 2 4-4"/>',
  'code-reviewer': '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/><path d="M8.6 11.2l1.7 1.7 3.2-3.4"/>',
  architect: '<path d="M4 20h16"/><path d="M6 20V10.5L12 5l6 5.5V20"/><path d="M10 20v-5h4v5"/>',
  'tester-debugger': '<path d="M9.5 3h5M10.5 3v5.5L5.6 17.4A2 2 0 0 0 7.4 20.4h9.2a2 2 0 0 0 1.8-3L13.5 8.5V3"/><path d="M8 14.5h8"/>',
  'study-teacher': '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15.5H6.5A2.5 2.5 0 0 0 4 21z"/><path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H20"/><path d="M9 7.5h6"/>',
  builder: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3.6 17.4a1.9 1.9 0 0 0 2.7 2.7l5.7-5.7a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.2-.6-.6-2.2z"/>',
  'deep-researcher': '<circle cx="10" cy="10" r="6"/><path d="M20 20l-5.6-5.6"/><path d="M10 7v6M7 10h6"/>',
  research: '<circle cx="10" cy="10" r="6"/><path d="M20 20l-5.6-5.6"/><path d="M10 7v6M7 10h6"/>',
  guild: '<path d="M3 9.5L12 4l9 5.5"/><path d="M5.5 10v8M10 10v8M14 10v8M18.5 10v8"/><path d="M3 20.5h18"/>',
  life: '<rect x="3.5" y="3.5" width="7.5" height="7.5" rx="2.2"/><rect x="13" y="3.5" width="7.5" height="5" rx="2.2"/><rect x="13" y="10.5" width="7.5" height="10" rx="2.2"/><rect x="3.5" y="13" width="7.5" height="7.5" rx="2.2"/>',
  board: '<rect x="4" y="3.5" width="16" height="17" rx="3.5"/><path d="M8 9l1.4 1.4L12 7.8M8 15l1.4 1.4L12 13.8M14.5 9.2H17M14.5 15.2H17"/>',
  chess: '<path d="M7 20h10"/><path d="M8.2 20c0-3 .9-4.6 3-6.2-2.2-.6-4.2-2.1-4.2-4.6C7 6.5 9.8 4 13 4c3.2 0 5.2 2.6 5.2 6 0 3-1.6 5-3.6 6.4.9 1 1.3 2.2 1.3 3.6"/><circle cx="12.6" cy="8.6" r=".7" fill="currentColor" stroke="none"/>',
  chat: '<path d="M20.5 12a8 8 0 0 1-11.4 7.2L4 20.5l1.2-4.6A8 8 0 1 1 20.5 12z"/>',
  robot: '<rect x="5" y="8.5" width="14" height="11" rx="3.5"/><path d="M12 4.5v4"/><circle cx="12" cy="4" r="1" fill="currentColor" stroke="none"/><circle cx="9.5" cy="14" r="1.1" fill="currentColor" stroke="none"/><circle cx="14.5" cy="14" r="1.1" fill="currentColor" stroke="none"/>',
  new: '<path d="M12 5v14M5 12h14"/>',
  select: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7"/><path d="M6.5 7l1 12.5h9L17.5 7"/>',
  sunset: '<path d="M3 18.5h18"/><path d="M6.5 15a5.5 5.5 0 0 1 11 0"/><path d="M12 6v2.5M5.2 9l1.6 1.6M18.8 9l-1.6 1.6"/>',
  home: '<path d="M4 11l8-7 8 7"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5.5h4V20"/>',
  moon: '<path d="M20 14.5A8.2 8.2 0 0 1 9.5 4 8.2 8.2 0 1 0 20 14.5z"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  bella: '<path d="M4 18L3 8l5 4 4-7 4 7 5-4-1 10z"/><path d="M4.5 21h15"/>',
  attach: '<path d="M21 11.5l-8.6 8.6a5 5 0 0 1-7-7l8.6-8.6a3.4 3.4 0 0 1 4.8 4.8l-8.7 8.6a1.7 1.7 0 0 1-2.4-2.4l8-8"/>',
  crown: '<path d="M4 18L3 8l5 4 4-7 4 7 5-4-1 10z"/><path d="M4.5 21h15"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
};
export const icon = (name, size = 18, color) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="${color || 'currentColor'}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || P.robot}</svg>`;
// small rounded tile with a tinted background, like an app icon
export const badge = (name, color = '#9aa0b4', size = 24) =>
  `<span class="ibadge" style="--c:${color};width:${size}px;height:${size}px">${icon(name, Math.round(size * 0.66), color)}</span>`;
