Feature: holo

  @HO-30 @build
  Scenario: Every refusal of attest and verify-attestation is a registered diagnostic with its check: PP3101 signing, PP3102 signature, PP3103 identity, PP3104 transparency, PP3105 subject, PP3106 no attestation, PP3107 trusted root, and PP1001 for a policy that would let any signer pass.
    Given a holo signed with a local key, the other key, a forged subject digest and every unusable policy
    When verify-attestation and attest are asked to act on them
    Then each refusal is the registered diagnostic with its check and the holo is untouched
    And a holo without the requested attestation reports PP3106 inside the result

  @HO-29 @build
  Scenario: attest signs an in-toto Statement v1 about the holo's content blobs with a local P-256 or Ed25519 key into the attestation section as a Sigstore bundle v0.3 in the shape the JavaScript signer writes, leaves the input holo untouched, strips back to it byte for byte, and verifies offline with the public key.
    Given the Calculator reference archive and test-only P-256 and Ed25519 keys
    When attest signs the proof and provenance statements over its blobs
    Then the section holds the bundle as signed, stripping returns the reference archive, and verify-attestation passes with the public key
    And a type selects which bundles are checked

  @HO-28 @build
  Scenario: verify-attestation checks every attestation of the requested type in the oracle's order: subjects against the holo's blobs, the DSSE signature under the signing certificate or the given key with the chain and its signed certificate timestamps at a signed time, the exact certificate identity and OIDC issuer, and the transparency evidence with Rekor v1 dsse 0.0.1, Rekor v2 dsse 0.0.2 and hashedrekord 0.0.2 bodies checked against the envelope, offline against a pinned trusted root; the bundles the JavaScript signer writes verify, and the Sigstore conformance bundles pass and fail as they do there.
    Given the bundles the JavaScript signer wrote, the Sigstore conformance bundles and their pinned trusted roots
    When the Rust verifier checks them offline
    Then the keyed bundles verify, the keyless signer, log entry and signed time verify, and every refusal names its check
    And the identity is compared exactly, never as a prefix, a suffix or a pattern

  @HO-27 @build
  Scenario: A blank line, a v0.2 bundle, a messageSignature, a single-digest subject and an oci-manifest subject inside the holo are each refused with a registered diagnostic.
    Given malformed attestation lines and statements
    When the Rust writer is asked to attach them
    Then each is refused with PP3016 or PP3017 before any byte is written
    And a valid bundle is accepted

  @HO-26 @build
  Scenario: Every attestation line is one Sigstore bundle v0.3 with a DSSE envelope over an in-toto Statement v1, and every subject names a content blob of the archive with matching sha256 and blake3.
    Given a signed archive whose two bundles name archive blobs with both digests
    When the Rust reader decodes every line
    Then each predicate type and subject is reported with the blob it names and whether sha256 agrees
    And a subject naming no blob or a wrong sha256 is reported as not resolved

  @HO-25 @build
  Scenario: Removing the attestation section yields the unsigned archive byte for byte; rows 0 to 7, every blob label and application_kappa are unchanged by adding it, and the Rust and JavaScript writers produce the same bytes.
    Given the Calculator reference archive and the bundle lines the JavaScript appender signed into it
    When the Rust writer attaches the same lines and strips them again
    Then the Rust bytes equal the JavaScript bytes and stripping returns the reference archive
    And no row of the unsigned archive moves other than by one table row

  @HO-24 @build
  Scenario: An attestation section is an Extension row named https://uor.foundation/extension/attestation-bundle/v1, is the last row, appears at most once, and the footer is BLAKE3 of the body including it.
    Given an archive signed by the Rust writer and by the JavaScript appender
    When the modeled wire codec and both runtimes read the table and the footer
    Then the section is a kind 14 row named by the extension URI and last in a nine-row table, and the footer covers the bundles
    And a foreign name, another kind, a tenth row, a blank line, a missing final LF and a flipped bundle byte are each refused

  @HO-23 @build
  Scenario: A holo without the attestation section loads and verifies with the same bytes and identities as before the section existed, and reports no attestations.
    Given an unsigned Calculator archive with eight rows and a signed one with nine
    When the Rust reader loads, strips and reads attestations of both
    Then the unsigned archive is unchanged byte for byte and reports none, and the signed one keeps every application identity
    And only the archive fingerprint and archive kappa differ

  @HO-20 @build
  Scenario: The JavaScript runtime in sdk/npm/prism-code opens a composed .holo archive and an exported browser closure without the Rust SDK, verifies the footer, every content-blob label and the manifest cross-references with its own BLAKE3, decodes and re-encodes the HOLOVIEW bundle byte for byte, dispatches requests through the Core-Wasm guest on fresh instances, and replays every modeled acceptance vector byte-identically, so a change to the archive, bundle or model-document layout fails this case in the same change.
    Given the released Calculator archive and its exported browser closure committed under sdk/npm/prism-code, and no Rust SDK on the path
    When the JavaScript runtime's owning Node suite parses the archive, verifies its footer, labels and manifest with its own BLAKE3, decodes and re-encodes the HOLOVIEW bundle, compiles the Core-Wasm guest and dispatches every acceptance vector through holo_run and through the closure's adapter
    Then every section, label, footer and cross-reference verifies, the bundle re-encodes byte for byte, every vector answers byte-identically on both paths, and a corrupted header, label or footer is refused with a named error
    And the complete owning suite is accepted file by file with its exact registered test inventory, so a drift in the archive, bundle or model-document layout fails the case in the change that causes it

  @HO-18 @build
  Scenario: The SDK checks OPM and UML design views against the system model, refuses an unknown component, edge, process, state or viewpoint with PP2012, and emits OPL text and PlantUML source as build artifacts.
    Given a model whose Foundation.Arch design records state OPM and UML views over its components, edges and processes
    When the controller checks and builds the model
    Then every view name is resolved against the system model and each view is emitted deterministically under design/
    And a view naming a component, edge, process, state or viewpoint the system model does not declare is refused with PP2012 before any artifact is written

  @HO-17 @build
  Scenario: The explicit text/3 profile models its command-line surface in source and generates static musl programs whose bounded raw input, model-owned help and version, declared exit-code map and registered usage, I/O and fault diagnostics are accepted against the Core-Wasm entry for every vector, without handwritten product code or any claim about targets not executed.
    Given a source-owned text/3 application with a modeled command, help, examples and exit-code map
    When the generated x86_64 and aarch64 musl programs are built, inspected and the host program runs every acceptance vector over stdin, a file and the explicit dash
    Then every within-limit report equals the Core-Wasm report byte for byte with the modeled exit code and every oversized, unreadable, malformed or unwritable invocation exits with its registered usage, I/O or fault code
    And the build manifest and bill of materials bind each program by SHA-256 and source-free verification replays the retained command-line evidence

  @HO-19 @build
  Scenario: The optional Text/3 workbench binds typed source-owned guidance, forms, examples, error recovery and mandatory no-store Wasm acquisition to real byte-guest results, six exact portable assets and cancellable browser worker execution while preserving Text/1 and Text/2 resource semantics and the text/3 command-line surface.
    Given a closed Text V3 source application with exact framed acceptance vectors
    When generated native, Wasm, worker and portable Hologram owners execute
    Then modeled results and recovery are real, current and bounded and malformed or stale evidence is rejected
    And a returning visitor's cached prior Wasm is not reused by the modeled no-store worker acquisition
    And a returning visitor's cached prior Wasm is not reused by the modeled no-store worker acquisition

  @HO-16 @build
  Scenario: The explicit text/2 profile binds modeled Core-Wasm memory and stack limits through generated artifacts and source-free verification while retaining the text/1 profile and legacy guest resource defaults.
    Given a source-owned text/2 application with explicit Core-Wasm memory and stack bounds
    When the generated guest executes and ordinary and source-free verification inspect its actual binary limits
    Then declared and actual limits agree and malformed or substituted budgets are rejected
    And text/1 application metadata and generated guest defaults retain their existing contract

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
