/**
 * The local image store (issue #349): what `images.build` and `images.pull` write
 * into, and what `images.list`, `tag`, `remove`, `push` and `system.df`/`prune` read.
 *
 * It is content-addressed the way containerd's content store is: an image is kept
 * once, under the BLAKE3 digest its own footer names (the holo's digest), and a
 * tag is only a name that points at a digest. Removing a tag never touches the
 * bytes; removing an image drops the bytes and every tag on it.
 *
 *   <root>/index.json              prism/image-store/1: images by digest, tags by name
 *   <root>/blobs/blake3/<hex>      the archive, exactly as it was built or pulled
 *
 * The root is `$PRISM_IMAGES`, else `$PRISM_HOME/images`, else `~/.prism/images`,
 * beside the container records in `$PRISM_HOME/containers`.
 *
 * What may be removed is not decided here in code. `IMAGE_STORE_RULES` is the
 * decision table the store model writes (`bindings/src/Foundation/Images/V1/Store.lex.tex`,
 * checked byte for byte by `cargo xtask check-image-store-rules`; Lean proves its safety rules):
 * every combination of what is asked and what holds the image, and the one outcome
 * it has. A container that references an image holds it; a running one holds it
 * even against `force`. Garbage collection is `prune`: by default it removes only
 * untagged images that no container references, and with `all` every image that
 * no container references.
 *
 * Bytes are hashed again on every read, so a store that was changed on disk is
 * reported as `image.corrupt`, not served.
 */
import { asBytes, parseArchive } from './archive.mjs';
import { blake3Hex } from './blake3.mjs';
import { fail } from './errors.mjs';
import { parseReference } from './oci-reference.mjs';
import { sha256Hex } from './sha256.mjs';
import RULES from './image-store-rules.json' with { type: 'json' };
import { homedir } from 'node:os';
import { join } from 'node:path';

export const IMAGE_STORE_SCHEMA = 'prism/image-store/1';
export const IMAGE_SCHEMA = 'prism/image/1';
export const IMAGE_REMOVE_SCHEMA = 'prism/image-remove/1';
export const IMAGE_PRUNE_SCHEMA = 'prism/image-prune/1';

/** The store model's decision table, read as data. Its rows are generated; nothing below adds a case. */
export const IMAGE_STORE_RULES = Object.freeze(RULES);

const HEX = /^[0-9a-f]+$/;
const DIGEST = /^blake3:[0-9a-f]{64}$/;
/** As `docker image ls` shortens an id, and the shortest prefix that may name one. */
const SHORT_ID = 4;

const emptyIndex = () => ({ schema: IMAGE_STORE_SCHEMA, images: {}, tags: {} });

function sorted(object) {
  return Object.fromEntries(Object.keys(object).sort().map((key) => [key, object[key]]));
}

/** An index read back from a backend: its schema, its shape, and every tag pointing at a kept image. */
function checkIndex(index) {
  if (index === null || index === undefined) return emptyIndex();
  if (index.schema !== IMAGE_STORE_SCHEMA || typeof index.images !== 'object' || typeof index.tags !== 'object') fail('image.store', `the image store index is not ${IMAGE_STORE_SCHEMA}`);
  for (const [name, hex] of Object.entries(index.tags)) if (!index.images[hex]) fail('image.store', `the image store index tags ${name} to ${hex}, which it does not keep`);
  return { schema: IMAGE_STORE_SCHEMA, images: { ...index.images }, tags: { ...index.tags } };
}

/** A local name as `docker tag` takes it: `[registry/]repository[:tag]`, `latest` when no tag is given. */
export function localName(text) {
  if (typeof text !== 'string' || text === '') fail('image.name', 'an image name must be non-empty text');
  if (text.startsWith('dir://')) fail('image.name', `${text} names an OCI layout; a local image is named [registry/]repository[:tag]`);
  const reference = parseReference(text, { store: '.' });
  if (reference.digest !== null || reference.fingerprint !== null) fail('image.name', `${text} pins a digest; a tag is a name, as repository:tag`);
  return `${reference.repository}:${reference.tag}`;
}

/**
 * The local name a pulled image is kept under, from its parsed reference: the name it
 * was pulled by, with its tag. One pinned to a digest, or a `dir://` layout by path, is
 * kept untagged, as `docker pull name@digest` keeps it.
 */
export function storedName(reference) {
  if (reference.digest !== null || reference.fingerprint !== null || reference.tag === null) return null;
  const name = reference.kind === 'registry' ? `${reference.registry}/${reference.repository}` : reference.repository;
  return typeof name === 'string' ? `${name}:${reference.tag}` : null;
}

/** The decision for one case, `{ outcome, code }`, from the table: the facts in the table's order, as bits. */
export function decide(verb, facts) {
  const key = (IMAGE_STORE_RULES.facts[verb] ?? []).map((fact) => (facts[fact] === true ? '1' : '0')).join('');
  const [outcome, code = null] = IMAGE_STORE_RULES[verb]?.[key]?.split(' ') ?? fail('image.store', `the image store rules have no ${verb} row for ${JSON.stringify(facts)}`);
  return { outcome, code };
}

/** Images kept in memory, for a client with no file system. */
export function memoryImageStore() {
  let index = null;
  const blobs = new Map();
  return Object.freeze({
    location: null,
    read: () => (index === null ? null : structuredClone(index)),
    write: (next) => {
      index = structuredClone(next);
    },
    get: (hex) => blobs.get(hex)?.slice() ?? null,
    put: (hex, bytes) => {
      blobs.set(hex, bytes.slice());
    },
    drop: (hex) => {
      blobs.delete(hex);
    },
  });
}

/** The local image store `Prism.fromEnv()` keeps: `$PRISM_IMAGES`, else `$PRISM_HOME/images`, by default `~/.prism/images`. */
export function imagesDirectory(env = process.env) {
  return env.PRISM_IMAGES || join(env.PRISM_HOME || join(homedir(), '.prism'), 'images');
}

/** The file a store made by `fileImageStore(directory)` keeps the image `blake3:<hex>` in. */
export const imageFile = (directory, hex) => join(directory, 'blobs', 'blake3', hex);

/** Images on disk, readable only by this user. Every write lands beside its target and is renamed over it. */
export function fileImageStore(directory) {
  if (typeof directory !== 'string' || directory === '') fail('image.store', 'fileImageStore needs a directory');
  const node = (async () => ({ fs: await import('node:fs/promises'), path: await import('node:path') }))();
  const guarded = async (what, action) => {
    const { fs, path } = await node;
    try {
      return await action(fs, path);
    } catch (cause) {
      if (cause?.code === 'image.store' || cause?.code === 'image.corrupt') throw cause;
      return fail('image.store', `${what} ${directory}: ${cause.message}; set PRISM_IMAGES or PRISM_HOME to a directory you can write`, { cause: cause.code });
    }
  };
  const atomic = async (fs, path, file, bytes) => {
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const scratch = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(scratch, bytes, { mode: 0o600 });
    await fs.rename(scratch, file);
  };
  const blob = (path, hex) => imageFile(directory, hex);
  const absent = (cause) => {
    if (cause.code === 'ENOENT') return null;
    throw cause;
  };
  return Object.freeze({
    location: directory,
    read: () =>
      guarded('cannot read the image store in', async (fs, path) => {
        const text = await fs.readFile(path.join(directory, 'index.json'), 'utf8').catch(absent);
        if (text === null) return null;
        try {
          return JSON.parse(text);
        } catch {
          return fail('image.store', `${path.join(directory, 'index.json')} is not JSON`);
        }
      }),
    write: (index) => guarded('cannot write the image store in', (fs, path) => atomic(fs, path, path.join(directory, 'index.json'), `${JSON.stringify(index, null, 2)}\n`)),
    get: (hex) => guarded('cannot read an image from', async (fs, path) => fs.readFile(blob(path, hex)).then((bytes) => new Uint8Array(bytes), absent)),
    put: (hex, bytes) => guarded('cannot write an image to', (fs, path) => atomic(fs, path, blob(path, hex), bytes)),
    drop: (hex) => guarded('cannot remove an image from', (fs, path) => fs.rm(blob(path, hex), { force: true })),
  });
}

const BACKEND = ['read', 'write', 'get', 'put', 'drop'];

/**
 * The store's verbs over a backend. `references()` returns what holds images:
 * `[{ digest, running }]`, one per container record. `images` may not depend on
 * `containers` (model/modules.toml), so the client passes it in; without it no
 * image is held.
 *
 * @param {{ backend?: object, references?: () => Promise<Array<{ digest: string | null, running: boolean }>> | Array<{ digest: string | null, running: boolean }>, now?: () => number }} [options]
 */
export function createImageStore({ backend = memoryImageStore(), references = () => [], now = () => Date.now() } = {}) {
  if (!BACKEND.every((name) => typeof backend?.[name] === 'function')) fail('image.store', `an image store backend has ${BACKEND.join(', ')}`);
  if (typeof references !== 'function') fail('image.store', 'references must be a function that lists what containers hold');

  // One change at a time in this process, so two writes never interleave a read and a write of the index.
  let queue = Promise.resolve();
  const exclusive = (action) => {
    const run = queue.then(action, action);
    queue = run.catch(() => {});
    return run;
  };
  const load = async () => checkIndex(await backend.read());
  const save = (index) => backend.write({ schema: IMAGE_STORE_SCHEMA, images: sorted(index.images), tags: sorted(index.tags) });

  const tagsOf = (index, hex) =>
    Object.entries(index.tags)
      .filter(([, target]) => target === hex)
      .map(([name]) => name)
      .sort();
  const view = (index, hex) => ({ schema: IMAGE_SCHEMA, ...index.images[hex], tags: tagsOf(index, hex) });

  /** What holds each digest: how many containers reference it, and whether one of them is running. */
  async function holders() {
    const held = new Map();
    for (const { digest, running } of await references()) {
      if (typeof digest !== 'string' || !DIGEST.test(digest)) continue;
      const hex = digest.slice('blake3:'.length);
      const seen = held.get(hex) ?? { containers: 0, running: false };
      held.set(hex, { containers: seen.containers + 1, running: seen.running || running === true });
    }
    return held;
  }

  /** A name, a digest or a unique id prefix, to the digest it names and whether it was named by a tag. */
  function resolveIn(index, name) {
    if (typeof name !== 'string' || name === '') fail('image.name', 'an image is named by repository:tag, blake3:<digest> or an id prefix');
    const bare = name.startsWith('blake3:') ? name.slice('blake3:'.length) : name;
    if (HEX.test(bare) && bare.length >= SHORT_ID && !(name in index.tags)) {
      const found = Object.keys(index.images).filter((hex) => hex.startsWith(bare));
      if (found.length > 1) fail('image.ambiguous', `${name} names ${found.length} images; give more of the digest`);
      if (found.length === 1) return { hex: found[0], tag: null };
      if (name.startsWith('blake3:') || bare.length === 64) fail('image.missing', `no such image: ${name}`);
    }
    const tag = localName(name);
    const hex = index.tags[tag];
    if (!hex) fail('image.missing', `no such image: ${tag}`);
    return { hex, tag };
  }

  /**
   * Keep an image: its bytes under its digest, and `tags` pointing at it. A tag that
   * named another image moves here, as `docker build -t` and `docker pull` move one.
   */
  function add(image, { tags = [] } = {}) {
    return exclusive(async () => {
      const bytes = asBytes(image);
      const parsed = parseArchive(bytes);
      if (!parsed.verification.footer) fail('image.corrupt', `the image does not match its own digest: its footer is ${parsed.footer}, its body gives ${parsed.fingerprint}`);
      const names = [...new Set(tags.map(localName))];
      const hex = parsed.footer;
      const index = await load();
      if (!index.images[hex]) {
        await backend.put(hex, bytes);
        index.images[hex] = { id: `blake3:${hex}`, digest: `blake3:${hex}`, fileDigest: { sha256: await sha256Hex(bytes), blake3: blake3Hex(bytes) }, size: bytes.length, created: new Date(now()).toISOString() };
      }
      for (const name of names) index.tags[name] = hex;
      await save(index);
      return view(index, hex);
    });
  }

  /** The record of an image, with its bytes, checked against its digests. */
  async function get(name) {
    const index = await load();
    const { hex } = resolveIn(index, name);
    const bytes = await backend.get(hex);
    if (bytes === null) fail('image.corrupt', `the image store keeps ${name} (blake3:${hex}) but not its bytes`);
    if (blake3Hex(bytes) !== index.images[hex].fileDigest.blake3 || bytes.length !== index.images[hex].size) fail('image.corrupt', `the bytes kept for blake3:${hex} changed on disk; remove the image and pull or build it again`);
    return { ...view(index, hex), bytes };
  }

  /** Every image, newest first. `dangling` keeps only untagged ones (`true`) or tagged ones (`false`); `name` keeps those with a tag in that repository. */
  async function list({ dangling, name } = {}) {
    const index = await load();
    let rows = Object.keys(index.images).map((hex) => view(index, hex));
    if (dangling !== undefined) rows = rows.filter((row) => (row.tags.length === 0) === dangling);
    if (name !== undefined) {
      const repository = name.includes(':') && name.lastIndexOf(':') > name.lastIndexOf('/') ? localName(name) : null;
      rows = rows.filter((row) => row.tags.some((tag) => (repository === null ? tag.slice(0, tag.lastIndexOf(':')) === name : tag === repository)));
    }
    return rows.sort((a, b) => (a.created > b.created ? -1 : a.created < b.created ? 1 : a.digest < b.digest ? -1 : 1));
  }

  /** `docker tag SOURCE TARGET`: one more name for an image already kept. */
  function tag(source, target) {
    return exclusive(async () => {
      const index = await load();
      const { hex } = resolveIn(index, source);
      index.tags[localName(target)] = hex;
      await save(index);
      return view(index, hex);
    });
  }

  /**
   * `docker rmi`. Named by one of several tags, the tag goes and the image stays.
   * Otherwise the image goes with every tag on it, unless what holds it says no;
   * the table says which (see IMAGE_STORE_RULES).
   */
  function remove(name, { force = false } = {}) {
    if (typeof force !== 'boolean') fail('PP1001', 'images.remove option force must be true or false');
    return exclusive(async () => {
      const index = await load();
      const { hex, tag: named } = resolveIn(index, name);
      const tags = tagsOf(index, hex);
      const held = (await holders()).get(hex) ?? { containers: 0, running: false };
      const { outcome, code } = decide('remove', { byTag: named !== null, otherTags: tags.length > 1, referenced: held.containers > 0, running: held.running, force });
      const label = named ?? `blake3:${hex}`;
      if (outcome === 'refuse') {
        const why = code === 'image.in-use' ? `${held.containers} container${held.containers === 1 ? '' : 's'} reference${held.containers === 1 ? 's' : ''} it${held.running ? ', and one is running' : '; remove them, or pass force'}` : `it is tagged ${tags.join(', ')}; remove a tag, or pass force`;
        fail(code, `cannot remove ${label}: ${why}`, { digest: `blake3:${hex}`, containers: held.containers, running: held.running, tags });
      }
      if (outcome === 'untag') {
        delete index.tags[named];
        await save(index);
        return { schema: IMAGE_REMOVE_SCHEMA, untagged: [named], deleted: [], spaceReclaimed: 0 };
      }
      const size = index.images[hex].size;
      for (const each of tags) delete index.tags[each];
      delete index.images[hex];
      await save(index);
      await backend.drop(hex);
      return { schema: IMAGE_REMOVE_SCHEMA, untagged: tags, deleted: [`blake3:${hex}`], spaceReclaimed: size };
    });
  }

  /** Garbage collection: `docker image prune [-a]`, as the table's prune rows say. */
  function prune({ all = false } = {}) {
    if (typeof all !== 'boolean') fail('PP1001', 'images.prune option all must be true or false');
    return exclusive(async () => {
      const index = await load();
      const held = await holders();
      const deleted = [];
      let spaceReclaimed = 0;
      for (const hex of Object.keys(index.images).sort()) {
        const tags = tagsOf(index, hex);
        const { outcome } = decide('prune', { tagged: tags.length > 0, referenced: held.has(hex), all });
        if (outcome !== 'delete') continue;
        for (const each of tags) delete index.tags[each];
        spaceReclaimed += index.images[hex].size;
        delete index.images[hex];
        deleted.push(`blake3:${hex}`);
      }
      if (deleted.length > 0) await save(index);
      for (const digest of deleted) await backend.drop(digest.slice('blake3:'.length));
      return { schema: IMAGE_PRUNE_SCHEMA, imagesDeleted: deleted, spaceReclaimed };
    });
  }

  /** What `system.df` reports for images: each one's size and whether a container holds it. */
  async function usage() {
    const index = await load();
    const held = await holders();
    const rows = Object.keys(index.images)
      .sort()
      .map((hex) => ({ digest: `blake3:${hex}`, tags: tagsOf(index, hex), size: index.images[hex].size, containers: held.get(hex)?.containers ?? 0 }));
    return { rows, location: backend.location ?? null };
  }

  return Object.freeze({ add, get, list, tag, remove, prune, usage });
}
