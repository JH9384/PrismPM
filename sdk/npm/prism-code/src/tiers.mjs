/**
 * The build tiers (experimental): three gates of rising cost, so an edit is
 * judged by the cheapest one that can refuse it.
 *
 *   T0  `build --check`   prismpm check: the model is well formed and locked. Seconds.
 *   T1  `verify --lean`   lexlean verify: every theorem through Lean and leanchecker,
 *                         every axiom policy exact. About a minute for one module.
 *   T2  `verify`          prismpm verify: T1, then LCNF, the generated Rust, the
 *                         guest and the holo with its vectors. Minutes.
 *
 * T0 and T1 run in the SDK image when it is on this machine, else on the
 * hosted verifier (hosted.mjs); `--local` and `--hosted` choose. T1 runs
 * `lexlean` on the project's LexLean project. It is
 * found, in this order: `--project <dir>`; the project root; between
 * `[model] source` of `prism.toml` and the root; the one direct subdirectory
 * that holds a `lexlean.toml`, as a UOR template instance's `app/` does.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fail } from './errors.mjs';
import { containerWorkdir } from './docker.mjs';

export const LEXLEAN_PROJECT_FILE = 'lexlean.toml';

const inside = (root, path) => {
  const rel = relative(resolve(root), resolve(path));
  return rel === '' || (!rel.startsWith('..') && !rel.includes(`..${sep}`) && !/^[A-Za-z]:/.test(rel));
};
const forward = (path) => (path === '' ? '.' : path.split(sep).join('/'));

/** Direct subdirectories of `root` that hold a `lexlean.toml`, skipping hidden ones and dependencies. */
function childProjects(root) {
  let entries;
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }
  return entries
    .filter((name) => !name.startsWith('.') && name !== 'node_modules' && name !== 'target')
    .filter((name) => {
      try {
        return statSync(join(root, name)).isDirectory() && existsSync(join(root, name, LEXLEAN_PROJECT_FILE));
      } catch {
        return false;
      }
    })
    .sort();
}

/**
 * The directory holding the project's `lexlean.toml`, relative to `root`
 * with forward slashes (`'.'` for the root). `modelSource` is `[model] source`
 * of `prism.toml`; `explicit` is `--project`.
 */
export function lexleanProjectDir(root, modelSource = null, explicit = null) {
  if (explicit) {
    const dir = resolve(root, explicit);
    if (!inside(root, dir)) fail('tier.project', `--project ${explicit} is outside ${root}`);
    if (!existsSync(join(dir, LEXLEAN_PROJECT_FILE))) fail('tier.project', `no ${LEXLEAN_PROJECT_FILE} in --project ${explicit}`);
    return forward(relative(root, dir));
  }
  const candidates = ['.'];
  if (modelSource) {
    let dir = resolve(root, modelSource);
    while (inside(root, dir) && dir !== resolve(root)) {
      candidates.push(forward(relative(root, dir)));
      dir = dirname(dir);
    }
  }
  for (const candidate of candidates) {
    if (existsSync(join(root, candidate, LEXLEAN_PROJECT_FILE))) return candidate;
  }
  if (!modelSource) {
    const children = childProjects(root);
    if (children.length === 1) return children[0];
    if (children.length > 1) fail('tier.project', `${children.length} LexLean projects here (${children.join(', ')}); name one with --project <dir>`);
  }
  fail('tier.project', `no ${LEXLEAN_PROJECT_FILE} in ${root}${modelSource ? ` or under [model] source = ${JSON.stringify(modelSource)}` : ' or a directory directly under it'}; name the LexLean project with --project <dir>`);
}

/** The `--project` argument `lexlean` gets inside the container for that directory. */
export function lexleanProjectArgument(root, dir, platform = process.platform) {
  const workdir = containerWorkdir(root, platform);
  return dir === '.' ? `${workdir}/${LEXLEAN_PROJECT_FILE}` : `${workdir}/${dir}/${LEXLEAN_PROJECT_FILE}`;
}
