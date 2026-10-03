import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { snapshot, delta } from './source.mjs';
import { configuration, remote, startBackend, tunnel } from './transport.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const [action, ...args] = process.argv.slice(2);
let stopped = false;
let forward;
let frontend;
let frontendStop;

function stopFrontend() {
  if (!frontend?.pid || frontend.exitCode !== null || frontend.signalCode) return Promise.resolve();
  if (frontendStop) return frontendStop;
  frontendStop = new Promise(resolve => {
    if (process.platform === 'win32') {
      // Stop only the process tree we started; otherwise pnpm can leave Vite behind.
      const cleanup = spawn('taskkill', ['/PID', String(frontend.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      cleanup.once('error', () => { console.error('Could not stop local frontend; close its terminal.'); resolve(); });
      cleanup.once('close', resolve);
    } else {
      try { process.kill(-frontend.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') console.error('Could not stop local frontend.'); }
      resolve();
    }
  });
  return frontendStop;
}

function requestStop() { stopped = true; forward?.kill(); void stopFrontend(); }
process.once('SIGINT', requestStop);
process.once('SIGTERM', requestStop);

async function ready(port) {
  for (let attempt = 0; attempt < 120 && !stopped; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health/ready`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return;
    } catch { /* Startup and tunnel establishment can take a moment. */ }
    await delay(1000);
  }
  throw new Error('Backend did not become ready. The local port may be occupied or the connection may have failed.');
}

async function main() {
  if (!['dev', 'preview', 'status'].includes(action) || (args.length && (args.length !== 2 || args[0] !== '--slot'))) {
    throw new Error('Usage: pnpm dev:remote [--slot dev-1] (or remote:preview / remote:status).');
  }
  const config = await configuration(root, args[1]);
  if (action === 'status') {
    const result = await remote(config, 'status');
    console.log(`${config.slot}: ${result.busy ? 'writer connected' : 'available'}; source files: ${result.files}`);
    return;
  }
  const token = randomUUID();
  let acquired = false;
  try {
    let current = action === 'dev' ? await snapshot(root) : new Map();
    const session = await remote(config, action === 'dev' ? 'acquire' : 'status', token);
    acquired = action === 'dev';
    if (stopped) return;
    if (acquired) {
      await remote(config, 'apply', token, delta(new Map(), current));
      console.log(`Starting ${config.slot}. First dependency install can take several minutes.`);
      await startBackend(config);
    }
    if (stopped) return;
    forward = tunnel(config, session.port);
    forward.once('error', () => { console.error('Unable to start the SSH tunnel.'); stopped = true; });
    forward.once('close', () => { if (!stopped) console.error('SSH tunnel disconnected. Restart the command to reconnect.'); stopped = true; void stopFrontend(); });
    await ready(config.localApiPort);
    if (stopped) return;
    console.log(`${config.slot} backend ready. Starting local frontend; Ctrl+C disconnects and preserves server data.`);
    // pnpm invokes this script; launch its exact CLI with Node, avoiding Windows shell quoting.
    const pnpmCli = process.env.npm_execpath;
    if (!pnpmCli) throw new Error('Run this command with pnpm, so the frontend uses the pinned package manager.');
    frontend = spawn(process.execPath, [pnpmCli, 'dev:web'], { cwd: root, windowsHide: true, detached: process.platform !== 'win32', stdio: 'inherit', env: { ...process.env, ARDEN_DEV_API_PORT: String(config.localApiPort) } });
    frontend.once('error', () => { console.error('Unable to start the frontend.'); stopped = true; });
    frontend.once('close', () => { stopped = true; forward?.kill(); });
    let heartbeat = Date.now();
    while (!stopped) {
      await delay(750);
      if (!acquired || stopped) continue;
      const next = await snapshot(root);
      const update = delta(current, next);
      if (update.files.length || update.manifest.length !== current.size || Date.now() - heartbeat > 30000) {
        await remote(config, 'apply', token, update);
        if (update.files.length || update.manifest.length !== current.size) console.log(`Synced ${update.files.length} backend file(s).`);
        current = next;
        heartbeat = Date.now();
      }
    }
  } finally {
    forward?.kill();
    await stopFrontend();
    if (acquired) {
      try { await remote(config, 'release', token); }
      catch { console.error('Could not release the writer lease. It expires automatically after five minutes.'); }
    }
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
