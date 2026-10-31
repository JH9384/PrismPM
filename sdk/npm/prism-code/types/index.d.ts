/** prism-code — JavaScript runtime for Prism SDK (PrismPM) applications. */

/** Base of every error the package throws. `code` is stable: a class's own code, or for `PrismCodeError` the check that failed. */
export class PrismError extends Error {
  static readonly code: string;
  code: string;
  /** The verdict reason's check id, such as `holo.integrity` or `proof.subject`, or the reason no verdict was reached. */
  check?: string;
  /** The registered diagnostic of the reason, such as `PP5601`. */
  diagnostic?: string;
  details?: unknown;
  /** The whole verdict, when the error explains a failed one. */
  verdict?: Verdict;
  reasons?: VerdictReason[];
  constructor(
    message: string,
    options?: { code?: string; check?: string; diagnostic?: string; details?: unknown; verdict?: Verdict; reasons?: VerdictReason[]; cause?: unknown },
  );
}

export class PrismCodeError extends PrismError {
  /** The check that failed, e.g. `archive.magic`, `core.exports`, `closure.provenance`, `lock.image`. */
  code: string;
  constructor(code: string, message: string, details?: unknown);
}

/** `verification_failed`: no verdict was reached, or a `holo.*`, `provenance.*` or `policy.*` check failed. */
export class VerificationError extends PrismError {
  static readonly code: 'verification_failed';
}
/** `proof_mismatch`: a `proof.*` check failed. */
export class ProofMismatchError extends PrismError {
  static readonly code: 'proof_mismatch';
}
/** `capability_denied`: the declared world exceeds the granted capabilities (`world.capabilities`), or the runtime denied a guest import or a resource (`capabilities.*`, #279). */
export class CapabilityDeniedError extends PrismError {
  static readonly code: 'capability_denied';
}
/**
 * `world_mismatch`: the guest does not have the imports and exports of its declared WIT world (`world.contract`),
 * or the declared world is not the one the caller pinned (`world.hash`). Issue #278.
 */
export class WorldMismatchError extends PrismError {
  static readonly code: 'world_mismatch';
}
/** `policy_parse_failed`: the policy file does not parse, or uses a construct outside the subset (`policy.parse`). No verdict; `check` exits 2. Issue #285. */
export class PolicyParseError extends VerificationError {
  static readonly code: 'policy_parse_failed';
}
/** `policy_evaluation_failed`: the policy file parsed but produced no decision (`policy.evaluation`); the message names the rule. No verdict; `check` exits 2. Issue #285. */
export class PolicyEvaluationError extends VerificationError {
  static readonly code: 'policy_evaluation_failed';
}
/** `policy_denied`: a rule of a policy file denied the holo; `check` is the rule, such as `policy.pure-only.effects`. `check` exits 1. Issue #285. */
export class PolicyDeniedError extends VerificationError {
  static readonly code: 'policy_denied';
}
/** `determinism_violation`: a replay diverged from its recorded history (`replay.divergence`). */
export class DeterminismViolationError extends PrismError {
  static readonly code: 'determinism_violation';
}
/** `replay_failed`: a replay could not be carried out, or another `replay.*` check failed. */
export class ReplayError extends PrismError {
  static readonly code: 'replay_failed';
}
/** `signing_failed`: `attest` could not sign. `check` is `sign.key`, `sign.identity`, `sign.service`, `sign.config`, `sign.predicate` or `sign.subject`. */
export class SigningError extends PrismError {
  static readonly code: 'signing_failed';
}
/** `signature_invalid`: the DSSE signature, the signing key or the certificate chain of a bundle does not verify. */
export class SignatureInvalidError extends PrismError {
  static readonly code: 'signature_invalid';
}
/** `identity_mismatch`: the signer is valid but is not the certificate identity or OIDC issuer the policy names. */
export class IdentityMismatchError extends PrismError {
  static readonly code: 'identity_mismatch';
}
/** `transparency_failed`: a log entry or signed timestamp is missing, untrusted or not about this bundle. */
export class TransparencyError extends PrismError {
  static readonly code: 'transparency_failed';
}
/** `subject_mismatch`: a statement subject is not a content blob of the holo, or its digests differ from the blob's. */
export class SubjectMismatchError extends PrismError {
  static readonly code: 'subject_mismatch';
}
/** `attestation_not_found`: the holo has no attestation, or none of the requested predicate type. */
export class AttestationNotFoundError extends PrismError {
  static readonly code: 'attestation_not_found';
}
/** Running a provider service failed (#294). `details` names the capability and the provider type. */
export class ProviderError extends PrismError {
  static readonly code: 'provider_error' | 'provider_not_found' | 'provider_reply_invalid' | 'provider_failed';
}
/** No `prism-provider-<type>` is on the PATH. */
export class ProviderNotFoundError extends ProviderError {
  static readonly code: 'provider_not_found';
}
/** A provider broke the protocol (`provider.reply`), or a variable it returned has a second source (`provider.collision`). */
export class ProviderReplyError extends ProviderError {
  static readonly code: 'provider_reply_invalid';
}
/** A provider failed (`provider.failed`), would not start (`provider.spawn`) or ran out of time (`provider.timeout`). */
export class ProviderFailedError extends ProviderError {
  static readonly code: 'provider_failed';
}
/** `trust_root_invalid`: the pinned trusted root cannot be read or does not pin what the policy needs. */
export class TrustRootError extends PrismError {
  static readonly code: 'trust_root_invalid';
}
/** `registry_failed`: a registry or a local store could not do what was asked. `check` is `registry.*` or `store.*`. */
export class RegistryError extends PrismError {
  static readonly code: 'registry_failed';
}
/** `registry_auth_failed`: the registry refused the credentials, or asked for them where they must not be sent. */
export class RegistryAuthError extends PrismError {
  static readonly code: 'registry_auth_failed';
}
/** `referrers_unsupported`: no referrers API, and the referrers tag cannot be read or written, or the fallback is off. */
export class ReferrersUnsupportedError extends PrismError {
  static readonly code: 'referrers_unsupported';
}
/** `manifest_not_found`: the reference names nothing in the registry or the store. */
export class ManifestNotFoundError extends PrismError {
  static readonly code: 'manifest_not_found';
}
/** `digest_mismatch`: bytes differ from the digest a descriptor, a reference, a registry header or an annotation claimed. */
export class DigestMismatchError extends PrismError {
  static readonly code: 'digest_mismatch';
}
/** `pull_verification_failed`: a pulled holo failed its verdict, its attestations or the signer policy; nothing was written. */
export class PullVerificationError extends PrismError {
  static readonly code: 'pull_verification_failed';
}
/** `reference_invalid`: the text is not a registry or store reference. `check` is `reference.*`. */
export class ReferenceInvalidError extends PrismError {
  static readonly code: 'reference_invalid';
}
/** `export_mismatch`: a browser export's bytes differ from the release. `check` is `export.manifest`, `export.layer`, `export.files` or `export.tree`. */
export class ExportMismatchError extends PrismError {
  static readonly code: 'export_mismatch';
}
export const ERROR_CLASSES: Readonly<Record<string, typeof PrismError>>;
/** The class a verdict reason's check id maps to. */
export function classForCheck(check: string): typeof PrismError;
export function errorForReason(reason: VerdictReason, verdict?: Verdict): PrismError;
/** The error that explains a failed verdict, or null for a passed one. `ranks` is `ASSURANCE.RANK`. */
export function errorFromVerdict(verdict: Verdict, ranks: Record<AssuranceLevel, number>): PrismError | null;

/** One row of the exit table. `error` names a class, null for success, or `anything else`. */
export interface ExitCodeRow {
  readonly exit: number;
  readonly error: string | null;
  /** Narrows `error`: `with a verdict` or `no verdict`. */
  readonly when?: string;
  readonly meaning: string;
}
/** Experimental. What a run exits with: the single source of truth for containers and the command line (#348). */
export const EXIT_CODES: readonly ExitCodeRow[];
/** Experimental. The exit code for how a run ended: null is 0, a typed error takes its row, anything else is 70. */
export function exitCodeFor(error: unknown): number;

/** Experimental. The `schema` of `Container.inspect()`. */
export const CONTAINER_SCHEMA: 'prism/container/1';
export type ContainerStatus = 'created' | 'running' | 'exited';

/** What `Container.inspect()` returns (#348). */
export interface ContainerRecord {
  schema: 'prism/container/1';
  /** 64 lowercase hex characters. A unique prefix also names the container. */
  id: string;
  image: {
    name: string | null;
    kind: 'holo' | 'closure' | null;
    /** The archive fingerprint, `blake3:` and 64 hex characters, as in `verdict.holo`. Null for a closure. */
    digest: string | null;
  };
  /** ISO 8601. */
  created: string;
  rm: boolean;
  state: {
    status: ContainerStatus;
    /** Null until exited. */
    exitCode: number | null;
    /** What ended the run, or null. */
    error: { name: string; code: string | null; message: string; check?: string; diagnostic?: string } | null;
    /** Null until running, and null for good when check refused the holo: the guest never ran. */
    startedAt: string | null;
    finishedAt: string | null;
  };
  /** The verdict of the check this run was gated on, or null when none was reached. */
  verdict: Verdict | null;
  /** The output the guest returned, as text when it is valid UTF-8, otherwise as hex. Never the input. */
  output: { encoding: 'utf-8' | 'hex'; data: string } | null;
}

/** Experimental. One run of a holo (#348). */
export interface Container {
  readonly id: string;
  readonly status: ContainerStatus;
  readonly exitCode: number | null;
  /** The bytes the guest returned, or null. */
  readonly output: Uint8Array | null;
  /** The typed error that ended this run, or null. A container read back from a store has the summary in `inspect()` instead. */
  readonly error: unknown;
  /** The output as text, or null. */
  text(): string | null;
  /** Run it, and resolve to this container once it has exited. A failed run is the exit code, never a rejection. Again after exit runs it again. */
  start(): Promise<Container>;
  /** Rejects with `container.missing` once removed. */
  inspect(): Promise<ContainerRecord>;
  /** Refused with `container.running` while it runs. */
  remove(): Promise<void>;
}

/** Where records are kept. `memoryContainerStore` is the default. */
export interface ContainerStore {
  put(record: ContainerRecord): Promise<void>;
  get(id: string): Promise<ContainerRecord | undefined>;
  /** The full ids that start with this prefix. */
  find(prefix: string): Promise<string[]>;
  remove(id: string): Promise<void>;
}
export function memoryContainerStore(): ContainerStore;

export interface ContainerOptions extends LoadOptions {
  /** The policy to gate on, as `experimental_verify` takes it, or a function that returns it. Default: P2 or above, or `PRISM_MINIMUM_LEVEL`. */
  policy?: VerifyOptions | (() => VerifyOptions | Promise<VerifyOptions>);
  /** Run a holo that fails check, or that check cannot judge. Warns on every start; never the default. */
  allowUnverified?: boolean;
  /** Remove the container when it exits, as `docker run --rm` does. */
  rm?: boolean;
}

/** Experimental. `prism.containers` (#348). `image` is what `load` takes, or an application it returned. */
export interface Containers {
  /** Create and start: resolves to the container once it has exited, whatever its exit code. */
  run(image: Uint8Array | ArrayBuffer | Blob | string | URL | Application, input: string | Uint8Array | ArrayBuffer | ArrayBufferView, options?: ContainerOptions): Promise<Container>;
  /** Open the image and make a container in state `created`. An image that cannot be opened makes no container. */
  create(image: Uint8Array | ArrayBuffer | Blob | string | URL | Application, input: string | Uint8Array | ArrayBuffer | ArrayBufferView, options?: ContainerOptions): Promise<Container>;
  start(id: string): Promise<Container>;
  /** The container with this id or unique id prefix. Rejects with `container.missing` or `container.ambiguous`. */
  get(id: string): Promise<Container>;
  remove(id: string): Promise<void>;
}

/** Experimental. The default client. Its records live in memory until removed. */
export const prism: { readonly containers: Containers };
/** Experimental. A client with containers of its own. `warn` receives the warning of an unverified run. */
export function createPrism(options?: { store?: ContainerStore; warn?: (message: string) => void }): { readonly containers: Containers };

export type AssuranceLevel = 'P0' | 'P1' | 'P2' | 'P3';

export interface VerdictReason {
  check: string;
  code?: string;
  withholds: AssuranceLevel | null;
  message: string;
}

/** `prism/verdict/1`: what `prism check`, `holo.verify()` and `@prism-code/verify` return. */
export interface Verdict {
  schema: 'prism/verdict/1';
  /** The archive fingerprint, `blake3:` and 64 hex characters. */
  holo: string;
  /** The highest level whose evidence checks out, never the policy's minimum. */
  level: AssuranceLevel;
  policy: { name: string; minimum: AssuranceLevel };
  passed: boolean;
  reasons: VerdictReason[];
}

export interface VerifyOptions {
  name?: string;
  /** Default: `PRISM_MINIMUM_LEVEL`, then `P2`. */
  minimum?: AssuranceLevel;
  /** Digests the holo (`archive`) or one of its parts (`capabilities`, `guest`, `view`, `model`) must have. */
  digests?: Partial<Record<'archive' | 'capabilities' | 'guest' | 'view' | 'model', Partial<DigestSet>>>;
  /**
   * The world the holo must declare, in the shape of the lock's `inputs.world`, so a caller passes `lock.inputs.world`
   * unchanged. Any digest may be left out. `null` expects no world, which no holo satisfies. A mismatch is a
   * `world.hash` reason, never changes the level, and throws `WorldMismatchError` with `throw: true`.
   */
  world?: { contract?: string; blake3?: string; sha256?: string } | null;
  /**
   * The capability set granted (#283): one set of a `prism/capabilities/1` file, or null. A world importing a kind
   * the set grants none of is a `world.capabilities` reason (`PP5602`). `holo.experimental_verify` defaults it to
   * the set the holo was loaded with.
   */
  capabilities?: CapabilitySet | null;
  /** The impure effects the policy allows the world (#282). Absent allows any; `[]` is the pure-world policy (`policy.effects`). */
  effects?: Array<'clock' | 'random' | 'socket' | 'filesystem' | 'unknown'>;
  /** Throw the typed error for a verdict that did not pass. Default false. */
  throw?: boolean;
  /** Where `PRISM_MINIMUM_LEVEL` is read. Default `process.env`. */
  env?: Record<string, string | undefined>;
}

export const MINIMUM_LEVEL_ENV: 'PRISM_MINIMUM_LEVEL';
/** Experimental until the v0.6 freeze. Check a holo (bytes, a Blob or an opened holo) and return its verdict. Throws `VerificationError` when no verdict can be reached. */
export function experimental_verify(source: Uint8Array | ArrayBuffer | Blob | Application, options?: VerifyOptions): Promise<Verdict>;
export interface Client {
  readonly options: Readonly<VerifyOptions>;
  verify(source: Uint8Array | ArrayBuffer | Blob | Application, options?: VerifyOptions): Promise<Verdict>;
}
/** Experimental. A client whose options apply to every call and are replaced by the options of one call. */
export function experimental_createClient(options?: VerifyOptions): Client;

export interface Limits {
  /** `application.request_maximum`: longer requests get a modeled refusal. */
  request: number;
  /** `application.response_maximum`. */
  response: number;
  /** `application.guest_allocation_maximum`: requests above this are not sent to the guest. */
  guestAllocation: number;
}

export interface Vector {
  request: Uint8Array;
  response: Uint8Array;
}

export interface AcceptanceFailure {
  index: number;
  request: Uint8Array;
  expected: Uint8Array;
  actual?: Uint8Array;
  error?: unknown;
}

export interface AcceptanceResult {
  total: number;
  passed: number;
  failed: AcceptanceFailure[];
}

export interface View {
  entry: string;
  files: Map<string, Uint8Array>;
}

export interface ArchiveIdentities {
  archiveFingerprint: string;
  footer: string;
  guestKappa: string;
  viewKappa: string;
  modelKappa: string;
  capabilitiesKappa: string;
  applicationKappa: string | null;
  /** Footer, every blob label and the manifest/extension cross-references all check out. */
  verified: boolean;
  consistent: boolean;
}

export interface ClosureIdentities {
  verified: boolean;
  mismatches: { field: string; declared: unknown; actual: string }[];
  /** Provenance fields that cannot be checked from the closure alone (they name files outside it). */
  unverifiable: string[];
  stem: string;
  glueName: string;
  wasmName: string;
}

export interface Evidence {
  /** Pointers to the proof and build inputs. The package reads them; it does not check proofs. */
  [key: string]: string | null;
}

export interface Application {
  kind: 'holo' | 'closure';
  name: string | null;
  /** `model.prism.json` (`prismpm/model-document/N`); null for a closure opened without one. */
  model: Record<string, unknown> | null;
  /** `application.profile` (`prismpm/text-application/1|3`) or the document schema for the numeric profile. */
  profile: string | null;
  limits: Limits | null;
  vectors: Vector[];
  provenance: { model: Record<string, unknown> | null; browser: Record<string, unknown> | null };
  /** Hologram application-directory/v1 (archives only). */
  directory: Record<string, unknown> | null;
  metadata: unknown;
  identities: ArchiveIdentities | ClosureIdentities;
  evidence: Evidence;
  view: View;
  /** The capability set in force (#279). Without a capability file it grants nothing. */
  capabilities: CapabilityGrant;
  /**
   * The declared world against the grant, checked before the guest compiled (#283). A world outside the grant
   * never loads: it throws `CapabilityDeniedError` (`world.capabilities`). `pure` is true when the world imports no
   * clock, random, socket, filesystem or unknown interface, so its runs replay. Every member but `contract` is null
   * for a contract this reader has no world for; all are null for a closure.
   */
  world: {
    readonly contract: string | null;
    readonly within: boolean | null;
    readonly pure: boolean | null;
    readonly effects: ReadonlyArray<'clock' | 'random' | 'socket' | 'filesystem' | 'unknown'> | null;
  };
  /** Run one request through the guest on a fresh instance; bytes in, bytes out. */
  dispatch(request: Uint8Array | ArrayBuffer): Promise<Uint8Array>;
  /** Replay every acceptance vector, comparing bytes. */
  acceptance(): Promise<AcceptanceResult>;
  /** What the holo says about itself, without running the guest. Rejects with `inspect.kind` for a closure. */
  inspect(): Promise<Inspection>;
  /** Experimental. The verdict `prism check` returns for this holo. Rejects with `VerificationError` for a closure. */
  experimental_verify(options?: VerifyOptions): Promise<Verdict>;
  /** The bundles of the attestation section (#267), in order; empty without the section and for closures. Signatures are not verified. */
  attestations(): Attestation[];
}

/** sha256 and BLAKE3, lowercase hex, over the same bytes (ADR-015). */
export interface DigestSet {
  sha256: string;
  blake3: string;
}

export type SectionRole =
  | 'app-manifest'
  | 'source-manifest'
  | 'application-directory'
  | 'model-provenance'
  | 'capability-set'
  | 'guest'
  | 'view'
  | 'model-document'
  | 'extension'
  | 'content-blob'
  | 'unknown';

export interface InspectedSection {
  index: number;
  /** The table's kind code: 15 app manifest, 8 metadata, 14 extension, 16 content blob. */
  kind: number;
  kind_name: 'app-manifest' | 'metadata' | 'extension' | 'content-blob' | 'unknown';
  role: SectionRole;
  offset: number;
  length: number;
  /** Over exactly the table bytes, `offset` to `offset + length`. */
  digest: DigestSet;
  /** Extensions only: the extension name. */
  name?: string;
  /** Content blobs only: the 71-byte `blake3:` label. */
  label?: string;
  /** Content blobs only: the bytes after the label. `digest.blake3` equals the label when `label_matches`. */
  content?: { length: number; digest: DigestSet; label_matches: boolean };
}

export interface InspectedAttestation {
  predicate_type: string;
  subjects: { name: string; digest: DigestSet }[];
}

/** `prismpm/holo-inspection/1`: the object `prism-code inspect --json` prints, keys sorted. */
export interface Inspection {
  schema: 'prismpm/holo-inspection/1';
  name: string | null;
  /** The format revision whose identifiers the archive carries, or null when none matches. */
  revision: string | null;
  physical_version: number;
  flags: number;
  /** File size in bytes. */
  size: number;
  /** Over the whole file. */
  digest: DigestSet;
  /** The last 32 bytes: BLAKE3 of every earlier byte. */
  footer: string;
  sections: InspectedSection[];
  manifest: {
    uri: string;
    labels: { capability_set: string; guest: string; view: string };
    entry: string;
    contract: string;
    view_entry: string;
    surface: string;
  };
  model: {
    schema: string | null;
    name: string | null;
    cargo_name: string | null;
    cargo_version: string | null;
    description: string | null;
    profile: string | null;
    function: string | null;
    vectors: number;
    limits: { request: number | null; response: number | null; guest_allocation: number | null };
    /** Over the model document's bytes. `sha256` is the provenance `model_id`. */
    digest: DigestSet;
  };
  provenance: {
    schema: string | null;
    application_kappa: string | null;
    model_id: string | null;
    compiler_semantics_id: string | null;
    stdlib_semantics_id: string | null;
    lexlean_commit: string | null;
  };
  /** The guest contract and its world (issue #278); every member but `contract` and `capability_set` is null for a contract this reader does not know. */
  world: {
    contract: string;
    /** The WIT package, for example `hologram:guest@1.0.0`. */
    package: string | null;
    /** The world's name in that package. */
    name: string | null;
    /** The WIT file in `@prism-code/spec`. */
    file: string | null;
    /** Digests of the WIT file: the lock's `inputs.world` without `contract`. */
    digest: DigestSet | null;
    imports: string[] | null;
    exports: string[] | null;
    /** Whether the guest module has exactly the imports and exports of the world. */
    conforms: boolean | null;
    /** No clock, random, socket, filesystem or unknown import, so the world is replayable (issue #283, VER-09). */
    pure: boolean | null;
    /** The impure effects the world imports, sorted: `clock`, `filesystem`, `random`, `socket`, `unknown`. */
    effects: Array<'clock' | 'random' | 'socket' | 'filesystem' | 'unknown'> | null;
    capability_set: { label: string; empty: boolean };
  } | null;
  /** Empty until holos carry an attestation section (#267). */
  attestations: InspectedAttestation[];
  verification: { footer: boolean; labels: boolean; cross_references: boolean };
}

export const INSPECTION_SCHEMA: 'prismpm/holo-inspection/1';
/** Read a `.holo` without running it. Structural errors throw `archive.*`; integrity results land in `verification`. */
export function inspect(source: Uint8Array | ArrayBuffer | Blob): Promise<Inspection>;
/** The human view `prism-code inspect` prints: aligned columns, full digests, one fact per line. */
export function formatInspection(inspection: Inspection): string;

export interface LoadOptions {
  /** For closures: the model document (object, bytes, or in Node a path), needed by numeric-profile closures. */
  model?: Record<string, unknown> | Uint8Array | string | null;
  /** For browser closure URLs: the `<stem>_bg.wasm` prefix when it cannot be discovered from app.js. */
  stem?: string;
  files?: string[];
  /**
   * A `prism/capabilities/1` file (#279): text, bytes or a parsed value, and in
   * Node's `fromFile` a path. Without one the application is granted nothing.
   */
  capabilities?: Capabilities | Uint8Array | string | URL | null;
  /** The set of `capabilities` to apply. Default `default`. */
  capabilitySet?: string;
}

/** The resource kinds a capability set grants. */
export type CapabilityKind = 'outbound-hosts' | 'key-value-stores' | 'variables' | 'providers';

/** A `prism/capabilities/1` file; see `@prism-code/spec` `schemas/capabilities/capabilities-v1.schema.json`. */
export interface Capabilities {
  schema: 'prism/capabilities/1';
  sets: { default: CapabilitySet; [name: string]: CapabilitySet };
}
export interface CapabilitySet {
  'allow-outbound-hosts'?: readonly string[];
  'deny-outbound-hosts'?: readonly string[];
  'allow-key-value-stores'?: readonly string[];
  'deny-key-value-stores'?: readonly string[];
  'allow-variables'?: readonly string[];
  'deny-variables'?: readonly string[];
  'allow-providers'?: readonly string[];
  'deny-providers'?: readonly string[];
}

/** What a runtime enforces: one set of a capability file, or nothing. A deny entry wins over an allow entry. */
export interface CapabilityGrant {
  /** The set in force, or null when no capability file was given. */
  readonly set: string | null;
  /** The members of that set, or null when no capability file was given. */
  readonly members: CapabilitySet | null;
  /** True when an allow entry of `kind` matches `resource` and no deny entry does. Outbound hosts take a URL. */
  allows(kind: CapabilityKind, resource: string): boolean;
  /** Throws `CapabilityDeniedError` (`capabilities.<kind>`) unless `allows(kind, resource)`. */
  assert(kind: CapabilityKind, resource: string): void;
  /** Throws `CapabilityDeniedError` (`capabilities.import`) for a guest import the grant does not link. */
  linkImport(entry: WebAssembly.ModuleImportDescriptor): void;
}

export const CAPABILITIES_SCHEMA: 'prism/capabilities/1';
export const CAPABILITY_KINDS: readonly ['outbound-hosts', 'key-value-stores', 'variables', 'providers'];
export const DEFAULT_SET: 'default';
/** Validate a capability file and return it frozen. Throws `PrismCodeError` `capabilities.invalid`; unknown members are errors. */
export function parseCapabilities(source: Capabilities | Uint8Array | string): Capabilities;
/** The grant of one set of a parsed file, or of nothing when `capabilities` is null. */
export function grantOf(capabilities: Capabilities | null, setName?: string): CapabilityGrant;

/** `prism.toml` after the overlay for the target is merged in; see `@prism-code/spec` `schemas/manifest/manifest-v1.schema.json` (#280). */
export interface Manifest {
  manifest_version?: 1;
  application: { name: string; version: string; description?: string; authors?: readonly string[] };
  model?: { source?: string; build?: string; watch?: readonly string[] };
  /** A capability file and set, or the members of one capability set inline, and any capabilities a provider provisions. Absent grants nothing. */
  capabilities?: ({ file: string; set?: string } | CapabilitySet) & { [name: string]: unknown };
  variables?: Readonly<Record<string, string | { value?: string; secret?: boolean }>>;
}
export type ManifestTarget = 'browser' | 'node';

/** One provider a manifest declares (#294). `flags` are its options as `--<key>=<value>` arguments, sorted by key. */
export interface ManifestProviderDeclaration {
  readonly name: string;
  readonly type: string;
  readonly options: Readonly<Record<string, string | number | boolean | readonly (string | number | boolean)[]>>;
  readonly flags: readonly string[];
}
/** The providers a manifest declares, in order of capability name. */
export function manifestProviders(manifest: Manifest): readonly ManifestProviderDeclaration[];
/** A lint finding: `secret-literal` and `credential` are errors, `variable-not-granted` a warning. */
export interface ManifestFinding {
  rule: 'secret-literal' | 'credential' | 'variable-not-granted';
  /** The dotted path of the member, such as `variables.api_key.value`. */
  at: string;
  message: string;
}
export interface ParsedManifest {
  readonly manifest: Manifest;
  readonly target: ManifestTarget | null;
  readonly warnings: readonly ManifestFinding[];
}
export const MANIFEST_FILE: 'prism.toml';
export const MANIFEST_TARGETS: readonly ['browser', 'node'];
export const MANIFEST_VERSION: 1;
/**
 * Parse `prism.toml`, merge `overlay` (the text of `prism.<target>.toml`) when given, validate and lint.
 * Throws `PrismCodeError` `manifest.toml` (not TOML this reader takes), `manifest.invalid`, `manifest.overlay`,
 * `manifest.secret` (a lint error: a literal secret or a credential) or `capabilities.invalid`.
 */
export function parseManifest(
  source: string | Uint8Array | Record<string, unknown>,
  options?: { target?: ManifestTarget | null; overlay?: string | Uint8Array | Record<string, unknown> | null },
): ParsedManifest;
/** Throws `PrismCodeError` `manifest.invalid` naming the first member the schema rejects. */
export function validateManifest(manifest: unknown): Manifest;
export function lintManifest(manifest: Manifest): { errors: ManifestFinding[]; warnings: ManifestFinding[] };
/** Tables merge key by key; any other value, arrays included, replaces the one it overrides. */
export function mergeOverlay(base: Record<string, unknown>, overlay: Record<string, unknown>): Record<string, unknown>;
/** The grant a manifest makes: an inline set as a parsed capability file, or the file it names, unread. */
export function manifestCapabilities(manifest: Manifest): { capabilities: Capabilities | null; capabilitySet: string; file: string | null };
/** Variable name to value; `env(NAME)` reads `env`. An unset name throws `PrismCodeError` `manifest.env`. */
export function resolveVariables(manifest: Manifest, env: Record<string, string | undefined>): Readonly<Record<string, string>>;
/** The strict TOML subset a manifest uses. Throws `PrismCodeError` `manifest.toml` naming the line. */
export function parseToml(source: string | Uint8Array): Record<string, unknown>;

/** Open a `.holo` (bytes, Blob, path or URL) or a closure (directory path or URL). */
export function load(source: Uint8Array | ArrayBuffer | Blob | string | URL, options?: LoadOptions): Promise<Application>;
export function loadArchive(source: Uint8Array | ArrayBuffer, options?: Pick<LoadOptions, 'capabilities' | 'capabilitySet'>): Promise<Application>;
export function loadClosure(
  files: Map<string, Uint8Array>,
  importGlue: (name: string) => Promise<Record<string, unknown>>,
  options?: { model?: Record<string, unknown> | Uint8Array | null } & Pick<LoadOptions, 'capabilities' | 'capabilitySet'>,
): Promise<Application>;

export interface ParsedArchive {
  bytes: Uint8Array;
  body: Uint8Array;
  version: number;
  flags: number;
  sections: { index: number; kind: number; offset: number; length: number; body: Uint8Array }[];
  manifest: { uri: string; labels: string[]; suffix: Uint8Array; section: number };
  metadata: { text: string; section: number } | null;
  extensions: { name: string; payload: Uint8Array; text: string; section: number }[];
  blobs: { label: string; content: Uint8Array; section: number }[];
  footer: string;
  fingerprint: string;
  verification: { footer: boolean; labels: boolean; labelMismatches: { section: number; label: string; actual: string }[] };
}
export function parseArchive(source: Uint8Array | ArrayBuffer): ParsedArchive;
export function resolveArchive(parsed: ParsedArchive): {
  directory: Record<string, unknown>;
  provenance: Record<string, unknown>;
  modelDocument: Record<string, unknown>;
  guest: { label: string; content: Uint8Array };
  view: { label: string; content: Uint8Array };
  model: { label: string; content: Uint8Array };
  capabilities: { label: string; content: Uint8Array };
  identities: ArchiveIdentities;
};
/** JSON with sorted keys and no whitespace (`holo/canonical.rs`). */
export function canonicalJson(value: unknown): string;

export function decodeHoloview(bytes: Uint8Array): View;
export function encodeHoloview(view: View): Uint8Array;

/** Compile the guest and link its imports against `grant` (default: nothing granted, so any import throws `CapabilityDeniedError`). */
export function compileGuest(wasm: Uint8Array, grant?: CapabilityGrant): Promise<WebAssembly.Module>;
export function runGuest(module: WebAssembly.Module, request: Uint8Array, limits?: Partial<Limits>): Uint8Array;
export function runAcceptance(vectors: Vector[], dispatch: (request: Uint8Array) => Uint8Array | Promise<Uint8Array>): Promise<AcceptanceResult>;

export function verifyClosure(files: Map<string, Uint8Array>): Promise<{
  stem: string;
  glueName: string;
  wasmName: string;
  provenance: Record<string, unknown>;
  verification: Pick<ClosureIdentities, 'verified' | 'mismatches' | 'unverifiable'>;
}>;

export function blake3(bytes: Uint8Array, length?: number): Uint8Array;
export function blake3Hex(bytes: Uint8Array): string;
/** `blake3:` + 64 hex characters, the Hologram kappa label. */
export function kappa(bytes: Uint8Array): string;

/** `https://uor.foundation/extension/attestation-bundle/v1`: the Extension row that carries the bundles. */
export const ATTESTATION_EXTENSION: 'https://uor.foundation/extension/attestation-bundle/v1';
export const BUNDLE_MEDIA_TYPE: 'application/vnd.dev.sigstore.bundle.v0.3+json';

/** A content-blob subject of an in-holo statement, with both digests (ADR-015). */
export interface AttestationSubject {
  name: string;
  digest: { sha256: string; blake3: string };
  /** The `blake3:` label of the content blob the subject names, or null when no blob of this archive matches. */
  blob: string | null;
}

/** One Sigstore bundle v0.3 line of the attestation section, decoded. */
export interface Attestation {
  /** Line number in the section, from 0. */
  index: number;
  /** The line's exact bytes, without LF: the blob pushed as an OCI referrer. */
  bytes: Uint8Array;
  bundle: Record<string, unknown>;
  mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json';
  verificationMaterial: Record<string, unknown>;
  envelope: { payload: string; payloadType: 'application/vnd.in-toto+json'; signatures: { keyid?: string; sig: string }[] };
  /** At least one signature is non-empty. The provenance placeholder `prismpm build` writes has one empty signature; no verifier accepts it. */
  signed: boolean;
  /** The in-toto Statement v1 decoded from the DSSE payload. */
  statement: { _type: 'https://in-toto.io/Statement/v1'; subject: unknown[]; predicateType: string; predicate?: unknown };
  predicateType: string;
  subjects: AttestationSubject[];
  /** Every subject names a content blob of this archive by its blake3 label. */
  resolved: boolean;
}

/** A Sigstore bundle as an object, a one-line JSON string or its UTF-8 bytes. */
export type BundleInput = Record<string, unknown> | string | Uint8Array;

/** The attestation row, or null. Throws when it is repeated or not the last row. */
export function attestationSection(source: Uint8Array | ArrayBuffer | ParsedArchive): { section: number; payload: Uint8Array } | null;
/** Every bundle of the attestation section; an empty array without it. */
export function readAttestations(source: Uint8Array | ArrayBuffer | ParsedArchive): Attestation[];
/** Decode one bundle line; `labels` are the archive's blob labels used to resolve subjects. */
export function decodeBundle(line: string | Uint8Array, labels?: Set<string>): Omit<Attestation, 'index'>;
/** A new archive with the bundles added as the last row; other row bodies are byte-identical and the footer is recomputed. */
export function appendAttestations(source: Uint8Array | ArrayBuffer | ParsedArchive, bundles: BundleInput[]): Uint8Array;
/** The archive without its attestation row: the unsigned archive. */
export function stripAttestations(source: Uint8Array | ArrayBuffer | ParsedArchive): Uint8Array;
/** `https://slsa.dev/provenance/v1`. */
export const PROVENANCE_PREDICATE_TYPE: 'https://slsa.dev/provenance/v1';
/** The build type of a holo built by `prismpm build`. */
export const HOLO_BUILD_TYPE: 'https://uor.foundation/prism/holo-build/v1';
export const PROVENANCE_MODES: Readonly<{ MIN: 'min'; MAX: 'max' }>;

/** One resolved dependency row of a provenance statement. */
export interface ProvenanceDependency {
  name: string;
  uri: string;
  digest?: { blake3?: string; sha256?: string };
  mediaType?: string;
}

export interface ProvenanceStatement {
  _type: 'https://in-toto.io/Statement/v1';
  subject: { name: string; digest: { blake3: string; sha256: string } }[];
  predicateType: 'https://slsa.dev/provenance/v1';
  predicate: Record<string, unknown>;
}

export interface ProvenanceOptions {
  /** The bytes of `prismpm.lock`, schema `prismpm/sdk-lock/2` or `/3`. */
  lock: Uint8Array | string;
  /** `min` unless told otherwise. Max records the arguments, platform, invocation id and timestamps. */
  mode?: 'min' | 'max';
  /** Max only: the command line after `prismpm`. */
  arguments?: string[];
  /** Max only: the OCI platform of the builder, for example `linux/amd64`. */
  platform?: string;
  /** Max only. */
  invocationId?: string;
  /** Max only, UTC RFC 3339 without fractions. */
  startedOn?: string;
  /** Max only, UTC RFC 3339 without fractions. */
  finishedOn?: string;
  /** The build-manifest path of each blob; the defaults are the paths `prismpm build` writes. */
  subjectNames?: { guest?: string; view?: string; model?: string; capabilities?: string };
}

/** The resolved dependency rows a lock gives, sorted by uri then name. */
export function resolvedDependencies(lock: Uint8Array | string): Promise<ProvenanceDependency[]>;
/** The SLSA provenance v1 statement of a holo. Throws `provenance.*` errors. */
export function provenanceStatement(source: Uint8Array | ArrayBuffer | ParsedArchive, options: ProvenanceOptions): Promise<ProvenanceStatement>;
/** The bytes a DSSE envelope signs: canonical JSON of the statement. */
export function statementBytes(statement: ProvenanceStatement): Uint8Array;
/** One unsigned bundle line for a statement, as canonical JSON bytes. */
export function provenanceBundle(statement: ProvenanceStatement): Uint8Array;
/** The provenance statements an archive carries, with their mode and whether any signature is present. */
export function readProvenance(source: Uint8Array | ArrayBuffer | ParsedArchive): { index: number; mode: 'min' | 'max'; signed: boolean; statement: ProvenanceStatement }[];
/** A new archive that carries its provenance statement as an unsigned bundle. Refuses an archive that already has one. */
export function attachProvenance(source: Uint8Array | ArrayBuffer | ParsedArchive, options: ProvenanceOptions): Promise<Uint8Array>;

/** Encode header, table, bodies and BLAKE3 footer from rows. */
export function encodeArchive(sections: { kind: number; body: Uint8Array }[], options?: { version?: number; flags?: number }): Uint8Array;

/** @deprecated import from 'prism-code/canonical'; removed in 0.3.0 */
export { canonicalize, codeHash, describe, differs } from '../src/canonical/index.js';
