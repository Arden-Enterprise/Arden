import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';

const rootFiles = new Set(['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.base.json']);
const serverPackages = new Set(['domain', 'db', 'ai', 'api-client']);
const extensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.yaml', '.yml', '.sql']);
const excluded = new Set(['node_modules', 'dist', 'out', 'coverage', 'fixtures', 'backups', 'data']);

// Mirror only code needed by the API. Git ignores are an additional boundary.
export function allowedSource(name) {
  const parts = name.split('/');
  if (parts.some(part => part.startsWith('.') || excluded.has(part))) return false;
  if (/(secret|credential|token|password|private|\.local)([._-]|$)/i.test(path.basename(name))) return false;
  if (rootFiles.has(name)) return true;
  if (parts[0] === 'apps' && parts[2] === 'package.json' && parts.length === 3) return true;
  if (parts[0] === 'packages' && parts[2] === 'package.json' && parts.length === 3) return true;
  const scope = name.startsWith('apps/api/') || (parts[0] === 'packages' && serverPackages.has(parts[1]));
  return scope && extensions.has(path.extname(name));
}

export async function snapshot(root) {
  const names = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, maxBuffer: 16 * 1024 * 1024 }).toString().split('\0');
  const files = new Map();
  let size = 0;
  for (const name of new Set(names.filter(allowedSource))) {
    const full = path.join(root, name);
    let stat;
    try { stat = await lstat(full); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (!stat.isFile()) throw new Error('Remote source must contain regular files only.');
    for (let parent = path.dirname(full); parent !== root; parent = path.dirname(parent)) {
      if ((await lstat(parent)).isSymbolicLink()) throw new Error('Symlinks are not allowed in remote source.');
    }
    if (stat.size > 2 * 1024 * 1024) throw new Error('A remote source file exceeds the 2 MiB limit.');
    let content;
    try { content = await readFile(full); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    size += content.length;
    if (size > 16 * 1024 * 1024) throw new Error('Remote source exceeds 16 MiB. Review the upload scope.');
    files.set(name, { hash: createHash('sha256').update(content).digest('hex'), content: content.toString('base64') });
  }
  for (const name of [...rootFiles, 'apps/api/package.json', 'apps/api/src/index.ts']) {
    if (!files.has(name)) throw new Error(`Required remote source is missing: ${name}`);
  }
  return files;
}

export function delta(previous, current) {
  return {
    files: [...current].filter(([name, value]) => previous.get(name)?.hash !== value.hash).map(([name, value]) => ({ name, ...value })),
    manifest: [...current.keys()]
  };
}
