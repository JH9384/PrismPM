---
title: Quickstart
description: Write one JSON spec, then build, check, run and deploy your first holo.
available_in: "1.0-beta"
---
In five minutes you create a payment check from one JSON file, build it into a holo, check its proof, run it, and publish it to GitHub Pages. Every command below is one you will use every day.

The `prism` CLI ships with 1.0-beta.1. To try a holo with what is on npm today, start with [Call a holo](/docs/examples/call-a-holo).

## Before you start

You need Node.js 22 or later and Docker. Docker runs the SDK image, so you never install the compiler yourself. The scaffolder adds the `prism` CLI to the project. For the last step you need a GitHub account.

## Create the project

Scaffold a project named `calculator`:

```bash
npm create prism-code calculator
```

```text
Creating calculator
  prism.toml         application calculator 0.1.0
  prism/spec.json    the spec, as JSON
  prismpm.lock       SDK image sha256:91ab…
Done. Next: cd calculator && prism build
```

`prism/spec.json` is the whole input. You edit this file, or have an agent write it; everything else is generated from it. It says what one request holds, what the app may answer, the rules in order, and what must never or always happen:

```json
{
  "purpose": "Decide whether a payment request is approved.",
  "fields": [
    {"name": "role", "kind": "choice", "values": ["clerk", "manager"]},
    {"name": "amount", "kind": "number", "min": 1, "max": 1000000},
    {"name": "limit", "kind": "number", "max": 1000000}
  ],
  "outcomes": ["approved", "refused"],
  "rules": [
    {"when": [{"field": "role", "op": "is", "value": "manager"}], "then": "approved"},
    {"when": [{"field": "amount", "op": "<=", "value": {"field": "limit"}}], "then": "approved"}
  ],
  "otherwise": "refused",
  "properties": [
    {"kind": "never",
     "when": [{"field": "role", "op": "is", "value": "clerk"},
              {"field": "amount", "op": ">", "value": {"field": "limit"}}],
     "then": "approved"}
  ],
  "examples": [{"request": "clerk 250 1000", "response": "approved"}]
}
```

Each entry in `properties` becomes a theorem Lean proves for every request. Each entry in `examples` becomes an acceptance vector the built application replays.

`prism.toml` names the application:

```toml
[application]
name = "calculator"
version = "0.1.0"
description = "Decides whether a payment is approved."
```

There is no `[capabilities]` table, and without one the holo is granted nothing.

## Build the holo

Build renders the LexLean model from `prism/spec.json` alone, proves every property inside the pinned SDK image, replays the examples and sentence, replays the example, and records provenance:

```bash
cd calculator
prism build
```

```text
Pulling SDK image sha256:91ab… (cached)
Rendering model from prism/spec.json  sha256:2414…
  model/  2 files written, digest sha256:7d2e…
Compiling model
Proving
  INV-001 never approved when role is clerk and amount is above limit   checked
Replaying examples
  clerk 250 1000  ok
Built calculator@sha256:3f9c… (holo, 24.8 KB)
Provenance: recorded   Proof: 2 theorems checked   Level: P2
```

The holo is `calculator@sha256:3f9c…`. The digest covers everything inside it, including the proof. Commit `prism/spec.json` with the rest of the project; `model/` is generated from it, and the same JSON always gives the same model. A model that is not what `prism/spec.json` renders to is refused at build.

## Check it

Check verifies the digest, the provenance, the proof, the lockfile pins and the declared world against the default policy. It prints a verdict with the assurance level:

```bash
prism check
```

```text
calculator@sha256:3f9c…
  digest        ok   matches
  provenance    ok   built from model sha256:7d2e… in SDK image sha256:91ab…
  proof         ok   2 theorems checked
  lockfile      ok   all pins match prismpm.lock
  replay        ok   1 history, 1 call, no divergence
  world         ok   imports none, exports calculate, within capability set
Verdict: PASS  Level: P3  (policy: default, requires P2)
```

Exit code 0 means pass, 1 means fail, 2 means the check could not be completed. P3 is the highest level: proof checked, every history replayed, capabilities within policy.

## Run it

Run calls `check` first and refuses to start unless it passes. Then it instantiates the holo with exactly the capability set from `prism.toml` and dispatches one input:

```bash
prism run calculator --input 'clerk 250 1000'
```

```text
Check: PASS  Level: P3
Instance calculator@sha256:3f9c…  capabilities: none
approved
History: 1 call recorded
```

Leave out `--input` and `run` reads inputs from standard input, one per line. The instance records every input and output. Later, `replay` can prove that a new build behaves the same on all of them.

## Deploy it

Deploy publishes the holo to a GitHub repository and serves it from GitHub Pages, with the attestations alongside:

```bash
prism deploy
```

```text
Publishing calculator@sha256:3f9c… to github.com/you/calculator
  holo           24.8 KB
  attestations   provenance, proof, replay
  pages          https://you.github.io/calculator/
Done.
```

Anyone with the link gets the same bytes and the same proof. They can check it offline in a browser with `@prism-code/verify` and see the verdict you saw.

## What you did

You wrote one JSON file. Prism rendered the model from it, proved every property for every request, and sealed the proof into a holo with a digest. `check` confirmed the proof before `run` started anything. `deploy` published holo and proof together. Every later build, pull and run starts from the same check.

## Next steps

- [Core concepts](/docs/get-started/core-concepts)
- [Write the spec](/docs/guides/write-from-examples)
- [Ship a holo](/docs/guides/ship)
