// Starts Agents World and starts it again when an update asks for a restart (exit code 75).
// npm start and the "Agents World" start files run this, so an update needs no terminal work. Ctrl+C stops both.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RESTART = 75;   // the same number as RESTART_CODE in updater.js
const server = path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.js');
let child = null;

function run() {
  child = spawn(process.execPath, [server, ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, AGENT_WORLD_SUPERVISED: '1' } });
  child.on('exit', (code, signal) => {
    if (code === RESTART) { console.log('Restarting Agents World after the update...'); return run(); }
    process.exit(signal ? 1 : code ?? 0);
  });
}
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { child?.kill(s); });
run();
