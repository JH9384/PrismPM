Feature: holo

  @HO-14 @build
  Scenario: Pinned BLAKE3 vectors qualify every imported digest mode, streaming partition and content-identity result without claiming cryptographic proof or durable native storage.
    Given all 35 immutable upstream vectors and their complete licensed source closure
    When the pinned adapter executes every mode and declared input partition
    Then full extended outputs and content identities match imported expectations
    And changed expectations, lengths, pattern, key and context are rejected

  @HO-15 @build
  Scenario: The modeled primary-only component profile emits exact source-bound physical-v4 archives and verifies binary native, Wasm and pinned Live execution without accepting a public Browser application.
    Given current verified component source and its complete generated artifact closure
    When the exact modeled archive executes binary vectors and maxima in native Wasm and pinned Live
    Then malformed substituted and incomplete evidence is refused without changing public application admission

  @HO-13 @build
  Scenario: The modeled browser-surface wire codec preserves legacy bytes, reproduces pinned upstream framing in generated std and no_std code, and rejects malformed or mixed profiles without granting browser authority.
    Given current verified modeled source and independently produced wire vectors
    When both generated native modes exercise every browser codec export
    Then the exact closed profiles remain distinct and malformed framing is rejected

  @HO-12 @build
  Scenario: Application verification executes the exact portable View in Chromium through the authoritative Hologram intent and Core-Wasm session, rejecting incomplete browser evidence.
    Given a composed application with its exact portable attachment assets
    When Chromium exercises modeled requests, transport failures, privacy, and lifecycle
    Then actual rendered results and complete profile-specific evidence are required
    And the workspace interoperability owner qualifies both profiles and both triggers with the complete 78-case boundary inventory

  @HO-11 @build
  Scenario: The explicit text application profile projects to closed model-document/2, retaining legacy model-document/1 and rejecting invalid UTF-8 response, field, root, and byte-bound declarations.
    Given typed UTF-8 application metadata and legacy calculator metadata
    When closed schemas and application profile invariants are checked
    Then valid profiles retain their schemas and malformed text declarations fail closed

  @HO-01 @build
  Scenario: A Holo/1 artifact is a strict binary Hologram archive with physical version 4 and the HOLO header.
    Given a modeled application archive
    When its physical bytes are emitted
    Then they begin with HOLO and little-endian physical version 4

  @HO-02 @build
  Scenario: Legacy application and architecture model documents retain the closed prismpm/model-document/1 schema and model.prism.json name.
    Given a projected Prism model document
    When its build artifact and schema are inspected
    Then the closed schema and non-Holo filename agree

  @HO-03 @build
  Scenario: Prism model documents use deterministic canonical JSON and an exact SHA-256 model identity.
    Given canonical model.prism.json bytes
    When canonical encoding and SHA-256 identity are checked
    Then the bytes and declared model identity agree

  @HO-04 @build
  Scenario: The model-document projector is a total deterministic function from valid LexLean semantic snapshots.
    Given a valid LexLean semantic snapshot
    When the model-document projector runs
    Then a complete Prism model document is produced deterministically

  @HO-05 @build
  Scenario: Model entity identifiers are qualified strings assigned deterministic zero-based indexes.
    Given a projected Prism model document
    When runtime index assignment occurs
    Then entities receive unique, consecutive zero-based Nat indexes

  @HO-06 @build
  Scenario: Platform-independent Prism model and Holo artifacts exclude host paths, timestamps, and unstable environment data.
    Given generated Prism model and application artifacts
    When their platform-independent contents are inspected
    Then no timestamps, absolute paths, or host identifiers are present

  @HO-07 @build
  Scenario: Holo decoding rejects legacy JSON, noncanonical archives, malformed values, and unsupported physical versions.
    Given legacy JSON or malformed Holo archive bytes
    When the strict Holo/1 validator parses input
    Then validation fails at a registered archive diagnostic

  @HO-08 @build
  Scenario: The emitter-semantics ID uniquely identifies the model-document projector inputs.
    Given model/emitter-inputs.toml
    When input files are hashed
    Then the computed tree digest equals the declared emitter-semantics ID

  @HO-09 @build
  Scenario: Shared goldens bind generated Lean, canonical model documents, and binary Holo application projections to their sources.
    Given committed source-bound golden vectors
    When their manifests and artifact bytes are checked
    Then generated declarations and both projection formats are traceable to the same model

  @HO-10 @build
  Scenario: Holo/1 validation checks canonical sections, identities, content closure, directory derivation, and closed Prism provenance.
    Given a valid archive and one-field-at-a-time mutations
    When Holo/1 validation executes
    Then every disagreement is rejected before acceptance
