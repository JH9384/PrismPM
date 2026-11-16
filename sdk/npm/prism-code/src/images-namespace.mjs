/**
 * `prism.images`: everything about an image (issue #442, part of the proposal in
 * #440). A holo is an image that carries its own proof; `.holo` stays the file
 * format.
 *
 *   build    the project into an image, in the builder image `prismpm.lock` pins
 *   pull     an image from a registry or a store, verified before anything is written
 *   push     an image and its attestations to a registry or a store
 *   list     the images in the local store, newest first
 *   get      one image from the local store, with its bytes
 *   tag      one more name for a stored image
 *   remove   a tag, or a stored image no container holds
 *   prune    untagged images no container holds (`all`: every image none holds)
 *   inspect  what an image says about itself, without running it
 *   verify   the verdict of `check` on an image
 *
 * This is the developer view of #346: each verb calls the code that already does
 * the work and returns what it found in the developer's words. It decides nothing
 * about trust. What `pull` refuses and in what order is `push-pull.mjs`, a verdict
 * is `check`, credentials are `oci-auth.mjs`.
 *
 * The shapes follow docker-py: `pull(repository, { tag })`, `push(repository, { tag })`,
 * `build({ path, tag, file })`, `tag(source, target)`, `remove(name, { force })`.
 * `build` and `pull` write into the local image store (`image-store.mjs`, #349),
 * and `push` sends the stored image its name names unless `source` is given.
 *
 * An option a verb does not have is refused. A misspelled `policy` that was
 * ignored would pull an image under a weaker rule than the caller wrote.
 *
 * Everything but `inspect` needs Node, so those modules load on first use and this
 * one can sit behind a client that also runs in a browser.
 *
 * Experimental until the v0.6 freeze (STABILITY.md section 6).
 */
import { asBytes, holoDigest, parseArchive } from './archive.mjs';
import { readAttestations } from './attestations.mjs';
import { blake3Hex } from './blake3.mjs';
import { fail, PrismError, ReferenceInvalidError } from './errors.mjs';
import { createImageStore, localName, storedName } from './image-store.mjs';
import { inspect as inspectHolo } from './inspect.mjs';
import { parseReference } from './oci-reference.mjs';
import { sha256Hex } from './sha256.mjs';

export const IMAGE_BUILD_SCHEMA = 'prism/image-build/1';
export const IMAGE_PULL_SCHEMA = 'prism/image-pull/1';
export const IMAGE_PUSH_SCHEMA = 'prism/image-push/1';
export const IMAGE_INSPECTION_SCHEMA = 'prism/image-inspection/1';

const REGISTRY_OPTIONS = ['tag', 'store', 'plainHttp', 'env', 'timeoutMs', 'referrersFallback'];
const TUF_OPTIONS = ['tufMirrorUrl', 'tufRoot', 'tufCache'];
const SIGNER_OPTIONS = ['key', 'certificateIdentity', 'certificateIdentityRegexp', 'certificateOidcIssuer', 'trustedRoot', 'entries', 'timestamps', ...TUF_OPTIONS];
const PULL_OPTIONS = [...REGISTRY_OPTIONS, ...SIGNER_OPTIONS, 'output', 'policy', 'type', 'maxSize'];
const PUSH_OPTIONS = [...REGISTRY_OPTIONS, ...TUF_OPTIONS, 'source', 'key', 'keyless', 'noAttestations', 'signingConfig', 'identityToken', 'onProgress'];
const VERIFY_OPTIONS = [...SIGNER_OPTIONS, 'policy', 'capabilities', 'replay', 'env'];
const BUILD_OPTIONS = ['path', 'tag', 'file', 'locked', 'update', 'release', 'env'];

/** A tag `build` was given that is also a local name, or none. A release reference that is not one stays the builder's. */
function builtName(tag) {
  if (tag === undefined) return null;
  try {
    return localName(tag);
  } catch {
    return null;
  }
}

/** `prismpm build` prints one JSON value, so this is plenty; the last of the logs is what explains a failure. */
const MAX_RESULT_BYTES = 16 * 1024 * 1024;
const MAX_LOG_BYTES = 1024 * 1024;
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
const MAX_IMAGE_BYTES = 256 * 1024 * 1024;
// `schemas/product-release-result.schema.json`: `evidence_path`. A path the builder names stays in the project.
const RELATIVE_PATH = /^(?!\/)(?!.*(?:^|\/)[.][.]?(\/|$))[A-Za-z0-9._/-]+$/;
// `export.mjs`: a portable name at the top of a build, with no separator of any platform.
const FILE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,255}$/;
// Docker's own: the daemon failed, or the command could not be run or found. The builder never started.
const DOCKER_EXITS = new Set([125, 126, 127]);

/** Options are a plain object of known names. An inherited member would pass every check here and still reach the code below, or be dropped by a copy. */
function allow(verb, options, names) {
  const prototype = options === null || typeof options !== 'object' ? undefined : Object.getPrototypeOf(options);
  if (prototype !== Object.prototype && prototype !== null) fail('PP1001', `images.${verb} options must be a plain object`);
  const unknown = Object.keys(options).filter((name) => !names.includes(name));
  if (unknown.length > 0) fail('PP1001', `images.${verb} has no option ${unknown.join(', ')}; it takes ${names.join(', ')}`);
}

/** An option that is text is text: a value of another type must not be ignored, or be written into a name as `null`. */
function allowText(verb, options, names) {
  for (const name of names) {
    if (options[name] !== undefined && (typeof options[name] !== 'string' || options[name] === '')) fail('PP1001', `images.${verb} option ${name} must be non-empty text`);
  }
}

/**
 * The reference text. Anything but text is refused here, or `null` would name a
 * store's image `null:latest`. A `dir://` name holds its own tag, and its path may
 * hold a colon, so `tag` beside it is refused. Any other name that already has a
 * tag or digest beside `tag` is refused by the grammar.
 */
function named(repository, tag) {
  const refuse = (why, check = 'reference.syntax') => {
    throw new ReferenceInvalidError(`this is not a valid image name: ${why}`, { check });
  };
  if (typeof repository !== 'string' || repository === '') refuse(`it must be non-empty text, not ${typeof repository === 'string' ? 'empty' : typeof repository}`);
  if (tag === undefined) return repository;
  if (typeof tag !== 'string' || tag === '') refuse('the tag must be non-empty text');
  if (repository.startsWith('dir://')) refuse('a dir:// name holds its own tag, as dir://store:tag', 'reference.store');
  return `${repository}:${tag}`;
}

/** A path stays a path, so the code it reaches reads it and reports it; anything else becomes bytes. */
async function sourceOf(image) {
  if (typeof image === 'string') return image;
  if (image instanceof URL) {
    if (image.protocol !== 'file:' || image.hostname !== '') fail('load.path', `${image} is not a local file; pull an image from a registry with images.pull`);
    const { fileURLToPath } = await import('node:url');
    try {
      return fileURLToPath(image);
    } catch (cause) {
      return fail('load.path', `${image} is not a path: ${cause.message}`);
    }
  }
  if (typeof Blob !== 'undefined' && image instanceof Blob) return new Uint8Array(await image.arrayBuffer());
  return asBytes(image);
}

const digestsOf = async (bytes) => ({ sha256: await sha256Hex(bytes), blake3: blake3Hex(bytes) });

/** The last `limit` bytes of a stream, and whether anything before them was dropped. */
function tail(limit) {
  const chunks = [];
  let size = 0;
  let total = 0;
  return {
    add(chunk) {
      chunks.push(chunk);
      size += chunk.length;
      total += chunk.length;
      while (size - chunks[0].length >= limit) size -= chunks.shift().length;
    },
    text: () => Buffer.concat(chunks).subarray(-limit).toString('utf8'),
    overflowed: () => total > limit,
  };
}

/** Run docker and collect its one result and its logs. Whatever stops it from running at all is `error`. */
function runBuilder(spawn, { command, args }, { cwd, env }) {
  return new Promise((done) => {
    const stdout = tail(MAX_RESULT_BYTES);
    const logs = tail(MAX_LOG_BYTES);
    let child;
    try {
      child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (error) {
      done({ error, code: null, stdout: '', overflowed: false, logs: '' });
      return;
    }
    child.stdout.on('data', (chunk) => stdout.add(chunk));
    child.stderr.on('data', (chunk) => logs.add(chunk));
    child.on('error', (error) => done({ error, code: null, stdout: stdout.text(), overflowed: stdout.overflowed(), logs: logs.text() }));
    child.on('close', (code, signal) => done({ error: null, code: code ?? (signal ? 1 : 0), stdout: stdout.text(), overflowed: stdout.overflowed(), logs: logs.text() }));
  });
}

function parseResult(stdout) {
  try {
    const value = JSON.parse(stdout);
    return value !== null && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

/** A file a build result names: a regular file that is really inside the project, within `limit`. A link, or a path that leaves the project, is refused. */
async function readInside(root, path, limit, what) {
  const { lstat, readFile, realpath } = await import('node:fs/promises');
  const { relative } = await import('node:path');
  const missing = (cause) => fail('PP4002', `${what} cannot be read: ${cause.code ?? cause.message}`);
  const info = await lstat(path).catch(missing);
  const inside = relative(await realpath(root), await realpath(path).catch(missing));
  if (/^\.\.([\\/]|$)/.test(inside) || /^[A-Za-z]:|^[\\/]/.test(inside) || !info.isFile()) fail('PP8001', `${what} is a link or leaves the project`);
  if (info.size > limit) fail('PP4004', `${what} is ${info.size} bytes, over the ${limit} byte bound`);
  return readFile(path).catch(missing);
}

/** Where a build left its build manifest, and how to read a file it names. */
async function builtFiles(root, result) {
  const { join, dirname } = await import('node:path');
  if (typeof result.release_digest === 'string') {
    const { openRelease } = await import('./export.mjs');
    const release = openRelease(root, result.release_digest);
    return { manifestBytes: release.layerBytes('manifest.json', MAX_MANIFEST_BYTES), read: async (title) => release.layerBytes(title, MAX_IMAGE_BYTES), pathOf: () => null };
  }
  if (typeof result.manifest_path !== 'string' || !RELATIVE_PATH.test(result.manifest_path)) fail('PP4004', 'the build result names no build manifest inside the project');
  const path = join(root, result.manifest_path);
  const folder = dirname(path);
  return {
    manifestBytes: await readInside(root, path, MAX_MANIFEST_BYTES, `the build manifest ${result.manifest_path}`),
    read: (title) => readInside(root, join(folder, title), MAX_IMAGE_BYTES, `the image ${title}`),
    pathOf: (title) => join(folder, title),
  };
}

/** The one image a build manifest names, checked against its row. A build that names none did not build an image. */
async function builtImage(root, result) {
  const { BUILD_MANIFEST_SCHEMA, digestOf, parseDocument, rowsByPath } = await import('./export.mjs');
  const { manifestBytes, read, pathOf } = await builtFiles(root, result);
  if (!manifestBytes) fail('PP4002', 'the release has no build manifest');
  const manifest = parseDocument(manifestBytes, 'build manifest');
  if (manifest.schema !== BUILD_MANIFEST_SCHEMA || !Array.isArray(manifest.files)) fail('PP4004', 'the build manifest is not a PrismPM build manifest');
  const rows = rowsByPath(manifest.files, 'build manifest');
  const titles = [...rows.keys()].filter((path) => !path.includes('/') && path.endsWith('.holo'));
  if (titles.length !== 1) fail('PP4002', `the build names ${titles.length} images, and images.build returns one: ${titles.join(', ') || 'none'}`);
  const [title] = titles;
  if (!FILE_NAME.test(title)) fail('PP8001', `the build manifest names ${JSON.stringify(title)}, which is not a portable name in the build`);
  const row = rows.get(title);
  const bytes = new Uint8Array(await read(title) ?? fail('PP4002', `the release has no layer ${title}`));
  if (digestOf(bytes) !== `sha256:${row.sha256}` || bytes.length !== row.byte_length) fail('PP4001', `${title} differs from its build manifest row`);
  const parsed = parseArchive(bytes);
  if (!parsed.verification.footer) fail('PP3004', `${title} does not match its own digest: its footer is ${parsed.footer}, its body gives ${parsed.fingerprint}`);
  if (!parsed.verification.labels) fail('PP3008', `a layer of ${title} does not match its digest: ${parsed.verification.labelMismatches.map((m) => m.label).join(', ')}`);
  return { bytes, digest: holoDigest(parsed), path: pathOf(title) };
}

/** The file's digests in a push or pull, grouped the way an inspection groups them. */
const fileDigest = ({ sha256, blake3 }) => ({ sha256, blake3 });

/** Where an attestation came from: `holo` is the image itself in these words. */
const fromImage = (row) => (row.source === 'holo' ? { ...row, source: 'image' } : row);

const LAYER_ROLES = Object.freeze({ 'model-document': 'config' });

function layerOf(section) {
  const layer = {
    index: section.index,
    kind: section.kind,
    type: section.kind_name,
    role: LAYER_ROLES[section.role] ?? section.role,
    offset: section.offset,
    size: section.length,
    // A content blob's label is its layer digest. Any other section has none, only the digests of its bytes.
    digest: section.label ?? null,
    bytesDigest: section.digest,
  };
  if (section.name !== undefined) layer.name = section.name;
  if (section.content) {
    layer.contentSize = section.content.length;
    layer.contentDigest = section.content.digest;
    layer.verified = section.content.label_matches;
  }
  return layer;
}

/** The statements an image carries, and null when one cannot be read. `signed` says a signature is present, not that anyone checked it. */
function statementsOf(parsed) {
  try {
    return readAttestations(parsed).map(({ predicateType, signed, subjects }) => ({ predicateType, signed, subjects: subjects.map(({ name, digest }) => ({ name, digest })) }));
  } catch (cause) {
    if (cause instanceof PrismError) return null;
    throw cause;
  }
}

/**
 * `prismpm/holo-inspection/1` in the developer's words (#346), with what it does
 * not read yet: the statements in the image, and the digest its bytes really have.
 * A damaged image's footer is a claim, so it is reported as `claimedDigest`.
 */
function inspectionView(inspection, parsed) {
  const { manifest, model, provenance, world, verification } = inspection;
  const statements = statementsOf(parsed);
  let worldView = null;
  if (world) {
    const { capability_set: capabilitySet, ...rest } = world;
    worldView = { ...rest, capabilitySet: { digest: capabilitySet.label, empty: capabilitySet.empty } };
  }
  return {
    schema: IMAGE_INSPECTION_SCHEMA,
    name: inspection.name,
    digest: holoDigest(parsed),
    fileDigest: inspection.digest,
    size: inspection.size,
    format: { revision: inspection.revision, version: inspection.physical_version, flags: inspection.flags },
    layers: inspection.sections.map(layerOf),
    manifest: {
      uri: manifest.uri,
      layers: { capabilitySet: manifest.labels.capability_set, guest: manifest.labels.guest, view: manifest.labels.view },
      entry: manifest.entry,
      contract: manifest.contract,
      viewEntry: manifest.view_entry,
      surface: manifest.surface,
    },
    config: {
      schema: model.schema,
      name: model.name,
      crate: { name: model.cargo_name, version: model.cargo_version },
      description: model.description,
      profile: model.profile,
      function: model.function,
      vectors: model.vectors,
      limits: { request: model.limits.request, response: model.limits.response, guestAllocation: model.limits.guest_allocation },
      contentDigest: model.digest,
    },
    provenance: {
      schema: provenance.schema,
      applicationKappa: provenance.application_kappa,
      modelId: provenance.model_id,
      compilerSemanticsId: provenance.compiler_semantics_id,
      stdlibSemanticsId: provenance.stdlib_semantics_id,
      lexleanCommit: provenance.lexlean_commit,
    },
    world: worldView,
    attestations: statements ?? [],
    verification: {
      digest: verification.footer,
      claimedDigest: parsed.format === 5 ? parsed.kappa : `blake3:${inspection.footer}`,
      layers: verification.labels,
      crossReferences: verification.cross_references,
      attestations: statements !== null,
    },
  };
}

/**
 * The `images` namespace. `spawn` runs docker, `child_process.spawn` unless given.
 * `docker` builds the whole Docker invocation for this machine, as `hostDockerArguments`
 * in `host.mjs` does. That probe belongs to `client`, which `images` may not import
 * (model/modules.toml), so `client` passes it in. Without it `build` raises `PP5008`,
 * and every other verb works.
 *
 * `store` is the backend of the local image store (`fileImageStore` or
 * `memoryImageStore`), in memory unless given; `references()` lists what containers
 * hold, `[{ digest, running }]`, which `client` passes in because `images` may not
 * import `containers`.
 *
 * @param {{ spawn?: Function, docker?: (request: { image: string, cwd: string, command: string, args: string[] }) => ({ command: string, args: string[], display: string } | Promise<{ command: string, args: string[], display: string }>) | null, store?: object, references?: Function }} [dependencies]
 */
export function createImages({ spawn, docker = null, store, references } = {}) {
  if (docker !== null && typeof docker !== 'function') fail('PP1001', 'images: docker must be a function that builds the Docker invocation, or null');
  const local = createImageStore({ ...(store === undefined ? {} : { backend: store }), ...(references === undefined ? {} : { references }) });
  /**
   * Build the project in the builder image `prismpm.lock` pins, as `prism-code build`
   * does, and return the image it made.
   *
   * @param {{ path?: string, tag?: string, file?: string, locked?: boolean, update?: boolean, release?: string, env?: object }} [options]
   *   `path` the project, `.` unless given; `tag` makes a product release under that reference (`-t`);
   *   `file` the project configuration (`-f`); the others are `prismpm build`'s.
   * @returns {Promise<object>} `prism/image-build/1`, with `bytes` the image. `path` is null for a tagged build, which lives in the release store.
   */
  async function build(options = {}) {
    allow('build', options, BUILD_OPTIONS);
    allowText('build', options, ['path', 'tag', 'file', 'release']);
    const { readFile } = await import('node:fs/promises');
    const { resolve, join } = await import('node:path');
    if (docker === null) fail('PP5008', 'images.build runs the builder image in Docker, and this client has no Docker host; use prism.images from createPrism() or Prism.fromEnv() in Node');
    const { sdkImageFromLock } = await import('./docker.mjs');
    const root = resolve(options.path ?? '.');
    const lock = await readFile(join(root, 'prismpm.lock'), 'utf8').catch(() => fail('PP1101', `${root} has no prismpm.lock, which pins the builder image`));
    const builder = sdkImageFromLock(lock);
    const flag = (name, value) => (value === undefined ? [] : [`--${name}=${value}`]);
    const args = ['--json', ...flag('tag', options.tag), ...flag('config', options.file), ...flag('release', options.release)];
    if (options.locked) args.push('--locked');
    if (options.update) args.push('--update');
    const run = spawn ?? (await import('node:child_process')).spawn;
    const { error, code, stdout, overflowed, logs } = await runBuilder(run, await docker({ image: builder, cwd: root, command: 'build', args }), { cwd: root, env: options.env ?? process.env });
    if (error) fail('PP5008', error.code === 'ENOENT' ? 'docker is not installed or not on PATH; images.build runs the builder image in Docker' : `docker could not start: ${error.message}`);
    // The end of too much output could still parse, and it is not the one value `prismpm --json` prints.
    if (overflowed) fail('PP4004', `the build printed more than ${MAX_RESULT_BYTES} bytes, and its result is one JSON value`, { exitCode: code, logs });
    const result = parseResult(stdout);
    if (code !== 0) {
      // `prismpm --json` reports its own failure on stdout.
      const diagnostic = result?.diagnostic;
      if (typeof diagnostic?.code === 'string') fail(diagnostic.code, diagnostic.message ?? `the build exited ${code}`, { exitCode: code, logs });
      if (DOCKER_EXITS.has(code)) fail('PP5008', `the builder image did not run: docker exited ${code}`, { exitCode: code, logs });
      fail('PP9001', `the build stopped with exit ${code} and reported no diagnostic`, { exitCode: code, logs });
    }
    if (result === null) fail('PP4004', 'the build exited 0 and printed no JSON result', { logs });
    const { bytes, digest, path } = await builtImage(root, result);
    const name = builtName(options.tag);
    const stored = await local.add(bytes, { tags: name === null ? [] : [name] });
    return {
      schema: IMAGE_BUILD_SCHEMA,
      digest,
      tag: options.tag ?? null,
      tags: stored.tags,
      path,
      fileDigest: await digestsOf(bytes),
      size: bytes.length,
      builder,
      manifestDigest: result.release_digest ?? null,
      buildId: result.build_id ?? null,
      logs,
      bytes,
    };
  }

  /**
   * Fetch an image and verify it before anything is written. Nothing reaches `output`
   * unless the digests, the archive, the verdict under `policy`, every attestation
   * subject and any signer named here have passed; without `output`, nothing is
   * written at all and the bytes are returned.
   *
   * @param {string} repository a registry-qualified name, a name in `store`, or a `dir://` store
   * @param {object} [options] `{ tag, store, output, policy, key, certificateIdentity, certificateIdentityRegexp, certificateOidcIssuer, type, trustedRoot, entries, timestamps, tufMirrorUrl, tufRoot, tufCache, plainHttp, env, timeoutMs, referrersFallback, maxSize }`; `policy` is what `check` takes, or an object of the same members
   * @returns {Promise<object>} `prism/image-pull/1`, with `bytes` the image
   */
  async function pull(repository, options = {}) {
    allow('pull', options, PULL_OPTIONS);
    allowText('pull', options, ['store', 'output']);
    if (options.maxSize !== undefined && (!Number.isSafeInteger(options.maxSize) || options.maxSize <= 0)) fail('PP1001', 'images.pull option maxSize must be a positive whole number of bytes');
    const { experimental_pull } = await import('./push-pull.mjs');
    const { tag, maxSize, ...rest } = options;
    const text = named(repository, tag);
    const pulled = await experimental_pull(text, { ...rest, ...(maxSize === undefined ? {} : { maxHoloBytes: maxSize }) });
    // Only a verified image reaches the store: `experimental_pull` has refused anything else by now.
    const name = storedName(parseReference(text, options.store === undefined ? {} : { store: options.store }));
    const stored = await local.add(pulled.holo, { tags: name === null ? [] : [name] });
    return {
      schema: IMAGE_PULL_SCHEMA,
      reference: pulled.reference,
      digest: pulled.fingerprint,
      manifestDigest: pulled.digest,
      fileDigest: fileDigest(pulled),
      size: pulled.size,
      verdict: pulled.verdict,
      attestations: {
        image: pulled.attestations.holo,
        referrers: pulled.attestations.referrers,
        signatures: pulled.attestations.signatures,
        verified: pulled.attestations.verified.map(fromImage),
      },
      output: pulled.output,
      tags: stored.tags,
      bytes: pulled.holo,
    };
  }

  /**
   * Push an image and its attestations; its tags go last, so a tag never names an image whose attestations are on the way.
   *
   * @param {string} repository a registry-qualified name, a name in `store`, or a `dir://` store
   * @param {object} options `{ source, tag, store, key, keyless, noAttestations, signingConfig, identityToken, tufMirrorUrl, tufRoot, tufCache, plainHttp, env, timeoutMs, referrersFallback, onProgress }`; `source` is required: the image's bytes, a Blob, a path, a file URL or a `dir://` reference
   * @returns {Promise<object>} `prism/image-push/1`
   */
  async function push(repository, options = {}) {
    allow('push', options, PUSH_OPTIONS);
    allowText('push', options, ['store']);
    const { tag, source, ...rest } = options;
    const target = named(repository, tag);
    let image;
    if (source === undefined || source === null) {
      // `docker push name:tag` pushes the local image of that name; a `dir://` name has no local one.
      if (target.startsWith('dir://')) fail('load.source', `images.push to ${target} needs the image as options.source, or push a stored image by its name with options.store`);
      image = (await local.get(localName(target))).bytes;
    } else image = await sourceOf(source);
    const { experimental_push } = await import('./push-pull.mjs');
    const pushed = await experimental_push(image, target, rest);
    return {
      schema: IMAGE_PUSH_SCHEMA,
      reference: pushed.reference,
      repository: pushed.repository,
      tag: pushed.tag,
      tags: pushed.tags,
      digest: pushed.fingerprint,
      manifestDigest: pushed.digest,
      fileDigest: fileDigest(pushed),
      size: pushed.layer.size,
      uploaded: pushed.layer.uploaded,
      referrers: pushed.referrers.map(fromImage),
    };
  }

  /**
   * What an image says about itself, read from its layer table. The guest is not run.
   * Integrity is reported in `verification`, not thrown, so a damaged image can still be looked at.
   *
   * @param {Uint8Array | ArrayBuffer | ArrayBufferView | Blob | string | URL} image the image's bytes, a Blob, a path, a file URL or a name the local store keeps
   * @returns {Promise<object>} `prism/image-inspection/1`
   */
  async function inspect(image) {
    let source = await sourceOf(image);
    if (typeof source === 'string') {
      const { readFile, stat } = await import('node:fs/promises');
      const path = source;
      // A name the local store keeps is that image, as `docker image inspect calc:latest` (#347); a path that exists wins.
      const kept = await stat(path).then(() => null, () => local.get(path).catch((error) => {
        if (error instanceof ReferenceInvalidError || /^image\.(missing|name)$/.test(error?.code ?? '')) return null;
        throw error;
      }));
      source = kept?.bytes ?? await readFile(path).catch((cause) => {
        if (cause.code === 'EISDIR') fail('inspect.kind', `${path} is a directory; inspect reads a .holo archive, and a closure has no section table`);
        return fail('load.path', `${path} cannot be read: ${cause.code ?? cause.message}`);
      });
    }
    const bytes = asBytes(source);
    return inspectionView(await inspectHolo(bytes), parseArchive(bytes));
  }

  /**
   * The verdict of `check` on an image. A verdict that did not pass is returned, not
   * thrown; a call that cannot reach a verdict rejects with a `VerificationError`.
   * The signer options name who may vouch for the statements in the image: without
   * one a signed image is P0, because an unchecked signature is no evidence.
   *
   * @param {Uint8Array | ArrayBuffer | ArrayBufferView | Blob | string | URL} image the image's bytes, a Blob, a path or a file URL
   * @param {object} [options] `{ policy, capabilities, replay, env, key, certificateIdentity, certificateIdentityRegexp, certificateOidcIssuer, trustedRoot, entries, timestamps, tufMirrorUrl, tufRoot, tufCache }`
   * @returns {Promise<object>} `prism/verdict/1`
   */
  async function verify(image, options = {}) {
    allow('verify', options, VERIFY_OPTIONS);
    const { check } = await import('./check.mjs');
    const { policy, capabilities, replay, env, ...signer } = options;
    return check(await sourceOf(image), { policy, capabilities, replay, env, signer: Object.keys(signer).length > 0 ? signer : undefined });
  }

  /** The images in the local store, newest first: `{ dangling, name }` as `docker image ls --filter dangling=` and `docker image ls name` filter them. */
  async function list(options = {}) {
    allow('list', options, ['dangling', 'name']);
    if (options.dangling !== undefined && typeof options.dangling !== 'boolean') fail('PP1001', 'images.list option dangling must be true or false');
    allowText('list', options, ['name']);
    return local.list(options);
  }

  /** One stored image by tag, digest or id prefix, with its bytes checked against its digests. */
  const get = (name) => local.get(name);

  /** `docker tag`: `target` names the image `source` names. */
  const tag = (source, target) => local.tag(source, target);

  /** `docker rmi`: refuses while a container references the image unless `force`, and always while one runs. */
  async function remove(name, options = {}) {
    allow('remove', options, ['force']);
    return local.remove(name, options);
  }

  /** `docker image prune [-a]`: untagged images no container references, or with `all` every image none references. */
  async function prune(options = {}) {
    allow('prune', options, ['all']);
    return local.prune(options);
  }

  return Object.freeze({ build, pull, push, list, get, tag, remove, prune, inspect, verify, usage: local.usage });
}

/** The namespace with no Docker host: every verb but `build`. `createPrism()` builds the whole one (#441). */
export const images = createImages();
