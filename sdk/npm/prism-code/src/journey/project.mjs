/**
 * The files of a Prism app on disk. The app lives in one folder, `prism/`
 * beside the user's code (or the current folder when it already holds a
 * `prism.toml`), so an existing repository gains one directory and nothing
 * else.
 *
 *   prism/spec.json     the app's one input: the prism/spec/1 spec an agent writes or edits,
 *                       kept as canonical JSON (RFC 8785); its SHA-256 is the specHash, and
 *                       the model is rendered from it alone (spec-file.mjs)
 *   prism/session.json  where the conversation is, and what was proved
 *   prism/SPEC.md       the spec in prose
 *   prism/src/<App>.lex.tex   the generated LexLean model, the app's single source
 *   prism/...           the LexLean and PrismPM project files of the template
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { templateFiles } from '../init.mjs';
import { names, renderModel, renderProofs, renderSpecDocument } from './render.mjs';
import { SPEC_FILE, readSpecFile } from './spec-file.mjs';
import { DEFAULT_SDK_IMAGE, IMAGE_STANDARDS_LOCK, docker, runInImage } from './sdk.mjs';

export const SESSION_SCHEMA = 'prism/session/1';
const TEMPLATE_MODULE = 'TextRequest';
const RENAMED = ['lexlean.toml', 'lakefile.toml', 'lake-manifest.json', 'prismpm.toml'];
const UNUSED = [`src/${TEMPLATE_MODULE}.lex.tex`, 'src/Foundation/Utf8.lex.tex'];

export const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/** The app folder for a working directory. */
export function appDir(cwd) {
  if (existsSync(join(cwd, 'prism.toml')) && !existsSync(join(cwd, 'prism', 'prism.toml'))) return cwd;
  return join(cwd, 'prism');
}

const write = (dir, path, content) => {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), content);
};

export function readSession(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, 'session.json'), 'utf8'));
  } catch {
    return { schema: SESSION_SCHEMA, step: 'purpose', answers: {}, spec: null, axioms: {}, status: {} };
  }
}

export function writeSession(dir, session) {
  if (session.spec) writeSpecFile(dir, session);
  write(dir, 'session.json', `${JSON.stringify(session, null, 2)}\n`);
}

/**
 * Write spec.json, the canonical bytes of the session's spec, and record its
 * specHash. Returns what reading those bytes back gives.
 */
export function writeSpecFile(dir, session) {
  const read = readSpecFile(session.spec);
  write(dir, SPEC_FILE, read.bytes);
  session.status ??= {};
  session.status.specAddress = read.specAddress;
  session.status.specHash = read.specHash;
  return read;
}

/** The project's spec.json, read strictly, or null when there is none. Throws SpecError when it is not a valid spec. */
export function readProjectSpec(dir) {
  const path = join(dir, SPEC_FILE);
  return existsSync(path) ? readSpecFile(readFileSync(path, 'utf8')) : null;
}

/**
 * The model files that are not what spec.json renders to, compared byte for
 * byte: empty when the model is exactly the spec's. `axioms` are the recorded
 * axiom sets the render takes. Names spec.json itself when there is none.
 */
export function modelMismatches(dir, { axioms = {} } = {}) {
  const read = readProjectSpec(dir);
  if (!read) return [SPEC_FILE];
  const n = names(read.spec);
  const proofs = renderProofs(read.spec, { axioms });
  const expected = [[`src/${n.module}.lex.tex`, renderModel(read.spec, { axioms, specAddress: read.specAddress })], [`src/${n.proofs}.lex.tex`, proofs || null]];
  const differs = [];
  for (const [file, text] of expected) {
    const path = join(dir, file);
    const actual = existsSync(path) ? readFileSync(path, 'utf8') : null;
    if (actual !== text) differs.push(file);
  }
  for (const entry of existsSync(join(dir, 'src')) ? readdirSync(join(dir, 'src')) : []) {
    if (entry.endsWith('.lex.tex') && !expected.some(([file]) => file === `src/${entry}`)) differs.push(`src/${entry}`);
  }
  return differs;
}

/** Write the template's project files the folder lacks. Never overwrites. Returns the paths written. */
export function scaffold(dir) {
  const written = [];
  for (const [path, bytes] of templateFiles()) {
    // The app needs neither the template's model nor Foundation.Utf8: the guest uses the
    // UTF-8 primitives, and the exporter refuses Foundation.Utf8's decoder as too deeply nested.
    if (UNUSED.includes(path) || existsSync(join(dir, path))) continue;
    write(dir, path, bytes);
    written.push(path);
  }
  if (!existsSync(join(dir, '.gitattributes'))) {
    write(dir, '.gitattributes', '* text eol=lf\n');
    written.push('.gitattributes');
  }
  if (!existsSync(join(dir, '.gitignore'))) {
    write(dir, '.gitignore', '.prism/\n.lexlean/\n.lake/\n.prism-last.log\n');
    written.push('.gitignore');
  }
  return written;
}

export const isBound = (dir) => existsSync(join(dir, 'prismpm.lock')) && existsSync(join(dir, 'standards.lock'));

/** Pin the folder to an SDK image: copy its standards.lock, then `prismpm update --toolchain`, which writes prismpm.lock. */
export async function bind(dir, image = DEFAULT_SDK_IMAGE, { onLine } = {}) {
  const standards = await docker(['run', '--rm', '--network', 'none', '--entrypoint', 'cat', image, IMAGE_STANDARDS_LOCK]);
  if (standards.code !== 0) return { ok: false, output: standards.output };
  write(dir, 'standards.lock', standards.output);
  const update = await runInImage(dir, `lexlean lock && lexlean fmt --all && lexlean lock && prismpm update --toolchain ${image}`, { image, onLine });
  return { ok: update.code === 0 && existsSync(join(dir, 'prismpm.lock')), output: update.output };
}

/** The manifest, written from the spec, granting nothing. */
function manifest(spec) {
  return [
    '[application]',
    `name = ${JSON.stringify(spec.name)}`,
    'version = "0.1.0"',
    `description = ${JSON.stringify(spec.purpose.slice(0, 200))}`,
    '',
    '[model]',
    'source = "src"',
    'watch = ["src/**/*.lex.tex", "language/**/*.toml", "lexlean.toml"]',
    '',
    '# Deny by default: an empty set grants the holo nothing.',
    '[capabilities]',
    '',
  ].join('\n');
}

/** The path of the model file, and of the proofs module beside it. */
export const modelPath = (dir, spec) => join(dir, 'src', `${names(spec).module}.lex.tex`);
export const proofsPath = (dir, spec) => join(dir, 'src', `${names(spec).proofs}.lex.tex`);

/** The digest of what Prism wrote: the model and its proofs, as they are on disk. */
export function modelDigest(dir, spec) {
  const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
  return sha256(`${read(modelPath(dir, spec))}\n--proofs--\n${read(proofsPath(dir, spec))}`);
}

/**
 * Write the model and everything that names it. Refuses to overwrite a model
 * someone edited by hand since Prism last wrote it, unless `overwrite`.
 */
export function writeApp(dir, session, { overwrite = false } = {}) {
  // The model is rendered from spec.json alone: write it canonically, read it back strictly, render what it says.
  const read = writeSpecFile(dir, session);
  session.spec = read.spec;
  const specAddress = read.specAddress;
  const spec = session.spec;
  const n = names(spec);
  const path = modelPath(dir, spec);
  if (!overwrite && session.status.modelSha && existsSync(path) && modelDigest(dir, spec) !== session.status.modelSha) {
    return { edited: true, path };
  }
  scaffold(dir);
  const originals = templateFiles();
  for (const file of RENAMED) {
    let text = new TextDecoder().decode(originals.get(file));
    text = text.split('prism-text-request').join(`prism-${spec.name}`).split(`Prism${TEMPLATE_MODULE}`).join(n.prefix).split(`src/${TEMPLATE_MODULE}.lex.tex`).join(`src/${n.module}.lex.tex`);
    if (file === 'prismpm.toml') text = text.replace(`project = "${TEMPLATE_MODULE}"`, `project = "${n.module}"`);
    write(dir, file, text);
  }
  write(dir, 'prism.toml', manifest(spec));
  for (const entry of readdirSync(join(dir, 'src'))) {
    if (entry.endsWith('.lex.tex') && entry !== `${n.module}.lex.tex` && entry !== `${n.proofs}.lex.tex`) rmSync(join(dir, 'src', entry));
  }
  const model = renderModel(spec, { axioms: session.axioms ?? {}, specAddress });
  write(dir, `src/${n.module}.lex.tex`, model);
  const proofs = renderProofs(spec, { axioms: session.axioms ?? {} });
  if (proofs) write(dir, `src/${n.proofs}.lex.tex`, proofs);
  else if (existsSync(join(dir, 'src', `${n.proofs}.lex.tex`))) rmSync(join(dir, 'src', `${n.proofs}.lex.tex`));
  writeSpecDocument(dir, session);
  return { edited: false, path, model };
}

export function writeSpecDocument(dir, session) {
  if (session.spec) write(dir, 'SPEC.md', renderSpecDocument(session.spec, session.status));
}

/** Remember the model as formatted on disk, so a later hand edit is noticed. */
export function rememberModel(dir, session) {
  if (existsSync(modelPath(dir, session.spec))) session.status.modelSha = modelDigest(dir, session.spec);
}

/** The newest holo the build wrote, or null. */
export function newestHolo(dir) {
  const root = join(dir, '.prism', 'build');
  if (!existsSync(root)) return null;
  let best = null;
  const visit = (d, depth) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory() && depth < 3) visit(p, depth + 1);
      else if (entry.isFile() && entry.name.endsWith('.holo')) {
        const t = statSync(p).mtimeMs;
        if (!best || t > best.t) best = { path: p, t };
      }
    }
  };
  visit(root, 0);
  return best?.path ?? null;
}
