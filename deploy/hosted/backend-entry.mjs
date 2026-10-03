import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

let child;
let stopping = false;
function requestStop() {
  stopping = true;
  if (child?.pid && child.exitCode === null) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') console.error('Unable to signal backend process group.'); }
  }
}
process.once('SIGTERM', requestStop);
process.once('SIGINT', requestStop);

async function fingerprint() {
  const names = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'apps/api/package.json'];
  for (const parent of ['apps', 'packages']) {
    for (const entry of await readdir(parent, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; })) {
      if (entry.isDirectory()) names.push(`${parent}/${entry.name}/package.json`);
    }
  }
  const hash = createHash('sha256');
  for (const name of [...new Set(names)].sort()) hash.update(name).update(await readFile(name));
  return hash.digest('hex');
}

async function stopChild() {
  if (!child?.pid || child.exitCode !== null || child.signalCode) return;
  const active = child;
  const closed = new Promise(resolve => active.once('close', resolve));
  try { process.kill(-active.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  const timer = setTimeout(() => { try { process.kill(-active.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') console.error('Unable to stop backend process group.'); } }, 10000);
  await closed;
  clearTimeout(timer);
}

async function install() {
  child = spawn('pnpm', ['--filter', '@arden/api...', 'install', '--frozen-lockfile', '--prefer-offline', '--store-dir', '/pnpm/store'], { stdio: 'inherit', detached: true });
  await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(new Error('Frozen backend dependency install failed.'))); });
}

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

main().catch(async error => { console.error(error.message); await stopChild(); process.exitCode = 1; });
