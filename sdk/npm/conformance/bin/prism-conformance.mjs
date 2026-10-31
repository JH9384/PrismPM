#!/usr/bin/env node
/**
 * prism-conformance: run the suite, generate the matrix, judge a format change.
 *
 *   prism-conformance run --runtime <name> [--declaration <file>] [--out <file>] [--only <id or prefix>] [--timeout <ms>] [--json] [-- <shim command...>]
 *   prism-conformance matrix [--write | --check] [--results <dir>] [--output <file>]
 *   prism-conformance gate --base <commit> --head <commit> [--repo <dir>]
 *   prism-conformance list
 *   prism-conformance corpus --out <dir> | --update-lock
 *
 * Exit codes: 0 passed, 1 a check failed, the matrix is stale or the gate
 * refused, 2 the suite could not run, 64 bad usage.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { archiveNames, writeCorpus, writeLock } from '../src/corpus.mjs';
import { formatGate, runGate } from '../src/gate.mjs';
import { REGENERATE, renderMatrix, sameMatrix } from '../src/matrix.mjs';
import { runSuite } from '../src/run.mjs';
import { allChecks, loadScenarios } from '../src/scenarios.mjs';

const PACKAGE_DIR = fileURLToPath(new URL('../', import.meta.url));
const REPO_ROOT = resolve(PACKAGE_DIR, '../../..');
const RUNTIMES = join(PACKAGE_DIR, 'runtimes.json');

const USAGE = `prism-conformance: the suite every Prism runtime runs

  run --runtime <name> [-- <shim command...>]   run the suite against one runtime
      --declaration <file>                      the runtime's expected failures
      --out <file>                              write prism/conformance-results/1
      --only <id or prefix>                     run some checks; such results cannot be published
      --timeout <ms>                            per request, default 30000
      --json                                    print the results instead of a report
  matrix [--write | --check]                    render COMPLIANCE.md from every registered runtime
      --results <dir>                           read <runtime>.json from here instead of running the shims
      --output <file>                           default COMPLIANCE.md at the repository root
  gate --base <commit> --head <commit>          judge a format change against format-gate.json
      --repo <dir>                              default the repository root
  list                                          print every check id
  corpus --out <dir>                            write every archive of the corpus
  corpus --update-lock                          pin the corpus as its recipes now produce it
`;

const OPTIONS = {
  runtime: { type: 'string' },
  declaration: { type: 'string' },
  out: { type: 'string' },
  only: { type: 'string' },
  timeout: { type: 'string' },
  json: { type: 'boolean' },
  write: { type: 'boolean' },
  check: { type: 'boolean' },
  results: { type: 'string' },
  output: { type: 'string' },
  base: { type: 'string' },
  head: { type: 'string' },
  repo: { type: 'string' },
  'update-lock': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
};

function usage(message) {
  process.stderr.write(`${message}\n\n${USAGE}`);
  return 64;
}

const readRuntimes = () => JSON.parse(readFileSync(RUNTIMES, 'utf8')).runtimes;
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

function writeJson(path, value) {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function report(results) {
  const lines = [`${results.runtime}: ${results.implementation.name ?? 'unnamed'} ${results.implementation.version ?? ''}`.trim()];
  for (const check of results.checks) {
    const note = check.status === 'pass' ? '' : `  ${[check.reason, check.detail].filter(Boolean).join(' | ')}`;
    lines.push(`${check.status.padEnd(15)} ${check.id}${note}`);
  }
  const { summary } = results;
  lines.push('', `${results.checks.length} checks: ${summary.pass} pass, ${summary.fail} fail, ${summary.xfail} xfail, ${summary['unexpected-pass']} unexpected pass, ${summary['n/a']} n/a`);
  lines.push(results.passed ? 'PASSED' : 'FAILED');
  if (summary['unexpected-pass'] > 0) lines.push('An unexpected pass means the gap closed: remove the entry from the declaration.');
  return `${lines.join('\n')}\n`;
}

/** Run one runtime as `runtimes.json` registers it. Paths there are relative to the repository root. */
async function runRegistered(name, entry, { timeoutMs, only } = {}) {
  const declaration = entry.declaration ? readJson(join(REPO_ROOT, entry.declaration)) : undefined;
  return runSuite({ runtime: name, command: entry.command, declaration, cwd: REPO_ROOT, timeoutMs, only });
}

async function commandRun(values, shim) {
  if (!values.runtime) return usage('run needs --runtime');
  const timeoutMs = values.timeout === undefined ? undefined : Number(values.timeout);
  if (timeoutMs !== undefined && !(timeoutMs > 0)) return usage('--timeout must be a positive number of milliseconds');
  let results;
  if (shim.length > 0) {
    const declaration = values.declaration ? readJson(values.declaration) : undefined;
    results = await runSuite({ runtime: values.runtime, command: shim, declaration, timeoutMs, only: values.only ?? null });
  } else {
    const entry = readRuntimes()[values.runtime];
    if (!entry) return usage(`${values.runtime} is not in runtimes.json; give its shim after --`);
    if (!entry.command) return usage(`${values.runtime} has no shim yet; give one after --`);
    results = await runRegistered(values.runtime, entry, { timeoutMs, only: values.only ?? null });
  }
  if (values.out) writeJson(values.out, results);
  process.stdout.write(values.json ? `${JSON.stringify(results, null, 2)}\n` : report(results));
  return results.passed ? 0 : 1;
}

async function commandMatrix(values) {
  if (values.write && values.check) return usage('matrix takes --write or --check, not both');
  const features = loadScenarios();
  const output = values.output ?? join(REPO_ROOT, 'COMPLIANCE.md');
  const runtimes = [];
  for (const [name, entry] of Object.entries(readRuntimes())) {
    let results = null;
    if (entry.command) {
      if (values.results) {
        const path = join(values.results, `${name}.json`);
        if (!existsSync(path)) throw new Error(`${name} has a shim and ${path} does not exist; a registered runtime cannot go unmeasured`);
        results = readJson(path);
      } else {
        results = await runRegistered(name, entry);
      }
    }
    runtimes.push({ name, title: entry.title, results });
  }
  const rendered = renderMatrix({ features, runtimes });
  if (values.write) {
    writeFileSync(output, rendered);
    process.stdout.write(`wrote ${output}\n`);
    return 0;
  }
  if (values.check) {
    const committed = existsSync(output) ? readFileSync(output, 'utf8') : '';
    if (sameMatrix(committed, rendered)) {
      process.stdout.write(`${output} is current\n`);
      return 0;
    }
    process.stderr.write(`${output} is stale. It is generated, so do not edit it. Run:\n\n  ${REGENERATE}\n\nand commit the result.\n`);
    return 1;
  }
  process.stdout.write(rendered);
  return 0;
}

function commandGate(values) {
  if (!values.base || !values.head) return usage('gate needs --base and --head');
  const outcome = runGate({ repo: values.repo ?? REPO_ROOT, base: values.base, head: values.head });
  process.stdout.write(`${formatGate(outcome)}\n`);
  return outcome.passed ? 0 : 1;
}

function commandCorpus(values) {
  if (values['update-lock']) {
    writeLock();
    process.stdout.write('wrote corpus/archives.lock.json\n');
    return 0;
  }
  if (!values.out) return usage('corpus needs --out or --update-lock');
  const paths = writeCorpus(values.out);
  process.stdout.write(`wrote ${Object.keys(paths).length} archives to ${values.out}: ${archiveNames().join(', ')}\n`);
  return 0;
}

async function main() {
  const argv = process.argv.slice(2);
  const split = argv.indexOf('--');
  const shim = split === -1 ? [] : argv.slice(split + 1);
  const own = split === -1 ? argv : argv.slice(0, split);
  let parsed;
  try {
    parsed = parseArgs({ args: own, options: OPTIONS, allowPositionals: true });
  } catch (error) {
    return usage(error.message);
  }
  const { values, positionals } = parsed;
  if (values.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  switch (positionals[0]) {
    case 'run':
      return commandRun(values, shim);
    case 'matrix':
      return commandMatrix(values);
    case 'gate':
      return commandGate(values);
    case 'list':
      for (const check of allChecks(loadScenarios())) process.stdout.write(`${check.id}\n`);
      return 0;
    case 'corpus':
      return commandCorpus(values);
    default:
      return usage(positionals[0] ? `unknown command ${positionals[0]}` : 'no command');
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  process.stderr.write(`prism-conformance: ${error.message}\n`);
  process.exitCode = 2;
}
