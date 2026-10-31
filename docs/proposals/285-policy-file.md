# Proposal 285: the policy file for `prism check`

| | |
| --- | --- |
| Issue | [#285](https://github.com/UOR-Foundation/PrismPM/issues/285) |
| Milestone | M3 v0.6 Replay, capabilities, conformance |
| Status | Proposed, Experimental |
| Depends on | #269 (levels, verdict), #270 (`check`), #283 (`world.capabilities`) |
| Used by | #282 (`run` gated on check), #291 (freezes the policy input) |

## Summary

`prism-code check <holo> --policy <file>` judges a holo by a Rego file.
The default policy and every user policy go through one evaluator; the default is a shipped file, `default.rego`, not logic in `verify`.
A policy reads one versioned document, `prism/policy-input/1`, and decides with two rules: `minimum` and `deny`.
A policy never lives in a holo.

## Motivation

Before this, a policy was four options: a minimum level, digest pins, a world pin and allowed effects.
That cannot say "provenance, and no proof required, but only from this builder", and every new question meant a new option in `verify`.
#269 and #270 both left the format to this issue.
#291 freezes the policy input, so the input needs a schema before the freeze.

### Goals

1. One evaluator for the default policy and user policies.
2. A versioned input document in `@prism-code/spec`.
3. Three typed failures: a policy that does not parse, one that cannot be evaluated, and one that denies.
4. Exit codes that tell a denial (1) from an error (2).
5. Two shipped examples, `pure-only` and `provenance-only`.

### Non-goals

- CUE. See "Why Rego, and why not both".
- The Rust CLI. `prismpm check` validates the model; it has no verdict until #270 ships there, and then it reads the same files and schema.
- Signer identity rules. They need the statements of #267 in the input first.
- `prism/verdict/2` and the policy's digest in the verdict (#269 question 4).

## Proposal

### Why Rego, and why not both

The issue allows CUE or Rego. Rego is the one that fits both hosts.

| | Rego | CUE |
| --- | --- | --- |
| Rust CLI | `regorus`, a pure Rust interpreter | Go only; the `cue` crate binds `libcue` |
| Browser and `@prism-code/verify` | A subset is small enough to write with no dependencies | Unification over lattices is not |
| Precedent | Kyverno and Conftest, and `cosign verify-attestation --policy` accepts it | `cosign` accepts it |

The repository depends on neither.
`@prism-code/verify` has no dependencies and must run in a browser, and `prism-code` vendors it as one file.
No npm package evaluates Rego source today: `regorusjs` is unpublished, and `@open-policy-agent/opa-wasm` runs only what `opa build` already compiled.

So this change ships Rego alone, in `src/rego.mjs`.
A `.cue` file is a typed `policy.parse` error today.
CUE is additive: the input document is plain JSON and names no language, so a second evaluator takes the same document and returns the same `{ minimum, deny }`.

### A closed subset, which refuses rather than guesses

A hand-written evaluator is only safe if it cannot disagree quietly with OPA. Two rules hold that, so a policy both accept gets the same answer from each.

- A construct outside the subset is a parse error that names it. Refused: functions, partial objects, `else`, `with`, `=`, arithmetic and set operators, `_` and unbound variables in a reference, `data`, other imports, and any function not listed.
- Where OPA would turn a mistake into `undefined`, this evaluator stops with an evaluation error. `count(1)` under `not` would otherwise read as a pass. Mixed-type ordering and duplicate object keys stop too.

Two more checks catch mistakes that would read as a pass: a rule that neither `minimum` nor `deny` uses is a parse error, which catches `allow` and a misspelled `denny`, and a body is read in the order written, so a variable used before it is bound is a parse error.

There is no type checker, which is the one place this evaluator is looser: OPA refuses `1 == "1"` when it compiles, and this answers false. OPA's first run against the corpus found this, and it found no case where the two gave different answers. Input is untyped to OPA, so the difference reaches only literals and values derived from them.

An evaluation is bounded at two million steps. Nothing reads a clock, the network or randomness, so the same input gives the same verdict.

`test/rego-corpus.mjs` holds the answers. `test/rego-opa.test.mjs` holds OPA 1.22.0 to the same answers, on the corpus and on every shipped policy against every input fixture, and CI runs it with a digest-pinned binary.

### The policy file

```rego
package prism.policy

import rego.v1

minimum := "P1"

deny contains {"rule": "policy.house.builder", "message": "this builder is not ours"} if {
	input.predicates.provenance.predicate.runDetails.builder.id != "https://example.com/builder"
}
```

- `minimum` is required: the lowest level the policy accepts. It fills `policy.minimum` of the verdict, and a level below it adds the `policy.level` reason, so the verdict schema's rule that a pass is at or above its minimum always holds.
- `deny` is a set of objects with exactly `rule` and `message`. A rule named `policy.*` becomes a reason with that check id. A rule naming a reason the evidence already holds, such as `world.capabilities`, rests the denial on that reason and adds none. A policy cannot invent evidence, and cannot take a check id a verdict already uses (`policy.level`, `policy.effects`, `policy.digests.*`).

The level comes from the evidence and no policy changes it.

### The input document

`prism/policy-input/1`, schema `schemas/policy/policy-input-v1.schema.json`.

| Member | Holds |
| --- | --- |
| `holo` | `fingerprint`, `revision` and `digests`: both digests of the archive and each content blob. |
| `verdict` | `level` and `reasons`: the evidence, before any policy. |
| `world` | `contract`, `known`, `within`, `pure`, `effects`, `imports`, `problems`, `capability_set`; null when the holo names no contract. |
| `capabilities` | The set the caller granted, or null. A policy file never grants. |
| `predicates` | `provenance`, `proof`, `replay`: each `{ predicateType, verified, predicate }` or null. |

`predicates` are all null until a format revision admits the attestation section (#267). The shape is fixed now so that #291 can freeze it and a policy written today keeps its meaning.

### Which file `--policy` reads

| Value | Reads |
| --- | --- |
| `default`, `pure-only`, `provenance-only` | The shipped policy of that name. A file of the same name is reached as `./name`. |
| A path ending in `.rego` | That file. |
| A path ending in `.cue` | Nothing: `policy.parse`. |
| Any other path | A JSON file of `name`, `minimum`, `digests`, `world` and `effects`, as before. |

The JSON form stays because `run` and existing CI use it. It means the default policy adjusted by those options, so it too goes through the evaluator.
A Rego policy states everything itself, so `verify` refuses `minimum`, `digests`, `world` and `effects` beside `rego`, and `PRISM_MINIMUM_LEVEL` does not apply to it.

### Typed failures

| Failure | Class, `code` | `check` | Exit |
| --- | --- | --- | --- |
| Does not parse | `PolicyParseError`, `policy_parse_failed` | `policy.parse` | 2 |
| Cannot be evaluated | `PolicyEvaluationError`, `policy_evaluation_failed` | `policy.evaluation` | 2 |
| Denies | `PolicyDeniedError`, `policy_denied` | the rule | 1 |

All three extend `VerificationError`. A parse message names the line, the column and the construct. An evaluation message names the rule and its line. A denial is a verdict, so it arrives as a reason and is thrown only with `throw: true`.
No new `PP` diagnostic is added: `PP5601` and `PP5602` are themselves not yet in `model/errors.toml` (#269 question 1), and a registered code belongs with the Rust verdict.

### A policy never lives in the holo

No format revision has a policy section, and the input schema has no member for one.
An archive with an extra extension section matches no format revision, so it gets no verdict: `check` exits 2 with `format.revision`, and nothing in the section is read.

## What this does not yet deliver

The issue's sign-off asks that the default policy pass both reference archives. That cannot happen in this change.

- `verify` reports P0 for every holo. #267's wire model is in the Rust reader and writer (#369), but `@prism-code/verify` does not read statements yet and no build writes them (#268). The default policy needs P2, so the real `Calculator.holo` fails it, and correctly.
- The Payment Approval archive is not in this repository.

The evaluator side is tested with `calculator-p2.json`, the reference archive's real facts with P2 evidence written in by hand. Two `test.todo` entries in `prism-code/test/policy.test.mjs` hold the end-to-end check open until those land.
The over-privileged case has the same limit: `hologram:guest/core-wasm@1` imports nothing, so no real archive can exceed its grant. It is tested with the `over-privileged-p2.json` input, and end to end with a grant that `pure-only` refuses.

## Test plan

- `sdk/npm/verify/test/rego.test.mjs`: the corpus, every refused construct, and every evaluation error.
- `sdk/npm/verify/test/rego-opa.test.mjs`: OPA's answers against the corpus and the shipped policies.
- `sdk/npm/verify/test/policy.test.mjs`: the shipped policies against each input fixture, the decision contract, and `verify`.
- `sdk/npm/prism-code/test/policy.test.mjs`: the CLI, exit codes, typed errors, `run`, and an archive with a policy section.
- `sdk/npm/spec/test/policy.test.mjs` and the fixture rule: the schema, and the shipped files reachable by name.

## Graduation criteria

- Beta at the v0.6 freeze (#291): the input document, the decision rules and the error codes are frozen. The subset may grow; a construct that parses today keeps its meaning.
- Stable (1.0): the Rust CLI evaluates the same files, with `regorus`, against the same corpus.

## Precedent

- `cosign verify-attestation --policy`: a policy is a verify-time input, in CUE or Rego.
- Kyverno `ImageValidatingPolicy`: attestation rules beside the artifact, not in it.
- OPA `deny` sets and Conftest: a set of denials, each with a message.

## Alternatives

- Shell out to `opa` or `cue`. It needs a binary on every machine and does not work in a browser, so `holo.verify()` and `check` would disagree.
- Vendor `regorus` compiled to WebAssembly. It is the full language, at the cost of a binary in a browser file and a build step that must be reproducible. The subset's answers are pinned against OPA, so this stays open if the subset proves too small.
- Keep hard-coded rules and add options. Every new question would be a new option, and the default would stay outside the evaluator the issue asks for.

## Unresolved questions

1. Should the verdict record the policy's digest, as a VSA records its policy? It needs `prism/verdict/2` (#269 question 4).
2. Should `prism.toml` name a policy file (#282 question 1)?
3. Does the JSON form retire at 1.0 in favour of Rego alone?
