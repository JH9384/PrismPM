---
title: The holo
description: Why a Prism application is one self-describing file, and what that file holds.
available_in: "0.2.0"
---
A holo is the built form of a Prism application. It plays the part an image plays in Docker: you build it once, address it by digest, and run the same bytes everywhere.

## Why one file

A container image is a set of layers and a manifest, and a registry holds them together. A holo keeps everything in one file, for two reasons. The evidence about a build cannot be separated from the build, because it travels inside it. And anything that can read a file can check it, including a browser with no network.

## What is inside

A holo is a table of sections followed by their bytes. Each section has one job.

| Section | What it holds |
| --- | --- |
| `app-manifest` | The entry point and the digests of the program, the view and the capability set. |
| `source-manifest` | What the holo was built from. |
| `application-directory` | An index of the application. |
| `model-provenance` | What ties the model to what was built. |
| `guest` | The program, as WebAssembly. |
| `view` | The interface a browser shows. |
| `capability-set` | What the holo may touch. |
| `model-document` | The model in its canonical form, `model.prism.json`. |

[Inspect a holo](/docs/examples/inspect-a-holo) prints these sections from a real file, and [Holo format](/docs/reference/holo-format) gives the byte layout.

## How a digest covers it

Each content section has its own digest, as a layer has in an image. The last 32 bytes of the file are a BLAKE3 digest of every byte before them, which plays the part of the image digest. Changing one byte anywhere changes that footer, so a file that does not match its digest is refused when it loads.

## Next steps

- [Proof and assurance](/docs/concepts/proof-and-assurance)
- [Registries and releases](/docs/concepts/registries-and-releases)
- [Holo format](/docs/reference/holo-format)
