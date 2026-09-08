// Optional `gh` CLI integration. Everything here degrades: no gh, or gh not
// authenticated, and the check still works — only the offer-to-create path
// goes away.

import { spawnSync } from 'node:child_process';

const run = (args, cwd, input) => {
  const res = spawnSync('gh', args, { cwd, encoding: 'utf8', input, maxBuffer: 8 * 1024 * 1024 });
  return {
    ok: !res.error && res.status === 0,
    stdout: (res.stdout || '').trim(),
    stderr: (res.stderr || '').trim(),
    missing: Boolean(res.error && res.error.code === 'ENOENT'),
  };
};

export const available = () => !run(['--version']).missing;

export const authenticated = (cwd = process.cwd()) => run(['auth', 'status'], cwd).ok;

/** Create the three labels this workflow uses. Idempotent. */
export function ensureLabels(cwd = process.cwd()) {
  const labels = [
    ['feature', '0E8A16', 'New capability'],
    ['bug', 'B60205', 'Fix to existing behavior'],
    ['chore', 'FBCA04', 'Refactor, infra or docs'],
  ];
  for (const [name, color, description] of labels) {
    // Fails harmlessly when the label already exists.
    run(['label', 'create', name, '--color', color, '--description', description], cwd);
  }
}

/** Search open and closed issues so we never file a duplicate. */
export function searchIssues(query, cwd = process.cwd()) {
  const res = run(['issue', 'list', '--state', 'all', '--limit', '20', '--search', query, '--json', 'number,title,state'], cwd);
  if (!res.ok) return [];
  try {
    return JSON.parse(res.stdout);
  } catch {
    return [];
  }
}

/**
 * Create an issue.
 * @returns {{ok: boolean, url?: string, number?: number, error?: string}}
 */
export function createIssue({ title, body, label = 'feature' }, cwd = process.cwd()) {
  const res = run(['issue', 'create', '--title', title, '--body-file', '-', '--label', label], cwd, body);
  if (!res.ok) return { ok: false, error: res.stderr || 'gh issue create failed' };
  const url = res.stdout.split('\n').find((l) => l.startsWith('http'));
  const number = url ? Number(url.split('/').pop()) : null;
  return { ok: true, url, number };
}

/** Body template: Need / Proposal / Done when. */
export const issueBody = ({ need, proposal = '', doneWhen = [] }) =>
  [
    '## Need',
    need,
    '',
    '## Proposal',
    proposal || '_To be filled in._',
    '',
    '## Done when',
    ...(doneWhen.length ? doneWhen.map((d) => `- [ ] ${d}`) : ['- [ ] _To be filled in._']),
  ].join('\n');
