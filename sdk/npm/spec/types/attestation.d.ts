/**
 * in-toto Statement v1 and the DSSE envelope.
 * Schemas: `schemas/attestation/statement.schema.json`, `schemas/attestation/dsse-envelope.schema.json`.
 */
import type { PredicateMap, PredicateType } from './predicates.js';

/** Lowercase hexadecimal. */
export type HexDigest = string;

/**
 * Algorithm name to digest. A Prism subject may carry `blake3` and `sha256`
 * together. Issue #274 decides which bytes each one covers.
 */
export interface DigestSet {
  sha256?: HexDigest;
  /** 64 hex characters, without the `blake3:` label prefix. */
  blake3?: HexDigest;
  [algorithm: string]: HexDigest | undefined;
}

export interface ResourceDescriptor {
  name: string;
  digest: DigestSet;
  uri?: string;
  downloadLocation?: string;
  mediaType?: string;
  annotations?: Record<string, unknown>;
}

export interface Statement<T extends PredicateType = PredicateType> {
  _type: 'https://in-toto.io/Statement/v1';
  /** At least one subject. */
  subject: [ResourceDescriptor, ...ResourceDescriptor[]];
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
