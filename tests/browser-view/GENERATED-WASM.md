# Generated Wasm artifact identity

Test infrastructure only; source/package/toolchain provenance and complete
component/application owners remain required.

Capture immediately after guarded Cargo compilation. Retain the exact original
file identity and link count (Cargo normally uses two links), an exclusive
single-link private copy, and one execution buffer. Frozen evidence and private
digests cannot be replaced by a caller's buffer/hash pair. Verify before and
after synchronous/asynchronous execution and at owner completion. Maximum
runner files and browser-served copies must derive from that same capture and
be checked against its original digest before compilation.

The 64-MiB artifact maximum preserves the existing per-module admission in
`sdk/browser/effects-module.mjs`; it is distinct from request framing. This
helper checks the Core-Wasm header, not module semantics or artifact authority.

Eight non-root devcontainer tests passed, including exact 64-MiB capture,
one-over refusal, same-header valid-module payload substitutions, original and
private aliases, immutable buffer/evidence, async postchecks, and same-link-count
inode replacement. Two actual helper mutants remove original digest or inode
binding; each makes the complete six-case guard suite fail its exact negative.
No skipped tests or parser failures count as mutation evidence.

Fresh complete owning builds remain required after adoption; earlier component
receipts attest their original guard scope, not this stronger closure.
