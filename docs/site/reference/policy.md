---
title: Policy reference
description: The policy check and run judge a holo against, the default policy and how a failure is reported.
available_in: "0.6"
---
Use this page to know what a holo must reach before it runs. A policy says which assurance level a holo must reach, which attestations it must carry, and how large its capability set may be. `prism check --policy <file>` and `prism run --policy <file>` judge against a policy file. Without the flag, both use the default policy.

## The policy file

Status: the policy file format is not published yet. This page lists its keys, their types and two worked examples when the spec package publishes the policy schema.

## The default policy

The holo must reach P2 or above, and every host, store and variable its world declares must be inside the capability set granted in `prism.toml`.

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
prism check calculator@sha256:3f9c… --policy pure
```

```text
calculator@sha256:3f9c…
  digest      ok
  provenance  ok   signed, logged
  proof       ok   2 theorems checked
  lockfile    ok   toolchain pinned
  world       FAIL store "results" is not in policy capabilities
Verdict: FAIL  Level: P2  (policy: pure)
```

A policy can also list the impure effects the holo's world may import, as `effects`: any of `clock`, `random`, `socket`, `filesystem` and `unknown`. Without it any effect is allowed. `"effects": []` is the pure-world policy: a world that imports anything impure fails it, and so does a world importing an interface nothing describes. Add an effect to grant it, such as `"effects": ["clock"]`.

With `--json` the same result is one object with `verdict`, `level`, `policy` and a `reasons` list, one entry per failed rule. `prism run` prints the same report and refuses to instantiate. `prism run --allow-unverified` instantiates anyway and prints a warning on every start.

When `check` cannot evaluate a rule, because a registry or the transparency log is unreachable, it exits 2 and names the rule it could not evaluate. That is not a pass. `--offline` makes `check` contact neither, so any data it would fetch is missing and it exits 2.

| Exit code | Meaning |
|---|---|
| 0 | Every rule passed. |
| 1 | A rule failed. |
| 2 | No verdict was reached. |

## Next steps

- [Attestations reference](/docs/reference/attestations)
- [Verify and inspect](/docs/guides/verify-and-inspect)
- [Run and gate](/docs/guides/run-and-gate)
