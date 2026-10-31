# Proposal 270 (Rust half): `prismpm check <path.holo>`, a typed verdict with CI exit codes

| | |
| --- | --- |
| Issue | [#270](https://github.com/UOR-Foundation/PrismPM/issues/270) |
| Milestone | M2 v0.5 Lock, check, proof |
| Status | Proposed, Experimental |
| Document | `prism/verdict/1` (#269) |
| Depends on | #266 (proof predicate), #267 (attestation section, PR 369), #269 (assurance levels), the JavaScript half (PR 368) |
| Reference implementation | JavaScript: `sdk/npm/prism-code/src/check.mjs` over `@prism-code/verify`. Rust: `crates/prismpm/src/inspect/verdict.rs`, this change. |

## Summary

`prismpm check <path.holo>` judges a holo against a policy and prints a `prism/verdict/1`: the assurance level computed from the evidence in the archive, whether the policy accepts it, and a reason for every check that did not pass.
It exits 0 when the policy passes, 1 when it fails and 2 when no verdict was reached.
`--policy <file>` names a JSON policy; `--json` prints exactly one canonical verdict.
The verdict has the shape, check ids, order and withheld levels of `prism-code check`, `holo.verify()` and `@prism-code/verify`, so the four cannot disagree on a holo they all read.
`prismpm check` without a holo is unchanged: it still validates the project model.

## Decision: dispatch on the argument, not a flag

`check` takes an optional positional argument. With none it is the model check it has always been; with a `.holo` path it is the verdict.

- The JavaScript CLI already reads this way: `prism-code check <app.holo>` is the verdict, and `check` without a holo is the model check (now `build --check`). One spelling across both CLIs is worth more than a flag.
- `inspect <path.holo>` set the precedent in the Rust CLI (#271): a `.holo` argument selects the archive reader.
- A flag such as `check --holo <path>` would make the model check the default of a verb whose documented purpose, across both CLIs and `STABILITY.md`, is judging a holo. The argument form keeps both reachable with no default to argue about.
- `--policy` requires the holo, so a model check cannot silently take a policy it ignores.

`model/commands.toml` keeps the one `check` row (`mutates = "never"`, result `prismpm/check-result/1`): the registry names verbs, and the holo form adds no verb. The verdict's own schema is `prism/verdict/1` in `@prism-code/spec`.

The holo is judged before the project is loaded, so `prismpm check app.holo` works in any directory: a CI job that downloads an artifact needs no `prismpm.toml` beside it.

## What the Rust reader does

The archive is read through the modeled `Foundation.Holo.V1.Wire` accessors, as `inspect` reads it. Unlike `parse_application`, which refuses at the first problem, the reader records every finding and reports it under the check ids of `@prism-code/verify`:

| Reported as | Internal checks | Withholds |
| --- | --- | --- |
| `holo.integrity` | footer, blob labels, cross references between manifest, directory and provenance, the model document's sha256 | P1 |
| `holo.documents` | format revision, manifest wire form, source manifest, directory, provenance and model document shapes | P1 |
| `world.contract` | the guest has the imports and exports of `hologram:guest/core-wasm@1` | P1 |
| `provenance.*`, `proof.*`, `replay.*` | the statements of the attestation section, below | P1, P2, P3 |
| `world.capabilities` | the declared world within the granted capability set (#283) | P3 |
| `policy.level`, `policy.digests.<target>`, `policy.effects`, `world.hash` | the policy's own rules | none |

No verdict is reached, and `check` exits 2, when the bytes are not a holo whose header and section table the wire model admits (`archive.magic`, `archive.version`, `archive.flags`, `archive.table`), when the table has a layout the wire model does not admit, which is also how an intact archive of a newer revision reads today (`archive.table`, or `format.revision` once a layout is admitted that no revision names), when the path does not exist or is a directory (`load.path`, `verify.kind`), or when the policy file is unreadable or invalid (`policy.unreadable`, `policy.invalid`). A tampered archive is not exit 2: it is P0 with `holo.integrity`, and the verdict is printed.

### Where this reader is ahead of the JavaScript one

The Rust CLI sits on the wire model of #267 (PR 369), which admits the attestation section as a ninth row. So:

- A holo that carries the section has a verdict here. The JavaScript `check` still refuses it with `format.revision` until `@prism-code/spec` dates the revision that admits the row; that is the one holo the two CLIs answer differently, and it resolves when the spec package moves.
- The statements in the section are decoded (`holo::attestation`) and checked against the archive: the proof statement with the checks of #266 (`proof.statement` PP5502, `proof.subject` PP5503, `proof.model` PP5504, `proof.verdict` PP5506, `proof.tcb` PP5507), the provenance statement's subjects (`provenance.subject`). `proof.verifier` (PP5505) compares the statement with the project lock, which a holo on its own has not; it is registered and not yet raised.
- Signatures are verified with the verifier of `verify-attestation` (#272) against the signer the caller names: `--key <public.pem>`, or `--certificate-identity` / `--certificate-identity-regexp` with `--certificate-oidc-issuer`, and `--trusted-root <file>`. A statement whose signature does not verify, or when no signer is named, fails `proof.envelope` (PP5501) or `provenance.envelope`, and the level stays at P0; a signer policy that cannot be used is no verdict (exit 2). With a signer, both reference archives reach P2, held to the signed fixtures `prism-code check` prints goldens for. An unverified statement is no evidence, and the level is never raised by a claim: a `verifiedLevels` other than `["P2"]` is a shape failure (AL-05).

### Where it differs in detail, not in verdict

- Documents are checked by the typed decoders of `holo/archive.rs` rather than by JSON Schema; the check ids and the levels are the same, the messages differ.
- Messages are not part of the contract (#269). The Rust messages say what this reader knows; for example the absent-provenance message does not repeat the JavaScript claim that the format revision has no attestation bundle.

## The policy file

One JSON object with the members `name`, `minimum`, `digests`, `world` and `effects`, checked as `@prism-code/verify` checks them. Without a `name`, the verdict names the policy by the path as given. `PRISM_MINIMUM_LEVEL` sets the minimum when the policy does not. `capabilities` is never read from a policy file: a policy never grants, `run` does (#282).

Since #285 the JavaScript `check` also takes a Rego file or the name of a shipped policy (`default`, `pure-only`, `provenance-only`), and treats any other path as this JSON form. The Rust CLI reads the JSON form only. A path ending in `.rego` is refused with `policy.invalid` naming #285 rather than read as JSON, so the message says what is missing instead of "not JSON". The JSON form means the default policy adjusted by its members, in both CLIs, so a CI job can keep one `policy.json` for `prismpm check` and `prism-code check`. Rego in the Rust CLI follows with #285's Rust half (`regorus`, the same corpus), as that proposal plans.

```json
{ "name": "release", "minimum": "P2", "digests": { "guest": { "sha256": "<64 hex>" } } }
```

## Output and exit codes

| Exit | Meaning | stdout, text | stdout, `--json` | stderr |
| --- | --- | --- | --- | --- |
| 0 | the policy passed | the verdict, from `PASSED` | one canonical verdict line | nothing |
| 1 | the policy failed | the verdict, from `FAILED` | one canonical verdict line | nothing |
| 2 | no verdict | nothing | nothing | `PP5603: no verdict: <check>: <why>` |

Exit 2 keeps stdout empty with `--json`, as #269 and the JavaScript CLI do, rather than printing the CLI's usual `prismpm/error-result/1` envelope: a CI step that parses the verdict must never parse a diagnostic as one. The text form is the JavaScript `formatVerdict`, including the human title of each reason (`ProofMismatch` for `proof.*`) and, from P2 up, what the check trusts the signer for.

## Diagnostics

Registered in `model/errors.toml`, class `acceptance`, with executable probes in `diagnostics.rs`:

| Code | Title | Check id |
| --- | --- | --- |
| PP5501 to PP5507 | the proof statement checks of #266 | `proof.envelope`, `proof.statement`, `proof.subject`, `proof.model`, `proof.verifier`, `proof.verdict`, `proof.tcb` |
| PP5601 | Assurance level below the policy minimum | `policy.level` |
| PP5602 | Declared world exceeds the granted capabilities | `world.capabilities` |
| PP5603 | No verdict reached (exit 2) | the stderr line of exit 2 |

This answers the first unresolved question of #269.

## CI example

```yaml
# .github/workflows/check.yml: gate a deploy on the verdict of the built holo.
jobs:
  check:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/download-artifact@v4
        with: { name: app-holo }
      - name: Judge the holo
        run: |
          prismpm check app.holo --policy ci/policy.json --json > verdict.json
          # 0 passed, 1 failed, 2 no verdict: anything but 0 stops the job.
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: verdict, path: verdict.json }
```

With `ci/policy.json` as `{ "minimum": "P2" }`, the job passes only for a holo whose provenance and proof statements verify. Without a signer (`--key`) no holo reaches P2 here; a pipeline that wants the integrity check alone today uses `{ "minimum": "P0" }` and reads the reasons.

## Conformance

Registered now, suite `assurance`, each run through the Rust regressions of `inspect::verdict`:

| ID | MUST |
| --- | --- |
| AL-03 | A holo without provenance reports P0 even when its proof statement is valid. |
| AL-05 | A statement's `verifiedLevels` never changes the computed level. |
| AL-06 | `prismpm check` and `prism-code check` return equal verdicts for every committed fixture, in every member but the messages. The fixtures are the goldens `prism-code check --json` prints (`sdk/npm/prism-code/test/fixtures/verdict/`), which the JavaScript tests also hold. |

Not registered yet, because no holo can satisfy them before signatures verify: AL-01 (both reference archives reach P2), AL-02 (a tampered guest reports P1 with `proof.subject`), AL-04 (a world outside its capability set, #283). The Rust half of #272 registers AL-01 and AL-02; AL-04 waits for a world with imports.

## What is left

- Signature verification against the #267 trust root, so a signed statement can serve its level (#272). With it, the P2 acceptance of the issue becomes reachable and `proof.envelope` passes.
- `proof.verifier` against `prismpm.lock` when `check` runs inside a project.
- The second reference archive of the issue is not in the tree (also noted by #278).
- `@prism-code/spec` dating the revision that admits the attestation row, after which the JavaScript `check` and this reader answer the signed fixture alike.
