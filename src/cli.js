// Argument parsing and command dispatch. Uses node:util's parseArgs — no
// commander, no yargs, no install cost.

import { parseArgs } from 'node:util';
import { bold, dim, fail } from './lib/ui.js';
import * as readmeCmd from './commands/readme.js';
import * as issueCheckCmd from './commands/issue-check.js';

const VERSION = '0.1.0';

const COMMANDS = {
  readme: readmeCmd,
  'issue-check': issueCheckCmd,
};

const OPTIONS = {
  // global
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
  yes: { type: 'boolean', short: 'y' },
  // readme
  'print-context': { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  output: { type: 'string' },
  hint: { type: 'string' },
  provider: { type: 'string' },
  model: { type: 'string' },
  'base-url': { type: 'string' },
  // issue-check
  strict: { type: 'boolean' },
  threshold: { type: 'string' },
  against: { type: 'string' },
  create: { type: 'boolean' },
  'skip-changelog': { type: 'boolean' },
  title: { type: 'string' },
  label: { type: 'string' },
  hook: { type: 'boolean' },
  'install-hook': { type: 'boolean' },
  'uninstall-hook': { type: 'boolean' },
};

const HELP = `${bold('vibetidy')} — clean up vibecoded repos ${dim(`v${VERSION}`)}

Usage:
  npx vibetidy <command> [path] [options]

Commands:
  readme          Generate or refresh README.md from what the repo actually
                  contains. Shows a diff before writing anything.
  issue-check     Warn when a feature-sized change has no linked GitHub issue.
                  Installs as a pre-commit hook.

Options:
  -h, --help      Show help (or ${dim('vibetidy <command> --help')} for one command)
  -v, --version   Print the version

Examples:
  npx vibetidy readme --print-context      ${dim('# see the facts, no API key needed')}
  npx vibetidy readme                      ${dim('# generate, review the diff, confirm')}
  npx vibetidy issue-check --install-hook  ${dim('# nag on feature commits from now on')}

Docs: https://github.com/brbousnguar/vibetidy`;

export async function main(argv) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (err) {
    fail(err.message);
    console.error(dim('\nRun `vibetidy --help` for usage.'));
    return 2;
  }

  const [commandName, ...rest] = parsed.positionals;

  if (parsed.values.version) {
    console.log(VERSION);
    return 0;
  }

  if (!commandName) {
    console.log(HELP);
    return parsed.values.help ? 0 : 1;
  }

  const command = COMMANDS[commandName];
  if (!command) {
    fail(`Unknown command: ${commandName}`);
    console.error(dim(`Known commands: ${Object.keys(COMMANDS).join(', ')}`));
    return 2;
  }

  if (parsed.values.help) {
    console.log(command.usage);
    return 0;
  }

  return command.run({ values: parsed.values, positionals: rest });
}
