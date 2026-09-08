import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { scan, factsToPrompt } from '../src/lib/scan.js';
import { makeFixture, cleanup, NODE_FIXTURE, PYTHON_FIXTURE } from './helpers.js';

const dirs = [];
const fixture = (files) => {
  const dir = makeFixture(files);
  dirs.push(dir);
  return dir;
};
after(() => dirs.forEach(cleanup));

describe('scan: node project', () => {
  const facts = scan(fixture(NODE_FIXTURE));

  test('reads the manifest', () => {
    assert.equal(facts.name, 'demo-app');
    assert.equal(facts.version, '1.2.3');
    assert.equal(facts.description, 'A demo application');
    assert.equal(facts.language, 'JavaScript/TypeScript');
    assert.deepEqual(facts.engines, { node: '>=20' });
    assert.equal(facts.license, 'MIT');
  });

  test('detects the package manager from the lockfile', () => {
    assert.equal(facts.packageManager, 'npm');
  });

  test('lists real scripts and dependencies only', () => {
    assert.deepEqual(facts.scripts.map((s) => s.name).sort(), ['build', 'dev', 'test']);
    assert.deepEqual(facts.dependencies.map((d) => d.name).sort(), ['express', 'react']);
  });

  test('detects frameworks from dependencies', () => {
    assert.ok(facts.frameworks.includes('React'));
    assert.ok(facts.frameworks.includes('Express'));
    assert.ok(facts.frameworks.includes('TypeScript'));
  });

  test('parses env vars with comments and defaults', () => {
    assert.equal(facts.envFile, '.env.example');
    const names = facts.envVars.map((v) => v.name);
    assert.deepEqual(names, ['DATABASE_URL', 'PORT', 'STRIPE_KEY']);
    assert.equal(facts.envVars[0].comment, 'Postgres connection string');
    assert.equal(facts.envVars[0].hasDefault, false);
    assert.equal(facts.envVars[1].hasDefault, true);
  });

  test('finds entry points', () => {
    assert.ok(facts.entryPoints.includes('src/index.js'));
  });

  test('prunes node_modules from the tree', () => {
    assert.ok(!facts.tree.some((e) => e.path.startsWith('node_modules')));
    assert.ok(facts.tree.some((e) => e.path === 'src/routes/users.js'));
  });

  test('flags a scaffolding-default README', () => {
    assert.ok(facts.existingReadme);
    assert.equal(facts.existingReadme.looksScaffolded, true);
  });
});

describe('scan: python project', () => {
  const facts = scan(fixture(PYTHON_FIXTURE));

  test('parses pyproject metadata', () => {
    assert.equal(facts.name, 'pytool');
    assert.equal(facts.version, '0.4.0');
    assert.equal(facts.language, 'Python');
    assert.deepEqual(facts.engines, { python: '>=3.11' });
  });

  test('parses the dependency array and console scripts', () => {
    assert.deepEqual(facts.dependencies.map((d) => d.name), ['fastapi>=0.110', 'pydantic>=2.0']);
    assert.deepEqual(facts.binaries, [{ name: 'pytool', target: 'pytool.cli:main' }]);
  });

  test('detects FastAPI and tests', () => {
    assert.ok(facts.frameworks.includes('FastAPI'));
    assert.equal(facts.hasTests, true);
  });
});

describe('scan: empty directory', () => {
  const facts = scan(fixture({ 'notes.txt': 'hello' }));

  test('does not invent a manifest', () => {
    assert.equal(facts.manifest, null);
    assert.equal(facts.language, null);
    assert.deepEqual(facts.dependencies, []);
    assert.equal(facts.existingReadme, null);
  });

  test('still produces a usable prompt', () => {
    const prompt = factsToPrompt(facts);
    assert.match(prompt, /Repository facts/);
    assert.match(prompt, /None\. Create one from scratch\./);
  });
});

describe('factsToPrompt', () => {
  const prompt = factsToPrompt(scan(fixture(NODE_FIXTURE)));

  test('carries scripts, deps and env vars into the prompt', () => {
    assert.match(prompt, /dev: vite/);
    assert.match(prompt, /react@\^18\.2\.0/);
    assert.match(prompt, /DATABASE_URL/);
  });

  test('marks a scaffolded README as worthless', () => {
    assert.match(prompt, /untouched scaffolding-tool default/);
  });

  test('omits empty sections rather than padding them', () => {
    const bare = factsToPrompt(scan(fixture({ 'a.txt': 'x' })));
    assert.doesNotMatch(bare, /### Scripts/);
    assert.doesNotMatch(bare, /### Runtime dependencies/);
  });
});
