"""Root-owned operator entry point; never accepts a source command or path."""
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent


def start(slot):
    if not re.fullmatch(r'dev-[1-4]', slot):
        raise ValueError('Only development slots can be started here.')
    directory = ROOT / 'dev' / slot
    if directory.is_symlink() or not (directory / '.arden-slot').is_file():
        raise ValueError('Unprovisioned slot.')
    source = directory / 'source'
    if source.is_symlink() or not source.is_dir():
        raise ValueError('Invalid development source directory.')
    # The reviewed Compose and build context are root-owned, outside synced source.
    subprocess.run(['docker', 'compose', '--project-name', 'arden-hosted-dev', '--file', str(ROOT / 'ops' / 'development.yaml'), 'up', '-d', '--wait', '--wait-timeout', '180', 'postgres', slot], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return {'ok': True}


if __name__ == '__main__':
    try:
        result = start(sys.argv[1])
    except (ValueError, IndexError, subprocess.SubprocessError):
        result = {'ok': False}
    print(json.dumps(result))
