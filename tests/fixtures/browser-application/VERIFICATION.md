# DK-21 declaration verification

Scope: checked LexLean declarations, closed projection and early `PP2011` build
refusal. The fixture is not a browser runtime or Foundry acceptance oracle.

Original declaration baseline source SHA-256:

- Model: `3d55c1e1ea39a429a65bbb0c35971516a5fb3d1bcf7b5eeb099e64c9d48925a6`
- Probe: `23cefd329823d56bd8b03664f0bd5c3fcd86f802be0f3a1fd7c0fba1c95cce23`

Devcontainer checks (2026-09-20):

- Registered `conformance_dk_21`: 1 passed; independent source snapshots,
  schema/canonical closure, declaration mutations and no-output build refusal.
- `browser_application` integration: 1 passed; `text_application`: 8 passed.
- `repo-model` library: 12 passed.
- Scoped Clippy (`-D warnings`), Rust formatting and `git diff --check`: passed.
- Normal `xtask validate-model --write` and readback: passed.
- `xtask validate`: passed, including all 158 infrastructure tests.

No kernel, generated application runtime, credential custody, durable recovery,
effective grants or deployment is accepted by these declaration checks. Combined
SDK stdlib/golden/runtime acceptance remains an integration gate.

Signature-context regression (2026-09-20): the owning source/projection test
failed because `scope:record` was accepted by declaration validation although
the existing modeled effects and browser identity primitive reject it. The
corrected declaration and schema use the same signing grammar, independently of
guest protocol identifiers. Both sign/verify declarations, actual source
projection, 128-byte acceptance and malformed-context rejection pass. All nine
browser identity tests also pass, including real signatures under accepted
contexts and rejection of those malformed contexts by both primitives.

Private-journal policy regression (2026-09-20): the registered owner first
reproduced acceptance of an application Store as the private journal resource.
After the source/schema/projection change, `conformance_dk_21` passed in 8.64 s.
It checks private resource, namespace and head separation; signing slot/context
isolation; 2–1024 retained records; and 63 application signing resources plus
the private signer. Both shared-slot/different-context and different-slot/same-
context declarations remain admitted. Actual key separation remains a runtime
obligation, not a property inferred from names.

Current source SHA-256:

- Model: `57bafe697cca4f0b88dd0fcdb27d4a6420f21d02469a7db81e18c8a3027dab68`
- Probe: `0095f5c26dca6cec9f8d16314cf217cc5fa436d18df53a10c88cda79dd60fb02`

The companion complete registered `conformance_dk_22` owner passed in 232.63 s,
including fresh independent kernel/native/Wasm builds and complete artifact
replay. Its policy artifact now binds all application effects and the private
durability declaration. Changing each private field changes that policy digest.
The exact 17-file emitter register is updated from those reviewed input bytes.
These checks do not enable public runtime or accept SDK/Foundry publication.

Language 1.2 migration (2026-10-21): the Probe is now language 1.2 notation, and
the Current Probe digest above is the digest of that file. The Model digests and
the declaration baseline digests are unchanged and historical.
