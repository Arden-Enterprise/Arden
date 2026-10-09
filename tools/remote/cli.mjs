import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { snapshot, delta } from './source.mjs';
import { configuration, remote, startBackend, tunnel } from './transport.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const [action, ...args] = process.argv.slice(2);
/** Stop our frontend process tree so a transport failure cannot leave an orphan Vite listener. */
function stopFrontend(frontend) {
  if (!frontend?.pid || frontend.exitCode !== null || frontend.signalCode) return Promise.resolve();
  return new Promise(resolve => {
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
}

/** Delay local frontend startup until the forwarded API reports database readiness. */
async function ready(port, isStopped) {
  for (let attempt = 0; attempt < 120 && !isStopped(); attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health/ready`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return;
    } catch { /* Startup and tunnel establishment can take a moment. */ }
    await delay(1000);
  }
  if (isStopped()) return;
  throw new Error('Backend did not become ready. The local port may be occupied or the connection may have failed.');
}

/** Launch the local frontend using the same pinned pnpm CLI that invoked us. */
function launchFrontend(config) {
  const pnpmCli = process.env.npm_execpath;
  if (!pnpmCli) throw new Error('Run this command with pnpm, so the frontend uses the pinned package manager.');
  return spawn(process.execPath, [pnpmCli, 'dev:web'], { cwd: root, windowsHide: true, detached: process.platform !== 'win32', stdio: 'inherit', env: { ...process.env, ARDEN_DEV_API_PORT: String(config.localApiPort) } });
}

/** Own one session's lease/processes; injected I/O exercises cleanup without SSH. */
export async function runSession(config, action, runtime = {}) {
  const io = { snapshot: () => snapshot(root), delta, remote, startBackend, tunnel, ready, launchFrontend, stopFrontend, wait: delay, signals: process, report: message => console.log(message), ...runtime };
  let stopped = false;
  let forward;
  let frontend;
  let frontendStop;
  const stopLocal = () => frontendStop ??= Promise.resolve(io.stopFrontend(frontend));
  const requestStop = () => { stopped = true; forward?.kill(); void stopLocal(); };
  const disconnected = message => {
    if (!stopped) { io.report(message); stopped = true; void stopLocal(); }
  };
  io.signals.once('SIGINT', requestStop);
  io.signals.once('SIGTERM', requestStop);
  const token = randomUUID();
  let acquired = false;
  try {
    let current = action === 'dev' ? await io.snapshot() : new Map();
    const session = await io.remote(config, action === 'dev' ? 'acquire' : 'status', token);
    acquired = action === 'dev';
    if (stopped) return;
    if (acquired) {
      await io.remote(config, 'apply', token, io.delta(new Map(), current));
      io.report(`Starting ${config.slot}. First dependency install can take several minutes.`);
      await io.startBackend(config);
    }
    if (stopped) return;
    forward = io.tunnel(config, session.port);
    forward.once('error', () => disconnected('Unable to start the SSH tunnel.'));
    forward.once('close', () => disconnected('SSH tunnel disconnected. Restart the command to reconnect.'));
    await io.ready(config.localApiPort, () => stopped);
    if (stopped) return;
    io.report(`${config.slot} backend ready. Starting local frontend; Ctrl+C disconnects and preserves server data.`);
    frontend = io.launchFrontend(config);
    frontend.once('error', () => disconnected('Unable to start the frontend.'));
    frontend.once('close', () => { stopped = true; forward?.kill(); });
    let heartbeat = Date.now();
    while (!stopped) {
      await io.wait(750);
      if (!acquired || stopped) continue;
      const next = await io.snapshot();
      const update = io.delta(current, next);
      if (update.files.length || update.manifest.length !== current.size || Date.now() - heartbeat > 30000) {
        await io.remote(config, 'apply', token, update);
        if (update.files.length || update.manifest.length !== current.size) io.report(`Synced ${update.files.length} backend file(s).`);
        current = next;
        heartbeat = Date.now();
      }
    }
  } finally {
    stopped = true;
    forward?.kill();
    await stopLocal();
    if (acquired) {
      try { await io.remote(config, 'release', token); }
      catch { io.report('Could not release the writer lease. It expires automatically after five minutes.'); }
    }
    io.signals.removeListener('SIGINT', requestStop);
    io.signals.removeListener('SIGTERM', requestStop);
  }
}

/** Validate the command/configuration before admitting a development session. */
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
  await runSession(config, action);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
