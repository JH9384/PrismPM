/**
 * `prism-code setup [--agent <id>] [--dry-run]` and
 * `prism-code open <holo://build?agent=<id>&q=<sentence>> [--dry-run]` (experimental).
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatSteps, hostContext, openLink } from './open.mjs';
import { applySetup, bundledSkills, formatNext, formatSetup, hostSetupContext, nextSteps, planSetup } from './setup.mjs';
import { telemetryNotice } from './gaps.mjs';
import { applyMachine, formatMachine, hostMachineContext, machineFailed, machineReport, planMachine } from './setup-machine.mjs';

const HANDLER = join(dirname(fileURLToPath(import.meta.url)), 'handler.mjs');

function options(argv, { values = [], flags = [] }) {
  const positional = [];
  const named = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eq = a.indexOf('=');
    const name = a.startsWith('--') ? (eq > 0 ? a.slice(2, eq) : a.slice(2)) : null;
    if (name === null) positional.push(a);
    else if (values.includes(name)) named[name] = eq > 0 ? a.slice(eq + 1) : argv[++i];
    else if (flags.includes(name) && eq < 0) named[name] = true;
    else return { problem: `--${name} is not an option here` };
    if (values.includes(name) && (typeof named[name] !== 'string' || named[name] === '')) return { problem: `--${name} takes a value` };
  }
  return { positional, named };
}

/**
 * `setup [--agent <id>] [--hosted] [--local] [--pull] [--image <ref>] [--no-pull] [--agents-only] [--machine-only] [--json] [--dry-run]`.
 * `--hosted` also adds the hosted lexlean server to each agent; without it no agent is sent anywhere.
 * The machine half runs first and is applied first, so the agent half's write of
 * `config.json` sees the Docker record. Docker, the image and the cache are
 * looked at only with `--local`, or a flag that implies it: `--pull`,
 * `--image` or `--machine-only`. @returns {Promise<number>} the exit code
 */
export async function runSetup(argv, usage, context = hostSetupContext(), machineContext = hostMachineContext({ env: context.env, platform: context.platform, configDir: context.configDir })) {
  const { problem, positional, named } = options(argv, { values: ['agent', 'image'], flags: ['dry-run', 'local', 'pull', 'no-pull', 'agents-only', 'machine-only', 'json', 'hosted'] });
  if (problem) return usage(problem);
  if (positional.length > 0) return usage('setup takes no arguments');
  if (named.pull && named['no-pull']) return usage('--pull and --no-pull name opposite things; give one');
  const dryRun = named['dry-run'] === true;
  // The image is pulled only when asked: `--pull`, or `--image` naming one. `--no-pull` is the default and is kept so older scripts still run.
  const pull = named['no-pull'] ? false : Boolean(named.pull || named.image);
  const local = Boolean(named.local || named.pull || named.image || named['machine-only']);
  const machine = named['agents-only'] ? null : planMachine({ image: named.image, pull, local }, machineContext);
  if (machine && !dryRun) applyMachine(machine);
  const agentsHalf = !named['machine-only'];
  // The skill ships in the package, so there is nothing to fetch.
  const skills = agentsHalf ? bundledSkills() : undefined;
  const plan = agentsHalf ? planSetup({ agent: named.agent, skills, hosted: named.hosted === true }, context) : { agents: [], handler: { status: 'not-found', steps: [] }, preferred: { agent: null, steps: [] } };
  if (!dryRun && agentsHalf) applySetup(plan);
  const rows = [...plan.agents, ...(plan.journey ?? []), plan.handler, ...(plan.skills ? [plan.skills] : [])];
  const failed = (machine ? machineFailed(machine) : false) || rows.some((row) => row.status === 'failed');
  const github = machine?.rows.find((row) => row.id === 'github') ?? null;
  const next = agentsHalf ? nextSteps(plan, { github }) : [];
  if (named.json) {
    const row = ({ agent, status, detail }) => ({ agent, status, detail: detail ?? null });
    const report = {
      schema: 'prism/setup-report/1',
      dryRun,
      machine: machine ? machineReport(machine) : null,
      agents: plan.agents.map(row),
      journey: (plan.journey ?? []).map(row),
      handler: { status: plan.handler.status, detail: plan.handler.detail ?? null },
      skills: plan.skills ? { status: plan.skills.status, detail: plan.skills.detail ?? null } : null,
      preferredAgent: plan.preferred.agent,
      next,
      telemetry: telemetryNotice(),
      failed,
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return failed ? 1 : 0;
  }
  if (machine) process.stdout.write(formatMachine(machine, { dryRun }));
  if (agentsHalf) process.stdout.write(formatSetup(plan, { dryRun }));
  process.stdout.write(formatNext(next));
  process.stdout.write(`${telemetryNotice()}
`);
  return failed ? 1 : 0;
}

/** @returns {Promise<number>} the exit code */
export async function runOpen(argv, usage, context = hostContext({ handler: HANDLER })) {
  const { problem, positional, named } = options(argv, { flags: ['dry-run'] });
  if (problem) return usage(problem);
  if (positional.length !== 1) return usage('open takes one holo://build link');
  // A refused link throws a PrismCodeError open.*, which the command line prints and exits 2 for.
  const plan = await openLink(positional[0], context, { dryRun: named['dry-run'] === true });
  process.stdout.write(named['dry-run'] ? `${formatSteps(plan.steps)}\n` : `${plan.summary}\n`);
  return 0;
}
