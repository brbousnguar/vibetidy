// Fixture builder. Fixtures are created in a temp dir per test rather than
// committed, so a nested package.json never confuses tooling in this repo.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/** Create a temp directory populated from a { relativePath: contents } map. */
export function makeFixture(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tidyrepo-test-'));
  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, typeof contents === 'string' ? contents : JSON.stringify(contents, null, 2));
  }
  return dir;
}

export const cleanup = (dir) => fs.rmSync(dir, { recursive: true, force: true });

/** Initialise a git repo in `dir` with an identity, so commits work in CI. */
export function initGitRepo(dir) {
  const run = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  run(['init', '-q', '-b', 'main']);
  run(['config', 'user.email', 'test@example.com']);
  run(['config', 'user.name', 'Test']);
  run(['config', 'commit.gpgsign', 'false']);
  return dir;
}

export const gitIn = (dir, args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });

/** Run the CLI in a child process. Returns { status, stdout, stderr }. */
export function runCli(args, { cwd = process.cwd(), env = {} } = {}) {
  const bin = path.join(import.meta.dirname, '..', 'bin', 'tidyrepo.js');
  const res = spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', ...env },
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

export const NODE_FIXTURE = {
  'package.json': {
    name: 'demo-app',
    version: '1.2.3',
    description: 'A demo application',
    scripts: { dev: 'vite', build: 'vite build', test: 'vitest' },
    dependencies: { react: '^18.2.0', express: '^4.18.0' },
    devDependencies: { vite: '^5.0.0', typescript: '^5.3.0' },
    engines: { node: '>=20' },
    license: 'MIT',
  },
  'package-lock.json': '{}',
  'src/index.js': 'export const hello = () => "hi";\n',
  'src/routes/users.js': 'export const list = () => [];\n',
  '.env.example': [
    '# Postgres connection string',
    'DATABASE_URL=',
    'PORT=3000',
    '',
    'STRIPE_KEY=',
  ].join('\n'),
  'node_modules/junk/index.js': 'module.exports = 1;\n',
  'README.md': '# demo-app\n\nGetting Started with Create React App\n',
};

export const PYTHON_FIXTURE = {
  'pyproject.toml': [
    '[project]',
    'name = "pytool"',
    'version = "0.4.0"',
    'description = "A python tool"',
    'requires-python = ">=3.11"',
    'dependencies = [',
    '  "fastapi>=0.110",',
    '  "pydantic>=2.0",',
    ']',
    '',
    '[project.scripts]',
    'pytool = "pytool.cli:main"',
  ].join('\n'),
  'main.py': 'print("hello")\n',
  'tests/test_main.py': 'def test_ok():\n    assert True\n',
};
