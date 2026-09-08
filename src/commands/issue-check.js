// `tidyrepo issue-check` — warn when a feature-sized change carries no issue
// reference. Runs as a CLI check or as a pre-commit hook.
//
// Warns by default and blocks only with --strict. A hook that blocks on day
// one gets --no-verify'd on day two.

import fs from 'node:fs';
import path from 'node:path';
import * as git from '../lib/git.js';
import * as gh from '../lib/gh.js';
import { classifyChange, findIssueRefs, slugify, changelogFragment } from '../lib/issues.js';
import { installHook, uninstallHook, inspectHook, HOOK_BLOCK } from '../lib/hook.js';
import { ask, bold, confirm, dim, fail, info, interactive, ok, warn } from '../lib/ui.js';

export const usage = `${bold('tidyrepo issue-check')} — warn when a feature-sized change has no linked issue

Usage:
  npx tidyrepo issue-check [path] [options]

Checks the staged changes (or, with nothing staged, the branch against its
base) and looks for an issue number in the branch name or the commits on the
branch. Warns by default; only --strict blocks.

Options:
  --strict            Exit 1 when a feature-sized change has no issue.
  --threshold <n>     Inserted lines that make a change feature-sized (default 40).
  --against <ref>     Compare against this ref instead of the staged changes.
  --create            Create the issue via gh without asking first.
  --skip-changelog    Do not write a changelog fragment when creating an issue.
  --hook              Hook mode: quieter output, never prompts for issue text.
  --install-hook      Install the pre-commit hook in this repo.
  --uninstall-hook    Remove the pre-commit hook block.
  --yes, -y           Answer yes to prompts (used with --install-hook).

Bypass:
  SKIP_ISSUE_CHECK=1 git commit ...     skip the hook for one commit
  git commit --no-verify                skip all hooks`;

export async function run(args) {
  const root = git.repoRoot(path.resolve(args.positionals[0] || '.'));
  if (!root) {
    fail('Not a git repository.');
    return 1;
  }

  if (args.values['install-hook']) return doInstallHook(root, args);
  if (args.values['uninstall-hook']) return doUninstallHook(root);

  const hookMode = Boolean(args.values.hook);
  const threshold = Number(args.values.threshold ?? 40);

  // ---- Gather the change set ----
  let files = git.stagedFilesWithStatus(root);
  let numstat = git.stagedNumstat(root);
  let scope = 'staged changes';

  const against = args.values.against;
  if (against || (!files.length && !hookMode)) {
    const base = against || git.defaultBaseBranch(root);
    if (!base) {
      info('Nothing staged and no base branch to compare against — nothing to check.');
      return 0;
    }
    const range = `${base}...HEAD`;
    files = git.diffNameStatus(range, root);
    numstat = git.diffNumstat(range, root);
    scope = `branch vs ${base}`;
  }

  if (!files.length) {
    if (!hookMode) info('No changes to check.');
    return 0;
  }

  // ---- Classify ----
  const verdict = classifyChange(files, numstat, { threshold });
  if (!verdict.looksLikeFeature) {
    if (!hookMode) {
      ok(`${scope}: small or docs/test-only change — no issue needed.`);
    }
    return 0;
  }

  // ---- Look for an issue reference ----
  const branch = git.currentBranch(root);
  const base = git.defaultBaseBranch(root);
  const messages = base ? git.commitsSince(base, root) : git.recentCommitSubjects(20, root);
  const refs = findIssueRefs({ branch, messages });

  if (refs.numbers.length) {
    ok(`Linked to issue #${refs.numbers.join(', #')} (from ${refs.source === 'branch' ? 'branch name' : 'commit message'}).`);
    return 0;
  }

  // ---- No issue: report ----
  console.error();
  warn(`This looks like a feature, but no issue is linked (${scope}).`);
  for (const reason of verdict.reasons) console.error(`  ${dim('·')} ${reason}`);
  console.error();
  console.error(`  ${dim('Link one by naming the branch')} feat/42-short-description`);
  console.error(`  ${dim('or writing')} "#42" ${dim('in the commit message.')}`);

  const canCreate = gh.available() && gh.authenticated(root) && git.githubSlug(root);
  const wantCreate = args.values.create
    || (canCreate && !hookMode && interactive()
      && (await confirm('Create a GitHub issue for this now?', { fallback: false })));

  if (wantCreate && canCreate) {
    const created = await createIssueFlow(root, args, branch);
    if (created) return 0;
  } else if (!canCreate && !hookMode) {
    console.error();
    info(
      !gh.available()
        ? 'Install the GitHub CLI (https://cli.github.com) to create the issue from here.'
        : !git.githubSlug(root)
          ? 'No GitHub origin remote — issue creation is unavailable.'
          : 'Run `gh auth login` to create the issue from here.',
    );
  }

  if (args.values.strict) {
    console.error();
    fail('Blocked by --strict. Link an issue, or bypass with SKIP_ISSUE_CHECK=1.');
    return 1;
  }

  console.error();
  console.error(dim('  Warning only — the commit will proceed. Use --strict to block.'));
  return 0;
}

async function createIssueFlow(root, args, branch) {
  const defaultTitle = branch && !/^(main|master|develop)$/.test(branch)
    ? branch.replace(/^[a-z]+\//, '').replace(/[-_]/g, ' ').trim()
    : '';

  const title = args.values.title
    || (await ask(`Issue title:${defaultTitle ? ` ${dim(`[${defaultTitle}]`)}` : ''}`, { fallback: defaultTitle }));
  if (!title) {
    warn('No title given — skipping issue creation.');
    return false;
  }

  const existing = gh.searchIssues(title, root);
  if (existing.length) {
    console.error();
    warn('Similar issues already exist:');
    for (const issue of existing.slice(0, 5)) {
      console.error(`  #${issue.number} [${issue.state.toLowerCase()}] ${issue.title}`);
    }
    const proceed = await confirm('Create a new one anyway?', { fallback: false });
    if (!proceed) {
      info('Reuse one of the above: name your branch after it, or put "#N" in the commit message.');
      return false;
    }
  }

  const need = await ask('One line on why this is needed:', { fallback: title });
  gh.ensureLabels(root);
  const result = gh.createIssue(
    { title, body: gh.issueBody({ need }), label: args.values.label || 'feature' },
    root,
  );

  if (!result.ok) {
    fail(`Could not create the issue: ${result.error}`);
    return false;
  }

  ok(`Created #${result.number} — ${result.url}`);

  if (!args.values['skip-changelog']) {
    writeChangelogFragment(root, branch, title, result.number);
  }

  console.error();
  info(`Reference it: rename the branch to ${bold(`feat/${result.number}-${slugify(title)}`)}, ` +
    `or write "Closes #${result.number}" in the commit message.`);
  return true;
}

/**
 * One fragment file per branch under changelog/unreleased/. Never edits
 * CHANGELOG.md directly: two PRs appending to the same file on the same day
 * collide on merge, and a per-branch filename cannot.
 */
function writeChangelogFragment(root, branch, title, issueNumber) {
  const slug = slugify(branch && !/^(main|master)$/.test(branch) ? branch : `issue-${issueNumber}`);
  const dir = path.join(root, 'changelog', 'unreleased');
  const file = path.join(dir, `${slug}.md`);

  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(file)) {
    info(`Changelog fragment already exists: ${path.relative(root, file)}`);
    return;
  }
  fs.writeFileSync(file, changelogFragment(title, issueNumber));
  git.stage(path.relative(root, file), root);
  ok(`Changelog fragment: ${path.relative(root, file)} ${dim('(staged)')}`);

  const changelogPath = path.join(root, 'CHANGELOG.md');
  if (!fs.existsSync(changelogPath)) {
    fs.writeFileSync(changelogPath, [
      '# Changelog',
      '',
      'All notable changes to this project are documented here.',
      'Format based on [Keep a Changelog](https://keepachangelog.com/),',
      'and this project adheres to [Semantic Versioning](https://semver.org/).',
      '',
      '## [Unreleased]',
      '',
      '<!-- Fragments in changelog/unreleased/ are folded in here at release time. -->',
      '',
    ].join('\n'));
    git.stage('CHANGELOG.md', root);
    ok(`Created CHANGELOG.md ${dim('(staged)')}`);
  }
}

async function doInstallHook(root, args) {
  const state = inspectHook(root);
  if (state.installed) {
    ok(`Hook already installed: ${state.path}`);
    return 0;
  }

  if (state.exists) {
    warn(`A pre-commit hook already exists: ${state.path}`);
    const consent = args.values.yes
      || (await confirm('Append the tidyrepo block to it?', { fallback: false }));
    if (!consent) {
      info('Left untouched. Add this to your hook manually:\n');
      console.log(HOOK_BLOCK);
      return 0;
    }
    const res = installHook(root, { append: true });
    ok(`Appended the tidyrepo block to ${res.path}`);
    return 0;
  }

  const res = installHook(root);
  if (res.status === 'no-git') {
    fail('Could not resolve the git hooks directory.');
    return 1;
  }
  ok(`Installed ${res.path}`);
  console.log(dim('  Warns on feature-sized commits with no linked issue. Bypass: SKIP_ISSUE_CHECK=1'));
  return 0;
}

function doUninstallHook(root) {
  const res = uninstallHook(root);
  if (res.status === 'not-installed') {
    info('No tidyrepo hook block found.');
    return 0;
  }
  ok(res.status === 'removed' ? `Removed ${res.path}` : `Stripped the tidyrepo block from ${res.path}`);
  return 0;
}
