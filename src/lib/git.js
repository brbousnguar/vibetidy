// Thin wrappers over the `git` binary. Everything is best-effort: a missing
// repo or a missing git returns null/[] rather than throwing, so callers can
// degrade instead of crashing on a directory that is not a repo yet.

import { spawnSync } from 'node:child_process';

/**
 * Run a git command. Returns trimmed stdout, or null on any failure.
 * @param {string[]} args
 * @param {string} cwd
 */
export function git(args, cwd = process.cwd()) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (res.error || res.status !== 0) return null;
  return res.stdout.trim();
}

/** Repo root for `cwd`, or null when not inside a git repo. */
export const repoRoot = (cwd = process.cwd()) => git(['rev-parse', '--show-toplevel'], cwd);

export const isRepo = (cwd = process.cwd()) => repoRoot(cwd) !== null;

export const currentBranch = (cwd = process.cwd()) =>
  git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);

export const hasCommits = (cwd = process.cwd()) =>
  git(['rev-parse', '--verify', 'HEAD'], cwd) !== null;

/** Files staged for commit (added/copied/modified/renamed only). */
export function stagedFiles(cwd = process.cwd()) {
  const out = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR'], cwd);
  return out ? out.split('\n').filter(Boolean) : [];
}

/** Files staged with their status letter, e.g. [{ status: 'A', file: 'src/x.js' }]. */
export function stagedFilesWithStatus(cwd = process.cwd()) {
  const out = git(['diff', '--cached', '--name-status', '--diff-filter=ACMRD'], cwd);
  if (!out) return [];
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('\t');
      const status = parts[0][0];
      // Renames carry both old and new path; the new path is what matters.
      const file = parts[parts.length - 1];
      return { status, file };
    });
}

/** `git diff --cached --numstat` as [{ added, removed, file }]. Binary files report 0/0. */
export function stagedNumstat(cwd = process.cwd()) {
  const out = git(['diff', '--cached', '--numstat'], cwd);
  if (!out) return [];
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [added, removed, ...rest] = line.split('\t');
      return {
        added: added === '-' ? 0 : Number(added),
        removed: removed === '-' ? 0 : Number(removed),
        file: rest[rest.length - 1],
      };
    });
}

/** Recent commit subjects on this branch, newest first. */
export function recentCommitSubjects(limit = 20, cwd = process.cwd()) {
  if (!hasCommits(cwd)) return [];
  const out = git(['log', `-${limit}`, '--format=%s%n%b'], cwd);
  return out ? out.split('\n').filter(Boolean) : [];
}

/**
 * The `owner/repo` slug parsed from the `origin` remote, or null.
 * Handles both SSH (`git@github.com:o/r.git`) and HTTPS remotes.
 */
export function githubSlug(cwd = process.cwd()) {
  const url = git(['remote', 'get-url', 'origin'], cwd);
  if (!url) return null;
  const m = url.match(/github\.com[:/]+([^/]+)\/(.+?)(?:\.git)?\/?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

/** First existing branch from the usual base names, or null. */
export function defaultBaseBranch(cwd = process.cwd()) {
  const head = git(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], cwd);
  if (head) return head.replace('refs/remotes/origin/', 'origin/');
  for (const candidate of ['origin/main', 'origin/master', 'main', 'master', 'develop']) {
    if (git(['rev-parse', '--verify', '--quiet', candidate], cwd)) return candidate;
  }
  return null;
}

/** `git diff --name-status` for an arbitrary range. */
export function diffNameStatus(range, cwd = process.cwd()) {
  const out = git(['diff', '--name-status', '--diff-filter=ACMRD', range], cwd);
  if (!out) return [];
  return out.split('\n').filter(Boolean).map((line) => {
    const parts = line.split('\t');
    return { status: parts[0][0], file: parts[parts.length - 1] };
  });
}

/** `git diff --numstat` for an arbitrary range. */
export function diffNumstat(range, cwd = process.cwd()) {
  const out = git(['diff', '--numstat', range], cwd);
  if (!out) return [];
  return out.split('\n').filter(Boolean).map((line) => {
    const [added, removed, ...rest] = line.split('\t');
    return {
      added: added === '-' ? 0 : Number(added),
      removed: removed === '-' ? 0 : Number(removed),
      file: rest[rest.length - 1],
    };
  });
}

/** Commit subjects+bodies between base and HEAD. */
export function commitsSince(base, cwd = process.cwd()) {
  const out = git(['log', '--format=%s%n%b', `${base}..HEAD`], cwd);
  return out ? out.split('\n').filter(Boolean) : [];
}

/** Stage a path. Returns true on success. */
export const stage = (file, cwd = process.cwd()) => git(['add', '--', file], cwd) !== null;
