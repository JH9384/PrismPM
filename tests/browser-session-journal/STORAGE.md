# Private storage component

`session-storage.mjs` provides IndexedDB mechanics admitted by the generated
retention model: content-addressed immutable objects, exact-frontier compare-and-
swap, shared-root retention and acknowledgement after transaction completion.
It grants no identity, authority, freshness or application acceptance.

27 September 2026: three canonical-framing tests and ten real Chromium storage
journeys pass, including separate tabs, persistent browser restart, rollback,
quota failure, delayed completion acknowledgement and actual transactions that
report relaxed/default/missing durability. Reads and writes refuse those modes
before performing storage operations. The fixture executes
generated retention Wasm, not a JavaScript transition substitute.

- Wasm: `92ce26f8513293215320f1aa34922ea4704c92539d63e5684bdd2c88479beddd`.
- Receipt: `ab26ff91c8cf188b69a31d28fefe2981dcf822fe4d77f366ddd415ebbab932cd`.

The negative durability cases failed before the correction and pass afterward.
Four existing Store browser tests also pass. This verifies browser-reported
durability and transaction behavior, not a physical power-loss guarantee.

The strengthened follow-up passes 18/18 TAP tests in 7.479 seconds: eleven actual
Chromium journeys, 92 observed generated calls replayed twice by both native
configurations, altered-transcript refusal and six executed host defects.
The added journey changes stored object bytes while preserving its root/key;
the real adapter rejects the corrupted payload. Every observed Wasm instance
is bound to the exact source-owner artifact before execution. Exact per-journey
inventories require 24 transitions and 68 validations; dropped observations and
transition-to-validation substitutions are rejected.

Follow-up receipt:
`fb07d7fb833f2358680907737081c85d4c90f98e27e6009a193334e9705e4784`;
evidence: `target/retention-observed-BZ5pFR/evidence.json`.
The original source-owner receipt is bound, not relabeled as current acceptance.

The HTTP delivery follow-up serves only immutable strings captured from all five
SDK modules and checked against the original owner input digests. Undeclared
module/network requests fail; each host mutant starts from that same verified
snapshot. Actual file substitution cannot alter the captured strings and fails
recapture. Twenty scoped checks pass in 7.882 seconds, retaining the eleven
journeys, 92 native-replayed calls and six host mutants. Receipt:
`255e43853b134c05d39d3d5774733e16c9a19e0b4737a34fcfe13bf5211b056e`;
evidence: `target/retention-observed-EBpGGb/evidence.json`.

Fresh complete changed-closure source-owner verification, joint storage maxima,
all-browser execution and authenticated journal composition remain required.
Snapshots bind the reference frontier; callers must read and hash the complete
authenticated closure before executing or recovering effects. Strict transaction
completion does not establish permission for persistent storage, eviction
resistance, a physical power-loss guarantee or peer-backed recovery.
