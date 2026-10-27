---
title: Quickstart
description: Scaffold, build, check, run and deploy your first holo in five minutes.
available_in: "1.0-beta"
---
In five minutes you create a calculator from one example and two sentences, build it into a holo, check its proof, run it, and publish it to GitHub Pages. Every command below is one you will use every day.

## Before you start

You need Node.js 22 or later and Docker. Docker runs the toolchain image, so you never install the compiler yourself. The scaffolder adds the `prism` CLI to the project. For the last step you need a GitHub account.

## Create the project

Scaffold a project named `calculator`:

```bash
npm create prism-code calculator
```

```text
Creating calculator
  prism.toml         application calculator 0.1.0
  examples/add.json  one example
  intent.md          two sentences
  prismpm.lock       toolchain image sha256:91ab…
Done. Next: cd calculator && prism build
```

The project holds three files you edit. Open them and make them read as follows.

`examples/add.json` is one input and its expected output:

```json
{"input": {"op": "add", "a": 2, "b": 3}, "output": 5}
```

`intent.md` is one sentence per line. Each sentence becomes a theorem:

```md
add is commutative.
The result never exceeds 32 bits.
```

`prism.toml` names the application:

```toml
[application]
name = "calculator"
version = "0.1.0"
description = "Adds two numbers."
```

There is no `[capabilities]` table, and without one the holo is granted nothing.

## Build the holo

Build compiles the model into a holo inside the pinned toolchain image. It writes the model from your examples and intent, proves each sentence, replays the example, and records provenance:

```bash
cd calculator
prism build
```

```text
Pulling toolchain image sha256:91ab… (cached)
Generating model from examples/ and intent.md
  model/  2 files written, digest sha256:7d2e…
Compiling model
Proving
  add is commutative.                 checked
  The result never exceeds 32 bits.   checked
Replaying examples
  add.json  ok
Built calculator@sha256:3f9c… (holo, 24.8 KB)
Provenance: recorded   Proof: 2 theorems checked   Level: P2
```

The holo is `calculator@sha256:3f9c…`. The digest covers everything inside it, including the proof. Commit `model/` with the rest of the project. The lockfile pins its digest.

## Check it

Check verifies the digest, the provenance, the proof, the lockfile pins and the declared world against the default policy. It prints a verdict with the assurance level:

```bash
prism check
```

```text
calculator@sha256:3f9c…
  digest        ok   matches
  provenance    ok   built from model sha256:7d2e… in toolchain image sha256:91ab…
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
prism run calculator --input '{"op": "add", "a": 2, "b": 3}'
```

```text
Check: PASS  Level: P3
Instance calculator@sha256:3f9c…  capabilities: none
5
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

You wrote one example and two sentences. Prism wrote the model, proved both sentences for every input, and sealed the proof into a holo with a digest. `check` confirmed the proof before `run` started anything. `deploy` published holo and proof together. Every later build, pull and run starts from the same check.

## Next steps

- [Core concepts](/docs/get-started/core-concepts)
- [Write from examples](/docs/guides/write-from-examples)
- [Ship a holo](/docs/guides/ship)
