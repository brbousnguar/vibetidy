// pre-commit hook installer.
//
// Never clobbers an existing hook: a foreign hook gets our block appended
// (with the user's consent), and a hook we already own is left alone.

import fs from 'node:fs';
import path from 'node:path';
import { git } from './git.js';

export const MARKER = '# >>> tidyrepo issue-check >>>';
export const END_MARKER = '# <<< tidyrepo issue-check <<<';

export const HOOK_BLOCK = `${MARKER}
# Warns when a commit looks like a feature with no linked issue.
# Add --strict below to block such commits instead of warning.
# Set SKIP_ISSUE_CHECK=1 to bypass once, or delete this block to uninstall.
# If tidyrepo is not installed the block does nothing: a missing tool must
# never be the reason a commit fails.
if [ -z "$SKIP_ISSUE_CHECK" ]; then
  if command -v tidyrepo >/dev/null 2>&1; then
    tidyrepo issue-check --hook || exit $?
  elif npx --no-install tidyrepo --version >/dev/null 2>&1; then
    npx --no-install tidyrepo issue-check --hook || exit $?
  fi
fi
${END_MARKER}`;

const NEW_HOOK = `#!/bin/sh
${HOOK_BLOCK}
`;

/** Resolve the hooks directory, honouring core.hooksPath. */
export function hooksDir(root) {
  const configured = git(['config', '--get', 'core.hooksPath'], root);
  if (configured) return path.isAbsolute(configured) ? configured : path.join(root, configured);
  const gitDir = git(['rev-parse', '--git-dir'], root);
  if (!gitDir) return null;
  const abs = path.isAbsolute(gitDir) ? gitDir : path.join(root, gitDir);
  return path.join(abs, 'hooks');
}

/**
 * Inspect the current pre-commit hook.
 * @returns {{path: string|null, exists: boolean, installed: boolean, content: string}}
 */
export function inspectHook(root) {
  const dir = hooksDir(root);
  if (!dir) return { path: null, exists: false, installed: false, content: '' };
  const hookPath = path.join(dir, 'pre-commit');
  if (!fs.existsSync(hookPath)) return { path: hookPath, exists: false, installed: false, content: '' };
  const content = fs.readFileSync(hookPath, 'utf8');
  return { path: hookPath, exists: true, installed: content.includes(MARKER), content };
}

/**
 * Install the hook.
 * @param {string} root
 * @param {{append?: boolean}} opts `append` authorises modifying a foreign hook.
 * @returns {{status: 'installed'|'appended'|'already'|'needs-consent'|'no-git', path: string|null}}
 */
export function installHook(root, { append = false } = {}) {
  const state = inspectHook(root);
  if (!state.path) return { status: 'no-git', path: null };
  if (state.installed) return { status: 'already', path: state.path };

  fs.mkdirSync(path.dirname(state.path), { recursive: true });

  if (!state.exists) {
    fs.writeFileSync(state.path, NEW_HOOK, { mode: 0o755 });
    return { status: 'installed', path: state.path };
  }

  if (!append) return { status: 'needs-consent', path: state.path };

  const separator = state.content.endsWith('\n') ? '' : '\n';
  fs.writeFileSync(state.path, `${state.content}${separator}\n${HOOK_BLOCK}\n`);
  fs.chmodSync(state.path, 0o755);
  return { status: 'appended', path: state.path };
}

/** Remove our block; deletes the file if it was ours alone. */
export function uninstallHook(root) {
  const state = inspectHook(root);
  if (!state.installed) return { status: 'not-installed', path: state.path };

  const stripped = state.content
    .replace(new RegExp(`\\n?${escapeRe(MARKER)}[\\s\\S]*?${escapeRe(END_MARKER)}\\n?`), '\n')
    .trim();

  if (!stripped || stripped === '#!/bin/sh') {
    fs.rmSync(state.path);
    return { status: 'removed', path: state.path };
  }
  fs.writeFileSync(state.path, `${stripped}\n`, { mode: 0o755 });
  return { status: 'stripped', path: state.path };
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
