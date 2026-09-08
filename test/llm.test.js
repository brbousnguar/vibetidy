import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import { resolveConfig, complete, providerNames, LlmConfigError } from '../src/lib/llm.js';

describe('resolveConfig', () => {
  test('defaults to openai and its key variable', () => {
    const cfg = resolveConfig({}, { OPENAI_API_KEY: 'sk-test' });
    assert.equal(cfg.provider, 'openai');
    assert.equal(cfg.baseUrl, 'https://api.openai.com/v1');
    assert.equal(cfg.apiKey, 'sk-test');
  });

  test('VIBETIDY_API_KEY wins over the provider key', () => {
    const cfg = resolveConfig({ provider: 'groq' }, { VIBETIDY_API_KEY: 'a', GROQ_API_KEY: 'b' });
    assert.equal(cfg.apiKey, 'a');
  });

  test('flags beat environment', () => {
    const cfg = resolveConfig(
      { provider: 'openrouter', model: 'custom/model', baseUrl: 'https://example.test/v1/' },
      { OPENROUTER_API_KEY: 'k', VIBETIDY_MODEL: 'env/model' },
    );
    assert.equal(cfg.model, 'custom/model');
    assert.equal(cfg.baseUrl, 'https://example.test/v1', 'trailing slash is trimmed');
  });

  test('local providers need no key', () => {
    const cfg = resolveConfig({ provider: 'ollama' }, {});
    assert.equal(cfg.apiKey, null);
    assert.equal(cfg.baseUrl, 'http://localhost:11434/v1');
  });

  test('a missing key is a clear error, not a crash', () => {
    assert.throws(() => resolveConfig({}, {}), (err) => {
      assert.ok(err instanceof LlmConfigError);
      assert.match(err.message, /OPENAI_API_KEY/);
      assert.match(err.message, /--print-context/);
      return true;
    });
  });

  test('an unknown provider lists the known ones', () => {
    assert.throws(() => resolveConfig({ provider: 'nope' }, {}), /Known: /);
  });

  test('every advertised provider resolves', () => {
    for (const name of providerNames) {
      const cfg = resolveConfig({ provider: name }, { VIBETIDY_API_KEY: 'k' });
      assert.ok(cfg.baseUrl.startsWith('http'), `${name} has a base url`);
      assert.ok(cfg.model, `${name} has a default model`);
    }
  });
});

describe('complete', () => {
  const config = { provider: 'openai', baseUrl: 'https://api.test/v1', model: 'm', apiKey: 'k' };

  test('posts the chat-completions shape and returns the content', async () => {
    const calls = [];
    mock.method(globalThis, 'fetch', async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ choices: [{ message: { content: '  # Hello  ' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const out = await complete({ system: 'sys', user: 'usr', config });
    assert.equal(out, '# Hello');
    assert.equal(calls[0].url, 'https://api.test/v1/chat/completions');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer k');
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.model, 'm');
    assert.deepEqual(body.messages.map((m) => m.role), ['system', 'user']);
    mock.restoreAll();
  });

  test('surfaces an HTTP error with the provider name and status', async () => {
    mock.method(globalThis, 'fetch', async () => new Response('nope', { status: 429, statusText: 'Too Many Requests' }));
    await assert.rejects(complete({ system: 's', user: 'u', config }), /openai returned 429/);
    mock.restoreAll();
  });

  test('an empty completion is an error, not an empty README', async () => {
    mock.method(globalThis, 'fetch', async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }), { status: 200 }));
    await assert.rejects(complete({ system: 's', user: 'u', config }), /empty completion/);
    mock.restoreAll();
  });

  test('a network failure names the endpoint', async () => {
    mock.method(globalThis, 'fetch', async () => { throw new Error('ECONNREFUSED'); });
    await assert.rejects(complete({ system: 's', user: 'u', config }), /Could not reach https:\/\/api\.test\/v1/);
    mock.restoreAll();
  });
});
