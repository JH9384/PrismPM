---
title: Audit a holo
description: Read the security view of a holo, export the report, and know exactly what the proof covers.
available_in: "1.0-beta"
---
This guide is for the person who signs off on what runs. You get the security view of a holo in one command, a report to file, a signature to verify, and a plain statement of what the proof does and does not cover.

## What you are auditing

A holo is one file. It carries its manifest, its model, its program and an attestation bundle, under one digest. The same bundle rides with the holo in every registry, so what you audit on your machine is what runs in production.

## Print the security view

`inspect --audit` prints everything that bears on trust and nothing that does not. It never runs the holo:

```bash
prism inspect calculator@sha256:3f9c… --audit
```

```text
calculator@sha256:3f9c…   format revision {{FORMAT_REVISION}}
Built         2026-10-23T10:12:44Z in SDK image sha256:91ab…
Source        model sha256:7d2e…  lockfile pins match
Signed        keyless  identity https://github.com/you/calculator/.github/workflows/release.yml@refs/tags/v0.1.0
              issuer https://token.actions.githubusercontent.com
              transparency log entry 1184…  signed timestamp 2026-10-23T10:12:51Z
Proof         2 theorems checked
              add is commutative.
              The result never exceeds 32 bits.
Replay        1 history, 1 call, no divergence
World         imports none   exports calculate
Capabilities  hosts none   stores none   environment none
Level         P3
```

Read it in three passes. Who built it and from what: Built, Source, Signed. What was proved: Proof and Replay, with every intent sentence spelled out. What it can reach: World and Capabilities.

## Export the report

The same view exports as one JSON document, suitable for filing or for a ticket:

```bash
prism inspect calculator@sha256:3f9c… --audit --report calculator-audit.json
```

```json
{"ref": "calculator@sha256:3f9c…", "level": "P3", "built": {"toolchain": "sha256:91ab…", "at": "2026-10-23T10:12:44Z"}, "proof": {"theorems": 2, "checked": 2, "sentences": ["add is commutative.", "The result never exceeds 32 bits."]}, "world": {"imports": [], "exports": ["calculate"]}, "capabilities": {"hosts": [], "stores": [], "environment": []}}
```

The report comes from the holo, not from the build machine. Anyone with the same digest produces the same report.

## Verify the signature

The attestations are signed keyless by default, with a transparency log entry and a signed timestamp. `verify` checks the signature against the identity you expect:

```bash
prism verify calculator@sha256:3f9c… --certificate-identity https://github.com/you/calculator/.github/workflows/release.yml@refs/tags/v0.1.0 --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

```text
Verified 3 attestations on calculator@sha256:3f9c…
  provenance  signed by the expected identity, log entry 1184…
  proof       signed by the expected identity
  replay      signed by the expected identity
```

For an air-gapped site, sign with `attest --key` and verify with `verify --key`. The holo format is the same.

## What the proof covers

The proof is machine-checked evidence, produced at build and checked at `check`, of three things.

- The program in the holo is the compiled model. Not a similar one, this one.
- Every intent sentence holds for every input the types allow. Not for the examples, for all of them.
- Every recorded history replays on this build without divergence.

If any of the three fails, there is no P2 or P3 and `run` does not start.

## What the proof does not cover

- The proof checker, which is the Lean 4 kernel, and the SDK image are trusted, not proven. The compiler and the provers run in a pinned SDK image whose digest is in the lockfile. Their correctness is assumed. Pin the digest and review what is in the SDK image.
- The intent sentences are yours. The proof shows the sentences hold. It does not show that the sentences are the right ones. An audit reads every sentence and asks what is missing.
- The host enforces the capability set. The proof covers what the holo asks for. The runtime decides what it gets. Use a runtime that passes `@prism-code/conformance`.
- Anything beyond the world is outside the proof. A host you allowed can return anything. The proof says what the holo does with it, not what it is.

A holo at P3 matches its stated intent, was built by a known toolchain, and is signed by a known identity. That is the statement. It says nothing about the toolchain, the host or the intent itself.

## Next steps

- [Verify and inspect](/docs/guides/verify-and-inspect)
- [Attestations reference](/docs/reference/attestations)
- [Policy reference](/docs/reference/policy)
