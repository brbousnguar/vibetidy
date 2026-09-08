import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { installHook, uninstallHook, inspectHook, MARKER } from '../src/lib/hook.js';
import { makeFixture, cleanup, initGitRepo } from './helpers.js';

const dirs = [];
const repo = (files = {}) => {
  const dir = initGitRepo(makeFixture(files));
  dirs.push(dir);
  return dir;
};
after(() => dirs.forEach(cleanup));

describe('installHook', () => {
  test('creates an executable pre-commit hook in a fresh repo', () => {
    const dir = repo();
    const res = installHook(dir);
    assert.equal(res.status, 'installed');
    const content = fs.readFileSync(res.path, 'utf8');
    assert.match(content, /^#!\/bin\/sh/);
    assert.match(content, /tidyrepo issue-check --hook/);
    assert.match(content, /SKIP_ISSUE_CHECK/);
    if (process.platform !== 'win32') {
      assert.ok(fs.statSync(res.path).mode & 0o111, 'hook is executable');
    }
  });

  test('is idempotent', () => {
    const dir = repo();
    installHook(dir);
    assert.equal(installHook(dir).status, 'already');
  });

  test('refuses to clobber a foreign hook without consent', () => {
    const dir = repo();
    const hookPath = path.join(dir, '.git', 'hooks', 'pre-commit');
    fs.writeFileSync(hookPath, '#!/bin/sh\nnpm run lint\n', { mode: 0o755 });

    const res = installHook(dir);
    assert.equal(res.status, 'needs-consent');
    assert.equal(fs.readFileSync(hookPath, 'utf8'), '#!/bin/sh\nnpm run lint\n', 'untouched');
  });

  test('appends to a foreign hook with consent, preserving it', () => {
    const dir = repo();
    const hookPath = path.join(dir, '.git', 'hooks', 'pre-commit');
    fs.writeFileSync(hookPath, '#!/bin/sh\nnpm run lint\n', { mode: 0o755 });

    const res = installHook(dir, { append: true });
    assert.equal(res.status, 'appended');
    const content = fs.readFileSync(hookPath, 'utf8');
    assert.match(content, /npm run lint/, 'existing hook body survives');
    assert.match(content, new RegExp(MARKER.replace(/[>]/g, '.')), 'our block is added');
  });
});

describe('uninstallHook', () => {
  test('deletes a hook that was ours alone', () => {
    const dir = repo();
    const { path: hookPath } = installHook(dir);
    assert.equal(uninstallHook(dir).status, 'removed');
    assert.equal(fs.existsSync(hookPath), false);
  });

  test('strips only our block from a shared hook', () => {
    const dir = repo();
    const hookPath = path.join(dir, '.git', 'hooks', 'pre-commit');
    fs.writeFileSync(hookPath, '#!/bin/sh\nnpm run lint\n', { mode: 0o755 });
    installHook(dir, { append: true });

    assert.equal(uninstallHook(dir).status, 'stripped');
    const content = fs.readFileSync(hookPath, 'utf8');
    assert.match(content, /npm run lint/);
    assert.doesNotMatch(content, /tidyrepo/);
  });

  test('is a no-op when not installed', () => {
    assert.equal(uninstallHook(repo()).status, 'not-installed');
  });
});

describe('inspectHook', () => {
  test('reports a clean repo accurately', () => {
    const state = inspectHook(repo());
    assert.equal(state.exists, false);
    assert.equal(state.installed, false);
    assert.ok(state.path.endsWith(path.join('hooks', 'pre-commit')));
  });
});
