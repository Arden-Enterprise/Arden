import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let child;
let stopping = false;
/** Signal the whole backend process group, including pnpm's child API watcher. */
function requestStop() {
  stopping = true;
  if (child?.pid && child.exitCode === null) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') console.error('Unable to signal backend process group.'); }
  }
}

/** Detect dependency-input changes separately from ordinary source hot reload. */
export async function fingerprint(root = process.cwd()) {
  const required = new Set(['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'apps/api/package.json']);
  const names = [...required];
  for (const parent of ['apps', 'packages']) {
    for (const entry of await readdir(path.join(root, parent), { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; })) {
      if (entry.isDirectory()) names.push(`${parent}/${entry.name}/package.json`);
    }
  }
  const hash = createHash('sha256');
  for (const name of [...new Set(names)].sort()) {
    let content;
    try { content = await readFile(path.join(root, name)); }
    catch (error) { if (error.code === 'ENOENT' && !required.has(name)) continue; throw error; }
    hash.update(name).update(content);
  }
  return hash.digest('hex');
}

/** Drain the supervised process group, then force-stop it after a bounded grace period. */
async function stopChild() {
  if (!child?.pid || child.exitCode !== null || child.signalCode) return;
  const active = child;
  const closed = new Promise(resolve => active.once('close', resolve));
  try { process.kill(-active.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  const timer = setTimeout(() => { try { process.kill(-active.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') console.error('Unable to stop backend process group.'); } }, 10000);
  await closed;
  clearTimeout(timer);
}

/** Install Linux dependencies from the frozen lockfile into writable dependency volumes. */
async function install() {
  child = spawn('pnpm', ['--filter', '@arden/api...', 'install', '--frozen-lockfile', '--prefer-offline', '--store-dir', '/pnpm/store'], { stdio: 'inherit', detached: true });
  await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(new Error('Frozen backend dependency install failed.'))); });
}

/** Reinstall/restart on dependency changes and fail visibly if the supervised API exits. */
async function main() {
  let installed;
  while (!stopping) {
    const wanted = await fingerprint();
    if (wanted !== installed) {
      console.log('Backend dependency files changed; installing from the lockfile.');
      await stopChild();
      await install();
      if (stopping) break;
      installed = wanted;
      child = spawn('pnpm', ['--filter', '@arden/api', 'dev'], { stdio: 'inherit', detached: true });
      child.once('error', error => { console.error(error.message); stopping = true; });
    }
    if (child?.exitCode !== null || child?.signalCode) throw new Error('Backend development process exited.');
    await delay(2000);
  }
  await stopChild();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.once('SIGTERM', requestStop);
  process.once('SIGINT', requestStop);
  main().catch(async error => { console.error(error.message); await stopChild(); process.exitCode = 1; });
}
