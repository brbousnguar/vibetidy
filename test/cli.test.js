// End-to-end CLI tests. Nothing here touches the network: the only command
// that would is `readme` without --print-context, which is never exercised.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeFixture, cleanup, initGitRepo, runCli, gitIn, NODE_FIXTURE } from './helpers.js';

const dirs = [];
const fixture = (files) => {
  const dir = makeFixture(files);
  dirs.push(dir);
  return dir;
};
after(() => dirs.forEach(cleanup));

describe('top-level CLI', () => {
  test('--version prints the version', () => {
    const res = runCli(['--version']);
    assert.equal(res.status, 0);
    assert.match(res.stdout.trim(), /^\d+\.\d+\.\d+$/);
  });

  test('--help lists both commands and exits 0', () => {
    const res = runCli(['--help']);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /readme/);
    assert.match(res.stdout, /issue-check/);
  });

  test('no arguments prints help and exits non-zero', () => {
    const res = runCli([]);
    assert.equal(res.status, 1);
    assert.match(res.stdout, /Usage:/);
  });

  test('an unknown command exits 2 and names the known ones', () => {
    const res = runCli(['frobnicate']);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /Unknown command/);
    assert.match(res.stderr, /readme, issue-check/);
  });

  test('an unknown flag exits 2 rather than being ignored', () => {
    const res = runCli(['readme', '--nonsense']);
    assert.equal(res.status, 2);
  });

  test('per-command help works', () => {
    assert.match(runCli(['readme', '--help']).stdout, /--print-context/);
    assert.match(runCli(['issue-check', '--help']).stdout, /--strict/);
  });
});

describe('readme --print-context', () => {
  test('works with no API key and prints grounded facts', () => {
    const dir = fixture(NODE_FIXTURE);
    const res = runCli(['readme', dir, '--print-context'], {
      env: { OPENAI_API_KEY: '', TIDYREPO_API_KEY: '' },
    });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /system prompt/);
    assert.match(res.stdout, /DATABASE_URL/);
    assert.match(res.stdout, /react@\^18\.2\.0/);
    assert.match(res.stdout, /Never invent/);
  });

  test('reports a missing directory instead of scanning nothing', () => {
    const res = runCli(['readme', '/definitely/not/here']);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Not a directory/);
  });

  test('a missing API key is a clear error, and never a network call', () => {
    const dir = fixture(NODE_FIXTURE);
    const res = runCli(['readme', dir], {
      env: { OPENAI_API_KEY: '', TIDYREPO_API_KEY: '', TIDYREPO_PROVIDER: 'openai' },
    });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /No API key found/);
  });
});

describe('issue-check', () => {
  const stagedRepo = (files, branch = 'main') => {
    const dir = initGitRepo(fixture(files));
    gitIn(dir, ['add', '-A']);
    gitIn(dir, ['commit', '-qm', 'initial']);
    if (branch !== 'main') gitIn(dir, ['checkout', '-qb', branch]);
    return dir;
  };

  test('exits 0 outside a git repo is not claimed — it reports the problem', () => {
    const res = runCli(['issue-check', fixture({ 'a.txt': 'x' })]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Not a git repository/);
  });

  test('passes a small staged change', () => {
    const dir = stagedRepo({ 'src/app.js': 'const a = 1;\n' });
    fs.writeFileSync(path.join(dir, 'src/app.js'), 'const a = 2;\n');
    gitIn(dir, ['add', '-A']);

    const res = runCli(['issue-check', dir]);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /no issue needed/);
  });

  test('warns on a feature-sized staged change with no issue, but exits 0', () => {
    const dir = stagedRepo({ 'src/app.js': 'const a = 1;\n' }, 'my-feature');
    fs.writeFileSync(path.join(dir, 'src/feature.js'), 'export const feature = () => {};\n');
    gitIn(dir, ['add', '-A']);

    const res = runCli(['issue-check', dir]);
    assert.equal(res.status, 0, 'warn by default');
    assert.match(res.stderr, /no issue is linked/);
    assert.match(res.stderr, /1 new source file/);
    assert.match(res.stderr, /Warning only/);
  });

  test('--strict turns the same change into a block', () => {
    const dir = stagedRepo({ 'src/app.js': 'const a = 1;\n' }, 'my-feature');
    fs.writeFileSync(path.join(dir, 'src/feature.js'), 'export const feature = () => {};\n');
    gitIn(dir, ['add', '-A']);

    const res = runCli(['issue-check', dir, '--strict']);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Blocked by --strict/);
  });

  test('a numbered branch satisfies the check', () => {
    const dir = stagedRepo({ 'src/app.js': 'const a = 1;\n' }, 'feat/42-add-feature');
    fs.writeFileSync(path.join(dir, 'src/feature.js'), 'export const feature = () => {};\n');
    gitIn(dir, ['add', '-A']);

    const res = runCli(['issue-check', dir, '--strict']);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /Linked to issue #42/);
  });

  test('docs-only changes never trip the check', () => {
    const dir = stagedRepo({ 'src/app.js': 'const a = 1;\n' }, 'docs-work');
    fs.writeFileSync(path.join(dir, 'GUIDE.md'), '# Guide\n'.repeat(200));
    gitIn(dir, ['add', '-A']);

    const res = runCli(['issue-check', dir, '--strict']);
    assert.equal(res.status, 0);
  });
});

describe('issue-check hook management', () => {
  test('installs, reports, and uninstalls', () => {
    const dir = initGitRepo(fixture({ 'a.txt': 'x' }));
    const hookPath = path.join(dir, '.git', 'hooks', 'pre-commit');

    assert.equal(runCli(['issue-check', dir, '--install-hook']).status, 0);
    assert.ok(fs.existsSync(hookPath));

    const again = runCli(['issue-check', dir, '--install-hook']);
    assert.match(again.stdout, /already installed/);

    assert.equal(runCli(['issue-check', dir, '--uninstall-hook']).status, 0);
    assert.equal(fs.existsSync(hookPath), false);
  });

  test('a foreign hook is left alone when consent cannot be given', () => {
    const dir = initGitRepo(fixture({ 'a.txt': 'x' }));
    const hookPath = path.join(dir, '.git', 'hooks', 'pre-commit');
    fs.writeFileSync(hookPath, '#!/bin/sh\necho mine\n', { mode: 0o755 });

    // Non-interactive: confirm() falls back to "no" instead of hanging.
    const res = runCli(['issue-check', dir, '--install-hook']);
    assert.equal(res.status, 0);
    assert.equal(fs.readFileSync(hookPath, 'utf8'), '#!/bin/sh\necho mine\n');
    assert.match(res.stdout, /manually/);
  });
});

describe('documented flags are real flags', () => {
  // A flag printed in --help but missing from the parser exits 2 on use. This
  // caught --no-changelog once; it should never happen twice.
  const flagsIn = (helpText) => [...helpText.matchAll(/^\s{2}(--[a-z-]+)/gm)].map((m) => m[1]);

  for (const command of ['readme', 'issue-check']) {
    test(`${command}: every flag in --help is accepted by the parser`, () => {
      const help = runCli([command, '--help']).stdout;
      const flags = flagsIn(help);
      assert.ok(flags.length > 3, `found flags in ${command} help`);

      for (const flag of flags) {
        // --help short-circuits before the command runs, so pair each flag
        // with it: an unknown flag still fails at parse time, exit 2.
        const res = runCli([command, flag, 'x', '--help']);
        assert.notEqual(res.status, 2, `${flag} is documented but rejected: ${res.stderr.trim()}`);
      }
    });
  }
});
