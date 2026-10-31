---
title: Provenance and attestations
description: How a holo records where it came from, and how a signature ties that record to someone.
available_in: "0.5"
---
Provenance is a record of how a holo was built. An attestation is a signed statement about a holo. Provenance answers "what made this", and the signature answers "who says so".

## Why statements live inside the holo

Docker keeps attestations beside an image, as separate objects in a registry. A holo carries its statements in its own attestation section, so they arrive with the file however it reached you. Registries still see them, because `push` also sends them as referrers.

## What provenance records

`build` writes a SLSA provenance statement into every holo, with no flag. Its subjects are the holo's content sections, and it names the SDK image and the inputs from the lockfile.

| Mode | Flag | What it adds | Reproducible |
| --- | --- | --- | --- |
| Minimum | the default, `--provenance=min` | Only what the lockfile and the model already say. | Yes: the same inputs write the same statement. |
| Maximum | `--provenance=max` | The build arguments, the platform, an invocation id and timestamps. | No, which is why it is opt-in. |

## What signing adds

A statement written at build is unsigned, so it says what happened and nothing vouches for it. `attest` signs it, keyless by default: the signature ties it to an identity from your OpenID Connect provider, such as a CI workflow, and a transparency log records it publicly. `verify` then checks the signature against the identity you expect, so you decide who to trust rather than whoever signed last.

## Next steps

- [Reproducible builds](/docs/concepts/reproducible-builds)
- [Attestations reference](/docs/reference/attestations)
- [Audit a holo](/docs/guides/audit)
