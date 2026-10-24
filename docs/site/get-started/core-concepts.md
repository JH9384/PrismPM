---
title: Core concepts
description: The seven ideas behind every Prism command, each with one example.
available_in: "1.0-beta"
---
This page gives you the vocabulary the rest of the docs use. Each section defines one idea and shows it on the calculator application from the quickstart.

## Model

The model is the source of your application. It is what `build` reads. For calculator it is three things: the examples, the intent, and the model files that `build` generates from them into `model/`.

An example is one input and its expected output:

```json
{"input": {"op": "add", "a": 2, "b": 3}, "output": 5}
```

An intent sentence is something the application must always or never do. `intent.md` holds one per line. Each becomes a theorem that `build` must prove before it writes a holo.

## Holo

A holo is an image that carries its own proof. It is one file, `calculator.holo`, addressed by name or digest:

```text
calculator@sha256:3f9c…
```

Inside are the application manifest, the model document, the provenance, the capability set, the program as WebAssembly, a portable view for the browser, and an attestation bundle. Each part has its own sha256 and BLAKE3 digest, and the last 32 bytes of the file are the BLAKE3 of everything before them. The holo's digest covers all of it. The same model built in the same toolchain image gives the same digest, every time. [Holo format](/docs/reference/holo-format) has the byte layout.

## Check

Check is the verification step. It verifies five things: the digest, the provenance, the proof, the lockfile pins, and the declared world against policy. It prints a verdict with an assurance level and reasons:

```text
Verdict: PASS  Level: P3
```

Exit code 0 means pass, 1 means fail, 2 means the check could not be completed. `run` calls `check` first and refuses to start on anything but 0.

## Assurance levels

The level says how much `check` could confirm.

| Level | Name | What is confirmed |
|---|---|---|
| P0 | unverified | Nothing. The holo loaded, that is all. |
| P1 | provenance | How and from what the holo was built. |
| P2 | proof checked | P1, plus every theorem checked against the holo. |
| P3 | proof plus replay plus capabilities | P2, plus every history replays unchanged, plus the world is within policy. |

The default policy requires P2 or above and a world within the granted capabilities.

## Capability set and world

The world is the holo's declared contract: what it imports from the host and what it exports. Calculator imports nothing and exports `calculate`.

The capability set is what a holo may touch: hosts, stores, variables. You declare it in `prism.toml`. Deny is the default, so an empty set means the holo talks to nothing:

```toml
[capabilities]
allowed_outbound_hosts = []
```

`check` fails when the world imports more than the capability set allows. `run` grants exactly the set, never more.

## History and replay

A history is the recorded inputs and outputs of an instance. Your examples become the holo's first history. Every run records another. `replay` re-executes a history against the current build and fails on any divergence:

```bash
prism replay examples/
```

```text
Replaying 1 history against calculator@sha256:3f9c…
  add.json  1 call  ok
Replay: PASS  no divergence
```

A build that replays every history gets the replay attestation that P3 needs.

## Registry

A registry is any OCI-compatible registry. A holo pushes there with its attestations attached as referrers, and pulls back with them:

```text
ghcr.io/you/calculator@sha256:3f9c…
```

The digest is the same in the registry, on disk and in `check`. A pull that does not match it fails.

## Next steps

- [Write from examples](/docs/guides/write-from-examples)
- [Verify and inspect](/docs/guides/verify-and-inspect)
- [Run and gate](/docs/guides/run-and-gate)
