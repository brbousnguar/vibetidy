// Terminal output helpers. No dependencies: ANSI codes inline, disabled when
// the stream is not a TTY or NO_COLOR is set.

const CSI = String.fromCharCode(27) + '[';

const enabled = () =>
  Boolean(process.stdout.isTTY) && !process.env.NO_COLOR && process.env.TERM !== 'dumb';

const wrap = (open, close) => (s) =>
  enabled() ? `${CSI}${open}m${s}${CSI}${close}m` : String(s);

export const bold = wrap(1, 22);
export const dim = wrap(2, 22);
export const red = wrap(31, 39);
export const green = wrap(32, 39);
export const yellow = wrap(33, 39);
export const blue = wrap(34, 39);
export const cyan = wrap(36, 39);

export const log = (...a) => console.log(...a);
export const info = (msg) => console.log(`${cyan('>')} ${msg}`);
export const ok = (msg) => console.log(`${green('OK')} ${msg}`);
export const warn = (msg) => console.error(`${yellow('!')} ${msg}`);
export const fail = (msg) => console.error(`${red('x')} ${msg}`);
export const step = (msg) => console.log(`\n${bold(msg)}`);

/** True when we can ask the user something and expect an answer. */
export const interactive = () => Boolean(process.stdin.isTTY && process.stdout.isTTY);

/**
 * Yes/no prompt. Returns `fallback` immediately when stdin is not a TTY, so
 * CI and git hooks never hang waiting on input.
 */
export async function confirm(question, { fallback = false } = {}) {
  if (!interactive()) return fallback;
  const readline = await import('node:readline/promises');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const suffix = fallback ? '[Y/n]' : '[y/N]';
    const answer = (await rl.question(`${cyan('?')} ${question} ${dim(suffix)} `))
      .trim()
      .toLowerCase();
    if (!answer) return fallback;
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

/** Free-text prompt. Returns `fallback` when not interactive. */
export async function ask(question, { fallback = '' } = {}) {
  if (!interactive()) return fallback;
  const readline = await import('node:readline/promises');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${cyan('?')} ${question} `)).trim();
    return answer || fallback;
  } finally {
    rl.close();
  }
}
