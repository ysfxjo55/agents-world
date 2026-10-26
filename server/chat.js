import { observeUsageEvent } from './model-usage.js';
import { RunUsage } from './usage-ledger.js';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { clip } from './status.js';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { withToolPath, resolveBin } from './util.js';
import { USER } from './config.js';
import { toolBrief } from './sources/claude.js';
import { personaFor, codexPersonaPrompt } from './family-persona.js';
import { currentEngines, ENGINE_NAMES } from './engines.js';
import { UPLOADS, originalOf } from './uploads.js';

// Runs one chat turn by driving the real CLI headlessly and translating its output into simple events.
// Claude Code: claude -p --output-format stream-json   OpenCode: opencode run --format json   Codex: codex exec --json
// Bella's memory: loaded into every Bella chat; she may read and write ONLY this folder (plus whatever the chosen mode allows)
export const BELLA_MEMORY = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'bella', 'memory');
// look-only tools, including reading (never changing) the Google Calendar when that connector is signed in
const CAL = ['list_events', 'list_calendars', 'get_event', 'search_events'].map(t => `mcp__claude_ai_Google_Calendar__${t}`).join(',');
const READ = `Read,Grep,Glob,WebSearch,WebFetch,${CAL}`;
// "build" = edit files AND run a short list of build/test commands (git, npm run, node, ls...). No rm, sudo, osascript, or internet commands.
// Honest warning: `node` can run any script, so this mode is nearly as powerful as full access. The user must pick it on purpose.
// No curl to this app: an agent in build mode must not call the app's own API to start a new agent with full access.
const BUILD_BASH = ['git', 'npm run', 'npm test', 'node', 'ls', 'cat', 'head', 'tail', 'grep', 'find', 'wc', 'mkdir', 'cp', 'pwd', 'echo'].map(c => `Bash(${c}:*)`).join(',');
export const MODES = {
  readonly: ['--permission-mode', 'default', '--allowedTools', READ],                       // look, never change
  edits:    ['--permission-mode', 'acceptEdits', '--allowedTools', READ + ',Edit,Write'],   // may edit files
  build:    ['--permission-mode', 'acceptEdits', '--allowedTools', READ + ',Edit,Write,' + BUILD_BASH],   // may edit and run builds/tests
  full:     ['--dangerously-skip-permissions'],                                             // anything, no questions
};
const MAX_MS = 30 * 60_000;
// Old history is summarized (compacted) once a chat reaches this size. Without it, 1M-context models compact only near 967k tokens,
// and every message re-sends the whole history once per tool call: a long chat then costs millions of input tokens per message.
export const COMPACT_TOKENS = 150_000;
export const CODEX_COMPACT_TOKENS = 120_000;

export const DELEGATE_BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'delegate');
export const REMEMBER_BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'remember');

// Extra arguments for a chat with Bella: her memory index as context, access to her memory folder, and permission to edit only there.
// Injected into EVERY Bella message (also inside an old, resumed conversation), so she never works from outdated instructions.
export const BELLA_TOOLS = `# Your tools right now (this is always current and beats anything older in this conversation)
- You start, continue and follow agents ONLY with the delegate tool: ${DELEGATE_BIN}  (one command per call, no pipes)
    agents | sessions | start <agent> | continue <session-key> | repo | wait <job> | status <job> | stop <job> | trash <key> | restore <id>
- To continue an OLD agent (an older session remembers its earlier work): run \`delegate sessions\` to find its key, then \`delegate continue <key> "<prompt or @brief file>" --mode build\`. Tell ${USER} which session you are continuing, then do it. Never start a new session when an old one fits.
- QUICK helpers: for a small one-off job (check their calendar, add one event, answer one small question) start the agent with --temp, for example: delegate start <agent> "<prompt>" --temp --mode readonly --title "Check calendar". Tell them first, then read the answer with delegate wait. When it finishes OK the session moves itself to Trash (recoverable), so their list stays clean. Use --temp ONLY for small throwaway jobs; real work (building, reviewing, designs, research) is started normally so it stays visible and can be continued.
- Research Lab: NEVER run delegate research unless ${USER} asks for it in this conversation. It uses a lot of their Claude usage. Do light research yourself with the web tools instead, and ask first if a topic truly needs deep research.
- NEW PROJECT TASKS: do not work in your own HQ folder. Run: delegate newproject <short-name> --brief @<brief file>. It creates a new project folder (its own block in the world) with the brief in its root. After creating it, STOP: tell ${USER} the folder and block name, and ask what they want to do first. Do NOT plan, research or build until they tell you the task. When they do, do only that task, and start any agent with --cwd <that folder>.
- How to run a new project: read project-playbook.md in your memory folder.
- You cannot run git yourself. To see what a builder changed or which branch it is on, use \`delegate repo --cwd <folder>\` (read-only).
- Do NOT use ListAgents, SendMessage or the built-in Agent tool: they are not connected to the sessions in the Bella app and will not reach any of their agents.
- If a command is refused, read the error: it says which chat mode they must pick (top right of the chat page). Tell them that exact option; never say you "cannot reach" an agent before trying the delegate tool.`;

export const REMEMBER_TOOLS = `Save durable facts about ${USER} with ${REMEMBER_BIN} "<fact>" [--said|--observed] [--confirmed] (one command, no pipes).
Notes go to Bella's private inbox. Never save secrets. Ask ${USER} before sensitive personal facts; use --confirmed only after they agree.
Use --said for what they explicitly said; otherwise use --observed. The tool validates and may refuse a note.`;
export function bellaArgs(mode, memDir = BELLA_MEMORY, remote = false, familyDir = path.join(memDir, '..', '..', 'family')) {
  const out = ['--add-dir', memDir, '--add-dir', familyDir, '--disallowedTools', 'Agent,Task,ListAgents,SendMessage'];     // agents are started with the delegate tool, so you can watch them in the world
  let mem = ''; try { mem = `# Bella's memory index (from ${memDir}/MEMORY.md)\n\n` + fs.readFileSync(path.join(memDir, 'MEMORY.md'), 'utf8').slice(0, 12000); } catch { /* no memory yet */ }
  out.push('--append-system-prompt', (remote ? 'Remote read-only chat: do not save notes, edit memory or delegate commands.' : BELLA_TOOLS + '\n\n' + REMEMBER_TOOLS) + '\n\n' + mem);
  if (!remote && mode !== 'full') out.push('--allowedTools', `Edit(/${memDir}/**),Write(/${memDir}/**),Bash(${DELEGATE_BIN}:*),Bash(${REMEMBER_BIN}:*),Edit(/${familyDir}/**),Write(/${familyDir}/**)`);   // the family folder holds the shared profile and the notes inbox she tidies       // "//path" = absolute path in Claude Code's rule syntax
  return out;
}

export const INTERSTELLAR_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'interstellar');
const FAMILY_DIR = path.join(INTERSTELLAR_DIR, '..', 'family');
const AGENTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'agents');

// Interstellar on Claude Code (when Codex is not installed): his instructions live in AGENTS.md in his folder, which only Codex reads by itself.
export function interstellarPrompt(dir = INTERSTELLAR_DIR) {
  let own = ''; try { own = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8').slice(0, 12000); } catch { /* no instructions yet */ }
  return own || 'You are Interstellar, a calm and practical partner who builds and fixes things.';
}

// Bella on Codex (when Claude Code is not installed): her instructions and memory index go in front of the first message.
// Codex has no tool rules like Claude Code, so she cannot start other agents here; the sandbox still applies.
export function bellaCodexPrompt(text, sessionId, remote = false, { agentsDir = AGENTS_DIR, memDir = BELLA_MEMORY } = {}) {
  if (sessionId) return text;
  let who; try { who = fs.readFileSync(path.join(agentsDir, 'bella.md'), 'utf8').replace(/\r\n?/g, '\n').replace(/^---[\s\S]*?---\s*/, ''); } catch { who = 'You are Bella, the user\'s personal assistant.'; }
  let mem = ''; try { mem = fs.readFileSync(path.join(memDir, 'MEMORY.md'), 'utf8').slice(0, 12000); } catch { /* no memory yet */ }
  const note = remote ? 'This is a read-only chat: do not change files.' : `You run on Codex here, so you cannot start other agents. Say so if the user asks for that. Your memory folder is ${memDir}; you can save notes there only when the chat allows editing.`;
  return `[Bella instructions]\n${who}\n${note}\n${mem ? '\n# Your memory index (MEMORY.md)\n' + mem : ''}\n[/Bella instructions]\n\n${text}`;
}
export function chatAccessError({ tool, mode, agent, remote }) {
  if (mode !== 'readonly' && remote) return { status: 403, error: 'Through Tailscale only read-only chat is allowed. Use this computer for editing or full access.' };
  const eng = currentEngines();
  if ((agent === 'bella' || agent === 'interstellar') && !eng[agent]) return { status: 400, error: 'Install and log in to Claude Code or Codex first.' };
  if (agent === 'interstellar' && tool !== eng.interstellar) return { status: 400, error: `Interstellar runs on ${ENGINE_NAMES[eng.interstellar]} here.` };
  if (agent === 'bella' && tool !== eng.bella) return { status: 400, error: `Bella runs on ${ENGINE_NAMES[eng.bella]} here.` };
  if (agent && agent !== 'interstellar' && agent !== 'bella' && tool !== 'claude') return { status: 400, error: 'Agents other than Bella and Interstellar run on Claude Code.' };
  return null;
}

export function buildCodexArgs({ cwd, sessionId = null, mode, addDirs = [] }) {
  const sandbox = { readonly: 'read-only', edits: 'workspace-write', build: 'workspace-write', full: 'danger-full-access' }[mode];
  if (!sandbox) throw new Error('bad mode');
  const args = ['exec', '-c', `model_auto_compact_token_limit=${CODEX_COMPACT_TOKENS}`, '--skip-git-repo-check', '-C', cwd, '--sandbox', sandbox];   // many folders are not git repos; the sandbox still applies
  for (const dir of addDirs) args.push('--add-dir', dir);
  if (sessionId) args.push('resume', sessionId);
  args.push('--json', '-');
  return args;
}

// Bella's delegate tool proves how powerful its chat is with a secret token the server gave that one run. A header the caller wrote
// itself proves nothing: any agent could claim "full". Unknown or missing tokens mean read-only.
const runTokens = new Map();
export const issueRunToken = (mode) => { const t = crypto.randomBytes(16).toString('hex'); runTokens.set(t, mode); return t; };
export const releaseRunToken = (t) => runTokens.delete(t);
export const maxModeForToken = (t) => runTokens.get(String(t || '')) || 'readonly';

export function startRun({ tool, sessionId, cwd, text, mode, agent, images = [], addDirs = [], remote = false, usageSource = 'chat' }, emitCallback, onClose) {
  const eng = currentEngines();
  if (agent === 'interstellar' && tool !== eng.interstellar) throw new Error(`Interstellar runs on ${ENGINE_NAMES[eng.interstellar] || 'Codex'} here.`);
  if (agent === 'bella' && tool !== eng.bella) throw new Error(`Bella runs on ${ENGINE_NAMES[eng.bella] || 'Claude Code'} here.`);
  if (tool === eng.interstellar && path.resolve(cwd) === path.resolve(INTERSTELLAR_DIR)) agent = 'interstellar';
  if (agent === 'interstellar') {
    cwd = INTERSTELLAR_DIR;
    if (!fs.existsSync(cwd)) throw new Error('Interstellar folder is missing: ' + cwd);
  }
  // the agent you start must not inherit Bella's own settings
  const env = Object.fromEntries(Object.entries(withToolPath(process.env)).filter(([k]) => !k.startsWith('AGENT_WORLD_') && !k.startsWith('AGENTS_WORLD_')));
  env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = String(COMPACT_TOKENS);       // Claude Code reads this; see COMPACT_TOKENS
  let runToken = null;
  if (agent === 'bella' && tool === 'claude') { env.BELLA_MAX_MODE = mode; runToken = env.BELLA_RUN_TOKEN = issueRunToken(mode); }   // only on Claude Code, where her tool rules limit what she runs   // BELLA_MAX_MODE is only informational; the server trusts the token and clamps what she may start
  let cmd, args, stdin = null, key = sessionId ? `${tool}:${sessionId}` : null;
  if (tool === 'claude') {
    cmd = 'claude';
    args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', ...MODES[agent === 'bella' && mode === 'build' ? 'edits' : mode]];   // Bella herself never gets the run-commands mode: it is only the ceiling for the agents she starts
    const isNew = !sessionId;
    if (sessionId) args.push('--resume', sessionId); else { sessionId = crypto.randomUUID(); key = `claude:${sessionId}`; args.push('--session-id', sessionId); }
    if (agent && agent !== 'interstellar') args.push('--agent', agent);
    if (agent === 'bella') args.push(...bellaArgs(mode, BELLA_MEMORY, remote));
    if (agent === 'interstellar' && isNew) args.push('--append-system-prompt', interstellarPrompt());   // Claude Code reads CLAUDE.md, not his AGENTS.md
    const persona = personaFor({ tool, agent });
    if (persona) args.push('--append-system-prompt', persona + (remote ? '' : '\n\n' + REMEMBER_TOOLS));
    if (!remote && agent !== 'bella' && mode !== 'full') args.push('--allowedTools', `Bash(${REMEMBER_BIN}:*)`);
    for (const dir of addDirs) args.push('--add-dir', dir);
    const originals = images.map(originalOf).filter(Boolean);
    if (images.length) { args.push('--add-dir', UPLOADS); text += `\n\n[The user attached ${images.length} file${images.length > 1 ? 's' : ''} (images, PDFs or text): ${images.join(', ')}. Open ${images.length > 1 ? 'them' : 'it'} with the Read tool (for a PDF read it page by page if it is long) before answering.]`;
      if (originals.length) text += `\n[The text above was extracted from these ORIGINAL Office files, which are kept unchanged: ${originals.join(', ')}. To change a document or presentation, work on a COPY (never overwrite these): for .docx/.pptx use python-docx / python-pptx if installed, or edit the XML inside the zip; pictures are inside the zip under word/media or ppt/media, unzip a copy to view them; save the result as a new file in the user's project folder or ~/Downloads, and write its full path in your reply (the chat turns a path in Downloads, Desktop or Documents into a Download button for him).]`; }
    stdin = text;
  } else if (tool === 'codex') {
    cmd = 'codex';
    text = agent === 'bella' ? bellaCodexPrompt(text, sessionId, remote) : codexPersonaPrompt(text, agent, sessionId);
    const own = agent === 'interstellar' ? [FAMILY_DIR] : agent === 'bella' && !remote ? [BELLA_MEMORY, FAMILY_DIR] : [];   // the folders each manager may write to
    args = buildCodexArgs({ cwd, sessionId, mode, addDirs: [...new Set([...addDirs, ...(['edits', 'build'].includes(mode) ? own : [])])] });
    if (images.length) text += `\n\n[Attached files: ${images.join(', ')}. Read them before answering.]`;
    stdin = text;
  } else {
    cmd = 'opencode';
    args = ['run', '--format', 'json', '--dir', cwd];
    if (sessionId) args.push('-s', sessionId);
    if (agent) args.push('--agent', agent);
    for (const f of images) args.push(`--file=${f}`);
    args.push(text.startsWith('-') ? ' ' + text : text);   // a leading "-" must not be read as a flag
  }
  const bin = process.env.AGENT_WORLD_TEST_BIN && cmd === 'opencode' ? process.env.AGENT_WORLD_TEST_BIN : cmd === 'codex' && process.env.AGENT_WORLD_TEST_CODEX_BIN ? process.env.AGENT_WORLD_TEST_CODEX_BIN : cmd === 'claude' && process.env.AGENT_WORLD_TEST_CLAUDE_BIN ? process.env.AGENT_WORLD_TEST_CLAUDE_BIN : cmd;   // test hook: a fake program that hangs
  const trackers = new Map();
  const spawnChild = () => {
    const usage = new RunUsage({ tool, agent, sessionId, source: usageSource, attempt: trackers.size + 1 });
    const r = resolveBin(bin, args, { env });
    const c = spawn(r.cmd, r.args, { cwd, env, stdio: [stdin == null ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    trackers.set(c, usage);
    if (stdin != null) { c.stdin.on('error', () => {}); c.stdin.end(stdin); }   // a missing/crashed CLI must not crash the server (EPIPE)
    return c;
  };
  let child = spawnChild(), attempt = 1, gotOutput = false, finished = false;
  const st = { msg: null, blocks: new Map(), denied: [], started: false, result: false, err: '' };
  const start = (id) => { if (st.started) return; st.started = true; key = `${tool}:${id}`; emit({ t: 'start', key, sessionId: id }); };
  let callbackError = null;
  const emit = event => {
    if (callbackError) return;
    try { emitCallback(event); } catch (e) {
      callbackError = e;
      child.kill('SIGKILL');
    }
  };
  const timer = setTimeout(() => child.kill('SIGTERM'), MAX_MS);

  const addBlocks = (id, list) => { const cur = st.blocks.get(id) || []; cur.push(...list); st.blocks.set(id, cur); emit({ t: 'blocks', id, blocks: cur }); };
  const handleClaude = (d) => {
    try { observeUsageEvent('claude', d); } catch { /* optional quota telemetry must not break chat */ }
    if (d.type === 'system' && d.subtype === 'status') emit({ t: 'status', text: d.status === 'requesting' ? 'Thinking…' : d.status });
    else if (d.type === 'stream_event') {
      const e = d.event || {};
      if (e.type === 'message_start') st.msg = e.message?.id;
      else if (e.type === 'content_block_start' && e.content_block?.type === 'tool_use') emit({ t: 'status', text: `Running ${e.content_block.name}…` });
      else if (e.type === 'content_block_start' && e.content_block?.type === 'thinking') emit({ t: 'status', text: 'Thinking…' });
      else if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta') emit({ t: 'delta', id: st.msg, text: e.delta.text });
    } else if (d.type === 'assistant') {
      const list = [];
      for (const b of d.message?.content || []) {
        if (b.type === 'text' && b.text?.trim()) list.push({ type: 'text', text: b.text });
        else if (b.type === 'tool_use') list.push({ type: 'tool', id: b.id, name: b.name, summary: toolBrief(b) });
      }
      if (list.length) addBlocks(d.message.id, list);
    } else if (d.type === 'user') {
      for (const b of Array.isArray(d.message?.content) ? d.message.content : []) if (b.type === 'tool_result') {
        const t = typeof b.content === 'string' ? b.content : (b.content || []).map(x => x.text || '').join(' ');
        emit({ t: 'result', id: b.tool_use_id, text: clip(t, 700), error: !!b.is_error });
      }
    } else if (d.type === 'result') {
      st.result = true;
      emit({ t: 'done', ok: !d.is_error, cost: d.total_cost_usd, denied: (d.permission_denials || []).map(x => x.tool_name).filter(Boolean), error: d.is_error ? clip(d.result || 'error', 300) : null });
    }
  };
  const handleOpen = (d) => {
    if (d.sessionID) start(d.sessionID);
    const p = d.part || {};
    if (d.type === 'step_start') emit({ t: 'status', text: 'Thinking…' });
    else if (d.type === 'text') addBlocks(p.messageID, [{ type: 'text', text: p.text || '' }]);
    else if (d.type === 'tool_use') {
      const i = p.state?.input || {};
      addBlocks(p.messageID, [{ type: 'tool', id: p.callID, name: p.tool, summary: `${p.tool} · ${clip(i.command ?? i.filePath ?? i.pattern ?? i.description ?? '', 160)}` }]);
      emit({ t: 'result', id: p.callID, text: clip(p.state?.output ?? '', 700), error: p.state?.status === 'error' });
    } else if (d.type === 'step_finish' && p.reason === 'stop') { st.result = true; emit({ t: 'done', ok: true, cost: p.cost, denied: [] }); }
    else if (d.type === 'error') emit({ t: 'error', text: clip(JSON.stringify(d.error || d), 300) });
  };
  const handleCodex = (d) => {
    try { observeUsageEvent('codex', d); } catch { /* optional quota telemetry must not break chat */ }
    if (d.type === 'thread.started') start(d.thread_id);
    else if (d.type === 'turn.started') emit({ t: 'status', text: 'Thinking…' });
    else if (d.type === 'item.started' && d.item?.type === 'command_execution') emit({ t: 'status', text: 'Running a command' });
    else if (d.type === 'item.completed') {
      const item = d.item || {};
      if (item.type === 'agent_message' && item.text) addBlocks(item.id, [{ type: 'text', text: item.text }]);
      else if (item.type === 'command_execution') {
        emit({ t: 'status', text: 'Running a command' });
        addBlocks(item.id, [{ type: 'tool', id: item.id, name: 'command', summary: clip(item.command || 'Command', 160), result: clip(item.aggregated_output || '', 700), error: item.exit_code != null && item.exit_code !== 0 }]);
      }
    } else if (d.type === 'turn.completed') {
      if (!st.result) { st.result = true; emit({ t: 'done', ok: true, denied: [] }); }
    } else if (d.type === 'turn.failed' || d.type === 'error') {
      if (!st.result) { st.result = true; emit({ t: 'error', text: clip(d.error?.message || d.message || (typeof d.error === 'string' ? d.error : 'Codex turn failed'), 400) }); }
    }
  };
  // OpenCode sometimes hangs at startup and never even contacts the model. Don't wait forever: stop it, retry once if nothing was
  // created yet (a new session), then say so clearly.
  const START_MS = Number(process.env.AGENT_WORLD_OPENCODE_START_MS) || 90_000;
  let watchdog = null;
  const armWatchdog = () => {
    if (tool !== 'opencode') return;
    clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      if (gotOutput) return;
      child.kill('SIGKILL');
      if (!sessionId && attempt < 2) { attempt++; child = spawnChild(); attach(child); armWatchdog(); return; }   // nothing exists yet, so a retry is safe
      // Report the timeout now; release the run only when the killed child closes.
      clearTimeout(timer);
      emit({ t: 'error', text: `OpenCode did not start (no response in ${Math.round(START_MS / 1000)} seconds${attempt > 1 ? ', tried twice' : ''}). Nothing was changed. Try again, or use Claude Code.` });
    }, START_MS);
  };
  let buf = '';
  const attach = (c) => {
    const usage = trackers.get(c);
    c.stdout.setEncoding('utf8');
    c.stdout.on('data', (chunk) => {
      if (callbackError) return;
      gotOutput = true; clearTimeout(watchdog);
      buf += chunk; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue;
        let d; try { d = JSON.parse(line); } catch { continue; }
        usage.observe(d);
        try { tool === 'claude' ? handleClaude(d) : tool === 'codex' ? handleCodex(d) : handleOpen(d); } catch (e) { emit({ t: 'error', text: e.message }); }
      }
    });
    c.stderr.on('data', (d) => { st.err = (st.err + d).slice(-1500); });
    c.on('error', (e) => { emit({ t: 'error', text: `Could not start ${cmd}: ${e.message}` }); });
    c.on('close', (code, sig) => {
      if (c !== child || finished) { usage.finish({ status: 'stopped' }); return; }
      if (buf.trim()) { try { const d = JSON.parse(buf); usage.observe(d); tool === 'claude' ? handleClaude(d) : tool === 'codex' ? handleCodex(d) : handleOpen(d); } catch {} buf = ''; }
      usage.finish({ sessionId: key?.slice(key.indexOf(':') + 1), status: callbackError || usage.failed || code !== 0 && !sig ? 'failed' : sig ? 'stopped' : st.result ? 'completed' : 'failed' });
      finished = true; clearTimeout(timer); clearTimeout(watchdog);
      if (!st.result) emit({ t: sig ? 'done' : 'error', ok: false, denied: [], text: sig ? 'Stopped' : clip(st.err || `${cmd} exited with code ${code}`, 400), error: sig ? 'Stopped' : null });
      if (runToken) releaseRunToken(runToken);
      try { onClose(key, callbackError); } catch { /* the child has exited; callback failures cannot leak it */ }
    });
  };
  attach(child); armWatchdog();
  if (tool === 'claude') start(sessionId);
  if (tool === 'codex') emit({ t: 'status', text: 'Starting Codex…' });
  return { get child() { return child; }, get key() { return key; } };
}
