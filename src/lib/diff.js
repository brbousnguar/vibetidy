// Diff preview. Uses `git diff --no-index` when git is available (nice colors,
// familiar output) and falls back to a plain line diff otherwise.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { dim, green, red } from './ui.js';

/** Unified diff between two strings, as a printable string. */
export function renderDiff(before, after, label = 'README.md') {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vibetidy-'));
  const a = path.join(tmp, 'current');
  const b = path.join(tmp, 'proposed');
  try {
    fs.writeFileSync(a, before);
    fs.writeFileSync(b, after);
    const res = spawnSync(
      'git',
      ['diff', '--no-index', '--src-prefix=a/', '--dst-prefix=b/', '--', a, b],
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
    );
    if (!res.error && typeof res.stdout === 'string' && res.stdout.length) {
      // Rewrite the temp paths back to the real filename.
      return res.stdout
        .split('\n')
        .filter((l) => !l.startsWith('index ') && !l.startsWith('diff --git'))
        .map((l) => (l.startsWith('--- ') ? `--- ${label} (current)` : l.startsWith('+++ ') ? `+++ ${label} (proposed)` : l))
        .join('\n');
    }
  } catch {
    // fall through to the plain diff
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return plainDiff(before, after, label);
}

/** Last-resort diff: no git, so just show removed-then-added blocks. */
function plainDiff(before, after, label) {
  const beforeLines = before ? before.split('\n') : [];
  const afterLines = after.split('\n');
  const out = [`--- ${label} (current)`, `+++ ${label} (proposed)`];
  for (const line of beforeLines) out.push(red(`-${line}`));
  for (const line of afterLines) out.push(green(`+${line}`));
  return out.join('\n');
}

/** Summary counts for a proposed change. */
export function diffStats(before, after) {
  const b = before ? before.split('\n').length : 0;
  const a = after.split('\n').length;
  return { beforeLines: b, afterLines: a, delta: a - b };
}

/** Print a diff, truncating very long ones so the terminal stays readable. */
export function printDiff(diffText, { maxLines = 200 } = {}) {
  const lines = diffText.split('\n');
  if (lines.length <= maxLines) {
    console.log(diffText);
    return;
  }
  console.log(lines.slice(0, maxLines).join('\n'));
  console.log(dim(`... ${lines.length - maxLines} more diff lines (use --output to write the full proposal to a file)`));
}
