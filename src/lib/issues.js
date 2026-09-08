// Pure logic for `issue-check`: does this change look like a feature, and is
// an issue number referenced anywhere the repo will remember it?
//
// Kept free of git and network calls so it can be tested directly.

const SOURCE_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue', '.svelte', '.astro',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.php', '.cs', '.scala',
  '.c', '.h', '.cpp', '.hpp', '.m', '.mm', '.ex', '.exs', '.clj', '.dart',
  '.sql', '.graphql', '.proto', '.sh',
]);

const DOC_EXTENSIONS = new Set(['.md', '.mdx', '.txt', '.rst', '.adoc']);

const IGNORED_PATTERNS = [
  /(^|\/)package-lock\.json$/, /(^|\/)pnpm-lock\.yaml$/, /(^|\/)yarn\.lock$/,
  /(^|\/)bun\.lockb?$/, /(^|\/)poetry\.lock$/, /(^|\/)uv\.lock$/,
  /(^|\/)Cargo\.lock$/, /(^|\/)composer\.lock$/, /(^|\/)Gemfile\.lock$/,
  /(^|\/)(dist|build|out|coverage|node_modules|\.next|\.nuxt|\.svelte-kit|__pycache__|vendor)\//,
  /\.min\.(js|css)$/, /\.map$/, /(^|\/)\.gitignore$/,
  /(^|\/)(generated|__generated__)\//, /\.snap$/,
];

const TEST_PATTERNS = [
  /(^|\/)(test|tests|__tests__|spec|e2e|cypress)(\/|$)/,
  /\.(test|spec)\.[a-z]+$/,
  /(^|\/)test_[^/]+\.py$/,
  /_test\.(go|py|rb)$/,
];

const extname = (file) => {
  const base = file.split('/').pop() || '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot).toLowerCase() : '';
};

export const isIgnored = (file) => IGNORED_PATTERNS.some((re) => re.test(file));
export const isTest = (file) => TEST_PATTERNS.some((re) => re.test(file));
export const isSource = (file) => SOURCE_EXTENSIONS.has(extname(file));
export const isDoc = (file) => DOC_EXTENSIONS.has(extname(file));

/**
 * Classify a staged change set.
 *
 * @param {{status: string, file: string}[]} files
 * @param {{added: number, removed: number, file: string}[]} numstat
 * @param {{threshold?: number}} opts Insertion count above which a change
 *   counts as substantial even without a new source file.
 * @returns {{looksLikeFeature: boolean, reasons: string[], insertions: number,
 *   newSourceFiles: string[], consideredFiles: string[]}}
 */
export function classifyChange(files, numstat, { threshold = 40 } = {}) {
  const considered = files.filter((f) => !isIgnored(f.file));
  const relevant = considered.filter((f) => !isTest(f.file) && !isDoc(f.file));

  const insertions = numstat
    .filter((n) => !isIgnored(n.file) && !isTest(n.file) && !isDoc(n.file))
    .reduce((sum, n) => sum + n.added, 0);

  const newSourceFiles = relevant
    .filter((f) => f.status === 'A' && isSource(f.file))
    .map((f) => f.file);

  const reasons = [];
  if (newSourceFiles.length) {
    reasons.push(
      `${newSourceFiles.length} new source file${newSourceFiles.length > 1 ? 's' : ''} (${newSourceFiles.slice(0, 3).join(', ')}${newSourceFiles.length > 3 ? ', ...' : ''})`,
    );
  }
  if (insertions >= threshold) {
    reasons.push(`${insertions} inserted lines of non-test, non-doc code`);
  }

  return {
    looksLikeFeature: reasons.length > 0,
    reasons,
    insertions,
    newSourceFiles,
    consideredFiles: considered.map((f) => f.file),
  };
}

const BRANCH_PATTERNS = [
  /#(\d+)/,
  /\b(?:issue|issues|gh|fix|feat|feature|closes)[-_/]?(\d+)\b/i,
  /(?:^|\/)(\d+)(?:[-_]|$)/,
];

const MESSAGE_PATTERNS = [
  /#(\d+)/,
  /\bGH-(\d+)\b/i,
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#?(\d+)\b/i,
];

const collect = (text, patterns) => {
  const found = new Set();
  if (!text) return found;
  for (const re of patterns) {
    const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    for (const m of text.matchAll(global)) found.add(Number(m[1]));
  }
  return found;
};

/**
 * Find issue numbers referenced by a branch name or commit messages.
 * @param {{branch?: string|null, messages?: string[]}} input
 * @returns {{numbers: number[], source: 'branch'|'commit'|null}}
 */
export function findIssueRefs({ branch = null, messages = [] } = {}) {
  const fromBranch = collect(branch, BRANCH_PATTERNS);
  if (fromBranch.size) {
    return { numbers: [...fromBranch].sort((a, b) => a - b), source: 'branch' };
  }
  const fromMessages = new Set();
  for (const msg of messages) {
    for (const n of collect(msg, MESSAGE_PATTERNS)) fromMessages.add(n);
  }
  if (fromMessages.size) {
    return { numbers: [...fromMessages].sort((a, b) => a - b), source: 'commit' };
  }
  return { numbers: [], source: null };
}

/** Slugify a title into a branch-name-safe fragment. */
export const slugify = (text) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

/**
 * A Keep-a-Changelog fragment body. Fragments live one-per-branch so two PRs
 * landing the same day never collide on CHANGELOG.md.
 */
export const changelogFragment = (title, issueNumber, category = 'Added') =>
  `### ${category}\n- ${title}${issueNumber ? ` (#${issueNumber})` : ''}\n`;
