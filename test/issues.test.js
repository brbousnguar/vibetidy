import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyChange, findIssueRefs, slugify, changelogFragment,
  isIgnored, isTest, isSource,
} from '../src/lib/issues.js';

const files = (...specs) => specs.map(([status, file]) => ({ status, file }));
const stat = (...specs) => specs.map(([added, removed, file]) => ({ added, removed, file }));

describe('file classification', () => {
  test('ignores lockfiles and build output', () => {
    assert.ok(isIgnored('package-lock.json'));
    assert.ok(isIgnored('pnpm-lock.yaml'));
    assert.ok(isIgnored('dist/bundle.js'));
    assert.ok(isIgnored('src/generated/schema.ts'));
    assert.ok(!isIgnored('src/app.ts'));
  });

  test('recognises tests in several conventions', () => {
    assert.ok(isTest('test/foo.test.js'));
    assert.ok(isTest('src/__tests__/app.tsx'));
    assert.ok(isTest('tests/test_main.py'));
    assert.ok(isTest('pkg/handler_test.go'));
    assert.ok(!isTest('src/latest/index.js'));
  });

  test('recognises source extensions', () => {
    assert.ok(isSource('src/app.tsx'));
    assert.ok(isSource('api/main.py'));
    assert.ok(!isSource('README.md'));
    assert.ok(!isSource('logo.png'));
  });
});

describe('classifyChange', () => {
  test('a new source file makes it feature-sized', () => {
    const v = classifyChange(
      files(['A', 'src/checkout/banner.tsx']),
      stat([12, 0, 'src/checkout/banner.tsx']),
    );
    assert.equal(v.looksLikeFeature, true);
    assert.deepEqual(v.newSourceFiles, ['src/checkout/banner.tsx']);
  });

  test('a large edit makes it feature-sized without a new file', () => {
    const v = classifyChange(files(['M', 'src/app.ts']), stat([80, 3, 'src/app.ts']));
    assert.equal(v.looksLikeFeature, true);
    assert.equal(v.insertions, 80);
  });

  test('a small edit does not', () => {
    const v = classifyChange(files(['M', 'src/app.ts']), stat([3, 1, 'src/app.ts']));
    assert.equal(v.looksLikeFeature, false);
    assert.deepEqual(v.reasons, []);
  });

  test('docs-only changes never count', () => {
    const v = classifyChange(
      files(['M', 'README.md'], ['A', 'docs/guide.md']),
      stat([500, 0, 'README.md'], [300, 0, 'docs/guide.md']),
    );
    assert.equal(v.looksLikeFeature, false);
  });

  test('test-only changes never count', () => {
    const v = classifyChange(
      files(['A', 'test/app.test.js']),
      stat([200, 0, 'test/app.test.js']),
    );
    assert.equal(v.looksLikeFeature, false);
  });

  test('a regenerated lockfile alone never counts', () => {
    const v = classifyChange(
      files(['M', 'package-lock.json']),
      stat([4000, 3000, 'package-lock.json']),
    );
    assert.equal(v.looksLikeFeature, false);
    assert.equal(v.insertions, 0);
  });

  test('the threshold is configurable', () => {
    const change = [files(['M', 'src/app.ts']), stat([30, 0, 'src/app.ts'])];
    assert.equal(classifyChange(...change, { threshold: 40 }).looksLikeFeature, false);
    assert.equal(classifyChange(...change, { threshold: 10 }).looksLikeFeature, true);
  });

  test('binary files (numstat "-") do not blow up the count', () => {
    const v = classifyChange(files(['A', 'assets/logo.png']), [{ added: 0, removed: 0, file: 'assets/logo.png' }]);
    assert.equal(v.insertions, 0);
    assert.equal(v.looksLikeFeature, false);
  });
});

describe('findIssueRefs', () => {
  test('reads a number from common branch shapes', () => {
    assert.deepEqual(findIssueRefs({ branch: 'feat/42-add-oauth' }), { numbers: [42], source: 'branch' });
    assert.deepEqual(findIssueRefs({ branch: '42-add-oauth' }), { numbers: [42], source: 'branch' });
    assert.deepEqual(findIssueRefs({ branch: 'issue-7' }), { numbers: [7], source: 'branch' });
    assert.deepEqual(findIssueRefs({ branch: 'gh-19/fix-thing' }), { numbers: [19], source: 'branch' });
  });

  test('does not mistake a version number in a branch name for an issue', () => {
    assert.deepEqual(findIssueRefs({ branch: 'feat/add-oauth2-login' }), { numbers: [], source: null });
    assert.deepEqual(findIssueRefs({ branch: 'chore/bump-react-19' }), { numbers: [], source: null });
  });

  test('falls back to commit messages', () => {
    const res = findIssueRefs({ branch: 'my-work', messages: ['feat: banner', 'Closes #128'] });
    assert.deepEqual(res, { numbers: [128], source: 'commit' });
  });

  test('prefers the branch over commit messages', () => {
    const res = findIssueRefs({ branch: 'feat/5-thing', messages: ['Closes #99'] });
    assert.equal(res.source, 'branch');
    assert.deepEqual(res.numbers, [5]);
  });

  test('reports nothing when there is nothing', () => {
    assert.deepEqual(findIssueRefs({ branch: 'main', messages: ['wip'] }), { numbers: [], source: null });
    assert.deepEqual(findIssueRefs({}), { numbers: [], source: null });
  });
});

describe('changelog helpers', () => {
  test('slugify produces a branch-safe fragment name', () => {
    assert.equal(slugify('Add loyalty banner to checkout!'), 'add-loyalty-banner-to-checkout');
    assert.equal(slugify('feat/42-thing'), 'feat-42-thing');
    assert.ok(slugify('x'.repeat(100)).length <= 48);
  });

  test('fragment carries the issue number', () => {
    assert.equal(changelogFragment('Add banner', 42), '### Added\n- Add banner (#42)\n');
    assert.equal(changelogFragment('Fix crash', 7, 'Fixed'), '### Fixed\n- Fix crash (#7)\n');
    assert.equal(changelogFragment('Add banner', null), '### Added\n- Add banner\n');
  });
});
