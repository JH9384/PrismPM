/**
 * The proof predicate `https://uor.foundation/prism/proof/v1` (issue #266).
 *
 * Design: docs/proposals/266-proof-predicate.md. Schema:
 * `predicates/proof-v1.schema.json`, `$id`
 * `https://uor.foundation/prism/proof/v1/schema.json`. This type states the
 * schema exactly; a test compares their members.
 *
 * The statement is an in-toto Statement v1 with exactly one subject, the
 * Core-Wasm guest blob, digested as ADR-015 fixes it. Every `tcb` entry is
 * `trusted`: the toolchain is attested and reproducible, not proven.
 *
 * This file is `.d.ts`, not `.ts`: the package has no build step.
 */
import type { BlobSubject, HexDigest, PrismDigestSet } from '../types/attestation.js';

export declare const PROOF_PREDICATE_TYPE: 'https://uor.foundation/prism/proof/v1';

export type ProofVerdict = 'PASSED' | 'FAILED';

export interface ProofVerifier {
  id: 'https://uor.foundation/prism/verifier/lean4';
  /** `tools.lock` `[lean]` `release` and `commit`. */
  lean: { version: string; /** 40 lowercase hex. */ commit: string };
  /** `model/dependencies.toml` `lexlean`; `model-provenance.json` `lexlean_commit`, `lexlean_package_sha256`. */
  lexlean: { version: string; /** 40 lowercase hex. */ commit: string; crateSha256: HexDigest };
  /** `prismpm.lock` `sdk_version`. */
  prismpm: { version: string };
  /** `prismpm.lock` `sdk_image`: `<repository>@sha256:<hex>`. */
  sdkImage: string;
}

/** The per-declaration axiom policy table; its digest is the LexLean snapshot that carries it. */
export interface ProofPolicy {
  uri: string;
  digest: { sha256: HexDigest };
}

export interface ProofModule {
  /** Lean module name, e.g. `PrismCalculator.Calculator`. */
  name: string;
  leanSha256: HexDigest;
}

export interface ProofModel {
  /** SHA-256 is `model_id`; BLAKE3 is the model blob's label without `blake3:`. */
  document: PrismDigestSet;
  sourceId: HexDigest;
  semanticId: HexDigest;
  snapshotId: HexDigest;
  compilerSemanticsId: HexDigest;
  leanManifestSha256: HexDigest;
  /** At least one. */
  modules: [ProofModule, ...ProofModule[]];
}

/** The observed axioms against the declared policy (VR-05). */
export interface ProofAxiomAudit {
  policy: { kind: 'none' | 'allow' | 'exact'; axioms: string[] };
  observed: string[];
}

export interface ProofTheorem {
  /** Full Lean name, namespace plus declaration, e.g. `PrismCalculator.Calculator.addCorrect`. */
  name: string;
  module: string;
  verdict: ProofVerdict;
  axioms: ProofAxiomAudit;
}

/** One component of the trusted computing base. No entry is verified. */
export interface TcbEntry {
  /** Lowercase, e.g. `lean4-kernel`. */
  component: string;
  role: string;
  version: string;
  /** A git commit or a SHA-256 digest, lowercase hex. */
  digest?: string;
  trust: 'trusted';
}

export interface ProofEvidence {
  lexleanAttestation: { sha256: HexDigest };
  verificationManifest: { sha256: HexDigest };
}

export interface ProofPredicateV1 {
  verifier: ProofVerifier;
  policy: ProofPolicy;
  model: ProofModel;
  /** Theorems only, at least one. */
  theorems: [ProofTheorem, ...ProofTheorem[]];
  /** PASSED only when every theorem is PASSED and every leanchecker replay exited 0. */
  verificationResult: ProofVerdict;
  /** The signer's claim, fixed to `P2` (#269). A checker computes the level from evidence and never reads it. */
  verifiedLevels: ['P2'];
  /** At least one. */
  tcb: [TcbEntry, ...TcbEntry[]];
  evidence: ProofEvidence;
  /** RFC 3339, UTC, e.g. `2026-10-23T00:00:00Z`. */
  timeVerified: string;
}

/** A complete proof statement: exactly one subject, the Core-Wasm guest blob. */
export interface ProofStatementV1 {
  _type: 'https://in-toto.io/Statement/v1';
  subject: [BlobSubject];
  predicateType: typeof PROOF_PREDICATE_TYPE;
  predicate: ProofPredicateV1;
}
