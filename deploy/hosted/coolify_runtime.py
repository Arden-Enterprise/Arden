"""Start existing managed development containers without recreating legacy stacks."""
import json
import re
import stat
import subprocess
import time


def start_managed(root, slot):
    """Return False only for an installation that has never been adopted by Coolify."""
    if not re.fullmatch(r'dev-[1-4]', slot):
        raise ValueError('Only development slots can be started here.')
    if (root / 'ops' / 'coolify-cutover').exists():
        raise ValueError('The operator is switching development management. Try again later.')
    marker = root / 'ops' / 'coolify-development.json'
    if marker.is_symlink():
        raise ValueError('Invalid management marker.')
    if not marker.exists():
        return False
    metadata = marker.stat()
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_mode & 0o022:
        raise ValueError('Management marker must be an operator-owned protected file.')
    project = json.loads(marker.read_text())['service_uuid']
    if not isinstance(project, str) or not re.fullmatch(r'[a-z0-9]{10,64}', project):
        raise ValueError('Invalid managed development service.')
    # No config, images, credentials, or resource IDs come from uploaded source.
    deadline = time.monotonic() + 180
    for service in ['postgres', slot]:
        ids = subprocess.check_output([
            'docker', 'ps', '-aq', '--filter', f'label=com.docker.compose.project={project}',
            '--filter', f'label=com.docker.compose.service={service}',
            '--filter', 'label=coolify.managed=true', '--filter', 'label=coolify.environmentName=development',
        ], text=True, stderr=subprocess.DEVNULL, timeout=15).split()
        if len(ids) != 1:
            raise ValueError('The operator must deploy this resource in Coolify first.')
        container = ids[0]
        state = inspect_state(container)
        if not state['Running']:
            subprocess.run(['docker', 'start', container], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)
        while True:
            state = inspect_state(container)
            if state['Running'] and state.get('Health', {}).get('Status') == 'healthy':
                break
            if not state['Running'] or state.get('Health', {}).get('Status') == 'unhealthy' or time.monotonic() >= deadline:
                raise ValueError('Managed development service did not become healthy.')
            time.sleep(1)
    return True


def inspect_state(container):
    """Inspect state only; never send container credentials into the caller's output."""
    return json.loads(subprocess.check_output(['docker', 'inspect', '--format', '{{json .State}}', container], text=True, stderr=subprocess.DEVNULL, timeout=15))
