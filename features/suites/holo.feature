Feature: holo

  @HO-35 @build
  Scenario: --no-provenance writes no statement and needs no lock, and an application build that asked for provenance with nothing to derive it from is refused with PP3018 before compiling.
    Given a project with no prismpm.lock
    When a build asks for no provenance, and then for min provenance
    Then the first needs no lock and plans no statement
    And the second is refused with PP3018 before any compilation and names --no-provenance

  @HO-34 @build
  Scenario: --provenance=max adds exactly the arguments, platform, invocation id and whole-second timestamps, and min records none of them.
    Given the Calculator reference archive and its /3 lock
    When the statement is made in min mode and in max mode
    Then min records no argument, platform, time or invocation, and removing the members of max mode from the max statement gives the min statement
    And a max stamp records whole-second UTC times and a UUID URN that differs between runs

  @HO-33 @build
  Scenario: The provenance statement's subjects, build type, external parameters, builder and dependencies equal the lock and the archive, and PP3018 refuses a lock that does not describe the build and an archive that already has a statement.
    Given the Calculator reference archive, its /3 lock and locks that do not describe it
    When the provenance statement is made
    Then every subject names a content blob with both digests, and the build type, model, spec, builder and dependency rows equal the lock
    And another model, an unpinned image, a /1 lock, unparseable bytes and a second statement are each refused with PP3018

  @HO-32 @build
  Scenario: A build stamped with provenance carries exactly one unsigned SLSA provenance v1 statement in the attestation section with no flag, keeps every other row byte for byte, records the identities of the stamped archive, writes in min mode the same bytes as the JavaScript reference on every run, and stays at P0.
    Given the Calculator reference archive and its /3 lock
    When a build's artifacts are stamped with provenance in min mode, twice
    Then the archive carries one unsigned statement, stripping returns the reference archive, the recorded identities are the stamped archive's and both runs give the same bytes
    And the bundle line equals the JavaScript golden and the verdict is P0

  @HO-31 @build
  Scenario: A recorded history replays byte-identically against the build it came from in both the JavaScript runtime and prismpm, and a changed model that passes its own acceptance vectors fails replay with a typed divergence, writes a statement that records it, and cannot support assurance level P3 with that statement or with the statement of the previous build.
    Given the released Calculator archive, the history recorded from its acceptance vectors, and a coherent archive whose guest and vectors both changed
    When the owning Node suites replay the history against both archives and check each replay statement against each archive
    Then the released archive replays with no divergence and its statement supports P3, while the changed archive passes its own vectors, fails with DeterminismViolationError on every changed event, and its statement and the previous build's each withhold P3
    And prismpm replay writes the same statement but for the runtime that ran it

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

  @HO-21 @build
  Scenario: The explicit server/1 profile declares a closed set of typed host effects in source, with their bounds, closed failures and acceptance transcripts, and projects, validates and canonically encodes it as a closed model document whose every violation is refused with a registered diagnostic, without executing the application or granting any effect.
    Given the Foundation.Server.V1.Model declaration of a server application with effects, vectors and transcripts
    When it is projected from source, validated and canonically encoded as a model-document/7
    Then the document round-trips exactly and each invalid profile, bound, name, exit code, transcript or unexercised effect is refused with PP2013

  @HO-22 @build
  Scenario: The generated host adapter of a server application executes each declared effect only through a typed host binding: its request sum, codecs, host trait and scripted host are rendered from the declaration, an undeclared, malformed or over-bound effect request cannot be encoded or run, and every declared effect is exercised by an acceptance vector through the generated program, without handwritten dispatch or any claim about a real host binding, build or verification pipeline.
    Given a source-owned server application whose host effects are declared with typed requests, results, failures and bounds
    When the generated host adapter is built against the application core and its acceptance suite and program run every vector with its transcript
    Then every response equals the modeled response, every declared effect is performed by some vector and an undeclared, malformed, over-bound or over-budget effect request is refused with its registered failure
    And scripts that are exhausted, mismatched, unused or malformed exit with the registered fault code and publish nothing

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

  @HO-36 @build
  Scenario: The server application declares in source, as closed model data, the loopback listener it serves on and every bound of its HTTP/1.1 exchange (request line, header count and bytes, body, connections, read time, root stack), the Origin values it allows, the Accept and Content-Type it requires and the ordered host-provided sections of the request frame with the declared host effect that supplies each; a non-loopback address, a bound the frame cannot hold and a section without a source are refused with a registered diagnostic.
    Given the Foundation.Server.V1.Model declaration of a served application with a listener, bounds, allowed origins, required media types, frame sections and served vectors
    When it is projected from source, validated and canonically encoded as a model-document/7
    Then the document round-trips exactly and a listener address other than 127.0.0.1, a bound that is zero or that the request frame cannot hold, a frame section without a declared source and a served vector that disagrees with its frame vector are refused with PP2024
    And a frame effect is never an effect the core may request

  @HO-37 @build
  Scenario: The generated adapter of a served application listens on the loopback interface only and moves bytes between RFC 9112 messages and the core's boundary frames as a fixed template fragment: request line, field lines in received order without merging, Content-Length and chunked body delimiting and response serialization; every refusal it makes before the core runs (400, 403, 406, 413, 414, 415, 431) is a typed refusal whose bound or value comes from the declaration, and the acceptance vectors are answered over a real socket.
    Given a served application built with its core and a deterministic binding
    When a test client sends each served vector, and each malformed, oversized, forbidden or unacceptable request, over TCP to the generated program
    Then every vector is answered with the modeled response bytes, a non-loopback bind is refused, an oversized header section is a 431, an oversized body a 413, a bad Origin a 403 and a malformed request line a 400, and the core is not called for any refusal
    And the fields reach the core in the order received, unmerged, and the host-provided frame sections come from the declared host effects

  @HO-38 @build
  Scenario: A server application's core is built through the production API of the pinned lexlean crate and its exported package is the one the generated host links: prismpm build lays the produced package, the generated host packages and the declared binding out as one Cargo workspace, and a small server written in LexLean language 1.2 is accepted end to end over loopback.
    Given the example server whose core is LexLean language 1.2 source
    When prismpm builds it and the generated program serves the example vectors over loopback
    Then the build artifacts hold the production package, the generated packages and the binding as workspace members and every vector is answered as modeled
    And a core root that is not a production root is refused before anything is published

  @HO-39 @build
  Scenario: prismpm verify of a server application is the application acceptance of its build: it checks the build closure and regenerates the host packages from the declaration, stages the consumer's workspace beside the production core, builds it, replays every acceptance vector with its effect transcript through the generated program, runs the linked binding and the served exchanges over loopback, and publishes the evidence bound to the build under verified/; a workspace without the declared binding or its lock, a host package that differs from its regeneration, a replayed vector with a wrong effect result and a served exchange whose response differs are each refused with a registered diagnostic.
    Given the example server built from LexLean language 1.2 source, with a binding crate in the consumer's workspace
    When prismpm verify runs on it
    Then the build closure is checked, the host packages equal their regeneration from the declaration, the consumer's workspace builds, every acceptance vector is replayed with its effect transcript, the linked binding and the served exchanges answer as modeled, and the verified directory holds the acceptance evidence bound to the build
    And a workspace without the declared binding, a host package that differs from its regeneration, a vector with a wrong effect result and a served exchange with a different response are each refused

  @HO-40 @build
  Scenario: Every declared host effect of a server application is exercised by an acceptance vector as the acceptance observes it, a core effect by a step of an effect transcript replayed through the generated Host trait and a frame effect by a served exchange over loopback; the acceptance record names each effect with what reached it, and a declared effect that no vector reaches is refused with PP2026.
    Given a server application that declares a core effect and a frame effect
    When its acceptance runs and one declared effect has no transcript step or no served exchange
    Then the record names every effect with the steps and served exchanges that reached it
    And the effect that no vector reaches is refused with PP2026

  @HO-41 @build
  Scenario: The build bound of the verification of a server application is model data: the declaration states the seconds that the build of the consumer's workspace may take, verification builds under exactly that bound and records it in the published evidence, and a bound that is zero or over 7200 seconds is refused with PP2013.
    Given a server application that declares how many seconds the build of its workspace may take
    When prismpm verify stages and builds the consumer's workspace
    Then the build runs under exactly the declared bound and the published acceptance records it
    And a declared bound of zero or over 7200 seconds is refused with PP2013

  @HO-42 @build
  Scenario: A server application is released and verified from its release artifacts without the source tree: the build retains the consumer's workspace, release assembly and every source-free replay re-derive the application acceptance from the model and the released files, the evidence binds the core package, the two generated host packages, the consumer's workspace and the declared bounds, and replaying the acceptance rebuilds the released program under the recorded build bound and answers every acceptance and served vector as modeled; a tampered package or workspace, recorded bounds that differ from the model and a release without the acceptance evidence are refused with PP6101.
    Given the release of a verified server application and no source tree
    When the release is replayed
    Then the acceptance document is the one derived from the model and the released files
    And the released program is rebuilt under the recorded build bound and answers every acceptance and served vector as modeled
    And a tampered core package, a tampered host package, a tampered consumer workspace, recorded bounds that differ from the model and a release without the acceptance evidence are each refused with PP6101

  @HO-43 @build
  Scenario: The generated host trait of a server application has two defaulted per-request methods, request_begin and request_end, and the served driver calls each once per answered request: request_begin before the core runs with the request's number in the process and its body, request_end after the answer is written with the same number, the request body and the answer body, including a request the adapter or the core refuses; the number pairs each end with its begin when requests on other connections interleave; the defaults do nothing, the shared host forwards both, and the core, its vectors and the effect table are unchanged.
    Given a served application whose binding overrides request_begin and request_end
    When it answers a request the core answers and a request the adapter refuses
    Then the binding sees request_begin then request_end once for each, in order
    And request_begin carries the request's number and body, and request_end the same number, the request body and the answer body
    And a binding that overrides neither compiles and serves unchanged

  @HO-44 @build
  Scenario: The session world hologram:guest/core-wasm@2 is a new contract with its own WIT file and registry row, import-free, exporting exactly memory, holo_alloc and holo_step; its guest package is generated from the model's Bytes -> Bytes root as rendered by prod-codegen and a fixed shim rendered from the declared request, state, response, response-count, page and stack bounds alone; the shim keeps the state inside the instance, traps on a state, response, response count or trailing byte over its declaration and on a step over a region holo_alloc did not reserve, and compacts its arena after every step so the memory a step uses is a function of its state and request; bounds that cannot be generated and an entry that is not Bytes -> Bytes are refused with PP5101, and the @1 row and file are unchanged.
    Given the session world row and its WIT file
    And a model whose session root is Bytes -> Bytes and declared session bounds
    When the session guest package is generated
    Then it is a function of the IR and the bounds alone, and exports exactly memory, holo_alloc and holo_step
    And the shim traps on a state, a response, a response count or a trailing byte over the declaration
    And bounds that cannot be generated and an entry that is not Bytes -> Bytes are refused with PP5101
    And the @1 row and its file are unchanged

  @HO-45 @build
  Scenario: prism-code runs a session-world guest as sessions: one instance per session with an empty first state, steps in order returning zero or more responses through dispatch and stream, every failure ending the session, session.closed for a later step, session.busy for a concurrent step, session.required for dispatch on the application and session.unsupported for open on a stateless one; acceptance sessions are compared step by step; prism/history/2 records sessions as steps and the failure that ended them, and replay re-executes each on a fresh session, reporting every divergence as a DeterminismViolationError and refusing a history of the other world with replay.history.
    Given a holo whose guest is the session world
    When a session takes three steps
    Then each step sees the state the previous steps left and returns its responses in order
    And a failed step ends the session and a later step fails session.closed
    And dispatch on the application fails session.required
    And a recorded prism/history/2 history replays without divergence, and a changed response is one DeterminismViolationError
    And a history of the other world fails replay.history

  @HO-46 @build
  Scenario: Definitions of one application that share a last name component build: prod-export names a requested root by its last component and any other definition of the closure by its last component while no other definition has it, and otherwise by a reserved prefix followed by the length and text of each component of its qualified name, so distinct definitions have distinct names and calls reach the definition they name; an application with no shared last component exports the same bytes as before, and two requested roots that share a last component are refused by name with PP5004.
    Given an application whose entry calls a definition named answer in each of two modules
    When the application is built and verified
    Then the two definitions are exported under distinct qualified names and each call names its own definition
    And the entry and every definition with a unique last component keep that component as their name
    And the acceptance vectors pass
    And the same application with both definitions requested as roots is refused with PP5004, naming both
