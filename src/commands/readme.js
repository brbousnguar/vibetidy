// `vibetidy readme` — scan a repo, generate a grounded README, preview the
// diff, write it only on confirmation.

import fs from 'node:fs';
import path from 'node:path';
import { scan, factsToPrompt } from '../lib/scan.js';
import { resolveConfig, complete, LlmConfigError } from '../lib/llm.js';
import { SYSTEM_PROMPT, buildUserPrompt, cleanMarkdown } from '../lib/template.js';
import { renderDiff, printDiff, diffStats } from '../lib/diff.js';
import { bold, confirm, dim, fail, info, interactive, ok, step, warn } from '../lib/ui.js';

export const usage = `${bold('vibetidy readme')} — generate or refresh README.md from what the repo actually contains

Usage:
  npx vibetidy readme [path] [options]

Options:
  --print-context     Print the scanned facts and the prompt, then exit. No API
                      key needed. Use this to see exactly what would be sent.
  --dry-run           Generate and show the diff, but never write.
  --yes, -y           Skip the confirmation prompt and write.
  --output <file>     Write to <file> instead of README.md.
  --hint <text>       Extra context to treat as verified fact (e.g. what the
                      project is for, when the code alone does not say).
  --provider <name>   openai (default), openrouter, anthropic, groq, deepseek,
                      together, ollama, lmstudio.
  --model <id>        Override the provider's default model.
  --base-url <url>    Any other OpenAI-compatible endpoint.

Environment:
  VIBETIDY_API_KEY    Overrides the provider's own key variable.
  OPENAI_API_KEY      (or OPENROUTER_API_KEY, ANTHROPIC_API_KEY, ... per provider)
  VIBETIDY_PROVIDER   Same as --provider.
  VIBETIDY_MODEL      Same as --model.
  VIBETIDY_BASE_URL   Same as --base-url.`;

export async function run(args) {
  const targetArg = args.positionals[0] || '.';
  const root = path.resolve(targetArg);

  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    fail(`Not a directory: ${root}`);
    return 1;
  }

  step(`Scanning ${dim(root)}`);
  const facts = scan(root);
  const factsText = factsToPrompt(facts);

  info(
    [
      facts.language || 'unknown language',
      facts.manifest || 'no manifest',
      `${facts.dependencies.length} deps`,
      `${facts.scripts.length} scripts`,
      facts.envVars.length ? `${facts.envVars.length} env vars` : null,
      facts.existingReadme ? `README ${facts.existingReadme.lines} lines` : 'no README',
    ].filter(Boolean).join(' · '),
  );

  if (facts.existingReadme?.looksScaffolded) {
    warn('The existing README looks like an untouched scaffolding default — rewriting from scratch.');
  }

  const userPrompt = buildUserPrompt(factsText, { hint: args.values.hint });

  if (args.values['print-context']) {
    console.log(`\n${bold('--- system prompt ---')}\n${SYSTEM_PROMPT}`);
    console.log(`\n${bold('--- user prompt ---')}\n${userPrompt}`);
    return 0;
  }

  let config;
  try {
    config = resolveConfig({
      provider: args.values.provider,
      model: args.values.model,
      baseUrl: args.values['base-url'],
    });
  } catch (err) {
    if (err instanceof LlmConfigError) {
      fail(err.message);
      return 1;
    }
    throw err;
  }

  step(`Generating with ${config.provider} ${dim(config.model)}`);
  let markdown;
  try {
    markdown = cleanMarkdown(
      await complete({ system: SYSTEM_PROMPT, user: userPrompt, config, maxTokens: 6000 }),
    );
  } catch (err) {
    fail(err.message);
    return 1;
  }

  const outName = args.values.output || facts.existingReadme?.path || 'README.md';
  const outPath = path.isAbsolute(outName) ? outName : path.join(root, outName);
  const before = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : '';

  if (before === markdown) {
    ok('README is already what vibetidy would write — nothing to do.');
    return 0;
  }

  const stats = diffStats(before, markdown);
  step(`Proposed ${before ? 'changes to' : 'new'} ${path.relative(root, outPath) || outName}`);
  console.log(
    dim(`${stats.beforeLines} lines -> ${stats.afterLines} lines (${stats.delta >= 0 ? '+' : ''}${stats.delta})\n`),
  );
  printDiff(renderDiff(before, markdown, path.basename(outPath)));

  if (args.values['dry-run']) {
    console.log();
    info('Dry run — nothing written.');
    return 0;
  }

  const approved = args.values.yes || (await confirm(`Write ${path.basename(outPath)}?`, { fallback: false }));
  if (!approved) {
    console.log();
    info(
      interactive()
        ? 'Not written.'
        : 'Not written (no TTY to confirm on — re-run with --yes to write non-interactively).',
    );
    return interactive() ? 0 : 1;
  }

  fs.writeFileSync(outPath, markdown);
  console.log();
  ok(`Wrote ${outPath}`);
  console.log(dim('Read it before committing. It is grounded in the scan, but you know the project.'));
  return 0;
}
