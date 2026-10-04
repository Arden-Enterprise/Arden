import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runSession } from './cli.mjs';
import { allowedSource, snapshot, delta } from './source.mjs';
import { fingerprint } from '../../deploy/hosted/backend-entry.mjs';

const config = { slot: 'dev-1', localApiPort: 3001 };
const source = () => new Map([['apps/api/src/index.ts', { hash: 'fixture', content: 'Zml4dHVyZQ==' }]]);

/** Controlled transport/process boundaries; no real SSH, Docker, or private config. */
function sessionRuntime(overrides = {}) {
  const calls = [];
  const signals = new EventEmitter();
  const forward = new EventEmitter();
  forward.kill = () => { calls.push('kill-tunnel'); forward.emit('close'); };
  const frontend = new EventEmitter();
  return {
    calls, signals, forward, frontend,
    snapshot: async () => source(), delta,
    remote: async (_config, action, token, payload) => { calls.push({ action, token, payload }); return { port: 3101 }; },
    startBackend: async () => { calls.push('start'); },
    tunnel: () => forward,
    ready: async () => { calls.push('ready'); },
    launchFrontend: () => { calls.push('frontend'); return frontend; },
    stopFrontend: async child => { if (child) calls.push('stop-frontend'); },
    wait: async () => signals.emit('SIGINT'),
    report: message => calls.push({ message }),
    ...overrides,
  };
}
const actions = runtime => runtime.calls.filter(value => value?.action).map(value => value.action);

test('writer uploads before startup and releases the same lease on Ctrl+C', async () => {
  const io = sessionRuntime();
  await runSession(config, 'dev', io);
  assert.deepEqual(actions(io), ['acquire', 'apply', 'release']);
  assert.ok(io.calls.findIndex(value => value?.action === 'apply') < io.calls.indexOf('start'));
  assert.ok(io.calls.indexOf('ready') < io.calls.indexOf('frontend'));
  const tokens = io.calls.filter(value => value?.action).map(value => value.token);
  assert.equal(new Set(tokens).size, 1);
  assert.equal(io.calls.filter(value => value === 'stop-frontend').length, 1);
  assert.equal(io.signals.listenerCount('SIGINT') + io.signals.listenerCount('SIGTERM'), 0);
});

test('a rejected competing writer neither uploads nor releases another lease', async () => {
  const io = sessionRuntime({ remote: async () => { throw new Error('active writer'); } });
  await assert.rejects(runSession(config, 'dev', io), /active writer/);
  assert.ok(!io.calls.includes('start'));
  assert.ok(!io.calls.includes('frontend'));
  assert.equal(io.signals.listenerCount('SIGINT'), 0);
});

for (const failure of ['upload', 'startup', 'readiness']) {
  test(`${failure} failure releases an acquired lease without leaving a frontend`, async () => {
    const io = sessionRuntime();
    if (failure === 'upload') {
      const original = io.remote;
      io.remote = async (...args) => { if (args[1] === 'apply') throw new Error('failed upload'); return original(...args); };
    } else if (failure === 'startup') io.startBackend = async () => { throw new Error('failed startup'); };
    else io.ready = async () => { throw new Error('failed readiness'); };
    await assert.rejects(runSession(config, 'dev', io), /failed/);
    assert.equal(actions(io).at(-1), 'release');
    assert.ok(!io.calls.includes('frontend'));
    assert.equal(io.signals.listenerCount('SIGTERM'), 0);
  });
}

test('tunnel disconnect stops the frontend once and releases the writer', async () => {
  const io = sessionRuntime();
  io.wait = async () => io.forward.emit('close');
  await runSession(config, 'dev', io);
  assert.equal(io.calls.filter(value => value === 'stop-frontend').length, 1);
  assert.equal(actions(io).at(-1), 'release');
  assert.ok(io.calls.some(value => value?.message?.includes('disconnected')));
});

test('disconnect during readiness never launches a frontend', async () => {
  const io = sessionRuntime();
  io.ready = async (_port, stopped) => { io.forward.emit('close'); assert.equal(stopped(), true); };
  await runSession(config, 'dev', io);
  assert.ok(!io.calls.includes('frontend'));
  assert.equal(actions(io).at(-1), 'release');
});

test('preview never reserves, uploads, starts, or releases the backend', async () => {
  const io = sessionRuntime({ snapshot: () => { throw new Error('preview must not scan'); } });
  await runSession(config, 'preview', io);
  assert.deepEqual(actions(io), ['status']);
  assert.ok(!io.calls.includes('start'));
  assert.ok(io.calls.includes('stop-frontend'));
});

test('failed lease release reports automatic expiry and still removes signal handlers', async () => {
  const io = sessionRuntime();
  const original = io.remote;
  io.remote = async (...args) => { if (args[1] === 'release') throw new Error('offline'); return original(...args); };
  await runSession(config, 'dev', io);
  assert.ok(io.calls.some(value => value?.message?.includes('five minutes')));
  assert.equal(io.signals.listenerCount('SIGINT'), 0);
});

test('saved deletion produces a complete replacement manifest', async () => {
  const previous = source();
  previous.set('packages/domain/src/old.ts', { hash: 'old', content: '' });
  const update = delta(previous, source());
  assert.deepEqual(update.files, []);
  assert.deepEqual(update.manifest, ['apps/api/src/index.ts']);
});

test('watch loop sends deletion-only updates, not just changed file contents', async () => {
  const io = sessionRuntime();
  let scans = 0;
  io.snapshot = async () => {
    const value = source();
    if (scans++ === 0) value.set('packages/domain/src/old.ts', { hash: 'old', content: '' });
    return value;
  };
  let turns = 0;
  io.wait = async () => { if (turns++ > 0) io.signals.emit('SIGINT'); };
  await runSession(config, 'dev', io);
  const uploads = io.calls.filter(value => value?.action === 'apply');
  assert.equal(uploads.length, 2);
  assert.deepEqual(uploads[1].payload.files, []);
  assert.deepEqual(uploads[1].payload.manifest, ['apps/api/src/index.ts']);
});

test('disconnect drains the actual owned local frontend process', { timeout: 10000 }, async t => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    detached: process.platform !== 'win32', stdio: 'ignore', windowsHide: true,
  });
  t.after(() => { if (child.exitCode === null && !child.signalCode) child.kill('SIGKILL'); });
  const closed = once(child, 'close');
  const io = sessionRuntime();
  io.launchFrontend = () => child;
  delete io.stopFrontend; // Exercise the production platform-specific process cleanup.
  io.wait = async () => io.forward.emit('close');
  await runSession(config, 'dev', io);
  await closed;
  assert.ok(child.exitCode !== null || child.signalCode);
});

/** Build an untracked synthetic workspace; each test removes only its own temp root. */
async function workspace(t) {
  const temporaryParent = path.resolve(os.tmpdir());
  const root = await mkdtemp(path.join(temporaryParent, 'arden-workflow-'));
  assert.equal(path.dirname(path.resolve(root)), temporaryParent);
  assert.ok(path.basename(root).startsWith('arden-workflow-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.base.json', 'apps/api/package.json', 'apps/api/src/index.ts']) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), '{}');
  }
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  return root;
}

test('source allowlist excludes frontend, private files, traversal, and generated data', () => {
  for (const name of ['apps/web/src/main.tsx', '.private/remote.json', 'apps/api/password.json', 'apps/api/../outside.ts', 'apps/api/node_modules/x.js', 'packages/db/data/seed.sql']) {
    assert.equal(allowedSource(name), false, name);
  }
  for (const name of ['apps/api/src/index.ts', 'packages/db/src/schema.sql', 'apps/web/package.json']) assert.equal(allowedSource(name), true, name);
});

test('snapshot respects Git ignores and requires a complete backend', async t => {
  const root = await workspace(t);
  await writeFile(path.join(root, '.gitignore'), 'apps/api/src/ignored.ts\n');
  await writeFile(path.join(root, 'apps/api/src/ignored.ts'), 'private fixture');
  const current = await snapshot(root);
  assert.equal(current.has('apps/api/src/ignored.ts'), false);
  await rm(path.join(root, 'apps/api/src/index.ts'));
  await assert.rejects(snapshot(root), /Required remote source is missing/);
});

test('fingerprint tolerates deleted optional manifests but rejects required deletions', async t => {
  const root = await workspace(t);
  const before = await fingerprint(root);
  await mkdir(path.join(root, 'packages/domain'), { recursive: true });
  assert.equal(await fingerprint(root), before);
  await writeFile(path.join(root, 'packages/domain/package.json'), '{"name":"fixture"}');
  assert.notEqual(await fingerprint(root), before);
  await rm(path.join(root, 'packages/domain/package.json'));
  assert.equal(await fingerprint(root), before);
  await rm(path.join(root, 'apps/api/package.json'));
  await assert.rejects(fingerprint(root), { code: 'ENOENT' });
});
