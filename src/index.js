// Programmatic API. The scanner and the classifier are the reusable parts;
// the commands are thin wrappers over them.

export { scan, factsToPrompt } from './lib/scan.js';
export { classifyChange, findIssueRefs, slugify, changelogFragment } from './lib/issues.js';
export { SYSTEM_PROMPT, buildUserPrompt, cleanMarkdown, SECTIONS } from './lib/template.js';
export { resolveConfig, complete, providerNames, LlmConfigError } from './lib/llm.js';
export { main } from './cli.js';
