import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const sshOptions = ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ForwardAgent=no', '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=10', '-o', 'ServerAliveCountMax=3'];
/** Quote a validated argument for the remote POSIX shell, not the local Windows shell. */
export const shellQuote = value => `'${value.replaceAll("'", "'\\''")}'`;

/** Validate ignored checkout settings before constructing transport arguments. */
export async function configuration(root, slotArgument) {
  let config;
  try { config = JSON.parse(await readFile(path.join(root, '.private', 'remote.json'), 'utf8')); }
  catch { throw new Error('Create .private/remote.json using docs/engineering/remote-development.md.'); }
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Private remote configuration must be a JSON object.');
  const slot = slotArgument ?? config.defaultSlot;
  if (!/^dev-[1-4]$/.test(slot)) throw new Error('Choose --slot dev-1, dev-2, dev-3, or dev-4.');
  if (typeof config.sshAlias !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(config.sshAlias)) throw new Error('Invalid private SSH alias.');
  if (typeof config.remoteRoot !== 'string' || !/^\/srv\/[a-zA-Z0-9_-]+$/.test(config.remoteRoot)) throw new Error('remoteRoot must name a dedicated directory directly under /srv.');
  const localApiPort = config.localApiPort ?? 3001;
  if (!Number.isInteger(localApiPort) || localApiPort < 1024 || localApiPort > 65535) throw new Error('Invalid local API port.');
  return { ...config, slot, localApiPort };
}

/** Bound the subprocess lifetime/output and keep private SSH diagnostics out of ordinary logs. */
export function run(command, args, { input, timeout = 30000, inherit = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: inherit ? 'inherit' : ['pipe', 'pipe', 'pipe'] });
    let output = '';
    let bytes = 0;
    const timer = setTimeout(() => child.kill(), timeout);
    if (!inherit) {
      child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > 20 * 1024 * 1024) child.kill(); else output += chunk; });
      // SSH errors can contain private host/account metadata. Report a safe error.
      child.stderr.on('data', () => {});
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    }
    child.once('error', () => { clearTimeout(timer); reject(new Error(`Unable to start ${command}. Check its installation.`)); });
    child.once('close', code => { clearTimeout(timer); code === 0 ? resolve(output) : reject(new Error(`${command} failed. Check access, the slot lease, and the private server setup.`)); });
  });
}

/** Invoke the unprivileged slot protocol; the token and payload travel only over verified SSH. */
export async function remote(config, action, token = '', payload = {}) {
  const command = ['python3', `${config.remoteRoot}/ops/sync.py`, config.slot, action, token].map(shellQuote).join(' ');
  const output = await run('ssh', [...sshOptions, config.sshAlias, command], { input: JSON.stringify(payload) });
  const result = JSON.parse(output);
  if (!result.ok) throw new Error(result.error ?? 'Remote operation failed.');
  return result;
}

/** Elevate only the root-owned development start entry point, never synced source. */
export async function startBackend(config) {
  const command = ['sudo', '-n', 'python3', `${config.remoteRoot}/ops/start.py`, config.slot].map(shellQuote).join(' ');
  const output = await run('ssh', [...sshOptions, config.sshAlias, command], { timeout: 240000 });
  const result = JSON.parse(output);
  if (!result.ok) throw new Error('Backend startup failed. Ask the server operator to inspect its scoped logs.');
}

/** Start a loopback-only forward whose child-process lifetime belongs to the caller. */
export function tunnel(config, remotePort) {
  return spawn('ssh', [...sshOptions, '-o', 'ExitOnForwardFailure=yes', '-N', '-L', `127.0.0.1:${config.localApiPort}:127.0.0.1:${remotePort}`, config.sshAlias], { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] });
}
