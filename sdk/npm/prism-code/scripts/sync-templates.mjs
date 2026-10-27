/**
 * Copies the reviewed PrismPM fixtures that `prism-code init` scaffolds from
 * into templates/, byte for byte (issue #281). A template is a fixture the
 * repository's own gate already checks, so a scaffolded project starts from a
 * model that is known to check; its `lexlean.lock` binds the copied bytes, so
 * nothing in a template is edited by hand.
 *
 *   node scripts/sync-templates.mjs           rewrite templates/ from the fixtures
 *   node scripts/sync-templates.mjs --check   exit 1 when a template differs from its fixture
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEMPLATES } from '../src/init.mjs';

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const REPO = here('../../../../');
const TEMPLATES_DIR = here('../templates/');
const check = process.argv.includes('--check');

function walk(root, dir = root, out = []) {
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(root, full, out);
    else out.push(relative(root, full).split(sep).join('/'));
  }
  return out;
}

const lf = (path) => readFileSync(path, 'utf8').replaceAll('\r\n', '\n');

let stale = 0;
for (const [name, template] of Object.entries(TEMPLATES)) {
  const origin = join(REPO, template.origin);
  const target = join(TEMPLATES_DIR, name);
  const want = walk(origin);
  if (check) {
    let have = [];
    try {
      have = walk(target);
    } catch {}
    const problems = [];
    for (const path of want) if (!have.includes(path)) problems.push(`missing ${path}`);
    for (const path of have) if (!want.includes(path)) problems.push(`extra ${path}`);
    for (const path of want.filter((p) => have.includes(p))) if (lf(join(origin, path)) !== lf(join(target, path))) problems.push(`differs ${path}`);
    if (problems.length) {
      stale++;
      console.error(`templates/${name} is not ${template.origin}: ${problems.join(', ')}. Run node scripts/sync-templates.mjs`);
    }
  } else {
    rmSync(target, { recursive: true, force: true });
    for (const path of want) {
      mkdirSync(dirname(join(target, path)), { recursive: true });
      writeFileSync(join(target, path), lf(join(origin, path)));
    }
    console.log(`wrote templates/${name}: ${want.length} files from ${template.origin}`);
  }
}
if (stale) process.exit(1);
if (check) console.log('templates are current');
