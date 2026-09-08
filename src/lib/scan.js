// Repo scanner: turns a directory into a plain facts object.
//
// This is the grounding layer. Everything the README generator is allowed to
// claim has to come from here, so the model formats verified facts instead of
// inventing plausible ones. It is also the part that is fully testable: no
// network, no model, no side effects.

import fs from 'node:fs';
import path from 'node:path';

const IGNORED_DIRS = new Set([
  '.git', 'node_modules', '.next', '.nuxt', 'dist', 'build', 'out', 'coverage',
  '.venv', 'venv', '__pycache__', '.pytest_cache', '.mypy_cache', 'target',
  'vendor', '.turbo', '.cache', '.svelte-kit', '.output', '.terraform',
  '.idea', '.vscode', '.DS_Store', 'tmp', '.parcel-cache',
]);

const read = (p) => {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
};

const readJson = (p) => {
  const raw = read(p);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const exists = (p) => fs.existsSync(p);

/** First existing path from a candidate list, relative to root. */
function firstExisting(root, names) {
  for (const name of names) {
    if (exists(path.join(root, name))) return name;
  }
  return null;
}

/**
 * Minimal TOML value extraction for pyproject.toml. Deliberately not a full
 * TOML parser: we only need a handful of scalar fields and one array, and a
 * dependency would defeat the zero-dependency promise.
 */
function parsePyproject(raw) {
  const out = { name: null, version: null, description: null, dependencies: [], requiresPython: null, scripts: [] };
  const scalar = (key) => {
    const m = raw.match(new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']*)["']`, 'm'));
    return m ? m[1] : null;
  };
  out.name = scalar('name');
  out.version = scalar('version');
  out.description = scalar('description');
  out.requiresPython = scalar('requires-python');

  const depsBlock = raw.match(/^\s*dependencies\s*=\s*\[([\s\S]*?)\]/m);
  if (depsBlock) {
    out.dependencies = [...depsBlock[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
  }

  const scriptsBlock = raw.match(/\[project\.scripts\]([\s\S]*?)(?:\n\[|$)/);
  if (scriptsBlock) {
    out.scripts = [...scriptsBlock[1].matchAll(/^\s*([\w.-]+)\s*=\s*["']([^"']+)["']/gm)]
      .map((m) => ({ name: m[1], target: m[2] }));
  }
  return out;
}

/** Env var names (and any trailing comment) from a `.env.example`-style file. */
function parseEnvExample(raw) {
  const vars = [];
  let pendingComment = null;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      pendingComment = null;
      continue;
    }
    if (trimmed.startsWith('#')) {
      pendingComment = trimmed.replace(/^#+\s*/, '');
      continue;
    }
    const m = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (m) {
      const value = m[2].trim().replace(/^["']|["']$/g, '');
      vars.push({
        name: m[1],
        example: value,
        hasDefault: value !== '',
        comment: pendingComment,
      });
      pendingComment = null;
    }
  }
  return vars;
}

/** Depth-limited directory tree, noise directories pruned. */
function walkTree(root, { maxDepth = 3, maxEntries = 200 } = {}) {
  const entries = [];
  const visit = (dir, depth, prefix) => {
    if (depth > maxDepth || entries.length >= maxEntries) return;
    let items;
    try {
      items = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    items.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const item of items) {
      if (entries.length >= maxEntries) return;
      if (item.name.startsWith('.') && item.name !== '.github') continue;
      if (IGNORED_DIRS.has(item.name)) continue;
      const rel = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.isDirectory()) {
        entries.push({ path: rel, type: 'dir', depth });
        visit(path.join(dir, item.name), depth + 1, rel);
      } else if (item.isFile()) {
        entries.push({ path: rel, type: 'file', depth });
      }
    }
  };
  visit(root, 0, '');
  return entries;
}

/** Existing README structure: headings, size — used to preserve accurate prose. */
function parseReadme(raw) {
  const headings = [...raw.matchAll(/^(#{1,4})\s+(.+)$/gm)].map((m) => ({
    level: m[1].length,
    text: m[2].trim(),
  }));
  return {
    bytes: Buffer.byteLength(raw, 'utf8'),
    lines: raw.split('\n').length,
    headings,
    hasBadges: /img\.shields\.io|badge\.fury\.io/.test(raw),
    // The default file every scaffolding tool leaves behind.
    looksScaffolded:
      /Getting Started with Create React App|This is a \[Next\.js\] project bootstrapped|npm create vite/.test(raw),
  };
}

const FRAMEWORK_HINTS = [
  ['next', 'Next.js'], ['react', 'React'], ['vue', 'Vue'], ['svelte', 'Svelte'],
  ['@angular/core', 'Angular'], ['astro', 'Astro'], ['vite', 'Vite'],
  ['express', 'Express'], ['fastify', 'Fastify'], ['hono', 'Hono'], ['koa', 'Koa'],
  ['@nestjs/core', 'NestJS'], ['prisma', 'Prisma'], ['drizzle-orm', 'Drizzle ORM'],
  ['mongoose', 'Mongoose'], ['tailwindcss', 'Tailwind CSS'], ['typescript', 'TypeScript'],
  ['electron', 'Electron'], ['@supabase/supabase-js', 'Supabase'],
  ['firebase', 'Firebase'], ['stripe', 'Stripe'], ['openai', 'OpenAI SDK'],
  ['@anthropic-ai/sdk', 'Anthropic SDK'], ['@modelcontextprotocol/sdk', 'MCP SDK'],
  ['fastapi', 'FastAPI'], ['django', 'Django'], ['flask', 'Flask'],
  ['sqlalchemy', 'SQLAlchemy'], ['pydantic', 'Pydantic'], ['streamlit', 'Streamlit'],
];

function detectFrameworks(depNames) {
  const lower = depNames.map((d) => d.toLowerCase());
  const found = [];
  for (const [needle, label] of FRAMEWORK_HINTS) {
    if (lower.some((d) => d === needle || d.startsWith(`${needle}[`) || d.startsWith(`${needle}==`) || d.startsWith(`${needle}>`) || d.startsWith(`${needle}~`))) {
      found.push(label);
    }
  }
  return found;
}

const ENTRY_CANDIDATES = [
  'src/index.ts', 'src/index.js', 'src/main.ts', 'src/main.js', 'src/main.tsx',
  'src/app.ts', 'src/app.js', 'src/server.ts', 'src/server.js',
  'index.ts', 'index.js', 'main.py', 'app.py', 'src/main.py', 'main.go',
  'app/page.tsx', 'app/layout.tsx', 'pages/index.tsx', 'cmd/main.go', 'src/main.rs',
];

/**
 * Scan a repo directory into a facts object.
 * @param {string} root Absolute path to the repo root.
 * @returns {object} facts
 */
export function scan(root) {
  const facts = {
    root,
    name: path.basename(root),
    description: null,
    version: null,
    language: null,
    packageManager: null,
    manifest: null,
    scripts: [],
    dependencies: [],
    devDependencies: [],
    frameworks: [],
    engines: null,
    binaries: [],
    envVars: [],
    envFile: null,
    entryPoints: [],
    tree: [],
    existingReadme: null,
    license: null,
    docker: false,
    ci: [],
    hasTests: false,
    isGitRepo: exists(path.join(root, '.git')),
  };

  // ---- Node manifest ----
  const pkg = readJson(path.join(root, 'package.json'));
  if (pkg) {
    facts.manifest = 'package.json';
    facts.language = 'JavaScript/TypeScript';
    facts.name = pkg.name || facts.name;
    facts.description = pkg.description || null;
    facts.version = pkg.version || null;
    facts.scripts = Object.entries(pkg.scripts || {}).map(([name, cmd]) => ({ name, cmd }));
    facts.dependencies = Object.entries(pkg.dependencies || {}).map(([name, range]) => ({ name, range }));
    facts.devDependencies = Object.entries(pkg.devDependencies || {}).map(([name, range]) => ({ name, range }));
    facts.engines = pkg.engines || null;
    if (pkg.bin) {
      facts.binaries = typeof pkg.bin === 'string' ? [{ name: pkg.name, target: pkg.bin }]
        : Object.entries(pkg.bin).map(([name, target]) => ({ name, target }));
    }
    facts.license = pkg.license || facts.license;
    facts.packageManager =
      exists(path.join(root, 'pnpm-lock.yaml')) ? 'pnpm'
      : exists(path.join(root, 'yarn.lock')) ? 'yarn'
      : exists(path.join(root, 'bun.lockb')) || exists(path.join(root, 'bun.lock')) ? 'bun'
      : 'npm';
    if (exists(path.join(root, 'tsconfig.json'))) facts.frameworks.push('TypeScript');
  }

  // ---- Python manifest ----
  const pyprojectRaw = read(path.join(root, 'pyproject.toml'));
  if (pyprojectRaw) {
    const py = parsePyproject(pyprojectRaw);
    facts.manifest = facts.manifest ? `${facts.manifest}, pyproject.toml` : 'pyproject.toml';
    facts.language = facts.language ? `${facts.language}, Python` : 'Python';
    facts.name = facts.name === path.basename(root) && py.name ? py.name : facts.name;
    facts.description = facts.description || py.description;
    facts.version = facts.version || py.version;
    facts.dependencies.push(...py.dependencies.map((d) => ({ name: d, range: null })));
    facts.binaries.push(...py.scripts);
    if (py.requiresPython) facts.engines = { ...(facts.engines || {}), python: py.requiresPython };
    facts.packageManager = facts.packageManager
      || (exists(path.join(root, 'uv.lock')) ? 'uv'
        : exists(path.join(root, 'poetry.lock')) ? 'poetry' : 'pip');
  }

  const reqRaw = read(path.join(root, 'requirements.txt'));
  if (reqRaw && !pyprojectRaw) {
    facts.manifest = facts.manifest ? `${facts.manifest}, requirements.txt` : 'requirements.txt';
    facts.language = facts.language ? `${facts.language}, Python` : 'Python';
    facts.packageManager = facts.packageManager || 'pip';
    facts.dependencies.push(
      ...reqRaw.split('\n').map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#') && !l.startsWith('-'))
        .map((name) => ({ name, range: null })),
    );
  }

  // ---- Other ecosystems (recorded, not deeply parsed) ----
  for (const [file, lang] of [['go.mod', 'Go'], ['Cargo.toml', 'Rust'], ['Gemfile', 'Ruby'], ['composer.json', 'PHP'], ['pom.xml', 'Java']]) {
    if (exists(path.join(root, file))) {
      facts.manifest = facts.manifest ? `${facts.manifest}, ${file}` : file;
      facts.language = facts.language ? `${facts.language}, ${lang}` : lang;
    }
  }

  // ---- Config, entry points, layout ----
  facts.envFile = firstExisting(root, ['.env.example', '.env.sample', '.env.template', 'env.example', '.env.dist']);
  if (facts.envFile) {
    const raw = read(path.join(root, facts.envFile));
    if (raw) facts.envVars = parseEnvExample(raw);
  }

  facts.entryPoints = ENTRY_CANDIDATES.filter((c) => exists(path.join(root, c)));
  facts.tree = walkTree(root);

  const readmePath = firstExisting(root, ['README.md', 'readme.md', 'README.MD', 'Readme.md']);
  if (readmePath) {
    const raw = read(path.join(root, readmePath));
    if (raw !== null) {
      facts.existingReadme = { path: readmePath, raw, ...parseReadme(raw) };
    }
  }

  const licenseFile = firstExisting(root, ['LICENSE', 'LICENSE.md', 'LICENSE.txt']);
  if (licenseFile && !facts.license) {
    const raw = read(path.join(root, licenseFile)) || '';
    facts.license = /MIT License/i.test(raw) ? 'MIT'
      : /Apache License/i.test(raw) ? 'Apache-2.0'
      : /GNU GENERAL PUBLIC/i.test(raw) ? 'GPL'
      : 'see LICENSE';
  }

  facts.docker = exists(path.join(root, 'Dockerfile')) || exists(path.join(root, 'docker-compose.yml'))
    || exists(path.join(root, 'compose.yml'));

  const workflowDir = path.join(root, '.github', 'workflows');
  if (exists(workflowDir)) {
    try {
      facts.ci = fs.readdirSync(workflowDir).filter((f) => /\.ya?ml$/.test(f));
    } catch { /* unreadable workflow dir is not fatal */ }
  }

  facts.hasTests = facts.tree.some((e) =>
    /(^|\/)(test|tests|__tests__|spec)(\/|$)/.test(e.path) || /\.(test|spec)\.[jt]sx?$/.test(e.path));

  const allDepNames = [...facts.dependencies, ...facts.devDependencies].map((d) => d.name);
  facts.frameworks = [...new Set([...facts.frameworks, ...detectFrameworks(allDepNames)])];

  return facts;
}

/**
 * Render the facts as compact text for the model prompt (and for
 * `--print-context`, which is how you inspect it without an API key).
 */
export function factsToPrompt(facts) {
  const lines = [];
  const push = (label, value) => {
    if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) return;
    lines.push(`${label}: ${value}`);
  };

  lines.push('## Repository facts (verified — the only material you may state as fact)');
  push('Project name', facts.name);
  push('Version', facts.version);
  push('Existing description', facts.description);
  push('Language', facts.language);
  push('Manifest files', facts.manifest);
  push('Package manager', facts.packageManager);
  push('Engines', facts.engines ? JSON.stringify(facts.engines) : null);
  push('License', facts.license);
  push('Detected libraries/frameworks', facts.frameworks.join(', '));
  push('Dockerized', facts.docker ? 'yes (Dockerfile/compose present)' : null);
  push('CI workflows', facts.ci.join(', '));
  push('Test files present', facts.hasTests ? 'yes' : 'no');

  if (facts.scripts.length) {
    lines.push('\n### Scripts (package.json)');
    for (const s of facts.scripts) lines.push(`- ${s.name}: ${s.cmd}`);
  }
  if (facts.binaries.length) {
    lines.push('\n### Executables / entry commands');
    for (const b of facts.binaries) lines.push(`- ${b.name} -> ${b.target}`);
  }
  if (facts.dependencies.length) {
    lines.push('\n### Runtime dependencies');
    lines.push(facts.dependencies.slice(0, 60).map((d) => (d.range ? `${d.name}@${d.range}` : d.name)).join(', '));
  }
  if (facts.devDependencies.length) {
    lines.push('\n### Dev dependencies');
    lines.push(facts.devDependencies.slice(0, 40).map((d) => `${d.name}@${d.range}`).join(', '));
  }
  if (facts.envVars.length) {
    lines.push(`\n### Environment variables (from ${facts.envFile})`);
    for (const v of facts.envVars) {
      const bits = [v.name];
      if (v.comment) bits.push(`# ${v.comment}`);
      if (v.hasDefault) bits.push(`(example value present)`);
      lines.push(`- ${bits.join(' ')}`);
    }
  }
  if (facts.entryPoints.length) {
    lines.push('\n### Entry points found');
    for (const e of facts.entryPoints) lines.push(`- ${e}`);
  }
  if (facts.tree.length) {
    lines.push('\n### Repository layout');
    for (const e of facts.tree.slice(0, 120)) {
      lines.push(`${'  '.repeat(e.depth)}${e.path.split('/').pop()}${e.type === 'dir' ? '/' : ''}`);
    }
  }
  if (facts.existingReadme) {
    lines.push(`\n### Existing README (${facts.existingReadme.path}, ${facts.existingReadme.lines} lines)`);
    if (facts.existingReadme.looksScaffolded) {
      lines.push('NOTE: this looks like an untouched scaffolding-tool default README. Treat its content as worthless and rewrite from the facts above.');
    }
    lines.push('```markdown');
    lines.push(facts.existingReadme.raw.slice(0, 12000));
    lines.push('```');
  } else {
    lines.push('\n### Existing README\nNone. Create one from scratch.');
  }
  return lines.join('\n');
}
