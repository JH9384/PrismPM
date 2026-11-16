/**
 * `prism-code axioms [--write] [--json]` (experimental): the observed axiom
 * set of every definition and theorem of a project, in one pass, beside the
 * set its source declares.
 *
 * Language 1.2 needs an exact axiom policy on every declaration, and the
 * verify reports the first wrong one per run. LexLean's audit stage already asks
 * Lean `#print axioms` for every declaration and records each module's answer
 * before it enforces anything; src/axioms.sh runs the verify in the SDK image,
 * copies those records as soon as every module has one, and stops the verify
 * before its certificate stage. `--write` puts each observed set into the
 * source as its `axioms` member, so a reviewer sees the policy as a diff, and
 * runs `lexlean fmt` so the layout stays canonical.
 *
 * Everything that reads and rewrites source is pure and tested on the
 * template; only the command line reaches Docker.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fail } from './errors.mjs';
import { parseToml } from './toml.mjs';
import { containerWorkdir } from './docker.mjs';

export const WORK_DIR = '.lexlean/axioms';
export const PROBE_SCRIPT = fileURLToPath(new URL('./axioms.sh', import.meta.url));
/** The declarations an axiom policy applies to (§15.9: every definition and theorem-like declaration). */
// `lexlean fmt` writes a declaration that fits in 100 columns on one line, and a longer one a member to a line.
const POLICED = /^(definition|theorem)\{\s*name:\s*([A-Za-z_][A-Za-z0-9_']*)/gm;
/** Members that follow `axioms` in the canonical order; a new member goes before the first of them. */
const AFTER_AXIOMS = ['recursive_argument', 'termination', 'measure', 'evidence', 'mutual', 'executable', 'effects', 'instances'];

function walk(root, dir = root, out = []) {
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(root, full, out);
    else if (entry.endsWith('.lex.tex')) out.push(relative(root, full).split(sep).join('/'));
  }
  return out;
}

/** The `axioms` member of one declaration block, as a sorted list; `[]` when it has none. */
export function declaredAxioms(block) {
  const m = /[\s,{]axioms:\s*\[([^\]]*)\]/.exec(block);
  if (!m) return [];
  return m[1].split(',').map((s) => s.trim()).filter(Boolean).sort();
}

/** Every policed declaration of a module's text: `{ name, start, end }` with the block's bounds. */
export function declarations(text) {
  const out = [];
  for (const m of text.matchAll(POLICED)) {
    const start = m.index;
    const end = blockEnd(text, start + m[1].length);
    if (end < 0) break;
    out.push({ kind: m[1], name: m[2], start, end, block: text.slice(start, end) });
  }
  return out;
}

/**
 * The index just past the `}` that closes the `{` at `open`, skipping braces in
 * string literals (the notation's strings use JSON escapes, §17.21.2); -1 when it
 * is never closed.
 */
export function blockEnd(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++;
    } else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i + 1;
  }
  return -1;
}

/**
 * The project's modules and their policed declarations. `root` is the host
 * project directory, `dir` the LexLean project within it (`lexleanProjectDir`).
 */
export function collect(root, dir) {
  const projectDir = join(root, dir);
  // The manifest's strict TOML reader refuses the lock-style arrays of tables further down; the keys read here are plain and come first.
  const text = readFileSync(join(projectDir, 'lexlean.toml'), 'utf8');
  const tables = text.indexOf('[[');
  const config = parseToml(tables < 0 ? text : text.slice(0, tables));
  const prefix = config.module_prefix;
  if (typeof prefix !== 'string' || !prefix) fail('axioms.project', `${join(dir, 'lexlean.toml')} names no module_prefix`);
  const roots = Array.isArray(config.source_roots) && config.source_roots.length ? config.source_roots : ['src'];
  const modules = [];
  for (const sourceRoot of roots) {
    const base = join(projectDir, sourceRoot);
    if (!existsSync(base)) continue;
    for (const file of walk(base)) {
      const name = file.slice(0, -'.lex.tex'.length).replace(/\//g, '.');
      const text = readFileSync(join(base, file), 'utf8');
      modules.push({ file: join(dir, sourceRoot, file).split(sep).join('/'), name, lean: `${prefix}.${name}`, declarations: declarations(text) });
    }
  }
  if (modules.length === 0) fail('axioms.project', `no .lex.tex under ${roots.join(', ')} in ${projectDir}`);
  return { prefix, modules };
}

/** Lean's `#print axioms` lines, as a map from the full name to its sorted axiom list; an error line is `axioms.probe`. */
export function parseReport(text) {
  const observed = new Map();
  const errors = [];
  for (const line of text.split(/\r?\n/)) {
    let m = /^'([^']+)' depends on axioms: \[([^\]]*)\]/.exec(line);
    if (m) {
      observed.set(m[1], m[2].split(',').map((s) => s.trim()).filter(Boolean).sort());
      continue;
    }
    m = /^'([^']+)' does not depend on any axioms/.exec(line);
    if (m) {
      observed.set(m[1], []);
      continue;
    }
    if (/error/i.test(line)) errors.push(line);
  }
  if (errors.length) fail('axioms.probe', `Lean refused the probe:\n${errors.slice(0, 10).join('\n')}`);
  return observed;
}

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Declared beside observed for every declaration: `{ module, name, declared, observed, ok }`. */
export function compare(project, observed) {
  const rows = [];
  for (const m of project.modules) {
    // A verify that stops on a policy audits some modules and not the rest; those have no line at all.
    const audited = m.declarations.some((d) => observed.has(`${m.lean}.${d.name}`));
    for (const d of m.declarations) {
      const full = `${m.lean}.${d.name}`;
      const seen = observed.get(full);
      const declared = declaredAxioms(d.block);
      if (seen === undefined) {
        if (audited) fail('axioms.probe', `Lean said nothing about ${full}; is the declaration's name spelled as Lean sees it?`);
        rows.push({ module: m.file, name: d.name, declared, observed: null, ok: null });
        continue;
      }
      rows.push({ module: m.file, name: d.name, declared, observed: seen, ok: same(declared, seen) });
    }
  }
  return rows;
}

/** One declaration block with its `axioms` member set to `axioms` (none when empty), in the canonical place. */
export function withAxioms(block, axioms) {
  let text = block
    .replace(/,\n {2}axioms:\s*\[[^\]]*\]/, '')
    .replace(/\n {2}axioms:\s*\[[^\]]*\],/, '')
    .replace(/, axioms:\s*\[[^\]]*\]/, '');
  if (axioms.length === 0) return text;
  const member = `axioms: [${[...axioms].sort().join(', ')}]`;
  // A one-line declaration takes the member before its closing brace; `lexlean fmt` lays it out after.
  if (!text.includes('\n')) return `${text.slice(0, -1)}, ${member}}`;
  const after = new RegExp(`\\n {2}(${AFTER_AXIOMS.join('|')}):`);
  const anchor = /\n {2}(body|proof|statement):/.exec(text);
  const from = anchor ? anchor.index + 1 : 0;
  const next = after.exec(text.slice(from));
  if (next) {
    const at = from + next.index;
    text = `${text.slice(0, at)}\n  ${member},${text.slice(at)}`;
  } else {
    const close = text.lastIndexOf('\n}');
    text = `${text.slice(0, close)},\n  ${member}${text.slice(close)}`;
  }
  return text;
}

/** The module texts with every mismatching declaration rewritten: a map from file to new text. */
export function rewrite(root, project, rows) {
  const changed = new Map();
  for (const m of project.modules) {
    // Only a declaration Lean was asked about is rewritten; one not audited keeps its member as it is.
    const fixes = rows.filter((r) => r.module === m.file && r.ok === false);
    if (fixes.length === 0) continue;
    const path = join(root, m.file);
    let text = readFileSync(path, 'utf8');
    // Rewrite from the end so earlier offsets stay valid.
    for (const d of [...declarations(text)].reverse()) {
      const fix = fixes.find((r) => r.name === d.name);
      if (fix) text = `${text.slice(0, d.start)}${withAxioms(d.block, fix.observed)}${text.slice(d.end)}`;
    }
    changed.set(path, text);
  }
  return changed;
}

/** What the probe needs on disk under the project: the script and the modules whose audit it waits for. */
export function writeWork(root, project) {
  const work = join(root, WORK_DIR);
  mkdirSync(work, { recursive: true });
  // A Windows checkout may have written the script with CRLF, which sh refuses.
  writeFileSync(join(work, 'axioms.sh'), readFileSync(PROBE_SCRIPT, 'utf8').replace(/\r\n/g, '\n'));
  writeFileSync(join(work, 'modules.txt'), `${project.modules.map((m) => m.lean).join('\n')}\n`);
  return work;
}

/** The audit records the probe copied, as one text of `#print axioms` lines: each record's stdout, in name order. */
export function readAudit(work) {
  const dir = join(work, 'audit');
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.process.json')).sort() : [];
  if (files.length === 0) fail('axioms.probe', `no audit records in ${dir}`);
  return files
    .map((f) => {
      const record = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      if (record.exit_code !== 0) fail('axioms.probe', `the audit of ${record.module ?? f} exited ${record.exit_code}: ${String(record.stderr ?? '').trim()}`);
      return String(record.stdout ?? '');
    })
    .join('\n');
}

/** The command inside the container: the probe over the LexLean project, with the work directory beside it. */
export function probeCommand(root, dir, platform = process.platform) {
  const workdir = containerWorkdir(root, platform);
  const projectPath = dir === '.' ? workdir : `${workdir}/${dir}`;
  return ['-c', `sh "${workdir}/${WORK_DIR}/axioms.sh" "${projectPath}" "${workdir}/${WORK_DIR}"`];
}

const fmt = (list) => (list.length ? list.join(', ') : 'none');

/** The printed table, one declaration per line, mismatches marked. */
export function formatRows(rows) {
  const width = Math.max(...rows.map((r) => r.name.length), 4);
  const line = (r) => {
    if (r.ok === null) return `  ??  ${r.name.padEnd(width)}  not audited: the verify stopped on another policy first`;
    return `  ${r.ok ? 'ok ' : 'FIX'} ${r.name.padEnd(width)}  ${r.ok ? fmt(r.observed) : `declared ${fmt(r.declared)}, observed ${fmt(r.observed)}`}`;
  };
  const lines = rows.map(line);
  const fixes = mismatches(rows).length;
  const pending = unaudited(rows).length;
  if (fixes) lines.push(`${fixes} of ${rows.length} declarations need their axioms member set; run with --write`);
  if (pending) lines.push(`${pending} of ${rows.length} declarations were not audited; --write fixes the rest and audits again until every one is settled`);
  if (!fixes && !pending) lines.push(`all ${rows.length} declarations declare the axioms Lean observes`);
  return `${lines.join('\n')}\n`;
}

/** Declarations whose declared set differs from the observed one. */
export const mismatches = (rows) => rows.filter((r) => r.ok === false);
/** Declarations of modules the verify stopped before auditing. */
export const unaudited = (rows) => rows.filter((r) => r.ok === null);
/** How many audit rounds `--write` runs at most before it reports what is left. */
export const MAX_ROUNDS = 5;

/** The `lexlean fmt` arguments inside the container that canonicalize the project after a write. */
export function fmtArguments(root, dir, platform = process.platform) {
  const workdir = containerWorkdir(root, platform);
  return ['--project', dir === '.' ? `${workdir}/lexlean.toml` : `${workdir}/${dir}/lexlean.toml`];
}

