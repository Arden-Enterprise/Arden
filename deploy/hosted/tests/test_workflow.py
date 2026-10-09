"""Linux protocol tests: root is used only for owned, disposable fixture files.

Docker commands are mocked. No SSH, real databases, account creation, live
project directories, or production services are used.
"""
import base64
import fcntl
import hashlib
import io
import json
import multiprocessing
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import coolify_runtime
import operation_fence
import slot_access
import start
import sync

TOKEN = '11111111-1111-1111-1111-111111111111'
OTHER_TOKEN = '22222222-2222-2222-2222-222222222222'


def competing_writer(root, token, barrier, results):
    """Exercise actual non-root ownership and kernel locks in separate processes."""
    os.setgroups([])
    os.setgid(1001)
    os.setuid(1001)
    sync.ROOT = slot_access.ROOT = Path(root)
    barrier.wait(timeout=5)
    try:
        results.put(sync.operation('dev-1', 'acquire', token)['ok'])
    except ValueError:
        results.put(False)


class HostedFixture(unittest.TestCase):
    def setUp(self):
        if os.getuid() != 0:
            self.fail('Run these Linux fixture tests with sudo; real ownership checks are required.')
        temporary = tempfile.TemporaryDirectory(prefix='arden-protocol-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.root.chmod(0o755)
        controls = self.root / 'ops'
        controls.mkdir(mode=0o755)
        (controls / 'development.lock').touch(mode=0o644)
        (controls / 'slot-owners.json').write_text(json.dumps({'dev-1': 1001, 'dev-2': 1002}))
        for number in [1, 2]:
            directory = self.root / 'dev' / f'dev-{number}'
            directory.mkdir(parents=True)
            (directory / '.arden-slot').write_text(json.dumps({'port': 3100 + number}))
            for name in ['source', 'state']:
                (directory / name).mkdir(mode=0o755)
                os.chown(directory / name, 1000 + number, 1000 + number)
        for module in [sync, slot_access, start]:
            self.enterContext(patch.object(module, 'ROOT', self.root))
        self.enterContext(patch.dict(os.environ, {'SUDO_UID': '1001'}))

    def call(self, action, token=TOKEN, payload=None, uid=1001):
        stream = io.TextIOWrapper(io.BytesIO(json.dumps(payload or {}).encode()))
        with stream, patch.object(sync.os, 'getuid', return_value=uid), patch.object(sync.sys, 'stdin', stream):
            return sync.operation('dev-1', action, token)

    def upload(self, extra=None):
        contents = {name: b'fixture' for name in sync.ROOT_FILES | {'apps/api/package.json', 'apps/api/src/index.ts'}}
        contents.update(extra or {})
        return {'manifest': sorted(contents), 'files': [
            {'name': name, 'content': base64.b64encode(value).decode(), 'hash': hashlib.sha256(value).hexdigest()}
            for name, value in contents.items()
        ]}

    def assert_fence_held(self):
        descriptor = os.open(self.root / 'ops' / 'development.lock', os.O_RDWR)
        try:
            with self.assertRaises(BlockingIOError):
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        finally:
            os.close(descriptor)


class SyncTests(HostedFixture):
    def test_competing_writer_cannot_replace_lease(self):
        self.call('acquire')
        with self.assertRaisesRegex(ValueError, 'active writer'):
            self.call('acquire', OTHER_TOKEN)
        self.call('release')
        self.assertTrue(self.call('acquire', OTHER_TOKEN)['ok'])

    def test_simultaneous_nonroot_writers_have_one_winner(self):
        context = multiprocessing.get_context('fork')
        barrier, results = context.Barrier(2), context.Queue()
        children = [context.Process(target=competing_writer, args=(str(self.root), token, barrier, results))
                    for token in [TOKEN, OTHER_TOKEN]]
        try:
            for child in children:
                child.start()
            self.assertEqual(sorted([results.get(timeout=8), results.get(timeout=8)]), [False, True])
            for child in children:
                child.join(timeout=5)
                self.assertEqual(child.exitcode, 0)
        finally:
            for child in children:
                if child.is_alive():
                    child.kill()
                    child.join(timeout=5)
            results.close()
            results.join_thread()

    def test_cross_slot_account_denied_even_with_writer_token(self):
        self.call('acquire')
        with self.assertRaisesRegex(ValueError, 'not assigned'):
            self.call('apply', payload=self.upload(), uid=1002)
        self.assertFalse((self.root / 'dev/dev-1/source/package.json').exists())

    def test_nonroot_account_cannot_modify_operator_assignment_or_fence(self):
        code = """
import os, sys
from pathlib import Path
os.setgroups([])
os.setgid(1001)
os.setuid(1001)
for name in ['slot-owners.json', 'development.lock']:
    try:
        (Path(sys.argv[1]) / 'ops' / name).write_text('tampered')
    except PermissionError:
        continue
    raise SystemExit('operator file was writable')
"""
        result = subprocess.run([sys.executable, '-c', code, str(self.root)], capture_output=True, text=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_deletion_reconciliation_preserves_required_source(self):
        self.call('acquire')
        payload = self.upload({'packages/domain/src/old.ts': b'old'})
        self.call('apply', payload=payload)
        removed = self.root / 'dev/dev-1/source/packages/domain/src/old.ts'
        self.assertTrue(removed.exists())
        wanted = self.upload()
        wanted['files'] = []
        self.call('apply', payload=wanted)
        self.assertFalse(removed.exists())
        self.assertTrue((self.root / 'dev/dev-1/source/apps/api/src/index.ts').exists())
        self.assertEqual(self.call('status')['files'], len(wanted['manifest']))

    def test_expired_lease_rejects_changes_and_allows_new_writer(self):
        self.call('acquire')
        lease = self.root / 'dev/dev-1/state/lease.json'
        lease.write_text(json.dumps({'token': TOKEN, 'expires': 0}))
        with self.assertRaisesRegex(ValueError, 'expired'):
            self.call('apply', payload=self.upload())
        self.assertTrue(self.call('acquire', OTHER_TOKEN)['ok'])

    def test_bad_checksum_and_missing_required_source_do_not_write(self):
        self.call('acquire')
        payload = self.upload()
        payload['files'][-1]['hash'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'checksum'):
            self.call('apply', payload=payload)
        self.assertFalse((self.root / 'dev/dev-1/source/package.json').exists())
        payload = self.upload()
        payload['manifest'].remove('apps/api/src/index.ts')
        with self.assertRaisesRegex(ValueError, 'Required backend source'):
            self.call('apply', payload=payload)

    def test_traversal_secret_paths_and_symlink_escape_are_denied(self):
        source = self.root / 'dev/dev-1/source'
        for name in ['apps/api/../escape.ts', 'apps/api/password.json', '.private/remote.json']:
            with self.assertRaises(ValueError):
                sync.safe_file(source, name)
        (source / 'apps').symlink_to(self.root)
        with self.assertRaisesRegex(ValueError, 'Symlinks'):
            sync.safe_file(source, 'apps/api/src/index.ts')

    def test_sync_mutation_holds_global_fence_and_pause_rejects_it(self):
        original = sync.atomic_json
        def writing(*args):
            self.assert_fence_held()
            return original(*args)
        with patch.object(sync, 'atomic_json', side_effect=writing):
            self.call('acquire')
        (self.root / 'ops/coolify-cutover').touch()
        with self.assertRaisesRegex(ValueError, 'switching'):
            self.call('apply', payload=self.upload())


class FenceTests(HostedFixture):
    def test_exclusive_maintenance_blocks_direct_starts_and_source_writes(self):
        with operation_fence.maintenance(self.root):
            with self.assertRaisesRegex(ValueError, 'maintenance'):
                self.call('acquire')
            with patch.object(start, 'start_managed') as managed:
                with self.assertRaisesRegex(ValueError, 'maintenance'):
                    start.start('dev-1')
                managed.assert_not_called()
        self.assertFalse((self.root / 'ops/coolify-cutover').exists())

    def test_failed_maintenance_stays_paused_until_explicit_recovery(self):
        with self.assertRaisesRegex(RuntimeError, 'interrupted'):
            with operation_fence.maintenance(self.root):
                raise RuntimeError('interrupted')
        with self.assertRaisesRegex(ValueError, 'switching'):
            with operation_fence.development_operation(self.root):
                self.fail('failure must keep admission closed')
        with self.assertRaisesRegex(ValueError, 'already paused'):
            with operation_fence.maintenance(self.root):
                self.fail('recovery must be explicit')
        with operation_fence.maintenance(self.root, resume=True):
            pass
        with operation_fence.development_operation(self.root):
            pass

    def test_missing_writable_and_symlink_fences_fail_closed(self):
        lock = self.root / 'ops/development.lock'
        lock.chmod(0o666)
        with self.assertRaisesRegex(ValueError, 'protected file'):
            with operation_fence.development_operation(self.root):
                self.fail('writable fence accepted')
        lock.unlink()
        with self.assertRaises(FileNotFoundError):
            with operation_fence.development_operation(self.root):
                self.fail('missing fence accepted')
        lock.symlink_to(self.root / 'ops/slot-owners.json')
        with self.assertRaises(OSError):
            with operation_fence.development_operation(self.root):
                self.fail('symlink fence accepted')

    def test_waiting_resume_cannot_run_after_another_operator_unpauses(self):
        marker = self.root / 'ops/coolify-cutover'
        marker.touch()
        original = operation_fence.fcntl.flock
        def completed_while_waiting(descriptor, mode):
            original(descriptor, mode)
            marker.unlink()
        with patch.object(operation_fence.fcntl, 'flock', side_effect=completed_while_waiting):
            with self.assertRaisesRegex(ValueError, 'cleared while waiting'):
                with operation_fence.maintenance(self.root, resume=True):
                    self.fail('stale recovery entered maintenance')

    def test_both_startup_paths_hold_fence_until_startup_finishes(self):
        with patch.object(start, 'start_managed', side_effect=lambda *_: (self.assert_fence_held(), True)[1]):
            self.assertTrue(start.start('dev-1')['ok'])
        with patch.object(start, 'start_managed', return_value=False), \
             patch.object(start.subprocess, 'run', side_effect=lambda *_args, **_kwargs: self.assert_fence_held()) as docker:
            self.assertTrue(start.start('dev-1')['ok'])
            self.assertEqual(docker.call_args.kwargs['timeout'], 210)

    def test_cutover_drains_start_admitted_before_pause(self):
        started, finish_start, paused, entered = [threading.Event() for _ in range(4)]
        failures = []
        def managed(*_):
            started.set()
            if not finish_start.wait(timeout=5):
                raise RuntimeError('startup release timed out')
            return True
        original_open = os.open
        def opening(name, *args, **kwargs):
            descriptor = original_open(name, *args, **kwargs)
            if Path(name).name == 'coolify-cutover':
                paused.set()
            return descriptor
        def starting():
            try:
                start.start('dev-1')
            except Exception as error:
                failures.append(error)
        def migrating():
            try:
                with operation_fence.maintenance(self.root):
                    entered.set()
                    with self.assertRaises(ValueError):
                        with operation_fence.development_operation(self.root):
                            self.fail('operation entered cutover')
            except Exception as error:
                failures.append(error)
        with patch.object(start, 'start_managed', side_effect=managed), patch.object(operation_fence.os, 'open', side_effect=opening):
            starter, operator = threading.Thread(target=starting), threading.Thread(target=migrating)
            starter.start()
            try:
                self.assertTrue(started.wait(timeout=5))
                operator.start()
                self.assertTrue(paused.wait(timeout=5))
                self.assertFalse(entered.is_set())
                self.assert_fence_held()
                with self.assertRaisesRegex(ValueError, 'switching|maintenance'):
                    with operation_fence.development_operation(self.root):
                        self.fail('new operation admitted after pause')
            finally:
                finish_start.set()
                starter.join(timeout=5)
                if operator.ident is not None:
                    operator.join(timeout=5)
            self.assertFalse(starter.is_alive() or operator.is_alive())
        self.assertTrue(entered.is_set())
        self.assertEqual(failures, [])


class ManagedStartupTests(HostedFixture):
    def marker(self, value=None):
        (self.root / 'ops/coolify-development.json').write_text(json.dumps(value or {'service_uuid': 'syntheticproject123'}))

    def test_invalid_markers_and_missing_duplicate_containers_fail_closed(self):
        self.marker({'service_uuid': '../invalid'})
        with self.assertRaises(ValueError):
            coolify_runtime.start_managed(self.root, 'dev-1')
        self.marker()
        for output in ['', 'one two']:
            with patch.object(coolify_runtime.subprocess, 'check_output', return_value=output):
                with self.assertRaisesRegex(ValueError, 'deploy this resource'):
                    coolify_runtime.start_managed(self.root, 'dev-1')

    def test_unhealthy_or_timed_out_services_fail(self):
        self.marker()
        with patch.object(coolify_runtime.subprocess, 'check_output', return_value='container'), \
             patch.object(coolify_runtime, 'inspect_state', return_value={'Running': True, 'Health': {'Status': 'unhealthy'}}):
            with self.assertRaisesRegex(ValueError, 'healthy'):
                coolify_runtime.start_managed(self.root, 'dev-1')
        with patch.object(coolify_runtime.subprocess, 'check_output', return_value='container'), \
             patch.object(coolify_runtime, 'inspect_state', return_value={'Running': True, 'Health': {'Status': 'starting'}}), \
             patch.object(coolify_runtime.time, 'monotonic', side_effect=[0, 181]):
            with self.assertRaisesRegex(ValueError, 'healthy'):
                coolify_runtime.start_managed(self.root, 'dev-1')

    def test_stopped_managed_services_start_only_identified_containers(self):
        self.marker()
        healthy = {'Running': True, 'Health': {'Status': 'healthy'}}
        with patch.object(coolify_runtime.subprocess, 'check_output', side_effect=['database', 'api']), \
             patch.object(coolify_runtime, 'inspect_state', side_effect=[{'Running': False}, healthy, {'Running': False}, healthy]), \
             patch.object(coolify_runtime.subprocess, 'run') as docker:
            self.assertTrue(start.start('dev-1')['ok'])
        self.assertEqual([call.args[0] for call in docker.call_args_list], [['docker', 'start', 'database'], ['docker', 'start', 'api']])

    def test_managed_failure_never_falls_back_to_legacy_compose(self):
        with patch.object(start, 'start_managed', side_effect=ValueError('managed failed')), \
             patch.object(start.subprocess, 'run') as legacy:
            with self.assertRaises(ValueError):
                start.start('dev-1')
            legacy.assert_not_called()

    def test_cross_slot_sudo_caller_is_denied(self):
        with patch.dict(os.environ, {'SUDO_UID': '1002'}), patch.object(start, 'start_managed') as managed:
            with self.assertRaisesRegex(ValueError, 'not assigned'):
                start.start('dev-1')
            managed.assert_not_called()


if __name__ == '__main__':
    unittest.main()
