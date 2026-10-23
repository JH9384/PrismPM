/**
 * The holo attestation section and the Sigstore bundle it carries (issue #267).
 * Design: docs/proposals/267-attestation-bundle.md.
 * Schema of one bundle: `schemas/attestation/sigstore-bundle.schema.json`.
 *
 * The section is an Extension row (kind 14), the last row of the table, named
 * `https://uor.foundation/extension/attestation-bundle/v1`. Its payload is
 * JSON Lines: one `SigstoreBundle` per line, each line ended by LF.
 *
 * Statement, subject and digest types are reused from `attestation.d.ts`.
 */
import type { BlobSubject, DsseEnvelope, Statement } from './attestation.js';
import type { PredicateType } from './predicates.js';

/** Standard or URL-safe base64. */
export type Base64 = string;
/** A protobuf JSON int64: decimal digits in a string. */
export type Int64String = string;

export interface TransparencyLogEntry {
  logIndex: Int64String;
  logId: { keyId: Base64 };
  kindVersion: { kind: string; version: string };
  integratedTime: Int64String;
  inclusionPromise?: { signedEntryTimestamp: Base64 };
  inclusionProof?: {
    logIndex: Int64String;
    rootHash: Base64;
    treeSize: Int64String;
    hashes: Base64[];
    checkpoint: { envelope: string };
  };
  canonicalizedBody: Base64;
}

interface VerificationMaterialBase {
  tlogEntries?: TransparencyLogEntry[];
  timestampVerificationData?: { rfc3161Timestamps?: { signedTimestamp: Base64 }[] };
}

/** Keyless: the Fulcio leaf certificate. Keyed: a public key hint. Exactly one. */
export type VerificationMaterial =
  | (VerificationMaterialBase & { certificate: { rawBytes: Base64 }; publicKey?: never })
  | (VerificationMaterialBase & { publicKey: { hint?: string }; certificate?: never });

/** Sigstore bundle v0.3 restricted to a DSSE envelope over an in-toto Statement v1. */
export interface SigstoreBundle {
  mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json';
  verificationMaterial: VerificationMaterial;
  dsseEnvelope: DsseEnvelope;
}

/**
 * The statement a bundle in the holo carries once its DSSE payload is decoded.
 * Subjects are content blobs only: an in-holo statement never names the OCI
 * manifest or the archive, because both digests would cover the statement.
 */
export type HoloStatement<T extends PredicateType = PredicateType> = Omit<Statement<T>, 'subject'> & {
  subject: [BlobSubject, ...BlobSubject[]];
};

/** The decoded attestation section: the bundles in line order. */
export interface AttestationSection {
  extension: 'https://uor.foundation/extension/attestation-bundle/v1';
  kind: 14;
  bundles: [SigstoreBundle, ...SigstoreBundle[]];
}

/** OCI referrer layout for one bundle line on push (issue #267, ADR-015). */
export interface BundleReferrer {
  artifactType: 'application/vnd.dev.sigstore.bundle.v0.3+json';
  annotations: {
    'dev.sigstore.bundle.content': 'dsse-envelope';
    'dev.sigstore.bundle.predicateType': string;
  };
}
