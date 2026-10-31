/**
 * The reference grammar of `push` and `pull` (issue #292, docs/proposals/292-push-pull-oci.md).
 *
 *   ghcr.io/acme/calculator:1.0           a tag, `latest` when none is given
 *   ghcr.io/acme/calculator@sha256:<hex>  the manifest digest
 *   ghcr.io/acme/calculator@blake3:<hex>  the archive fingerprint, pull only
 *   dir://./store:v1                      a local OCI layout, by tag
 *   dir://./store@sha256:<hex>            a local OCI layout, by digest
 *   --store ./store calculator:v1         a local OCI layout, by full name
 *
 * A registry is required: Prism has no default registry. The repository and tag
 * follow the OCI distribution spec's grammar.
 */
import { ReferenceInvalidError } from './errors.mjs';

const COMPONENT = '[a-z0-9]+(?:(?:\\.|_|__|-+)[a-z0-9]+)*';
const REPOSITORY = new RegExp(`^${COMPONENT}(?:/${COMPONENT})*$`);
const TAG = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const DIGEST = /^(sha256|blake3):[0-9a-f]{64}$/;
const HOST = /^(?:\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)(?::[0-9]{1,5})?$/;

export const DEFAULT_TAG = 'latest';
export const STORE_SCHEME = 'dir://';

const invalid = (text, why, check = 'reference.syntax') => new ReferenceInvalidError(`${JSON.stringify(text)} is not a valid reference: ${why}`, { check });

/** Split `name[:tag][@digest]`. The tag's `:` is the last one after the last `/`, so a registry port stays in the name. */
function splitName(text) {
  let rest = text;
  let digest = null;
  const at = rest.indexOf('@');
  if (at >= 0) {
    digest = rest.slice(at + 1);
    rest = rest.slice(0, at);
    if (!DIGEST.test(digest)) throw invalid(text, 'the digest must be sha256: or blake3: and 64 lowercase hex characters', 'reference.digest');
  }
  let tag = null;
  const colon = rest.lastIndexOf(':');
  if (colon > rest.lastIndexOf('/')) {
    tag = rest.slice(colon + 1);
    rest = rest.slice(0, colon);
    if (!TAG.test(tag)) throw invalid(text, `the tag ${JSON.stringify(tag)} does not match the OCI tag grammar`, 'reference.tag');
  }
  return { name: rest, tag, digest };
}

/** A pinned address: the `sha256` of a manifest, or the `blake3` fingerprint of the archive it holds. */
function pin(digest) {
  if (digest === null) return { digest: null, fingerprint: null };
  return digest.startsWith('sha256:') ? { digest, fingerprint: null } : { digest: null, fingerprint: digest };
}

function registryReference(text) {
  const { name, tag, digest } = splitName(text);
  const slash = name.indexOf('/');
  const first = slash < 0 ? name : name.slice(0, slash);
  const qualified = slash > 0 && (first.includes('.') || first.includes(':') || first === 'localhost');
  if (!qualified) throw invalid(text, 'name the registry, such as ghcr.io/acme/app:1.0, or use --store or dir:// for a local store', 'reference.registry');
  if (!HOST.test(first)) throw invalid(text, `the registry ${JSON.stringify(first)} is not a host`, 'reference.registry');
  const repository = name.slice(slash + 1);
  if (!REPOSITORY.test(repository)) throw invalid(text, `the repository ${JSON.stringify(repository)} does not match the OCI name grammar`, 'reference.repository');
  const registry = first.toLowerCase();
  return { kind: 'registry', text, registry, repository, tag: tag ?? (digest === null ? DEFAULT_TAG : null), ...pin(digest) };
}

/** `dir://<path>[:tag|@digest]`. The last `:` starts the tag, except the one of a Windows drive letter. */
function storeReference(text) {
  const body = text.slice(STORE_SCHEME.length);
  if (body === '') throw invalid(text, 'dir:// needs a path', 'reference.store');
  let path = body;
  let tag = null;
  let digest = null;
  const at = body.lastIndexOf('@');
  if (at >= 0 && DIGEST.test(body.slice(at + 1))) {
    digest = body.slice(at + 1);
    path = body.slice(0, at);
  } else if (at >= 0 && /^[a-z0-9]+:/.test(body.slice(at + 1))) {
    throw invalid(text, 'the digest must be sha256: or blake3: and 64 lowercase hex characters', 'reference.digest');
  } else {
    const colon = body.lastIndexOf(':');
    const drive = colon === 1 && /^[A-Za-z]$/.test(body[0]);
    if (colon >= 0 && !drive && colon > Math.max(body.lastIndexOf('/'), body.lastIndexOf('\\'))) {
      tag = body.slice(colon + 1);
      path = body.slice(0, colon);
      if (!TAG.test(tag)) throw invalid(text, `the tag ${JSON.stringify(tag)} does not match the OCI tag grammar`, 'reference.tag');
    }
  }
  if (path === '') throw invalid(text, 'dir:// needs a path', 'reference.store');
  return { kind: 'store', text, path, repository: null, tag: tag ?? (digest === null ? DEFAULT_TAG : null), ...pin(digest) };
}

/** `name[:tag][@digest]` inside the store `--store` names. The name may be registry-qualified: it is only a key here. */
function namedStoreReference(text, path) {
  const { name, tag, digest } = splitName(text);
  const slash = name.indexOf('/');
  const first = slash < 0 ? '' : name.slice(0, slash);
  const qualified = first.includes('.') || first.includes(':') || first === 'localhost';
  const repository = qualified ? name.slice(slash + 1) : name;
  if (qualified && !HOST.test(first)) throw invalid(text, `the registry ${JSON.stringify(first)} is not a host`, 'reference.registry');
  if (!REPOSITORY.test(repository)) throw invalid(text, `the name ${JSON.stringify(repository)} does not match the OCI name grammar`, 'reference.repository');
  return { kind: 'store', text, path, repository: name, tag: tag ?? (digest === null ? DEFAULT_TAG : null), ...pin(digest) };
}

/**
 * Parse a reference. With `options.store`, the text is a name inside that local
 * store; `dir://` names a store on its own; anything else is registry-qualified.
 *
 * @param {string} text
 * @param {{ store?: string }} [options]
 * @returns {{ kind: 'registry' | 'store', text: string, registry?: string, path?: string, repository: string | null, tag: string | null, digest: string | null, fingerprint: string | null }}
 */
export function parseReference(text, options = {}) {
  if (typeof text !== 'string' || text === '') throw invalid(String(text), 'it is empty');
  const dir = text.startsWith(STORE_SCHEME);
  if (dir && options.store !== undefined) throw invalid(text, '--store and dir:// are two spellings of the same thing; use one', 'reference.store');
  if (dir) return storeReference(text);
  if (options.store !== undefined) return namedStoreReference(text, options.store);
  return registryReference(text);
}

/** The reference a person can paste back, pinned to a manifest digest. */
export function formatReference(reference, digest = reference.digest) {
  const name = reference.kind === 'registry' ? `${reference.registry}/${reference.repository}` : reference.repository ?? `${STORE_SCHEME}${reference.path}`;
  return digest ? `${name}@${digest}` : `${name}:${reference.tag ?? DEFAULT_TAG}`;
}
