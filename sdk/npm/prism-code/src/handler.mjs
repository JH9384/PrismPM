#!/usr/bin/env node
/**
 * The holo:// handler (experimental). The OS runs it with the link:
 *
 *   node handler.mjs holo://build?agent=claude-code&q=...
 *
 * and the terminal it opens runs it with a ticket:
 *
 *   node handler.mjs --run <ticket>
 *
 * `prism-code setup` copies this file, open.mjs, agents.mjs, errors.mjs and
 * plugins.mjs into $PRISM_HOME/handler and registers that copy, so the handler
 * does not depend on where npx put the package. `prism-code open` runs the
 * package's own copy.
 */
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostContext, openLink, planRun, readTicket } from './open.mjs';

const enter = (prompt) =>
  new Promise((done) => {
    const lines = createInterface({ input: process.stdin, output: process.stdout });
    lines.once('SIGINT', () => lines.close());
    lines.question(prompt, () => {
      lines.close();
      done(true);
    });
    lines.once('close', () => done(false));
  });

/** In the terminal the link opened: show the sentence, wait for Enter, then run the agent with it. */
async function run(ticketPath, context) {
  const plan = planRun(readTicket(ticketPath), context);
  if (!plan.found) {
    process.stdout.write(`\n${plan.message}\n`);
    await enter('Press Enter to close this window. ');
    return 1;
  }
  process.stdout.write(`\nA holo:// link asks to run:\n\n  ${plan.display}\n\nAny web page can write such a link, so read the request first.\n`);
  if (!(await enter('Press Enter to start it, or close this window to cancel. '))) return 1;
  return new Promise((done) => {
    const child = spawn(plan.command, plan.args, { ...plan.options, stdio: 'inherit' });
    child.once('error', (error) => {
      process.stderr.write(`${plan.command}: ${error.code ?? error.message}\n`);
      done(1);
    });
    child.once('exit', (code, signal) => done(code ?? (signal ? 1 : 0)));
  });
}

/** Opened by the OS, a refusal has no terminal to go to on macOS and Linux; it goes to handler.log too. */
async function report(error, context) {
  const line = `${new Date().toISOString()} ${error.code ?? error.name}: ${error.message}\n`;
  process.stderr.write(line);
  try {
    mkdirSync(context.configDir, { recursive: true });
    appendFileSync(join(context.configDir, 'handler.log'), line);
  } catch {
    // Nowhere else to say it.
  }
  if (process.stdin.isTTY) await enter('Press Enter to close this window. ');
}

const context = hostContext({ handler: fileURLToPath(import.meta.url) });
const [first, second] = process.argv.slice(2);
try {
  process.exitCode = first === '--run' ? await run(second, context) : (await openLink(first, context), 0);
} catch (error) {
  await report(error, context);
  process.exitCode = 2;
}
