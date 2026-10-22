# Private signed context

DK-32 prerequisite. This component authenticates an exact statement signed by a
key, not an account, mailbox, organization permission, current state or release.
`PP2011` remains closed. The internal frame is not DID, VC, JOSE or COSE.

`SignedContext` reuses `SourceSessionBinding` unchanged. It binds origin, purpose,
subject, scope, state, request, credential epoch and challenge. Every reference
is exactly 32 bytes; epoch is uint32. Purposes are AccountBinding0,
AccountRequest1, OrganizationApproval2 and SessionJournal3. Their fixed signing
contexts are respectively `prismpm/account-binding/1`, `prismpm/account-request/1`,
`prismpm/organization-approval/1` and `prismpm/session-journal-context/1`.

The unsigned canonical body contains version, complete context and public key.
Signing uses the existing `identity.mjs` domain and P-256/SHA-256 P1363 profile.
The source owns complete parsing, serialization, projection and exact expected
context/key comparison. Both the signer key and independently expected key must
pass the shared `Foundation.Crypto.P256.Model.p256PublicKeyValid` predicate,
in addition to the existing effect signing-grant shape/domain checks. Exact
SEC1/SEC2 point admission precedes signature-width checks and provider import;
it does not prove signature validity or possession. Invalid points retain
`BadKey` (wire code 1); the host reports `model-rejected` without invoking key
import, rather than waiting for a provider-level import failure.
Key validity, envelope validity and matching declare DK-34's exact
`Quot.sound`/`propext` kernel policy. Their wire dependents already declare
these axioms through canonical CBOR. The owning attestation checks each exact
policy; no additional axioms are admitted.
No operation accepts a verification boolean or returns an authorization decision.

The private SDK factory captures every option before awaiting, verifies the exact
selected model artifact, executes its projections and comparison, then performs
actual public-key import, hashing and signature verification. Only that completed
path creates an opaque evidence handle. Evidence is bound to the exact verifier
instance and artifact; copies, lookalikes and constructor substitutions reject.
Returned byte facts are copies. They prove only the captured signed statement.
The existing public-key digest identifies a key, not an account. Randomized or
malleable signature bytes and signed-envelope hashes never identify an account
or count distinct approvals; any statement identity binds the unsigned body.
The full release/session-bound statement is not a stable account genesis.
The private bootstrap must select the artifact from its independently verified
source/package closure. A caller-supplied module and matching self-hash do not
prove model provenance and cannot admit that module into a published authority.

Consumers derive expected context from their own generated request/state and
resolve the signer through admitted current credential state. A signed request
reference does not establish its payload integrity; a subject reference does not
allocate a stable account. Email assertions, credential succession, organization
quorums, independent freshness and durable admission remain required separately.

Acceptance requires complete source/kernel/native std/no_std/two-Wasm parity,
actual bounds and mutations, original pinned WPT ECDSA tests, independent native
signature verification, and three-engine host/capture/handle adversaries. A
passing component does not accept an SDK image, complete standard or application.
