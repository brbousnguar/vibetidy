# tidyrepo

**Two checks that make an AI-generated repo look maintained.**
Generates a README from what your code actually contains, and warns when a feature-sized commit has no issue behind it.

[![npm](https://img.shields.io/npm/v/tidyrepo?color=0E8A16)](https://www.npmjs.com/package/tidyrepo)
[![node](https://img.shields.io/badge/node-%3E%3D20.10-informational)](https://nodejs.org)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](package.json)

You shipped something from v0, Bolt, Lovable, or a long Claude session. It works. The README still says *Getting Started with Create React App*, there is no record of why anything was built, and the changelog does not exist. `tidyrepo` fixes those two things and stops.

```bash
npx tidyrepo readme                      # generate README.md, review the diff, confirm
npx tidyrepo issue-check --install-hook  # nag on feature commits with no issue
```

## What it does

- **`readme`** — scans the repository (manifest, scripts, dependencies, `.env.example`, entry points, folder tree, existing README), sends only those verified facts to an LLM, and writes a README in a fixed structure: What it does / Requirements / Setup / Run / Reference / Tech stack / Repository layout / Notes. Shows a diff and waits for confirmation before touching the file.
- **`issue-check`** — classifies your staged changes. New source files or a substantial diff means "feature"; lockfiles, build output, docs and tests are excluded. If it is a feature and no issue number appears in the branch name or the commits, it says so. Offers to create the issue with `gh` and writes a `changelog/unreleased/` fragment.
- **Zero runtime dependencies.** `npx tidyrepo` downloads one package, not three hundred.
- **Any OpenAI-compatible endpoint.** OpenAI, OpenRouter, Anthropic, Groq, DeepSeek, Together, or a local Ollama / LM Studio.

### The grounding rule

The scanner is the product; the model is a formatter. Everything the README is allowed to claim comes from the scan, and the prompt says so explicitly: never invent a feature, a flag, an environment variable, a dependency, or a version. When the facts are thin, you get a short accurate README instead of a long plausible one.

You can see exactly what would be sent, with no API key:

```bash
npx tidyrepo readme --print-context
```

## Requirements

- Node.js 20.10 or newer.
- An API key for one LLM provider — only for `readme`, and only when actually generating. `--print-context` needs nothing.
- `git`, for `issue-check`.
- The [GitHub CLI](https://cli.github.com) (`gh`), optional — only for the offer-to-create-an-issue path. Everything else works without it.

## Setup

No install step: `npx tidyrepo <command>` runs the latest version. To install it permanently:

```bash
npm install -g tidyrepo
```

Point it at a provider with one environment variable:

```bash
export OPENAI_API_KEY=sk-...          # default provider
# or
export OPENROUTER_API_KEY=sk-or-...   # then: --provider openrouter
```

| Variable | Required | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | for `readme` on the default provider | OpenAI API key |
| `TIDYREPO_API_KEY` | no | Overrides whichever provider key would otherwise be used |
| `TIDYREPO_PROVIDER` | no | `openai` (default), `openrouter`, `anthropic`, `groq`, `deepseek`, `together`, `ollama`, `lmstudio` |
| `TIDYREPO_MODEL` | no | Model id, overriding the provider default |
| `TIDYREPO_BASE_URL` | no | Any other OpenAI-compatible endpoint |
| `SKIP_ISSUE_CHECK` | no | Set to `1` to bypass the pre-commit hook once |

Each provider also reads its own key variable (`ANTHROPIC_API_KEY`, `GROQ_API_KEY`, `DEEPSEEK_API_KEY`, `TOGETHER_API_KEY`). Local providers need no key at all:

```bash
npx tidyrepo readme --provider ollama --model llama3.1
```

## Run

```bash
npx tidyrepo readme                        # current directory
npx tidyrepo readme ./packages/api         # somewhere else
npx tidyrepo issue-check                   # check what is staged
npx tidyrepo --help
```

## Commands

### `tidyrepo readme [path]`

Scans a repository and writes a README grounded in what it finds. Nothing is written until you confirm.

```bash
npx tidyrepo readme --print-context     # inspect the facts and prompt, no key needed
npx tidyrepo readme --dry-run           # generate and diff, never write
npx tidyrepo readme --yes               # write without the prompt (for CI)
```

| Option | Purpose |
|---|---|
| `--print-context` | Print the scanned facts and the full prompt, then exit |
| `--dry-run` | Generate and show the diff, but never write |
| `--yes`, `-y` | Skip the confirmation and write |
| `--output <file>` | Write somewhere other than `README.md` |
| `--hint <text>` | Extra context treated as verified fact — useful when the code alone does not say what the project is *for* |
| `--provider <name>` | Provider preset (see the table above) |
| `--model <id>` | Override the provider's default model |
| `--base-url <url>` | Any other OpenAI-compatible endpoint |

When a README already exists, accurate prose is preserved and stale claims are rewritten. A README that is still the untouched scaffolding default is detected and replaced outright.

Without a TTY (CI, a pipe) the confirmation cannot be answered, so nothing is written and the command exits 1 — pass `--yes` for non-interactive runs.

### `tidyrepo issue-check [path]`

Checks the staged changes — or, with nothing staged, the branch against its base — and looks for an issue number.

```bash
npx tidyrepo issue-check                     # warn (exit 0)
npx tidyrepo issue-check --strict            # block (exit 1)
npx tidyrepo issue-check --against main      # check a whole branch, e.g. in CI
npx tidyrepo issue-check --install-hook      # install the pre-commit hook
```

| Option | Purpose |
|---|---|
| `--strict` | Exit 1 instead of warning |
| `--threshold <n>` | Inserted lines that make a change feature-sized (default 40) |
| `--against <ref>` | Compare against a ref instead of the staged changes |
| `--create` | Create the issue via `gh` without asking first |
| `--no-changelog` | Do not write a changelog fragment when creating an issue |
| `--install-hook` | Install the pre-commit hook |
| `--uninstall-hook` | Remove the hook block |
| `--hook` | Hook mode: quieter, never prompts |

**What counts as a feature.** A new source file, or more than `--threshold` inserted lines. Lockfiles, `dist/`, `build/`, `node_modules/`, generated directories, minified files, docs and tests are all excluded from the count — a 4000-line lockfile churn is not a feature.

**Where it looks for the issue.** The branch name (`feat/42-add-oauth`, `42-add-oauth`, `issue-42`, `gh-42`) first, then the commit messages on the branch (`#42`, `Closes #42`, `GH-42`). A version number in a branch name (`feat/add-oauth2-login`) is not mistaken for an issue.

**It warns; it does not block.** A hook that blocks on day one gets `--no-verify`'d on day two. Add `--strict` to the installed hook when the habit has stuck.

### The pre-commit hook

```bash
npx tidyrepo issue-check --install-hook
```

Writes `.git/hooks/pre-commit`, honouring `core.hooksPath`. If a hook already exists, tidyrepo asks before appending its block and never overwrites what is there. The block is delimited by markers, so `--uninstall-hook` removes exactly it and leaves the rest.

If `tidyrepo` is not installed when the hook runs, the block does nothing. A missing tool is never the reason a commit fails.

Bypass one commit with `SKIP_ISSUE_CHECK=1 git commit ...`, or all hooks with `git commit --no-verify`.

### Creating the issue

When `gh` is installed and authenticated, `issue-check` offers to file the issue for you. It searches open and closed issues first so you do not file a duplicate, creates the `feature` / `bug` / `chore` labels if missing, and writes the body in a fixed shape:

```markdown
## Need
Why this is needed.

## Proposal
The shape of the solution.

## Done when
- [ ] Acceptance criteria
```

It then writes `changelog/unreleased/<branch-slug>.md` and stages it:

```markdown
### Added
- Add loyalty banner to checkout (#42)
```

One fragment file per branch, never a direct edit to `CHANGELOG.md`. Two pull requests appending a line to the same file on the same day collide on merge; two files named after different branches cannot. Fold the fragments into `CHANGELOG.md` whenever you cut a release.

## Tech stack

| Layer | Technology |
|---|---|
| Runtime | Node.js >= 20.10, ES modules |
| CLI parsing | `node:util` `parseArgs` |
| HTTP | global `fetch` |
| Tests | `node:test` |
| Runtime dependencies | none |

## Repository layout

```text
.
├── bin/
│   └── tidyrepo.js        # executable entry point
├── src/
│   ├── cli.js             # argument parsing and command dispatch
│   ├── index.js           # programmatic API
│   ├── commands/
│   │   ├── readme.js      # scan -> generate -> diff -> write
│   │   └── issue-check.js # classify -> find refs -> warn/create
│   └── lib/
│       ├── scan.js        # repository facts (the grounding layer)
│       ├── issues.js      # feature heuristic and issue-ref parsing
│       ├── template.js    # README structure and the prompt
│       ├── llm.js         # OpenAI-compatible client
│       ├── gh.js          # optional GitHub CLI integration
│       ├── hook.js        # pre-commit hook install/uninstall
│       ├── diff.js        # diff preview
│       └── git.js         # git wrappers
└── test/                  # node:test suite, no network
```

## Notes

- **Nothing is written without your say-so.** `readme` shows a diff and waits; `issue-check` only writes when it creates an issue for you, and then only a changelog fragment.
- **Read the generated README before committing it.** It is grounded in a real scan, but you know things about the project that the code does not say — `--hint` is there for exactly that.
- **`readme` sends repository metadata to your chosen provider**: manifest contents, dependency names, script names, environment *variable names* (never values — it reads `.env.example`, never `.env`), the folder tree, and the existing README. It never sends your source code. Use `--print-context` to see the payload, or `--provider ollama` to keep it on your machine.
- **The scanner and the classifier are importable** if you want to build something else on them:
  ```js
  import { scan, classifyChange, findIssueRefs } from 'tidyrepo';
  ```
- The test suite never touches the network. The one function that would is injected and stubbed.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Issues and pull requests are welcome.

## License

MIT — see [LICENSE](LICENSE).
