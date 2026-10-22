# OC-10 conditional checkpoint

Status: incomplete. No SDK acceptance, authentication, readiness or deployment
authority. Public document versions, PP2011 and compiler/SDK pins are unchanged.

## Previous stable source and generated package

Normal `xtask validate-model --write` and readback passed. Normal
`xtask stdlib-package --write` and readback passed with all 57 registered exports.
The crate archive/release metadata were not republished.

| Artifact | SHA-256 |
| --- | --- |
| LinkageV1 source | `ddad045aaf666d136267df0570a831924636bf007c98d8f3ba53e085bfb40d70` |
| LinkageV1Wire source | `c4f9fe47c4af5eddee2300a4eff1fc3a19f07c731faa7f3db380bca94e3e070a` |
| Branch-specific source archive | `a4597c7ee72efd65060737852ca71b1d9642c1af87a7dad138821bd1b47d159b` |
| Generated library | `d6c0df179f1c6bf7df194156140d87c31772ffe29da4cfe4baccca8ae631e1f6` |
| Generation manifest | `dd1c8892481d8608f1b8f8954eb72781f0b5976aa902d62061a6f32c18d208c5` |

The six CBOR primitive source/test changes are identical to reviewed PR #51
commit `377f2b4`; its differently based source archive was not copied here.
That separate exact-candidate ST-16 gate passed 194 roots, 342 kernel audits,
274 Wasm cases, 71 independent byte witnesses and five source mutants.

## Actual private capture

23 focused Rust boundary tests passed with zero ignored; the latest checkpoint
rerun passed in 5.09 seconds after the new graph-negative owner compiled.
The initial actual source-free capture test passed in 1,084.98 seconds, including a disk-floor pause.
It checked the actual fixture Git commit, kernel-verified build, complete OCI
replay, all SDK inventory rows, seven generated linkage preimages, generated
six-field context and unchanged OC-09 roundtrip, three publisher substitutions
and four invalid attempt bounds.

Runtime: `127.0.0.1:5000/prismpm-sdk@sha256:f0f5b5c2ea7fc216ffb309616e42ddf5ffd541855a8c502f71df9b212cbc4891`.
Test executable: `9523de17a0437f82dc28d8f71e14361a04c7dfbd51ee7997994bd2ef88230667`.
Receipt: `3b7eac38f8cebfc0ac7e00848247b589e7d83cfc87139293a40221ed9cf1f1b0`.
Retained in container `prismpm-publication-capture-compatible`, directory
`/tmp/prismpm-oc10-captured-release-1oKJ5s`.

The receipt reports `installed_sdk_source_matches=false`. The older image's
complete provenance remains unchanged; only the private measured-fixture source
constructor succeeds. Image `60226bc7…` independently failed PP5301 because its
actual inventory lacks `playwright-driver`; no inventory rows were fabricated.

The newer fresh source-built test executable
`a1e2b05832c3cbc2bb1ff3f4a8b021b8fbe8026c4433ef4db3c34f5f2bf46b12`
passed the same actual flow plus all 22 changed/missing OCI blob checks with
exact refusal reasons and pristine replay. Receipt
`e5c69d3e74dd9002b9eef5fbd4c7c17d3dc6def850f2048515584f8a75fe48ea`
is retained at `/tmp/prismpm-publication-capture-Zj8wi2/capture` in the same
compatible container. Its actual-process prerequisite took 1,080.95 seconds,
including the unchanged-deadline disk-floor pause. Five fresh Rust gate tests
passed, including removal of the actual capture test; executable/source custody
and occupied-output refusal also passed.

The overall JavaScript owner remained RED: its independent oracle initially
required newline-free JSON for the retained LexLean semantic snapshot. LexLean
defines exactly one final LF. Corrected explicit framing, with original bytes
and digests preserved, passes retained readback and both capture guard tests.
Missing/extra LF, noncanonical whitespace and duplicate keys are refused. This
readback is not a new fresh complete-owner receipt. The earlier read-only fixture
copy failure is retained separately at `/tmp/prismpm-publication-capture-1OqWZp`.

The corrected fresh factory then passed all five tests, zero skipped, in
1,176.35 seconds at `/tmp/prismpm-publication-capture-oliGBT`. Its source-built
executable `0dfc456a72193ef78bbac30398085ffca7f1a78d5f7a105f0c7b25bd43e3e774`
also passed the new readonly-fixture test and all five exact-inventory Rust tests.
Actual replay and all 22 graph refusals took 963.85 seconds. All eight independent
preimages, 11 metadata mutations, four escaping paths and four injected root
entries passed. Factory receipt:
`89d16f9baa13e910d6f76462b3d62621c508dc8aecb5b383f7911e607a1ea8ef`;
actual capture receipt:
`00e24a61ef6b74db46f4d4d36fc75f6b05744bdf66c2bd840960545b7b476292`.
The older installed SDK source remains explicitly unmatched. This is a fresh
conditional factory result, not the complete component/capture owner or SDK gate.
Its completed oracle cache was normally cleaned only after preserving the exact
executed ELF (`6724cdf63ec4b928cb5d1be3f8b21726bf2a359177d200e499b04e21b2cb5aed`);
all 1,118 retained tree rows and independent oracle readback still match afterward.

## Required remaining gates

- Run the complete mandatory capture owner with the still-owned generated
  native/no_std/Wasm replay; the successful standalone factory cannot substitute
  for that closed owner.
- Pass all 33 unchanged resource cases with the pinned compiler. Conditional
  unmerged-compiler/source diagnostics now pass all 119 vectors twice in
  std/no_std/Wasm and all 33 maxima. They do not establish pinned-SDK acceptance.
- Complete all 20 compiled source mutants, registered native semantic witnesses,
  actual capture replay and artifact/receipt substitutions in
  the full owning gate; retain unchanged OC-07/08/09 requirements.
- Rebuild the normal SDK, verify its complete installed inventory/source/corpus
  bindings and owning gates, then integrate the separately authenticated host.

The reviewed collector/bitset/writer source is now promoted without changing any
compiler pin, SDK export or limit. The preceding four-root
119/33 conditional receipt at `prismpm-publication-linkage-owner:/tmp/prismpm-oc10-combined-diagnostic-5x8cQP/diagnostic-result.json`
has SHA-256 `d1f573d6d6088006540e2533d059f452bc5d1753d14c9df55a2a5844a303c83f`.
The widest case uses 1,061,617,664 bytes within the unchanged 1-GiB limit.
Direct diagnostics passed 260 collector, 710 public-partition and 3,192 payload
witnesses per native mode. Earlier 132,320 bit/coverage/fuel checks and surviving
redundant-coverage mutants remain historical; malformed private-helper behavior
is not claimed equivalent. Actual hosts instantiate fresh Wasm per invocation,
as required by SPEC; the retained reused-instance exhaustion counterexample is
not reclassified as success.

The registered observer now includes four reusable witness modules and the
exact 65-test owner plus two guards; its complete execution remains unaccepted.
The old manifest mutant was a source-linking error, not a killed runtime mutant;
the corrected mutation preserves the recursive fuel match and is detected by
actual generated native/no_std/Wasm output differences.

## Promoted-source conditional observations

The fresh seven-root IR includes three private wrapper roots, not SDK exports.
Its SHA-256 is `c438e3dc0169b4bb92c6bb831e8d0df06b5032e3f2ad5385bbe345bedcef23a0`.
The exact unmerged compiler is
`60a9efc0910e8f5b288f0557e11c9e2bf0109d0b5d4ced49396569bd02e0cc03`.
No observation below establishes pinned-SDK acceptance.

| Observation | Receipt SHA-256 |
| --- | --- |
| 119 cases twice in std/no_std/Wasm; all 33 unchanged resource cases | `d2cf85e4e966a445c1537375be22347fd39cb9cce0b2705ecfe78f675622e214` |
| 135,754 registered semantic witnesses in each native mode | `748e7d9ab1c4710721e2f5f99ffd7209272091e8aa66c537e25d07645ed4f38b` |
| 76 context cases twice per native mode and fields-Wasm; 59 unchanged admission-Wasm cases twice | `24aa9401e33b95aaf9bc49a33d06052edffcab42c8f185c8d06eb5b80166e594` |
| All 20 genuine source mutants on the preceding four-root IR, each detected by native/no_std/Wasm output | `b9d5906238fd2edc8ca9ab112adbf8c4a66ff1f1ea4c5aeec7745a0954b33fe5` |

Receipts remain in container `prismpm-publication-linkage-owner`, respectively:
`/tmp/prismpm-oc10-combined-diagnostic-uDgAZ4/diagnostic-result.json`,
`/tmp/prismpm-oc10-registered-witness-zZOj5e/result.json`,
`/tmp/prismpm-oc10-context-witness-mYD6u8/result.json`, and
`/tmp/prismpm-oc10-combined-diagnostic-5x8cQP/twenty-mutants.json`.
The full registered owner must freshly repeat its complete inventory, including
all 20 mutants and actual capture, on the promoted bytes.

Promoted LinkageV1 source: `a9c2718ed1adf3f3b5f4ec3e65a579320be5449f70f0921a380a5e8a77ae45de`.
Promoted LinkageV1Wire source: `8fddebd0413b6c865ccd167caa6092210bc7348490b82e0c7c3964a0f991eab8`.
Normal model write/readback passed; archive:
`f7aedaf0917dc8536df15dbf228d263a2d33a021ef575606819fdc5d2850467b`.
Normal 57-export package generation passed with attestation
`1b913fb3f8f7c0dce6b2b9a882d6d394dc221a8af527892e961054eb943e40dc`,
semantic identity `7ce1ae3928a54a58557b0e723cdc23cf72ce4c603deed597ce00accc371415d0`
and IR `6ff43e8384b0d8bf718ad5eae72d54f66f9a3888dbef875247dd7383c377f899`.
Generated library: `bfb06e7a619464c84e888c38a5460182dab3fec882235885ad310f68f328373e`;
generation manifest: `68314f4ed06dfd283b110145aaf789a38b2d300be900adc698c15e7ae6609803`.
Normal no-write package readback passed with exactly the same identities and
package bytes. The crate archive and release metadata remain unchanged. Prior
failed owners and their successful underlying phases are retained. The complete
registered owner still requires the accepted compiler closure; the successful
conditional compiler diagnostics cannot repin or substitute for it.

The first exact pinned registered-gate attempt stopped before compiler execution:
the owning entrypoint used a dynamic import forbidden by its static closure.
Receipt `af152e6b65eeb7586501db095ea53a9e7e5f702c5aa7b6f70b0e77fa996a92b7`
is retained at `/tmp/prismpm-oc10-pinned-gate-jMXBFt/result.json` in the compatible
capture container. This was an owner defect, not an upstream compiler refusal.
The entry now imports statically. Both guards pass, including parsing a fresh
private copy of the complete actual ESM closure and rejecting a real dynamic-import
mutation; the registered 65+2 inventory and deadlines are unchanged. A fresh exact
pinned owner remains required.

The corrected exact registered gate at `e83351b` failed in 500.83 seconds against
unchanged compiler revision `6272da01ea2045906f5f844988b6265d6c867f39`.
Both guards and all five preceding prerequisites passed: compiler/artifact
substitutions, all 119 vectors, 135,754 semantic witnesses in each native mode,
and six-field/opcode-four parity. The first resource case, `servicesExact`,
trapped in actual generated Wasm at the unchanged 1,073,741,824-byte limit.
The remaining maxima, mutants and mandatory actual capture did not execute;
the complete gate is RED, not accepted or replaced by conditional diagnostics.

Receipt in the compatible capture container:
`/tmp/prismpm-oc10-pinned-gate-0UYrs3/result.json`, SHA-256
`bd883b98aaa37d641cc56b25762952791625b1f7a3033bb03ed8712cd0af0b18`.
The freshly compiled registered test executable is
`d1c935ef0d51f9c06d8e34bac914d0d3e96d61f70507420ca7c014fa2e1feafb`;
all 198 raw dependency files, 3,071 resolved inputs and target-generated inputs
were retained before normal Cargo-cache cleanup. A bookkeeping-only refusal of
relative dependency paths preceded launch; resolving them against the actual
Cargo working directory preserved the same executable and frozen source.
Generated evidence remains at `/tmp/prismpm-publication-linkage-ZDn4Y8`.
Its seven-root IR exactly matches the conditional receipt above; pinned Wasm is
`d2048df6000095905cc2920850fba71c513fd37fdc9a38178f8eb9e2138de531`.
Upstream compiler integration and a fresh complete owner remain required;
no compiler pin, domain limit, public admission or SDK acceptance changed.
