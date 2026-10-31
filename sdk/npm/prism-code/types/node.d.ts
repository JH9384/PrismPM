import type { Server } from 'node:http';
import type { Application, Capabilities, ContainerStore, LoadOptions, ManifestTarget, ParsedManifest, PrismError } from './index.js';

/** Open a `.holo` file or a closure directory. */
export function fromFile(source: string | URL, options?: LoadOptions): Promise<Application>;
/** Read a closure directory into a file map. */
export function readClosureDirectory(directory: string): Promise<Map<string, Uint8Array>>;
/** Experimental. Where `prism-code run` keeps containers: `$PRISM_HOME/containers`, by default `~/.prism/containers`. */
export function containersDirectory(env?: Record<string, string | undefined>): string;
/** Experimental. Container records as one JSON file each, readable only by this user. A record holds the output and never the input. */
export function fileContainerStore(directory?: string): ContainerStore;
/** Serve `app.view` as static files and answer `POST /_hologram/intent` with `app.dispatch`. */
export function serve(app: Application, options?: { port?: number; host?: string }): Promise<{ server: Server; url: string; close(): Promise<void> }>;

/**
 * Read `prism.toml` from a project directory (default the current one), merging `prism.<target>.toml` when
 * `target` is given and that file exists, and opening a capability file the manifest names (#280).
 * `grant` is the `{ capabilities, capabilitySet }` that `fromFile` and `load` take.
 */
export function readManifest(
  directory?: string | URL,
  options?: { target?: ManifestTarget | null },
): Promise<ParsedManifest & { directory: string; files: readonly string[]; grant: { capabilities: Capabilities | null; capabilitySet: string } }>;

/** How `resolveProviders` and `releaseProviders` run a provider (#294). */
export interface ProviderCallOptions {
  /** The environment the provider inherits and the PATH it is found on. Default `process.env`. */
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  /** Per call. Default 120000. */
  timeoutMs?: number;
  /** Every `info`, `debug` and `error` message, as it arrives. A `setenv` is never passed here. */
  onMessage?: (message: { capability: string; type: 'info' | 'debug' | 'error'; message: string }) => void;
}

/** What `resolveProviders` and `releaseProviders` take: the result of `readManifest`. */
export type ProviderProject = Pick<Awaited<ReturnType<typeof readManifest>>, 'manifest' | 'grant' | 'directory'>;

/**
 * Run `up` for every provider `prism.toml` declares, in order of capability name, and produce the environment.
 * Every declaration is checked against the capability set and the PATH before any provider starts. Sets the
 * environment on no process. Throws `CapabilityDeniedError` or a `ProviderError`.
 */
export function resolveProviders(
  project: ProviderProject,
  options?: ProviderCallOptions,
): Promise<{
  /** The granted `<NAME>_<VAR>` variables. */
  readonly env: Readonly<Record<string, string>>;
  readonly providers: readonly { readonly name: string; readonly type: string; readonly file: string; readonly variables: readonly string[] }[];
  /** Returned variables the capability set does not allow, by name. */
  readonly withheld: readonly { readonly capability: string; readonly name: string; readonly variable: string }[];
}>;
/** Run `down` for every declared provider, in reverse order, attempting all of them. */
export function releaseProviders(project: ProviderProject, options?: ProviderCallOptions): Promise<{ readonly providers: readonly string[] }>;
export const PROVIDER_MESSAGES: readonly ['info', 'error', 'debug', 'setenv'];
export const PROVIDER_MESSAGES_ENV: 'PRISM_PROVIDER_MESSAGES';
export const PROVIDER_TIMEOUT_MS: 120000;

/** The OIDC issuer of GitHub Actions workflows: `https://token.actions.githubusercontent.com`. */
export const GITHUB_ACTIONS_ISSUER: 'https://token.actions.githubusercontent.com';

type HoloSource = Uint8Array | ArrayBuffer | string | Application;

export interface AttestOptions {
  /** The predicate type, a URI such as `https://slsa.dev/provenance/v1`. */
  type: string;
  /** The predicate: a JSON value, JSON text or UTF-8 JSON bytes. */
  predicate: unknown;
  /** Subjects of the statement: `guest`, `view`, `model`, `capabilities`, a `blake3:<hex>` label, or `name=<either>`. Default `['guest']`. */
  subjects?: string[];
  /** A private key (PEM, unencrypted PKCS#8 or SEC1, or a KeyObject). Without it the signing is keyless. */
  key?: string | import('node:crypto').KeyObject;
  /** The OIDC token for keyless signing. Default: GitHub Actions (`id-token: write`) or `SIGSTORE_ID_TOKEN`. */
  identityToken?: string;
  /** A Sigstore signing configuration (object or path). Default: the public instance's, over TUF. */
  signingConfig?: object | string;
  tufMirrorUrl?: string;
  tufRoot?: string;
  tufCache?: string;
}

export interface AttestResult {
  /** The holo with the new bundle appended to its attestation section. */
  holo: Uint8Array;
  /** The Sigstore bundle v0.3 as stored. */
  bundle: object;
  /** The in-toto Statement v1 that was signed. */
  statement: object;
  /** The number of bundles now in the holo. */
  attestations: number;
}

/**
 * Experimental. Sign an in-toto statement about the holo and append it as a Sigstore bundle. Rejects with
 * `SigningError`, or `PrismCodeError` `attest.unavailable` when the optional sigstore packages are missing.
 */
export function experimental_attest(source: HoloSource, options: AttestOptions): Promise<AttestResult>;

export interface VerifyAttestationOptions {
  /** Check only bundles whose statement has this predicate type. */
  type?: string;
  /** Keyless: the exact certificate identity (the SAN) the signer must have. One of this and the regexp is required. */
  certificateIdentity?: string;
  /** Keyless: a pattern the identity must match. Anchor it. */
  certificateIdentityRegexp?: string | RegExp;
  /** Keyless: the exact OIDC issuer in the certificate. Required. */
  certificateOidcIssuer?: string;
  /** Keyed: the public key (PEM or KeyObject). Replaces the three certificate options. */
  key?: string | import('node:crypto').KeyObject;
  /** A pinned `trusted_root.json`, as an object or a path. Default for keyless: the public instance's, over TUF. */
  trustedRoot?: object | string;
  /** The least verified Rekor v2 entries: 1 keyless, 0 keyed. */
  entries?: number;
  /** The least verified RFC 3161 timestamps: 1 keyless, 0 keyed. */
  timestamps?: number;
  tufMirrorUrl?: string;
  tufRoot?: string;
  tufCache?: string;
  /** Throw the result's error instead of returning it. */
  throw?: boolean;
}

export interface AttestationCheck {
  index: number;
  predicateType: string;
  subjects: string[];
  passed: boolean;
  /** Who signed: the certificate identity and issuer (keyless) or the key id (keyed). */
  signer: { identity: string | null; issuer: string | null; keyId: string | null } | null;
  /** The signed time, from the verified timestamps, or null when none was required. */
  time: string | null;
  error: PrismError | null;
}

export interface AttestationResult {
  /** True when at least one bundle of the requested type passed every check. */
  passed: boolean;
  results: AttestationCheck[];
  /** The first failure when nothing passed: `AttestationNotFoundError`, `SubjectMismatchError`, `SignatureInvalidError`, `IdentityMismatchError` or `TransparencyError`. */
  error: PrismError | null;
}

/**
 * Experimental. Check the holo's attestations against a signer policy, offline when a `trustedRoot` is pinned.
 * Rejects with `VerificationError` (`policy.invalid`, `holo.integrity`) or `TrustRootError` when no result can be reached.
 */
export function experimental_verifyAttestations(source: HoloSource, options?: VerifyAttestationOptions): Promise<AttestationResult>;

/** Experimental. Check one DSSE Sigstore bundle on its own: signature, signer policy, log entries and timestamps. */
export function experimental_verifyBundle(
  bundle: object,
  options?: Omit<VerifyAttestationOptions, 'type' | 'throw'>,
): Promise<{ identity: string | null; issuer: string | null; keyId: string | null; time: string | null }>;

/** A credential for a registry. Docker's config and the GHCR variables are read when none is passed. */
export type RegistryCredentials = { username: string; password: string } | { identityToken: string } | null;

export interface RegistryOptions {
  /** A name in this local OCI layout, instead of a registry reference. */
  store?: string;
  /** Reach a registry over HTTP. A loopback registry already is. */
  plainHttp?: boolean;
  /** Use this credential; `null` is anonymous. Without it: Docker's config, then `GHCR_TOKEN` or `GITHUB_TOKEN` for ghcr.io. */
  credentials?: RegistryCredentials;
  /** `false` refuses a registry with no referrers API instead of using the tag schema. */
  referrersFallback?: boolean;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
  env?: Record<string, string | undefined>;
}

export interface PushOptions extends RegistryOptions {
  /** Sign a statement naming the manifest, per predicate in the holo, with this private key. */
  key?: string | KeyObject;
  /** The same with an OIDC token, as `attest` does. */
  keyless?: boolean;
  /** Push only the holo's manifest. The section stays in the file. */
  noAttestations?: boolean;
  identityToken?: string;
  signingConfig?: object | string;
  tufMirrorUrl?: string;
  tufRoot?: string;
  tufCache?: string;
  onProgress?: (event: { action: string; digest: string; predicateType?: string | null }) => void;
}

export interface PushedReferrer {
  digest: string;
  predicateType: string | null;
  /** `holo`: a line of the holo. `push`: signed by this push. `store`: carried from a store. */
  source: 'holo' | 'push' | 'store';
  signed: boolean;
}

/** `prism/push-result/1`. */
export interface PushResult {
  schema: 'prism/push-result/1';
  /** Pinned to the manifest digest. */
  reference: string;
  repository: string;
  tag: string | null;
  /** The manifest digest, `sha256:`. */
  digest: string;
  mediaType: string;
  size: number;
  layer: { digest: string; size: number; uploaded: boolean };
  /** The archive fingerprint, `blake3:` and the footer. */
  fingerprint: string;
  /** The whole file's digests, over the same bytes (ADR-015). */
  sha256: string;
  blake3: string;
  tags: string[];
  referrers: PushedReferrer[];
}

export interface PullOptions extends RegistryOptions {
  /** A path, or a `dir://` reference to store the holo with all its referrers. Without one, nothing is written. */
  output?: string;
  /** A policy file path or object, as `check` takes. Default: P0 or `PRISM_MINIMUM_LEVEL`. */
  policy?: string | object;
  /** With any of these, at least one attestation must pass, as `experimental_verifyAttestations`. */
  key?: string | KeyObject;
  certificateIdentity?: string;
  certificateIdentityRegexp?: string | RegExp;
  certificateOidcIssuer?: string;
  type?: string;
  trustedRoot?: object | string;
  entries?: number;
  timestamps?: number;
  tufMirrorUrl?: string;
  tufRoot?: string;
  tufCache?: string;
  /** The most a pull accepts for one holo. Default 1 GiB. */
  maxHoloBytes?: number;
}

/** `prism/pull-result/1`, with the bytes. */
export interface PullResult {
  schema: 'prism/pull-result/1';
  reference: string;
  digest: string;
  size: number;
  fingerprint: string;
  sha256: string;
  blake3: string;
  verdict: Verdict;
  attestations: { holo: number; referrers: number; signatures: 'verified' | 'not checked'; verified: object[] };
  output: string | null;
  holo: Uint8Array;
}

/** Experimental. Push a holo, as bytes, a path or a `dir://` reference, to a registry or a local store. */
export function experimental_push(source: Uint8Array | ArrayBuffer | string, target: string | ParsedReference, options?: PushOptions): Promise<PushResult>;
/** Experimental. Fetch a holo and write it only after it verifies. Rejects with `PullVerificationError` or `DigestMismatchError`. */
export function experimental_pull(source: string | ParsedReference, options?: PullOptions): Promise<PullResult>;

export interface ParsedReference {
  kind: 'registry' | 'store';
  text: string;
  registry?: string;
  path?: string;
  repository: string | null;
  tag: string | null;
  /** The manifest digest, `sha256:`. */
  digest: string | null;
  /** The archive fingerprint, `blake3:`. */
  fingerprint: string | null;
}
export function parseReference(text: string, options?: { store?: string }): ParsedReference;
export function formatReference(reference: ParsedReference, digest?: string | null): string;

/** The endpoint both a registry client and a store implement. */
export interface OciEndpoint {
  kind: 'registry' | 'store';
  hasBlob(digest: string): Promise<boolean>;
  putBlob(digest: string, bytes: Uint8Array): Promise<boolean>;
  getBlob(digest: string, size?: number): Promise<Uint8Array>;
  putManifest(reference: string, bytes: Uint8Array, mediaType?: string): Promise<{ digest: string; indexed: boolean }>;
  getManifest(reference: string): Promise<{ bytes: Uint8Array; digest: string; mediaType: string | null }>;
  tagManifest(tag: string, bytes: Uint8Array): Promise<{ digest: string; indexed: boolean }>;
  listReferrers(digest: string): Promise<Array<{ mediaType?: string; digest: string; size?: number; artifactType?: string; annotations?: Record<string, string> }>>;
  attachReferrers(digest: string, descriptors: object[]): Promise<void>;
  resolveFingerprint(fingerprint: string): Promise<string>;
}
export function openEndpoint(reference: ParsedReference, options?: RegistryOptions): OciEndpoint;
export function createRegistryClient(
  reference: { registry: string; repository: string },
  options?: { plainHttp?: boolean; resolveCredentials?: (host: string) => RegistryCredentials | Promise<RegistryCredentials>; fetch?: typeof globalThis.fetch; timeoutMs?: number; referrersFallback?: boolean },
): OciEndpoint;
export function parseChallenge(header: string | null): { scheme: string; parameters: Record<string, string> } | null;
export function isLoopback(host: string): boolean;
export function dockerCredentials(registry: string, options?: { env?: Record<string, string | undefined> }): Promise<RegistryCredentials>;

/** A local OCI image layout, the backing store of `images`, `tag` and `rmi` (#349). */
export interface OciStore extends OciEndpoint {
  root: string;
  repository: string | null;
  list(): Promise<Array<{ name: string; tag: string; digest: string; size: number; fingerprint: string | null }>>;
}
export function openStore(path: string, options?: { repository?: string | null }): OciStore;

export interface HoloManifest {
  manifest: object;
  bytes: Uint8Array;
  digest: string;
  size: number;
  descriptor: { mediaType: string; digest: string; size: number };
  layer: object;
  fingerprint: string;
  name: string;
}
/** The deterministic OCI manifest of a holo: the same bytes give the same digest on every registry. */
export function holoManifest(source: Uint8Array | ArrayBuffer | object): Promise<HoloManifest>;
export function referrerManifest(line: Uint8Array, subject: { mediaType: string; digest: string; size: number }, predicateType: string): Promise<{ manifest: object; bytes: Uint8Array; digest: string; layer: object; descriptor: object }>;
export function registryStatement(statement: object, manifestDigest: string): object;
export function registryStatements(attestations: Array<{ statement: object }>, manifestDigest: string): object[];
export function fingerprintTag(fingerprint: string): string;
export function referrersTag(digest: string): string;
export const HOLO_MEDIA_TYPE: 'application/vnd.uor.prism.holo.v1';
export const MANIFEST_MEDIA_TYPE: 'application/vnd.oci.image.manifest.v1+json';
export const INDEX_MEDIA_TYPE: 'application/vnd.oci.image.index.v1+json';
export const EMPTY_DESCRIPTOR: Readonly<{ mediaType: string; digest: string; size: 2; data: 'e30=' }>;
export const ANNOTATION: Readonly<Record<string, string>>;
export const CREATED: '1970-01-01T00:00:00Z';
export const MAX_HOLO_BYTES: number;
export const PUSH_SCHEMA: 'prism/push-result/1';
export const PULL_SCHEMA: 'prism/pull-result/1';
