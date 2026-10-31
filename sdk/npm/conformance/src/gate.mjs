/**
 * The format-change gate: a change to the `.holo` format cannot merge without a
 * scenario. `format-gate.json` maps format files to the scenario files that
 * cover them, and this compares two commits.
 *
 * A rule is satisfied when one of its scenario files adds or changes a check.
 * Whitespace, titles, placeholders and removals do not count: none of them tests
 * anything. A change that truly leaves the format alone, such as a refactor of
 * the writer, adds an entry to `exemptions` in the same change, with a reason a
 * reviewer can read. Only entries the change itself adds count, so an old entry
 * exempts nothing.
 *
 * The rules come from the base commit, so a change cannot loosen the gate that
 * judges it; the exemptions come from the head, since that is where they are
 * proposed.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const GATE_CONFIG = 'sdk/npm/conformance/format-gate.json';
export const SCENARIO_DIR = 'sdk/npm/conformance/scenarios';

/** `**` crosses directories, `*` stays inside one. */
export function globToRegExp(glob) {
  const body = glob
    .split(/(\*\*\/|\*\*|\*)/)
    .map((part) => {
      if (part === '**/') return '(?:.*/)?';
      if (part === '**') return '.*';
      if (part === '*') return '[^/]*';
      return part.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('');
  return new RegExp(`^${body}$`);
}

const git = (repo, args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

function show(repo, commit, path) {
  try {
    return git(repo, ['show', `${commit}:${path}`]);
  } catch {
    return null;
  }
}

function parsed(repo, commit, path) {
  const text = show(repo, commit, path);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${path} at ${commit} is not JSON: ${error.message}`);
  }
}

/** A check as the gate compares it: everything that changes what it tests. */
function substance(check) {
  const { title, ...rest } = check;
  return JSON.stringify(rest);
}

const realChecks = (file) => (Array.isArray(file?.checks) ? file.checks.filter((check) => !('placeholder' in check)) : []);

/** The ids of the checks this scenario file adds or changes between the two commits. */
export function changedChecks(repo, base, head, feature) {
  const path = `${SCENARIO_DIR}/${feature}.json`;
  const before = new Map(realChecks(parsed(repo, base, path)).map((check) => [check.id, substance(check)]));
  return realChecks(parsed(repo, head, path))
    .filter((check) => before.get(check.id) !== substance(check))
    .map((check) => check.id);
}

/** The exemptions added between the two commits that give a reason, as a set of file paths. */
function addedExemptions(baseConfig, headConfig) {
  const before = new Set((baseConfig?.exemptions ?? []).map((entry) => JSON.stringify(entry)));
  const exempt = new Map();
  for (const entry of headConfig?.exemptions ?? []) {
    if (before.has(JSON.stringify(entry))) continue;
    if (typeof entry?.reason !== 'string' || entry.reason.trim().length === 0) continue;
    for (const file of entry.files ?? []) exempt.set(file, entry.reason);
  }
  return exempt;
}

/**
 * Judge the change from `base` to `head`. Returns `{ passed, findings }`, one
 * finding per rule a changed format file fell under.
 */
export function runGate({ repo, base, head }) {
  const changed = git(repo, ['diff', '--name-only', '--no-renames', `${base}...${head}`]).split('\n').map((line) => line.trim()).filter(Boolean);
  const headConfig = parsed(repo, head, GATE_CONFIG);
  const baseConfig = parsed(repo, base, GATE_CONFIG);
  const config = baseConfig ?? headConfig;
  if (!config) throw new Error(`${GATE_CONFIG} exists at neither commit`);
  const exempt = addedExemptions(baseConfig, headConfig);
  const findings = [];
  for (const rule of config.rules) {
    const patterns = rule.format.map(globToRegExp);
    const files = changed.filter((file) => patterns.some((pattern) => pattern.test(file)));
    if (files.length === 0) continue;
    const covered = rule.scenarios.flatMap((feature) => changedChecks(repo, base, head, feature));
    const uncovered = files.filter((file) => !exempt.has(file));
    const finding = { rule: rule.name, files, scenarios: rule.scenarios, covered, exempted: files.filter((file) => exempt.has(file)).map((file) => ({ file, reason: exempt.get(file) })) };
    findings.push({ ...finding, passed: covered.length > 0 || uncovered.length === 0 });
  }
  return { passed: findings.every((finding) => finding.passed), changed: changed.length, findings };
}

/** The report a person reads in the CI log. */
export function formatGate({ passed, changed, findings }) {
  const lines = [`${changed} files changed; ${findings.length} format rule${findings.length === 1 ? '' : 's'} apply.`];
  for (const finding of findings) {
    lines.push('', `${finding.passed ? 'ok  ' : 'FAIL'} ${finding.rule}: ${finding.files.join(', ')}`);
    if (finding.covered.length) lines.push(`     covered by ${finding.covered.join(', ')}`);
    for (const { file, reason } of finding.exempted) lines.push(`     ${file} is exempt: ${reason}`);
    if (!finding.passed) lines.push(`     needs a new or changed check in ${finding.scenarios.map((feature) => `${SCENARIO_DIR}/${feature}.json`).join(' or ')}`);
  }
  if (!passed) {
    lines.push(
      '',
      'A change to the .holo format cannot merge without a scenario. Add or change a check that fails without this change,',
      `or, if the format truly did not change, add an entry to "exemptions" in ${GATE_CONFIG} naming the files and why.`,
      'See "The format-change gate" in sdk/npm/conformance/README.md.',
    );
  }
  return lines.join('\n');
}

/** Rules whose scenarios or format globs point at nothing, read from the working tree. A gate on a renamed file guards nothing. */
export function problemsOfConfig(config, trackedFiles, features) {
  const problems = [];
  for (const rule of config.rules) {
    for (const glob of rule.format) {
      const pattern = globToRegExp(glob);
      if (!trackedFiles.some((file) => pattern.test(file))) problems.push(`rule ${rule.name}: ${glob} matches no tracked file`);
    }
    for (const feature of rule.scenarios) if (!features.includes(feature)) problems.push(`rule ${rule.name}: no scenario file ${feature}.json`);
    if (rule.scenarios.length === 0) problems.push(`rule ${rule.name} maps to no scenario`);
  }
  return problems;
}

export const readGateConfig = () => JSON.parse(readFileSync(fileURLToPath(new URL('../format-gate.json', import.meta.url)), 'utf8'));
