Feature: stdlib

  @ST-11 @build
  Scenario: Saved-code recovery transitions bind admitted current credentials, consume codes atomically, preserve authorization, and reject stale or substituted recovery evidence.
    Given current admitted credential state and independently verified saved-code evidence
    When the modeled lifecycle executes through generated std and no_std packages
    Then successful recovery consumes the code and revises the credential with notification intent
    And disabled identities, stale epochs, consumed codes, substituted keys and exhausted retention are rejected
    And current authorization is preserved without restoring grants or bypassing quorums

  @ST-01 @build
  Scenario: Prism-stdlib defines core ISO 42010 architectural primitives in Foundation.Arch.
    Given stdlib/src/Foundation/Arch.lex.tex
    When processed by LexLean
    Then Component, Edge, Stakeholder, and Viewpoint primitives are defined

  @ST-02 @build
  Scenario: Prism-stdlib defines ISO 27034 security primitives in Foundation.Sec.
    Given stdlib/src/Foundation/Sec.lex.tex
    When processed by LexLean
    Then SecurityControl and Activity primitives are defined

  @ST-03 @build
  Scenario: Prism-stdlib defines ISO 27005 risk primitives in Foundation.Sec.
    Given stdlib/src/Foundation/Sec.lex.tex
    When processed by LexLean
    Then Asset, Threat, and Risk primitives are defined

  @ST-04 @build
  Scenario: Prism-stdlib defines ISO 25010 quality primitives in Foundation.Qual.
    Given stdlib/src/Foundation/Qual.lex.tex
    When processed by LexLean
    Then QualityCharacteristic and Measure primitives are defined

  @ST-05 @build
  Scenario: Prism-stdlib is authored strictly in .lex.tex with no handwritten Lean source.
    Given the stdlib/ directory tree
    When scanned for source files
    Then only .lex.tex files exist and no handwritten .lean files are present

  @ST-06 @build
  Scenario: Prism-stdlib models allow cyclic component graphs while rejecting dangling references.
    Given a component model with cycles and resolved endpoints
    When validated by Prism-stdlib validators
    Then cycles are accepted and dangling edges are rejected

  @ST-07 @build
  Scenario: Prism-stdlib proves cross-facet consistency theorems with empty observed axiom sets.
    Given cross-facet models in stdlib
    When verified with Lean
    Then all consistency theorems hold with empty observed axiom sets

  @ST-08 @build
  Scenario: Prism-stdlib exports registered runtime validator roots.
    Given Foundation.Holo validators
    When exported for compilation
    Then registered validator roots match exact specifications

  @ST-09 @build
  Scenario: Prism-stdlib includes golden test outputs for all published artifacts.
    Given stdlib expected outputs
    When build runs
    Then published artifacts equal committed oracles

  @ST-10 @build
  Scenario: Prism-stdlib models validate through the Holo projector and Lean kernel.
    Given stdlib models
    When projected to Holo and checked with Lean
    Then validation succeeds across all facets

  @ST-12 @build
  Scenario: The internal scoped-administration reducer preserves revision-bound approval and complete post-change ownership in generated native execution.
    Given an authenticated internal organization snapshot and exact bound approval records
    When LexLean and lean4-prod compile the scoped-administration model and complete finite corpus
    Then generated std and no_std consumers enforce distinct-user quorums and complete post-change coverage
    And planted minimum-coverage and ungranted-membership approval defects fail at their exact generated runtime roots
    And restoring each defect reproduces the original accepted artifact identities

  @ST-13 @build
  Scenario: The internal mailbox-admission kernel binds profile-specific admitted proof to current authority, account, challenge and credential state in generated native execution.
    Given a current authenticated account and authority snapshot with a separately admitted profile-specific mailbox proof
    When LexLean and lean4-prod compile the mailbox-admission kernel and complete finite corpus
    Then generated std and no_std consumers enforce exact intent binding and single-use state transitions
    And historical-address and replacement-key defects fail at their exact generated runtime roots
    And restoration reproduces the original accepted artifact identities

  @ST-15 @build
  Scenario: The internal organization lifecycle creates isolated provisional organizations without name privileges and composes scoped administration for revision-bound activation and founding-grant handover.
    Given a current admitted registry partition and authenticated stable account and approval records
    When LexLean and lean4-prod compile the lifecycle and complete finite corpus
    Then duplicate display names confer no authority and unrelated organizations remain unchanged
    And generated std and no_std consumers reject stale or cross-organization requests and incomplete scoped ownership
    And planted identity-uniqueness and administration-bypass defects fail at their exact runtime roots

  @ST-14 @build
  Scenario: The internal candidate browser-bootstrap kernel binds admitted peer sessions to explicit public-operator policy, consent, bounded reservations and fail-closed channel lifecycle in generated native execution.
    Given an authenticated current snapshot and separately admitted policy, consent and session evidence
    When LexLean and lean4-prod compile the candidate kernel and its complete finite corpus
    Then generated std and no_std consumers reject substituted bindings, expired reservations, exhausted attempts and message admission after loss
    And direct peer channels and relayed channels have distinct loss behavior without discarding retained durable operations
    And planted session, consent and lifecycle defects fail at their exact generated runtime roots

  @ST-16 @build
  Scenario: The internal bounded CBOR primitive profile preserves deterministic encoding, typed cursor limits and strict UTF-8 through generated native and bounded Wasm execution.
    Given the exact pinned RFC 8949, RFC 8610 and RFC 3629 sources and independently indexed applicable vectors
    When LexLean and lean4-prod compile every typed codec probe and byte entry
    Then native std and no_std and fresh bounded Wasm instances execute the complete primitive corpus
    And actual maximum-size primitive inputs preserve their bytes and excess inputs fail before unbounded allocation
    And nonminimal-header, payload-limit and UTF-8 admission defects fail their owning runtime assertions
    And an array head is never evidence that its body or a complete application message has been decoded

  @ST-17 @build
  Scenario: The private PKCE S256 primitive generates and validates source-owned verifier bytes and encodes actual browser SHA-256 challenges against RFC 7636 vectors without authenticating an account or mailbox.
    Given the pinned RFC 7636 example and complete verifier alphabet and length boundaries
    When actual generated source kernels and native std and no_std and bounded Wasm execute
    Then all three browser engines derive the exact S256 challenge through their cryptographic provider
    And real source and host defects fail their owning assertions without accepting skipped checks
    And no provider registration or authenticated enrollment is inferred from PKCE material
