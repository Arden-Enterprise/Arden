"""Operator bootstrap: provision.py /srv/DEDICATED_ROOT DEV1_USER DEV2_USER DEV3_USER DEV4_USER.

Run through sudo after reviewing these files. Existing installations are refused.
The bootstrap does not start containers, modify sudo/SSH policy, or expose ports.
"""
import json
import os
from pathlib import Path
import pwd
import re
import secrets
import shutil
import sys


def postgres_service(root, name, database, password):
    """Keep generated database credentials outside source and expose no database port."""
    secret = root / 'secrets' / f'{name}.password'
    secret.write_text(password)
    secret.chmod(0o600)
    return {
        'image': 'pgvector/pgvector:pg17@sha256:ac08538c6f8b9904c33c8224c5e5706dbe760aca29db1d096972b4052c22a75d',
        'environment': {'POSTGRES_USER': 'postgres', 'POSTGRES_DB': database, 'POSTGRES_PASSWORD_FILE': '/run/secrets/database_password'},
        'secrets': ['database_password'],
        'volumes': [f'{name}_data:/var/lib/postgresql/data'],
        'healthcheck': {'test': ['CMD-SHELL', f'pg_isready -U postgres -d {database}'], 'interval': '5s', 'timeout': '3s', 'retries': 20},
        'mem_limit': '768m', 'cpus': 0.5, 'pids_limit': 200,
        'restart': 'unless-stopped', 'logging': {'driver': 'json-file', 'options': {'max-size': '10m', 'max-file': '3'}}
    }


def provision(root, accounts):
    """Initialize a new dedicated root without changing access grants or existing state."""
    if os.getuid() != 0 or not re.fullmatch(r'/srv/[A-Za-z0-9_-]+', str(root)):
        raise ValueError('Use sudo and a dedicated directory directly under /srv.')
    if len(accounts) != 4:
        raise ValueError('Provide four distinct approved SSH accounts, in dev-1 through dev-4 order.')
    users = [pwd.getpwnam(account) for account in accounts]
    if len({user.pw_uid for user in users}) != 4 or any(user.pw_uid == 0 for user in users):
        raise ValueError('Each development slot requires a distinct non-root SSH account.')
    if root.exists() or root.is_symlink():
        raise ValueError('Target already exists; inspect it and update deliberately instead of reprovisioning.')
    source = Path(__file__).resolve().parent
    root.mkdir(mode=0o755)
    (root / 'ops').mkdir(mode=0o755)
    (root / 'secrets').mkdir(mode=0o700)
    for name in ['sync.py', 'start.py', 'slot_access.py', 'backend.Dockerfile', 'backend-entry.mjs']:
        shutil.copyfile(source / name, root / 'ops' / name)
        (root / 'ops' / name).chmod(0o644)
    assignments = root / 'ops' / 'slot-owners.json'
    assignments.write_text(json.dumps({f'dev-{number}': user.pw_uid for number, user in enumerate(users, 1)}))
    assignments.chmod(0o644)
    (root / '.arden-hosted').write_text('1\n')
    admin = secrets.token_hex(32)
    postgres = postgres_service(root, 'development', 'postgres', admin)
    services = {'postgres': postgres}
    volumes = {'development_data': {}}
    statements = []
    for number in range(1, 5):
        user = users[number - 1]
        slot = f'dev-{number}'
        database = f'arden_dev_{number}'
        password = secrets.token_hex(32)
        directory = root / 'dev' / slot
        directory.mkdir(parents=True, mode=0o755)
        (directory / 'source').mkdir(mode=0o755)
        (directory / 'state').mkdir(mode=0o755)
        # Nested writable volumes need mountpoints before the source bind becomes read-only.
        for relative in ['apps', 'apps/api', 'node_modules', 'apps/api/node_modules']:
            mountpoint = directory / 'source' / relative
            mountpoint.mkdir(parents=True, exist_ok=True)
            os.chown(mountpoint, 1000 if relative.endswith('node_modules') else user.pw_uid,
                     1000 if relative.endswith('node_modules') else user.pw_gid)
        (directory / '.arden-slot').write_text(json.dumps({'port': 3100 + number}))
        # Keep slot identity and its parent root-owned; the contributor writes source/state only.
        (directory / '.arden-slot').chmod(0o644)
        for item in [directory / 'source', directory / 'state']:
            os.chown(item, user.pw_uid, user.pw_gid)
        env = root / 'secrets' / f'{slot}.env'
        env.write_text(f'DATABASE_URL=postgresql://{database}:{password}@postgres:5432/{database}\nARDEN_API_HOST=0.0.0.0\nARDEN_API_PORT=3001\nNODE_ENV=development\n')
        env.chmod(0o600)
        statements.extend([f"CREATE ROLE {database} LOGIN PASSWORD '{password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;", f'CREATE DATABASE {database} OWNER {database};', f'REVOKE CONNECT ON DATABASE {database} FROM PUBLIC;'])
        services[slot] = {
            'image': 'arden-hosted-backend:node24-pnpm11',
            'build': {'context': str(root / 'ops'), 'dockerfile': 'backend.Dockerfile'},
            'env_file': [str(env)],
            'ports': [f'127.0.0.1:{3100 + number}:3001'],
            'volumes': [f'{directory}/source:/workspace:ro', f'{slot}_modules:/workspace/node_modules', f'{slot}_api_modules:/workspace/apps/api/node_modules', f'{slot}_pnpm_store:/pnpm/store'],
            'depends_on': {'postgres': {'condition': 'service_healthy'}},
            'mem_limit': '384m', 'cpus': 0.4, 'pids_limit': 128,
            'cap_drop': ['ALL'], 'security_opt': ['no-new-privileges:true'], 'init': True,
            'restart': 'unless-stopped',
            'healthcheck': {'test': ['CMD', 'node', '-e', "fetch('http://127.0.0.1:3001/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"], 'interval': '10s', 'timeout': '3s', 'retries': 20, 'start_period': '60s'},
            'logging': {'driver': 'json-file', 'options': {'max-size': '10m', 'max-file': '3'}}
        }
        volumes[f'{slot}_modules'] = {}
        volumes[f'{slot}_api_modules'] = {}
        volumes[f'{slot}_pnpm_store'] = {}
    # Initialization runs as the postgres user; the SQL includes generated dev-only passwords.
    init = root / 'secrets' / 'development-init.sql'
    init.write_text('\n'.join(statements) + '\n')
    os.chown(init, 999, 999)
    init.chmod(0o400)
    postgres['volumes'].append(f'{init}:/docker-entrypoint-initdb.d/10-arden.sql:ro')
    development = {'services': services, 'volumes': volumes, 'secrets': {'database_password': {'file': str(root / 'secrets' / 'development.password')}}}
    (root / 'ops' / 'development.yaml').write_text(json.dumps(development, indent=2))
    for environment in ['staging', 'production']:
        password = secrets.token_hex(32)
        service = postgres_service(root, environment, 'arden', password)
        template = {'services': {'postgres': service}, 'volumes': {f'{environment}_data': {}}, 'secrets': {'database_password': {'file': str(root / 'secrets' / f'{environment}.password')}}}
        (root / 'ops' / f'{environment}.yaml').write_text(json.dumps(template, indent=2))
        (root / environment).mkdir(mode=0o700)
    print(json.dumps({'ok': True, 'development_slots': 4, 'release_database_templates': 2, 'containers_started': False}))


if __name__ == '__main__':
    provision(Path(sys.argv[1]), sys.argv[2:])
