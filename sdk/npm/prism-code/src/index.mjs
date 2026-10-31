/**
 * prism-code — the JavaScript runtime for Prism SDK (PrismPM) applications.
 *
 * `load(source)` opens what PrismPM generates, a Hologram v4 `.holo` archive or
 * the six-file browser closure, verifies its identities, and returns an
 * application object whose `dispatch(bytes)` runs the modeled guest and whose
 * `acceptance()` replays the modeled vectors. Nothing here compiles, proves or
 * produces an artifact; those stay in the SDK image.
 */
import { parseArchive, resolveArchive, asBytes } from './archive.mjs';
import { attestationSection, readAttestations } from './attestations.mjs';
import { decodeHoloview } from './view.mjs';
import { compileGuest, runGuest, runAcceptance } from './core.mjs';
import { parseCapabilities, grantOf, DEFAULT_SET } from './capabilities.mjs';
import { verifyClosure, closureDispatch, initializeGlue } from './closure.mjs';
import { CapabilityDeniedError, PrismCodeError, fail } from './errors.mjs';
import { inspect } from './inspect.mjs';
import { experimental_verify } from './verify.mjs';
import { worldPolicy } from './vendor/verify.mjs';
import * as canonical from './canonical/index.js';

export {
  PrismError,
  PrismCodeError,
  VerificationError,
  ProofMismatchError,
  CapabilityDeniedError,
  WorldMismatchError,
  DeterminismViolationError,
  ReplayError,
  SigningError,
  SignatureInvalidError,
  IdentityMismatchError,
  TransparencyError,
  SubjectMismatchError,
  AttestationNotFoundError,
  TrustRootError,
  RegistryError,
  RegistryAuthError,
  ReferrersUnsupportedError,
  ManifestNotFoundError,
  DigestMismatchError,
  PullVerificationError,
  ReferenceInvalidError,
  ProviderError,
  ProviderNotFoundError,
  ProviderReplyError,
  ProviderFailedError,
  ERROR_CLASSES,
  PolicyParseError,
  PolicyEvaluationError,
  PolicyDeniedError,
  classForCheck,
  errorForReason,
  errorFromVerdict,
} from './errors.mjs';
export { experimental_verify, experimental_createClient, MINIMUM_LEVEL_ENV } from './verify.mjs';
export { parseArchive, resolveArchive, canonicalJson } from './archive.mjs';
export { decodeHoloview, encodeHoloview } from './view.mjs';
export { compileGuest, runGuest, runAcceptance } from './core.mjs';
export { parseCapabilities, grantOf, CAPABILITIES_SCHEMA, CAPABILITY_KINDS, DEFAULT_SET } from './capabilities.mjs';
export {
  parseManifest,
  validateManifest,
  lintManifest,
  mergeOverlay,
  manifestCapabilities,
  manifestProviders,
  resolveVariables,
  MANIFEST_FILE,
  MANIFEST_TARGETS,
  MANIFEST_VERSION,
} from './manifest.mjs';
export { parseToml } from './toml.mjs';
export { verifyClosure, closureDispatch, initializeGlue } from './closure.mjs';
export { blake3, blake3Hex, kappa } from './blake3.mjs';
export { inspect, formatInspection, INSPECTION_SCHEMA } from './inspect.mjs';
export {
  ATTESTATION_EXTENSION,
  BUNDLE_MEDIA_TYPE,
  attestationSection,
  readAttestations,
  decodeBundle,
  appendAttestations,
  stripAttestations,
  encodeArchive,
} from './attestations.mjs';
export {
  PROVENANCE_PREDICATE_TYPE,
  HOLO_BUILD_TYPE,
  PROVENANCE_MODES,
  resolvedDependencies,
  provenanceStatement,
  statementBytes,
  provenanceBundle,
  attachProvenance,
  readProvenance,
} from './provenance.mjs';

const decoder = new TextDecoder('utf-8', { fatal: true });

function isNode() {
  return typeof process !== 'undefined' && process.versions != null && process.versions.node != null;
}

function limitsOf(application) {
  return {
    request: application.request_maximum,
    response: application.response_maximum,
    guestAllocation: application.guest_allocation_maximum,
  };
}

function vectorsOf(application) {
  const list = Array.isArray(application.acceptance_vectors) ? application.acceptance_vectors : [];
  return list.map((v) => ({ request: Uint8Array.from(v.request), response: Uint8Array.from(v.response) }));
}

function profileOf(modelDocument) {
  return modelDocument.application?.profile ?? modelDocument.schema ?? null;
}

function evidenceOf(provenance) {
  return {
    leanManifestSha256: provenance.lean_manifest_sha256 ?? null,
    lcnfManifestSha256: provenance.lcnf_manifest_sha256 ?? null,
    lexleanCommit: provenance.lexlean_commit ?? null,
    lean4ProdCommit: provenance.lean4_prod_commit ?? null,
    hologramLiveCommit: provenance.hologram_live_commit ?? null,
    uorHologramCommit: provenance.uor_hologram_commit ?? null,
    generatedCoreSha256: provenance.generated_core_sha256 ?? null,
    compilerSemanticsId: provenance.compiler_semantics_id ?? null,
    stdlibSemanticsId: provenance.stdlib_semantics_id ?? null,
  };
}

/**
 * The grant for `options.capabilities` (a capability file as text, bytes or a
 * parsed value) and `options.capabilitySet`. No file grants nothing (#279).
 */
function grantFor({ capabilities = null, capabilitySet = DEFAULT_SET } = {}) {
  if (capabilities === null || capabilities === undefined) {
    if (capabilitySet !== DEFAULT_SET) fail('capabilities.invalid', `capability set ${capabilitySet} was named, but no capability file was given`);
    return grantOf(null);
  }
  return grantOf(parseCapabilities(capabilities), capabilitySet);
}

/**
 * The static world-within-policy check (issue #283): the world the guest's
 * contract names, compared with the granted set before anything is compiled
 * or instantiated. A world that imports a capability kind the grant gives
 * none of fails with `CapabilityDeniedError` (`world.capabilities`). The same
 * function decides `world.capabilities` in `experimental_verify`, so the two
 * cannot disagree. Returns `{ contract, within, pure, effects }`, frozen;
 * `within`, `pure` and `effects` are null for a contract this reader has no
 * world for.
 */
function worldWithinGrant(directory, grant) {
  const contract = directory?.layers?.find((l) => l.kind === 'wasm')?.contract ?? null;
  if (contract === null) return Object.freeze({ contract: null, within: null, pure: null, effects: null });
  const result = worldPolicy(contract, grant.members);
  if (result.known && !result.within) {
    throw new CapabilityDeniedError(`the world ${contract} exceeds the granted capabilities: ${result.problems.join('; ')}`, {
      check: 'world.capabilities',
      details: { contract, problems: result.problems, set: grant.set },
    });
  }
  return Object.freeze({ contract, within: result.within, pure: result.pure, effects: result.effects === null ? null : Object.freeze([...result.effects]) });
}

/**
 * Open a `.holo` archive from bytes. `options.capabilities` is the capability
 * file the guest runs under and `options.capabilitySet` the set to apply,
 * `default` unless named; without a file the holo is granted nothing.
 */
export async function loadArchive(source, options = {}) {
  const parsed = parseArchive(asBytes(source));
  const resolved = resolveArchive(parsed);
  // A malformed attestation row fails the load; the bundles decode lazily.
  attestationSection(parsed);
  const { modelDocument, provenance, directory } = resolved;
  const application = modelDocument.application ?? fail('archive.model', 'model document has no application');
  const capabilities = grantFor(options);
  const world = worldWithinGrant(resolved.directory, capabilities);
  const module = await compileGuest(resolved.guest.content, capabilities);
  const limits = limitsOf(application);
  const vectors = vectorsOf(application);
  const view = decodeHoloview(resolved.view.content);
  let metadata = null;
  if (parsed.metadata) {
    try {
      metadata = JSON.parse(parsed.metadata.text);
    } catch {
      metadata = parsed.metadata.text;
    }
  }
  const dispatch = async (request) => runGuest(module, asBytes(request), limits);
  let inspection = null;
  return Object.freeze({
    kind: 'holo',
    name: application.name ?? provenance.cargo_name ?? null,
    model: modelDocument,
    profile: profileOf(modelDocument),
    limits,
    vectors,
    provenance: { model: provenance, browser: null },
    directory,
    metadata,
    identities: resolved.identities,
    evidence: evidenceOf(provenance),
    view,
    archive: parsed,
    /** The capability set in force (#279): `allows(kind, resource)`, `assert(kind, resource)`, `set`. */
    capabilities,
    /** The declared world against the grant, checked before the guest compiled (#283): contract, within, pure, effects. */
    world,
    dispatch,
    attestations: () => readAttestations(parsed),
    acceptance: () => runAcceptance(vectors, dispatch),
    /** What the holo says about itself, read from the section table; the guest is not run. */
    inspect: () => (inspection ??= inspect(parsed.bytes)),
    /**
     * The verdict `prism check` returns for this holo; see `experimental_verify`.
     * The capability set the holo was loaded with is the default `capabilities`
     * option, so `world.capabilities` judges the grant it runs under (#283).
     */
    experimental_verify: (options) => experimental_verify(parsed.bytes, { capabilities: capabilities.members, ...(options ?? {}) }),
  });
}

/**
 * Open a six-file closure. `files` maps file names to bytes; `importGlue(name)`
 * imports the wasm-bindgen glue module by file name (a file URL in Node, a
 * URL in browsers). `model` is optional and only needed to dispatch through a
 * numeric-profile closure, whose wire format lives in the model document.
 * `capabilities` and `capabilitySet` are as for `loadArchive`; a closure's
 * imports belong to its glue, so only `app.capabilities` carries the grant.
 */
export async function loadClosure(files, importGlue, { model = null, capabilities = null, capabilitySet = DEFAULT_SET } = {}) {
  const grant = grantFor({ capabilities, capabilitySet });
  const { stem, glueName, wasmName, provenance, verification } = await verifyClosure(files);
  const glue = initializeGlue(await importGlue(glueName), files.get(wasmName));
  const modelDocument = model ? (model instanceof Uint8Array ? JSON.parse(decoder.decode(model)) : model) : null;
  const application = modelDocument?.application ?? null;
  const limits = application ? limitsOf(application) : null;
  const vectors = application ? vectorsOf(application) : [];
  const profile = modelDocument ? profileOf(modelDocument) : typeof glue.invoke_bytes === 'function' ? 'text' : 'numeric';
  const dispatch = closureDispatch(glue, { profile, model: modelDocument, limits });
  const view = { entry: 'index.html', files };
  return Object.freeze({
    kind: 'closure',
    name: stem,
    model: modelDocument,
    profile,
    limits,
    vectors,
    provenance: { model: null, browser: provenance },
    directory: null,
    metadata: null,
    identities: { ...verification, stem, glueName, wasmName },
    evidence: {
      modelId: provenance.model_id ?? null,
      viewModelId: provenance.view_model_id ?? null,
      generatedCoreSha256: provenance.generated_core_sha256 ?? null,
    },
    view,
    capabilities: grant,
    /** A closure names no guest contract, so there is no world to check (#283). */
    world: Object.freeze({ contract: null, within: null, pure: null, effects: null }),
    dispatch: async (request) => dispatch(asBytes(request)),
    attestations: () => [],
    acceptance: () => runAcceptance(vectors, (r) => dispatch(r)),
    inspect: async () => fail('inspect.kind', 'inspect reads a .holo archive; a closure has no section table'),
    experimental_verify: (options) => experimental_verify({ kind: 'closure' }, options),
  });
}

/**
 * Open an application from bytes, a path (Node) or a URL. Bytes and `.holo`
 * paths or URLs open an archive; a directory path or a URL ending in `/`
 * opens a closure.
 */
export async function load(source, options = {}) {
  if (source instanceof Uint8Array || source instanceof ArrayBuffer || ArrayBuffer.isView(source)) {
    return loadArchive(source, options);
  }
  if (typeof Blob !== 'undefined' && source instanceof Blob) {
    return loadArchive(new Uint8Array(await source.arrayBuffer()), options);
  }
  if (typeof source === 'string' || source instanceof URL) {
    if (isNode()) {
      const node = await import('./node.mjs');
      return node.fromFile(source, options);
    }
    const browser = await import('./browser.mjs');
    return browser.load(source, options);
  }
  fail('load.source', 'load() takes bytes, a Blob, a path or a URL');
}

// 0.1.0 compatibility: the canonicalization API stays at `prism-code/canonical`.
// These top-level re-exports are deprecated and will be removed in 0.3.0.
let warned = false;
function deprecated(name, fn) {
  return function deprecatedCanonical(...args) {
    if (!warned) {
      warned = true;
      const message = `prism-code: top-level ${name}() is deprecated; import it from 'prism-code/canonical'`;
      if (isNode() && typeof process.emitWarning === 'function') process.emitWarning(message, 'DeprecationWarning');
      else if (typeof console !== 'undefined') console.warn(message);
    }
    return fn(...args);
  };
}
/** @deprecated import from 'prism-code/canonical' */
export const canonicalize = deprecated('canonicalize', canonical.canonicalize);
/** @deprecated import from 'prism-code/canonical' */
export const codeHash = deprecated('codeHash', canonical.codeHash);
/** @deprecated import from 'prism-code/canonical' */
export const describe = deprecated('describe', canonical.describe);
/** @deprecated import from 'prism-code/canonical' */
export const differs = deprecated('differs', canonical.differs);
