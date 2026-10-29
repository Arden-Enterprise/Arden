"""Prepare the bounded 0017 -> 0021 operator SQL bundle. Never executes SQL."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

DATA_FENCE = '-- OPERATOR_DATA_FENCE\n'


def render_upgrade(rows):
    if (not isinstance(rows, list) or len(rows) != 21
            or any(set(row) != {'name', 'sql'}
                   or not isinstance(row['name'], str)
                   or not re.fullmatch(r'\d{4}_[a-z0-9_]+\.sql', row['name'])
                   or not isinstance(row['sql'], str) or not row['sql'].strip()
                   for row in rows)
            or [row['name'][:4] for row in rows] != [f'{n:04}' for n in range(1, 22)]):
        raise ValueError('Expected exact ordered 0001-0021 source inventory')
    expected = ','.join("'" + row['name'][:-4] + "'" for row in rows[:17])
    fence = """DO $$ DECLARE applied text[]; BEGIN
  SELECT array_agg(migration_id ORDER BY migration_id) INTO applied
    FROM public.arden_schema_migrations;
  IF applied IS DISTINCT FROM ARRAY[EXPECTED]::text[] THEN
    RAISE EXCEPTION 'Expected exact 0017 ledger; review this target before upgrading';
  END IF;
END $$;
""".replace('EXPECTED', expected)
    changes = '\n'.join(row['sql'] + "\nINSERT INTO public.arden_schema_migrations(migration_id) "
                        "VALUES ('" + row['name'][:-4] + "');" for row in rows[17:])
    return ("-- Destructive content reset: separate named-environment approval and backup required.\n"
            "BEGIN;\nSET LOCAL lock_timeout = '10s';\nSET LOCAL statement_timeout = '120s';\n"
            "SELECT pg_advisory_xact_lock(hashtext('arden:migrations'));\n"
            + fence + DATA_FENCE + changes + '\nCOMMIT;\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, help='New SQL file inside this checkout’s ignored .private directory')
    args = parser.parse_args()
    root = Path(subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], text=True).strip()).resolve()
    output = Path(args.output).absolute()
    private = root / '.private'
    if (output.suffix != '.sql' or not output.is_relative_to(private)
            or output.parent.resolve() != output.parent or output.exists() or output.is_symlink()):
        raise ValueError('Use a new .sql file inside the real .private directory')
    for extra in [[], ['--cached']]:
        subprocess.run(['git', '-C', str(root), 'diff', *extra, '--exit-code', '--quiet', '--',
                        'apps/api/migrations'], check=True)
    head = subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip()
    names = subprocess.check_output(['git', '-C', str(root), 'ls-tree', '-r', '--name-only', head,
                                     'apps/api/migrations'], text=True).splitlines()
    rows = [{'name': name.rsplit('/', 1)[-1],
             'sql': subprocess.check_output(['git', '-C', str(root), 'show', head + ':' + name]).decode('utf-8')}
            for name in names if name.endswith('.sql')]
    sql = render_upgrade(rows).encode('utf-8')
    if private.is_symlink():
        raise ValueError('Refusing a linked private output directory')
    output.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
    with output.open('xb') as f:
        os.chmod(output, 0o600)
        f.write(sql)
        f.flush()
        os.fsync(f.fileno())
    print(json.dumps({'commit': head, 'sql_sha256': hashlib.sha256(sql).hexdigest(),
                      'pending_migrations': [row['name'][:-4] for row in rows[17:]],
                      'execution': 'not-performed'}))


if __name__ == '__main__':
    main()
