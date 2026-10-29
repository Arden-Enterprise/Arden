// Real built-process regression on a disposable DB; no auth server or model calls.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

const target = new URL(process.env.ARDEN_TEST_DATABASE_URL ?? 'missing-test-database:');
assert.ok(['postgres:', 'postgresql:'].includes(target.protocol)
  && ['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)
  && /^\/arden_test_[a-zA-Z0-9_]+$/.test(target.pathname), 'Refusing a non-disposable/non-loopback database');
const { Pool } = createRequire(resolve('apps/api/package.json'))('pg');
const admin = new Pool({ connectionString: target.href, max: 1, connectionTimeoutMillis: 5000 });
const login = 'arden_test_api_' + randomBytes(12).toString('hex');
const password = randomBytes(24).toString('hex');
const indexLogin = 'arden_test_index_' + randomBytes(12).toString('hex');
let indexCreated = false;
let created = false, temporary, parent, child, exited;
try {
  const identity = await admin.query('SELECT r.rolsuper FROM pg_roles r WHERE r.rolname = current_user');
  assert.equal(identity.rows[0]?.rolsuper, true, 'Disposable fixture administration requires its test superuser');
  // Both SQL literals are generated hexadecimal identifiers, never caller input.
  await admin.query(`CREATE ROLE ${login} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOINHERIT`);
  created = true;
  await admin.query(`GRANT arden_runtime TO ${login}`);
  const runtime = new URL(target); runtime.username = login; runtime.password = password;
  parent = await realpath(tmpdir());
  temporary = await mkdtemp(join(parent, 'arden-startup-'));
  const environment = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP']
    .filter(key => process.env[key]).map(key => [key, process.env[key]]));
  await admin.query(`CREATE ROLE ${indexLogin} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOINHERIT`);
  indexCreated = true;
  await admin.query(`GRANT arden_indexer TO ${indexLogin}`);
  const indexing = new URL(target); indexing.username = indexLogin; indexing.password = password;
  for (const withIndexer of [false, true]) {
  child = spawn(process.execPath, ['dist/index.js'], {
    cwd: resolve('apps/api'), stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...environment, NODE_ENV: 'production', ARDEN_API_HOST: '127.0.0.1', ARDEN_API_PORT: '0',
      ...(withIndexer ? { ARDEN_INDEX_DATABASE_URL: indexing.href } : {}),
      DATABASE_URL: runtime.href, SUPABASE_URL: 'http://127.0.0.1:1',
      SUPABASE_AUTH_PUBLIC_URL: 'https://auth.example.test',
      SUPABASE_PUBLISHABLE_KEY: 'synthetic-not-a-live-key', ARDEN_AUTH_TRUSTED_ORIGINS: 'https://example.test',
      ARDEN_PRIVATE_STORAGE_ROOT: temporary, ARDEN_AI_URL: 'http://127.0.0.1:1',
      ARDEN_AI_SERVICE_TOKEN: 'synthetic-not-a-live-token' },
  });
  exited = once(child, 'exit');
  let output = '', diagnostic = '', timer;
  child.stderr.on('data', bytes => { if (diagnostic.length < 4000) diagnostic += bytes.toString(); });
  try {
    const address = await Promise.race([
      new Promise((accept, reject) => {
        child.stdout.on('data', bytes => {
          if (output.length < 128_000) output += bytes.toString();
          const match = output.match(/Server listening at (http:\/\/127\.0\.0\.1:[0-9]+)/);
          if (match) accept(match[1]);
        });
        child.once('exit', () => reject(new Error('API exited before listening: ' + diagnostic)));
        child.once('error', () => reject(new Error('Built API process could not start')));
      }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('API startup deadline exceeded')), 10_000); }),
    ]);
    const response = await fetch(address + '/api/health/live', { signal: AbortSignal.timeout(3000) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
    if (!withIndexer) {
      assert.match(output, /Embedded indexing is disabled/);
      console.log('Built API stays available without an optional indexing login. No auth/model calls.');
    } else {
      const waitForIdle = async (differentFrom = 0) => {
        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline) {
          const rows = await admin.query('SELECT pid FROM pg_stat_activity WHERE usename = $1 AND state = $2 AND pid <> $3', [indexLogin, 'idle', differentFrom]);
          if (rows.rows[0]) return rows.rows[0].pid;
          assert.ok(child.exitCode === null && child.signalCode === null, 'API exited after optional worker disconnect');
          await delay(100);
        }
        throw new Error('Optional worker did not reconnect within the deadline');
      };
      const idle = await waitForIdle();
      assert.equal((await admin.query('SELECT pg_terminate_backend($1) AS terminated', [idle])).rows[0].terminated, true);
      await waitForIdle(idle);
      assert.match(output, /Indexing database connection interrupted/);
      const ready = await fetch(address + '/api/health/ready', { signal: AbortSignal.timeout(3000) });
      assert.equal(ready.status, 200, 'API database remains usable after worker connection loss');
      console.log('Built API survives an actual terminated idle worker connection; later polling reconnects.');
    }
  } finally {
    clearTimeout(timer);
    child.kill('SIGTERM');
    const force = setTimeout(() => child.kill('SIGKILL'), 5000);
    try { await exited; } finally { clearTimeout(force); child = null; }
  }
  }
} finally {
  try {
    if (child) {
      child.kill('SIGTERM');
      const force = setTimeout(() => child.kill('SIGKILL'), 5000);
      try { await exited; } finally { clearTimeout(force); }
    }
  } finally {
    try {
      if (temporary) {
        if (dirname(temporary) !== parent || !basename(temporary).startsWith('arden-startup-')
            || await realpath(temporary) !== temporary) throw new Error('Unexpected test cleanup target');
        await rm(temporary, { recursive: true });
      }
    } finally {
      try {
        if (created) await admin.query(`DROP ROLE ${login}`);
        if (indexCreated) await admin.query(`DROP ROLE ${indexLogin}`);
      }
      finally { await admin.end(); }
    }
  }
}
