import { TOOLS } from './themes.js';

const LOOKS = {
  bella: { color: '#ff6fae', accent: '#ffc1dc' },
  interstellar: { color: '#ffb347', accent: '#ffd9a0' },
};

export function familyOf(session = {}) {
  if (session?.delegatedBy === 'bella' || session?.delegatedBy === 'interstellar') return session.delegatedBy;
  if (session?.tool === 'claude') return 'bella';
  if (session?.tool === 'codex') return 'interstellar';
  return 'other';
}

export function lookOf(session = {}) {
  const family = familyOf(session);
  if (family !== 'other') return LOOKS[family];
  const tool = TOOLS[session?.tool] || TOOLS.claude;
  return { color: tool.color, accent: tool.accent };
}
