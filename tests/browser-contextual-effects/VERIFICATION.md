# DK-28 verification

Private exact-request staging only: no application authorization, durable result
receipt, nonce-freshness guarantee, public runtime or deployment acceptance.

2026-09-27, isolated pinned development container, locked/offline dependencies:

- Fresh registered `conformance_dk_28`: PASS, 24 underlying tests, 222.93 seconds.
  All 999 frozen source/compiler inputs matched actual staged inputs and final
  acceptance; an independent readback rehashed the complete closure and receipts.
- Effects: 242 vectors and five maxima; Custody: 90 vectors and ten maxima.
  Actual generated native `std`/`no_std` and Wasm execution passed. Explicit
  native-only over-allocation cases are not claimed as Wasm execution.
- Thirteen Chromium journeys produced 219 generated calls. Native `std`/`no_std`
  replay checked every call, including 23 large binary frames restored against
  their observed lengths and SHA-256 hashes. Nine executed host mutants failed
  their specific behavioral assertions.
- Effects wire maximum memory: 978,124,800 bytes; browser maximum: 494,272,512
  bytes, below the unchanged 1-GiB bound. The maximal Commit retains sixteen
  distinct 1-MiB objects.
- Completed private tool caches were retired with actual tool identities; source,
  proof, IR, Wasm and receipts remain. No retained diagnostic supplied acceptance.
- Unchanged complete DK-20 and DK-24 regressions passed in 365.25 and 776.17
  seconds. DK-24 retained all twelve host and five freshly compiled source mutants.
- Unchanged complete DK-27 passed in 627.99 seconds: thirteen tests and seven
  freshly compiled mutants. Independent readback matched all 811 frozen inputs;
  its 179 vectors, 25 maxima and 134,348,800-byte Wasm peak remain unchanged.
- Repository source audit passed all 204 tests without skips; normal formatting,
  warning-denying conformance Clippy and model/spec-link audits passed (182 IDs,
  86 diagnostics).

Acceptance: `target/audit-27sep26/dk28-acceptance.json`, SHA-256
`7ba2899b6d899f3044d975515619f7f30970c3f8aa0335c63a67e44c4e4f7d6c`.
Browser evidence: `target/audit-27sep26/dk28-browser-evidence.json`, SHA-256
`c7e75637d1af5cb8308dda95372dbb5ec53514add70b94b0e41c638bb92e252b`.
Original generated artifacts remain in the owning container at
`/tmp/prismpm-effects-Pl2ANQ` and `/tmp/prismpm-custody-4ppGOr`.

Logs under `target/audit-27sep26/`:

| Log | SHA-256 |
| --- | --- |
| `conformance_dk_28-private-lifecycle.log` | `7a8504fc1ca9b5a7c22e28af119a6a1958fdc8878af8fe29e14b54309b3e9959` |
| `conformance_dk_20-private-lifecycle.log` | `4d1e67183d22a8b735ca410be6c9d3a523c18d11a8faa27ef75062768f43986f` |
| `conformance_dk_24-private-lifecycle.log` | `39a76a249396b1a05717f3e1b84c070791485e143f35c8668f61dce634b62ef1` |
| `conformance_dk_27-private-lifecycle.log` | `f4546701367f2e680ebe3e9cb955a0d383265fe53e2c02b0f083bb759a6ead93` |
| `validate-final-private-lifecycle.log` | `83c16e12ef83acd1b26c9f8a10e9c9c8ea181f1e472e06f2310038e493404cf7` |

Earlier fresh attempts correctly rejected inherited missing private paths and
missing Cargo cache initialization. Compiler ownership and lifecycle were fixed
centrally, with thirteen real cache adversaries; those failures were not accepted.
The preserved original draft also reproduced missing contextual staging and
unknown-outcome late-waiter priority failures; its old receipt is not this run.

Installed-source tests bind the complete DK-27/DK-28 fixtures, licenses, exact
registered owners, minima and deadlines. They do not replace genuine execution
of the combined immutable installed SDK, both platforms or product release gates.
Browser admission remains closed; Hologram Live is the authoritative `.holo`
contract, not these private kernel vectors.
