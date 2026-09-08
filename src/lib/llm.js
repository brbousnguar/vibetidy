// Provider-agnostic LLM client.
//
// Anything that speaks the OpenAI `/chat/completions` shape works: OpenAI,
// OpenRouter, Groq, Together, DeepSeek, a local Ollama or LM Studio. Presets
// exist so the common cases need one env var instead of three. Uses global
// fetch — no SDK, no dependency.

const PRESETS = {
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    keyEnv: 'OPENAI_API_KEY',
    model: 'gpt-4o-mini',
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    keyEnv: 'OPENROUTER_API_KEY',
    model: 'anthropic/claude-3.5-haiku',
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com/v1',
    keyEnv: 'ANTHROPIC_API_KEY',
    model: 'claude-3-5-haiku-latest',
  },
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    keyEnv: 'GROQ_API_KEY',
    model: 'llama-3.3-70b-versatile',
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    keyEnv: 'DEEPSEEK_API_KEY',
    model: 'deepseek-chat',
  },
  together: {
    baseUrl: 'https://api.together.xyz/v1',
    keyEnv: 'TOGETHER_API_KEY',
    model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
  },
  ollama: {
    baseUrl: 'http://localhost:11434/v1',
    keyEnv: 'OLLAMA_API_KEY',
    model: 'llama3.1',
    keyOptional: true,
  },
  lmstudio: {
    baseUrl: 'http://localhost:1234/v1',
    keyEnv: 'LMSTUDIO_API_KEY',
    model: 'local-model',
    keyOptional: true,
  },
};

export const providerNames = Object.keys(PRESETS);

export class LlmConfigError extends Error {}

/**
 * Resolve provider config from flags then environment, in that order.
 * @param {{provider?: string, model?: string, baseUrl?: string}} opts
 */
export function resolveConfig(opts = {}, env = process.env) {
  const providerName = opts.provider || env.TIDYREPO_PROVIDER || 'openai';
  const preset = PRESETS[providerName];
  if (!preset) {
    throw new LlmConfigError(
      `Unknown provider "${providerName}". Known: ${providerNames.join(', ')}.\n` +
      `For anything else, set TIDYREPO_BASE_URL and TIDYREPO_API_KEY directly.`,
    );
  }

  const baseUrl = (opts.baseUrl || env.TIDYREPO_BASE_URL || preset.baseUrl).replace(/\/+$/, '');
  const model = opts.model || env.TIDYREPO_MODEL || preset.model;
  const apiKey = env.TIDYREPO_API_KEY || env[preset.keyEnv] || null;

  if (!apiKey && !preset.keyOptional) {
    throw new LlmConfigError(
      `No API key found. Set ${preset.keyEnv} (or TIDYREPO_API_KEY) in your environment.\n` +
      `  export ${preset.keyEnv}=sk-...\n` +
      `Other providers: --provider ${providerNames.join('|')}\n` +
      `No key handy? Run with --print-context to see exactly what would be sent.`,
    );
  }

  return { provider: providerName, baseUrl, model, apiKey };
}

/**
 * One chat completion. Returns the assistant message content as a string.
 * @param {{system: string, user: string, config: object, maxTokens?: number, temperature?: number, signal?: AbortSignal}} args
 */
export async function complete({ system, user, config, maxTokens = 4096, temperature = 0.2, signal }) {
  const headers = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  // OpenRouter attributes traffic by these; harmless elsewhere.
  if (config.provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://github.com/brbousnguar/tidyrepo';
    headers['X-Title'] = 'tidyrepo';
  }

  let res;
  try {
    res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      signal,
      body: JSON.stringify({
        model: config.model,
        temperature,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
  } catch (err) {
    throw new Error(`Could not reach ${config.baseUrl}: ${err.message}`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `${config.provider} returned ${res.status} ${res.statusText}` +
      (body ? `\n${body.slice(0, 500)}` : ''),
    );
  }

  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content;
  if (!content || !content.trim()) {
    throw new Error(`${config.provider} returned an empty completion (model: ${config.model}).`);
  }
  return content.trim();
}
