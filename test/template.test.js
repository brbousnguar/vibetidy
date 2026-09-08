import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SYSTEM_PROMPT, buildUserPrompt, cleanMarkdown } from '../src/lib/template.js';

describe('system prompt', () => {
  test('states the grounding rule', () => {
    assert.match(SYSTEM_PROMPT, /Never invent/);
    assert.match(SYSTEM_PROMPT, /checkable against the facts/);
  });

  test('bans marketing adjectives explicitly', () => {
    assert.match(SYSTEM_PROMPT, /blazing fast/);
  });

  test('names every house section', () => {
    for (const heading of ['What it does', 'Requirements', 'Setup', 'Run', 'Tech stack', 'Repository layout', 'Notes']) {
      assert.match(SYSTEM_PROMPT, new RegExp(heading), `mentions ${heading}`);
    }
  });
});

describe('buildUserPrompt', () => {
  test('passes the facts through unchanged', () => {
    const prompt = buildUserPrompt('FACTS HERE');
    assert.match(prompt, /FACTS HERE/);
    assert.match(prompt, /Write the README\.md now/);
  });

  test('appends a hint as verified fact when given', () => {
    const prompt = buildUserPrompt('FACTS', { hint: 'internal billing tool' });
    assert.match(prompt, /internal billing tool/);
    assert.match(prompt, /Treat this as verified fact/);
  });

  test('adds no hint section without one', () => {
    assert.doesNotMatch(buildUserPrompt('FACTS'), /Additional context/);
  });
});

describe('cleanMarkdown', () => {
  test('unwraps a whole-document code fence', () => {
    assert.equal(cleanMarkdown('```markdown\n# Title\n\ntext\n```'), '# Title\n\ntext\n');
    assert.equal(cleanMarkdown('```\n# Title\n```'), '# Title\n');
  });

  test('leaves inner fences alone', () => {
    const doc = '# Title\n\n```bash\nnpm test\n```\n';
    assert.equal(cleanMarkdown(doc), doc);
  });

  test('always ends with exactly one newline', () => {
    assert.equal(cleanMarkdown('# Title'), '# Title\n');
    assert.equal(cleanMarkdown('# Title\n\n\n'), '# Title\n');
  });
});
