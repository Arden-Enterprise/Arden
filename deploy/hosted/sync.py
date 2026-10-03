"""Unprivileged, bounded source sync for four development slots only."""
import base64
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import time
from slot_access import require_slot_owner

ROOT = Path(__file__).resolve().parent.parent
ROOT_FILES = {'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.base.json'}
PACKAGES = {'domain', 'db', 'ai', 'api-client'}
EXTENSIONS = {'.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.yaml', '.yml', '.sql'}
EXCLUDED = {'node_modules', 'dist', 'out', 'coverage', 'fixtures', 'backups', 'data'}
LEASE_SECONDS = 300


def permitted(name):
    """Enforce the server upload allowlist independently of the contributor CLI."""
    parts = name.split('/')
    if any(not part or part.startswith('.') or part in EXCLUDED for part in parts):
        return False
    if '\\' in name or re.search(r'(secret|credential|token|password|private|\.local)([._-]|$)', parts[-1], re.I):
        return False
    if name in ROOT_FILES:
        return True
    if len(parts) == 3 and parts[0] in {'apps', 'packages'} and parts[2] == 'package.json':
        return True
    scope = name.startswith('apps/api/') or (len(parts) > 2 and parts[0] == 'packages' and parts[1] in PACKAGES)
    return scope and Path(name).suffix in EXTENSIONS


def safe_file(source, name):
    """Resolve a permitted regular source path without traversal or symlink escapes."""
    if not isinstance(name, str) or not permitted(name):
        raise ValueError('Source path is outside the upload allowlist.')
    target = source / name
    for item in [source, target, *target.parents]:
        if item == source.parent:
            break
        if item.is_symlink():
            raise ValueError('Symlinks are not permitted in hosted source.')
    if not target.resolve().is_relative_to(source.resolve()):
        raise ValueError('Source path escaped its slot.')
    return target


def atomic_json(target, value):
    """Replace slot metadata atomically while keeping writer credentials private."""
    temporary = target.with_suffix('.tmp')
    temporary.write_text(json.dumps(value))
    temporary.chmod(0o600 if target.name == 'lease.json' else 0o644)
    temporary.replace(target)


def operation(slot, action, token):
    """Serialize each writer operation; status remains readable without a writer token."""
    if not re.fullmatch(r'dev-[1-4]', slot):
        raise ValueError('Only development slots accept source sync.')
    directory = ROOT / 'dev' / slot
    if directory.is_symlink() or not (directory / '.arden-slot').is_file():
        raise ValueError('The server operator must provision this slot first.')
    source = directory / 'source'
    if source.is_symlink():
        raise ValueError('Invalid source directory.')
    port = json.loads((directory / '.arden-slot').read_text())['port']
    state = directory / 'state'
    if state.is_symlink() or not state.is_dir():
        raise ValueError('The server operator must prepare protected slot state first.')
    if action == 'status':
        # Viewers may read status without receiving the private writer token or write permission.
        status_path = state / 'status.json'
        status = json.loads(status_path.read_text()) if status_path.exists() else {}
        return {'ok': True, 'port': port, 'busy': status.get('expires', 0) > time.time(), 'files': status.get('files', 0)}
    require_slot_owner(slot, os.getuid())
    with (state / 'sync.lock').open('a') as lock:
        os.chmod(state / 'sync.lock', 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX)
        lease_path = state / 'lease.json'
        manifest_path = state / 'manifest.json'
        lease = json.loads(lease_path.read_text()) if lease_path.exists() else {}
        manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else []
        active = lease.get('expires', 0) > time.time()
        if not re.fullmatch(r'[a-f0-9-]{36}', token):
            raise ValueError('Invalid writer token.')
        if action == 'acquire':
            if active and lease.get('token') != token:
                raise ValueError('This slot has an active writer. Choose another slot or use remote:preview.')
            atomic_json(lease_path, {'token': token, 'expires': time.time() + LEASE_SECONDS})
            atomic_json(state / 'status.json', {'expires': time.time() + LEASE_SECONDS, 'files': len(manifest)})
            return {'ok': True, 'port': port}
        if lease.get('token') != token or not active:
            raise ValueError('Writer lease expired or belongs to another session. Restart the command.')
        if action == 'release':
            lease_path.unlink()
            atomic_json(state / 'status.json', {'expires': 0, 'files': len(manifest)})
            return {'ok': True}
        if action != 'apply':
            raise ValueError('Unknown operation.')
        request = sys.stdin.buffer.read(24 * 1024 * 1024 + 1)
        if len(request) > 24 * 1024 * 1024:
            raise ValueError('Source request is too large.')
        update = json.loads(request)
        wanted = update['manifest']
        if not isinstance(wanted, list) or len(wanted) > 10000 or len(set(wanted)) != len(wanted):
            raise ValueError('Invalid source manifest.')
        for name in wanted:
            safe_file(source, name)
        for required in ROOT_FILES | {'apps/api/package.json', 'apps/api/src/index.ts'}:
            if required not in wanted:
                raise ValueError('Required backend source is missing.')
        prepared = []
        total = 0
        for item in update['files']:
            name = item['name']
            if name not in wanted:
                raise ValueError('Unexpected source file.')
            target = safe_file(source, name)
            content = base64.b64decode(item['content'], validate=True)
            total += len(content)
            if len(content) > 2 * 1024 * 1024 or total > 16 * 1024 * 1024:
                raise ValueError('Source size limit exceeded.')
            if hashlib.sha256(content).hexdigest() != item['hash']:
                raise ValueError('Source checksum mismatch.')
            prepared.append((target, content))
        # Acknowledge only after every file and deletion has been applied.
        for target, content in prepared:
            target.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as temporary:
                temporary.write(content)
            os.chmod(temporary.name, 0o644)
            os.replace(temporary.name, target)
        for name in set(manifest) - set(wanted):
            target = safe_file(source, name)
            if target.is_file():
                target.unlink()
        atomic_json(manifest_path, wanted)
        atomic_json(lease_path, {'token': token, 'expires': time.time() + LEASE_SECONDS})
        atomic_json(state / 'status.json', {'expires': time.time() + LEASE_SECONDS, 'files': len(wanted)})
        return {'ok': True}


if __name__ == '__main__':
    try:
        result = operation(*sys.argv[1:])
    except (ValueError, KeyError, TypeError, OSError) as error:
        # Path/system exception strings can disclose private metadata.
        message = str(error) if isinstance(error, ValueError) else 'Invalid request or unavailable slot. Ask the server operator to inspect it.'
        result = {'ok': False, 'error': message}
    print(json.dumps(result))
