// The app was renamed to Agents World. New setting names (AGENTS_WORLD_PORT, ...) are copied to the old ones
// (AGENT_WORLD_PORT, ...) that the code reads, so both work. An old name that is already set wins.
export function applyNewEnvNames(env = process.env) {
  for (const [k, v] of Object.entries(env)) if (k.startsWith('AGENTS_WORLD_')) { const old = 'AGENT_WORLD_' + k.slice(13); if (env[old] === undefined) env[old] = v; }
  return env;
}
applyNewEnvNames();
