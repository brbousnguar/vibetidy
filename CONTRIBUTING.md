# Contributing to tidyrepo

Thanks for taking the time. This is a small tool with a deliberately small surface — the fastest way to get a change merged is to keep it that way.

## Ground rules

**Zero runtime dependencies.** `"dependencies": {}` is a feature, not an oversight: `npx tidyrepo` should download one package. A pull request that adds a runtime dependency needs to argue why the standard library cannot do it. Dev dependencies are held to nearly the same bar — the test suite is `node:test`.

**The scanner is the product.** Everything the README generator may claim comes from `src/lib/scan.js`. If you want the output to mention something new, add it to the scan first, then to the prompt. Never widen what the model is allowed to assert on its own.

**No network in tests.** The whole suite runs offline. The single function that makes an HTTP call (`complete` in `src/lib/llm.js`) is injected and stubbed. Keep it that way.

**Warn before you block.** `issue-check` defaults to exit 0. Anything that turns a warning into a failure needs to be behind a flag.

## Getting set up

```bash
git clone https://github.com/brbousnguar/tidyrepo.git
cd tidyrepo
npm test
```

There is no build step and nothing to install. Run the CLI straight from the checkout:

```bash
node bin/tidyrepo.js readme --print-context
node bin/tidyrepo.js issue-check --help
```

To try the generation path without spending tokens, point `--base-url` at any local server that answers `POST /v1/chat/completions` with the OpenAI response shape — an Ollama instance works:

```bash
node bin/tidyrepo.js readme ../some-repo --provider ollama --model llama3.1 --dry-run
```

## Making a change

1. **Open an issue first** for anything beyond a typo. The tool exists to encourage this, so the repo practises it. Say what the need is and roughly how you would solve it.
2. **Branch as `feat/<issue>-short-description`** — `issue-check` reads that shape, and so do humans.
3. **Add a test.** New scanner facts get a fixture assertion in `test/scan.test.js`; new heuristics get cases in `test/issues.test.js`; new flags get an end-to-end case in `test/cli.test.js`.
4. **Add a changelog fragment** at `changelog/unreleased/<branch-slug>.md`:
   ```markdown
   ### Added
   - What you added (#42)
   ```
   One file per branch. Never edit `CHANGELOG.md` directly — parallel pull requests collide on it.
5. **Run `npm test`** before opening the pull request.

## What is likely to be merged

- More ecosystems in the scanner (Go modules, Cargo, Gemfile parsed properly rather than just detected).
- Better framework detection.
- Provider presets for endpoints people actually use.
- Sharper heuristics in `classifyChange`, with a test showing the case that was previously wrong.
- Bug fixes with a failing test attached.

## What is unlikely to be merged

- A dependency.
- A configuration file format. Flags and environment variables are enough at this size.
- Commands beyond the two. Scope creep is how a sharp tool becomes a dull one.
- Prompt changes that let the model assert things the scan did not verify.

## Reporting a bug

Include the command you ran, what you expected, what happened, and `node --version`. For anything involving `readme`, the output of `--print-context` is usually the whole story — and it contains no API key.

## License

By contributing you agree that your contributions are licensed under the MIT License.
