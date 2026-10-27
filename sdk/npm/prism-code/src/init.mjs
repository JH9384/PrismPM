/**
 * `prism-code init` (issue #281): scaffold a project a Prism SDK image can
 * check, build and verify.
 *
 * A project is a template plus a generated `prism.toml`. A template is a
 * reviewed PrismPM fixture copied byte for byte (see `TEMPLATES`): its
 * `lexlean.lock` binds the digests of its Lean workspace files and its
 * `lexlean.toml`, so renaming anything inside it would make the lock stale.
 * The application's own name lives in `prism.toml` (#280).
 *
 * Binding the project to an SDK takes two steps in the SDK image, which this
 * module only describes (pure functions; `bin/` runs them):
 *
 *   1. copy the image's `standards.lock` into the project, as the UOR
 *      template's bootstrap does (an existing, different one is refused);
 *   2. `prismpm update --toolchain <image>`, which writes `prismpm.lock`
 *      (docs/proposals/265-lock-update.md).
 *
 * There is no default image: no PrismPM SDK release exists yet (#194), so the
 * caller names one with `--sdk-image`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fail } from './errors.mjs';
import { parseManifest, MANIFEST_FILE } from './manifest.mjs';
import { SDK_IMAGE_PATTERN, dockerArguments } from './docker.mjs';

const TEMPLATES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');

/** Where the SDK image keeps the standards lock it was built with (sdk/Dockerfile). */
export const IMAGE_STANDARDS_LOCK = '/opt/prismpm/share/standards.lock';

/**
 * The templates. Each is a copy of a reviewed fixture; a test keeps the copy
 * byte for byte equal to its origin, and `scripts/sync-templates.mjs`
 * refreshes it.
 */
export const TEMPLATES = Object.freeze({
  'text-request': Object.freeze({
    origin: 'tests/fixtures/holo/ho-11-text-application/project',
    description: 'A text application: a UTF-8 request in, a response out, six acceptance vectors (language 1.2).',
    model: 'src',
    watch: Object.freeze(['src/**/*.lex.tex', 'language/**/*.toml', 'lexlean.toml']),
  }),
});
export const DEFAULT_TEMPLATE = 'text-request';

function walk(root, dir = root, out = []) {
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(root, full, out);
    else out.push(relative(root, full).split(sep).join('/'));
  }
  return out;
}

/** The files of a template, path to bytes, with line endings as LF whatever the checkout did. */
export function templateFiles(template = DEFAULT_TEMPLATE) {
  if (!Object.hasOwn(TEMPLATES, template)) {
    fail('init.template', `no template ${JSON.stringify(template)}; the templates are ${Object.keys(TEMPLATES).join(', ')}`);
  }
  const root = join(TEMPLATES_DIR, template);
  const files = new Map();
  for (const path of walk(root)) {
    // A Windows checkout may have turned LF into CRLF; the locks hash LF bytes.
    const text = readFileSync(join(root, path), 'utf8').replaceAll('\r\n', '\n');
    files.set(path, new TextEncoder().encode(text));
  }
  return files;
}

/** The `prism.toml` a new project starts with. It grants nothing: the capability table is present and empty. */
export function manifestText(name, template = DEFAULT_TEMPLATE) {
  const t = TEMPLATES[template];
  const text = [
    '[application]',
    `name = ${JSON.stringify(name)}`,
    'version = "0.1.0"',
    `description = ${JSON.stringify(t.description)}`,
    '',
    '[model]',
    `source = ${JSON.stringify(t.model)}`,
    `watch = [${t.watch.map((w) => JSON.stringify(w)).join(', ')}]`,
    '',
    '# Deny by default: an empty set grants the holo nothing. See docs/proposals/279-capability-sets.md.',
    '[capabilities]',
    '',
  ].join('\n');
  // The manifest reader is the authority on what a valid name is.
  parseManifest(text);
  return text;
}

/** A project name from a directory name: lower case, `-` for anything else, starting with a letter. */
export function nameFromDirectory(directory) {
  const base = directory.split(/[\\/]/).filter(Boolean).pop() ?? '';
  const name = base.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^[^a-z]+/, '').replace(/-+$/, '').slice(0, 63);
  return name || 'app';
}

/**
 * Everything `init` writes before binding an SDK: the template's files and
 * `prism.toml`, as path to bytes. Throws `manifest.invalid` for a name the
 * manifest refuses.
 */
export function planInit({ name, template = DEFAULT_TEMPLATE }) {
  const files = templateFiles(template);
  if (files.has(MANIFEST_FILE)) fail('init.template', `template ${template} already has a ${MANIFEST_FILE}`);
  files.set(MANIFEST_FILE, new TextEncoder().encode(manifestText(name, template)));
  return files;
}

/**
 * The two `docker` invocations that bind a project to an SDK image: read the
 * image's standards lock, then `prismpm update --toolchain <image>` in the
 * project. Returns `{ standards, update }`, argument lists for `docker`.
 */
export function bindCommands({ image, cwd, uid = null, gid = null, platform = process.platform }) {
  if (typeof image !== 'string' || !SDK_IMAGE_PATTERN.test(image)) {
    fail('lock.image', `--sdk-image must be an immutable reference, NAME@sha256:DIGEST; got ${JSON.stringify(image)}`);
  }
  return {
    standards: ['run', '--rm', '--network', 'none', '--entrypoint', 'cat', image, IMAGE_STANDARDS_LOCK],
    update: dockerArguments({ image, cwd, command: 'update', args: ['--toolchain', image], uid, gid, platform }),
  };
}
