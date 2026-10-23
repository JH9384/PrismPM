/**
 * in-toto Statement v1 and the DSSE envelope, with subjects as ADR-015 (issue #274) fixes them.
 * Schemas: `schemas/attestation/statement.schema.json`, `schemas/attestation/dsse-envelope.schema.json`.
 */
import type { PredicateMap, PredicateType } from './predicates.js';

/** 64 lowercase hex characters. */
export type HexDigest = string;

/**
 * Exactly two digests over the same bytes. `blake3` is default-mode BLAKE3
 * with 256-bit output. For a content blob it equals the blob's label without
 * the `blake3:` prefix. The archive footer is BLAKE3 of the body, not of the
 * file, so it never appears here.
 */
export interface PrismDigestSet {
  sha256: HexDigest;
  blake3: HexDigest;
}

/** A content blob of the holo, named by its build-manifest path. An archive cannot name itself. */
export interface BlobSubject {
  name: string;
  digest: PrismDigestSet;
}

/** The OCI manifest a registry-facing statement covers. Registries, cosign and Kyverno match only its sha256. */
export interface OciManifestSubject {
  name: 'oci-manifest';
  digest: { sha256: HexDigest };
}

export type Subject = BlobSubject | OciManifestSubject;

export interface Statement<T extends PredicateType = PredicateType> {
  _type: 'https://in-toto.io/Statement/v1';
  subject: [Subject, ...Subject[]];
  predicateType: T;
  predicate: PredicateMap[T];
}

export interface DsseSignature {
  keyid?: string;
  /** Base64, standard or URL-safe. */
  sig: string;
}

export interface DsseEnvelope {
  /** Base64 of the Statement bytes. */
  payload: string;
  payloadType: 'application/vnd.in-toto+json';
  signatures: [DsseSignature, ...DsseSignature[]];
}
