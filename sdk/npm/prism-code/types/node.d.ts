import type { Server } from 'node:http';
import type { Application, Capabilities, LoadOptions, ManifestTarget, ParsedManifest, PrismError } from './index.js';

/** Open a `.holo` file or a closure directory. */
export function fromFile(source: string | URL, options?: LoadOptions): Promise<Application>;
/** Read a closure directory into a file map. */
export function readClosureDirectory(directory: string): Promise<Map<string, Uint8Array>>;
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
