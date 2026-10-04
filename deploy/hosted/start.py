"""Root-owned operator entry point; never accepts a source command or path."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from slot_access import require_slot_owner
from coolify_runtime import start_managed
from operation_fence import development_operation

ROOT = Path(__file__).resolve().parent.parent


def start(slot):
    """Start only a provisioned development service using root-owned Compose controls."""
    if not re.fullmatch(r'dev-[1-4]', slot):
        raise ValueError('Only development slots can be started here.')
    if os.getuid() != 0:
        raise ValueError('Use the approved privileged startup entry point.')
    require_slot_owner(slot, int(os.environ.get('SUDO_UID', '0')), allow_root=True)
    directory = ROOT / 'dev' / slot
    if directory.is_symlink() or not (directory / '.arden-slot').is_file():
        raise ValueError('Unprovisioned slot.')
    source = directory / 'source'
    if source.is_symlink() or not source.is_dir():
        raise ValueError('Invalid development source directory.')
    with development_operation(ROOT):
        if start_managed(ROOT, slot):
            return {'ok': True}
        # The reviewed Compose and build context are root-owned, outside synced source.
        subprocess.run(['docker', 'compose', '--project-name', 'arden-hosted-dev', '--file', str(ROOT / 'ops' / 'development.yaml'), 'up', '-d', '--wait', '--wait-timeout', '180', 'postgres', slot], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=210)
    return {'ok': True}


if __name__ == '__main__':
    try:
        result = start(sys.argv[1])
    except (ValueError, KeyError, TypeError, OSError, IndexError, subprocess.SubprocessError):
        result = {'ok': False}
    print(json.dumps(result))
