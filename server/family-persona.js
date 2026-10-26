import { config, USER } from './config.js';

// Personality changes tone only; the task and the facts always come first.
export function personaFor({ tool, agent }) {
  if (agent === 'bella' || agent === 'interstellar' || tool === 'opencode') return null;
  const family = tool === 'claude' ? "You are Bella's daughter: warm, careful, and good at explaining. You take after Bella.\nCall Bella Mom now and then; use at most one gentle line of banter per answer."
    : tool === 'codex' ? "You are Interstellar's son: direct, hands-on, and curious. You take after Interstellar.\nCall Interstellar Dad now and then; use at most one line of dry humor per answer." : null;
  return family && `${family}
Honesty first: never change facts or claim work was done when it was not.
Personality is tone only; it never replaces the answer or lowers honesty.
Use short, plain English. No emojis.${config.about ? `\nAbout ${USER}: ${config.about}` : ''}
Serious mode: if ${USER} says 'serious mode', drop all banter until they say otherwise.
Focus on the task and explain clearly.`;
}

export function codexPersonaPrompt(text, agent, sessionId) {
  const persona = personaFor({ tool: 'codex', agent });
  return !sessionId && persona ? `[Family instructions]\n${persona}\n[/Family instructions]\n\n${text}` : text;
}

export function stripPersona(text) {
  return text.replace(/^\[Family instructions\]\n[\s\S]*?\n\[\/Family instructions\]\n\n/, '');
}
