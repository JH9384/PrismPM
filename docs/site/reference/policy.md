---
title: Policy reference
description: The policy check and run judge a holo against, the default policy and how a failure is reported.
available_in: "0.6"
---
Use this page to know what a holo must reach before it runs, and how to write your own rule. A policy says which assurance level a holo must reach and what else must be true of it. `prism check --policy <file>` and `prism run --policy <file>` judge against a policy file. Without the flag, both use the default policy. Today the same flag is on `prism-code check` and `prism-code run`. A policy is always your input at check time, and it never lives in the holo.

## The policy file

A policy file is [Rego](https://www.openpolicyagent.org/docs/policy-language), in the package `prism.policy`. It decides with two rules.

| Rule | Type | Meaning |
|---|---|---|
| `minimum` | one of `P0` to `P3`, required | The lowest assurance level the policy accepts. |
| `deny` | a set of objects, optional | Each member fails the holo. It has exactly `rule`, a dotted name such as `policy.house.builder`, and `message`, one sentence for a person. |

`--policy` takes one of these.

| Value | What it reads |
|---|---|
| `pure-only`, `provenance-only`, `default` | The policy of that name, shipped with the SDK. A file with the same name is reached as `./pure-only`. |
| A path ending in `.rego` | That file. |
| Any other path | A JSON file of `name`, `minimum`, `digests`, `world` and `effects`, which adjust the default policy. |

CUE is not read yet. A `.cue` file exits 2 with `policy.parse`.

A rule named `policy.*` becomes a reason in the verdict, under that name. A rule may also name a reason the check already reported, such as `world.capabilities` or `holo.integrity`, which fails the holo on that reason and adds no other. A policy cannot make up evidence, and it never changes the level.

### Example: pure only

`--policy pure-only` accepts a holo that does nothing beyond pure dispatch: it imports no effect, asks for no capability and is granted none. Any level passes, so copy the file and raise `minimum` when you also need one.

```rego
# Pure only: the holo does nothing beyond pure dispatch. It imports no effect, requests no
# capability and is granted none. Any assurance level passes, so an intact holo with no
# statements passes. Copy this file and raise minimum when you also need a level.
package prism.policy

import rego.v1

minimum := "P0"

# A pure world promises nothing about a holo whose bytes do not hold together.
damage contains reason.check if {
	some reason in input.verdict.reasons
	reason.check in {"holo.integrity", "holo.documents", "world.contract"}
}

deny contains {"rule": check, "message": sprintf("the holo is damaged: %s", [check])} if {
	some check in damage
}

deny contains {"rule": "policy.pure-only.world", "message": "the holo declares no world, so nothing shows that it is pure"} if {
	input.world == null
}

deny contains {"rule": "policy.pure-only.world", "message": sprintf("this reader has no world for %s, so nothing shows that it is pure", [input.world.contract])} if {
	input.world.known == false
}

deny contains {"rule": "policy.pure-only.effects", "message": sprintf("the world imports the impure effects %v", [input.world.effects])} if {
	input.world.pure == false
}

deny contains {"rule": "policy.pure-only.imports", "message": sprintf("the world imports %s.%s", [entry.module, entry.name])} if {
	some entry in input.world.imports
}

deny contains {"rule": "policy.pure-only.requested", "message": "the holo carries a capability set that requests something"} if {
	input.world.capability_set.empty == false
}

deny contains {"rule": "policy.pure-only.granted", "message": sprintf("the caller grants %s", [member])} if {
	some member, entries in input.capabilities
	startswith(member, "allow-")
	count(entries) > 0
}
```

### Example: provenance only

`--policy provenance-only` accepts a holo with a provenance statement whose signature checks, and asks for no proof.

```rego
# Provenance only: the holo carries a provenance statement whose signature checks, and no proof is
# required. P1 includes the integrity of the archive, so a damaged holo cannot reach it.
package prism.policy

import rego.v1

minimum := "P1"

deny contains {"rule": "policy.provenance-only.absent", "message": "the holo carries no provenance statement"} if {
	input.predicates.provenance == null
}

deny contains {"rule": "policy.provenance-only.unverified", "message": "the provenance statement signature does not check against the trust root"} if {
	input.predicates.provenance.verified == false
}
```

### What a policy reads

A policy reads one document, `input`, whose `schema` member is `prism/policy-input/1`. Its JSON Schema is `schemas/policy/policy-input-v1.schema.json` in `@prism-code/spec`.

| Member | What it holds |
|---|---|
| `holo.fingerprint` | The archive fingerprint, as in the verdict. |
| `holo.revision` | The format revision the archive matches, or null. |
| `holo.digests` | `sha256` and `blake3` of `archive`, `capabilities`, `guest`, `view` and `model`. |
| `verdict.level` | The assurance level from the evidence. |
| `verdict.reasons` | Every check that did not pass, before any policy. |
| `world` | `contract`, `known`, `within`, `pure`, `effects`, `imports`, `problems` and `capability_set`. Null when the holo names no contract. |
| `capabilities` | The capability set you granted, or null. A policy file never grants one. |
| `predicates.provenance`, `.proof`, `.replay` | Each `predicateType`, `verified` and `predicate`, or null when the holo carries none. All are null today. |

### The Rego it accepts

The evaluator runs in a browser with no dependencies, so it accepts a part of Rego and refuses the rest. A policy that both it and OPA accept gets the same answer from each, so you can try one there:

```bash
opa eval -d policy.rego -i input.json data.prism.policy
```

`policyInput(bytes)` in `@prism-code/verify` returns the input document of a holo.

| Accepted | Refused, with an error that names it |
|---|---|
| `x := term`, `x if { }`, `default x := term`, `x contains term if { }` | Functions, partial objects, `else` |
| `some v in c`, `some k, v in c`, `every v in c { }`, `not`, `x := term` | `=`, `with`, a bare `some` |
| `==`, `!=`, `<`, `<=`, `>`, `>=`, `x in c` | Arithmetic and the set operators |
| Arrays, objects, sets, comprehensions, `input.a[k]` with `k` bound | `_` or an unbound variable in a reference, `data` |
| `concat`, `contains`, `count`, `endswith`, `object.get`, `object.keys`, `set`, `sprintf`, `startswith`, `type_name` | Every other function |

It is stricter than OPA in three ways, and each one stops a mistake from reading as a pass. A function given the wrong type, or `<` between two types, is an error where OPA gives no value. A rule that neither `minimum` nor `deny` uses is an error, which catches an `allow` nothing consults. A body is read in the order written, so a variable used before it is bound is an error.

It is looser in one way, because it has no type checker. OPA refuses a policy that compares values it can see are different types, such as `1 == "1"`, when it compiles. This evaluator answers false.

## The default policy

The holo must reach P2 or above, and every host, store and variable its world declares must be inside the capability set granted in `prism.toml`. It is a policy file like any other, shipped as `default.rego`:

```rego
# The default policy: P2 or above, and the declared world within the granted capabilities.
# prism check judges a holo by this file when no --policy is given.
package prism.policy

import rego.v1

minimum := "P2"

deny contains {"rule": "world.capabilities", "message": message} if {
	input.world.within == false
	message := concat("; ", input.world.problems)
}
```

| Rule | Default |
|---|---|
| Lowest assurance level that passes | P2 |
| Attestations that must be present and verify | provenance, proof |
| World | within the capability set in `prism.toml` |

The world is what the compiler derived from the model, so a holo cannot declare less than it uses.

## Assurance levels

| Level | Name | What is confirmed |
|---|---|---|
| P0 | unverified | Nothing. The holo loaded, that is all. |
| P1 | provenance | How and from what the holo was built. |
| P2 | proof checked | P1, plus every theorem checked against the holo. |
| P3 | proof plus replay plus capabilities | P2, plus every history replays unchanged, plus the world is within policy. |

## How check reports a failure

`prism check` prints every rule it evaluated, marks the ones that failed, and exits 1. The level is still reported, so you can see how far the holo got.

```bash
prism check calculator@sha256:3f9c… --policy pure-only
```

```text
calculator@sha256:3f9c…
  digest      ok
  provenance  ok   signed, logged
  proof       ok   2 theorems checked
  lockfile    ok   toolchain pinned
  world       FAIL store "results" is not in policy capabilities
Verdict: FAIL  Level: P2  (policy: pure-only)
```

A JSON policy can also list the impure effects the holo's world may import, as `effects`: any of `clock`, `random`, `socket`, `filesystem` and `unknown`. Without it any effect is allowed. `"effects": []` fails a world that imports anything impure, and so does a world importing an interface nothing describes. Add an effect to grant it, such as `"effects": ["clock"]`.

With `--json` the same result is one object with `verdict`, `level`, `policy` and a `reasons` list, one entry per failed rule. `prism run` prints the same report and refuses to instantiate. `prism run --allow-unverified` instantiates anyway and prints a warning on every start.

When `check` cannot evaluate a rule, because a registry or the transparency log is unreachable, it exits 2 and names the rule it could not evaluate. That is not a pass. `--offline` makes `check` contact neither, so any data it would fetch is missing and it exits 2.

| Exit code | Meaning |
|---|---|
| 0 | Every rule passed. |
| 1 | A rule failed, or the policy denied the holo. |
| 2 | No verdict was reached, which includes a policy that cannot be parsed or evaluated. |

A policy that fails is one of three errors, each with a code that does not change.

| Failure | Error | `code` | `check` | Exit | The message names |
|---|---|---|---|---|---|
| The policy does not parse, or uses something it refuses | `PolicyParseError` | `policy_parse_failed` | `policy.parse` | 2 | The line, the column and the construct |
| The policy parsed and could not decide | `PolicyEvaluationError` | `policy_evaluation_failed` | `policy.evaluation` | 2 | The rule and its line |
| The policy denied the holo | `PolicyDeniedError` | `policy_denied` | the rule | 1 | The rule, in `check` |

Treat 2 as a failure in CI. It means nothing was judged, so a broken policy can never read as a pass.

## Next steps

- [Attestations reference](/docs/reference/attestations)
- [Verify and inspect](/docs/guides/verify-and-inspect)
- [Run and gate](/docs/guides/run-and-gate)
