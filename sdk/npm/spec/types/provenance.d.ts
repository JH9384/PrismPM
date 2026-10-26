/**
 * The predicate of a holo's SLSA provenance v1 statement (#268).
 * Design: docs/proposals/268-build-provenance.md. Schema: schemas/attestation/provenance-v1.schema.json.
 */

/** Exactly sha256 and blake3 over the same bytes (ADR-015). */
export interface ProvenanceDigestSet {
  blake3: string;
  sha256: string;
}

/** One resolved dependency: bytes with a digest, or a tool version with only its uri. */
export interface ProvenanceDependency {
  name: string;
  uri: string;
  digest?: { blake3?: string; sha256?: string };
  mediaType?: string;
}

/** `inputs.spec` of the lock: BLAKE3 over the authored sources. */
export interface ProvenanceSpec {
  basis: 'model-sources' | 'prism-toml';
  blake3: string;
}

export interface ProvenanceBuilder {
  /** The SDK image the lock pins, by digest. */
  id: string;
  version?: { prismpm: string };
}

/** Min: written by every `prismpm build` unless `--no-provenance`. Nothing in it varies between machines or runs. */
export interface MinHoloProvenance {
  buildDefinition: {
    buildType: 'https://uor.foundation/prism/holo-build/v1';
    externalParameters: { model: ProvenanceDigestSet; spec?: ProvenanceSpec };
    internalParameters: Record<string, never>;
    resolvedDependencies: ProvenanceDependency[];
  };
  runDetails: { builder: ProvenanceBuilder };
}

/** Max: opt-in with `--provenance=max`. Adds the build arguments, the platform, an invocation id and timestamps. */
export interface MaxHoloProvenance {
  buildDefinition: {
    buildType: 'https://uor.foundation/prism/holo-build/v1';
    externalParameters: { arguments: string[]; model: ProvenanceDigestSet; spec?: ProvenanceSpec };
    internalParameters: { platform: string };
    resolvedDependencies: ProvenanceDependency[];
  };
  runDetails: {
    builder: ProvenanceBuilder;
    metadata: { invocationId: string; startedOn: string; finishedOn: string };
  };
}

/** The predicate of `https://slsa.dev/provenance/v1` as Prism writes it. */
export type HoloProvenance = MinHoloProvenance | MaxHoloProvenance;

export type ProvenanceMode = 'min' | 'max';
