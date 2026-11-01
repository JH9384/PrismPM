---
title: What Prism is
description: Prism explained in Docker terms, with every noun and verb side by side.
available_in: "1.0-beta"
---

<Note>This page describes Prism 1.0-beta.1, which has not shipped. [Release status](/reference/release-status) says what works today.</Note>

This page tells you what Prism is and maps each Prism noun and verb to the Docker one you already know. Read it once. After that, every command in these docs should feel familiar.

## Why

Software should prove what it does. Tests show how a program behaves on the inputs you tried. A proof shows how it behaves on every input. Prism makes the proof part of the build. You write examples and plain sentences of intent. `build` turns them into a holo: an image that carries its own proof. `check` reads that proof before anything runs. A holo whose proof is missing or wrong does not run.

That is the whole idea. Everything else is Docker with one extra verb.

## Nouns

| Prism noun | Docker noun | What it is |
|---|---|---|
| model | Dockerfile | The source of your application: examples, intent, types, and the model files that `build` generates or you write. |
| holo | image | The built, content-addressed application. One file, addressed by name or digest, with its proof inside. |
| digest | image digest | The content hash of a holo. Every digest is a sha256 and a BLAKE3 over the same bytes, so Docker tools find the sha256. |
| SDK image | base image | The pinned image the compiler and the provers run in. `build` pulls it by digest and uses nothing on your machine. |
| lockfile | pinned FROM digest | `prismpm.lock`. Pins the SDK image, the model digest and every input. |
| instance | container | A loaded, checked, running holo. |
| registry | registry | Any OCI-compatible registry. Holos push and pull like images. Attestations ride along as referrers. |
| `prism.toml` | none | The manifest: name, model source, capability set, variables. Docker splits these across the Dockerfile and run flags. |

## Verbs

| Prism verb | Docker verb | What it does |
|---|---|---|
| `prism build` | `docker build` | Compiles the model into a holo inside the SDK image. Records provenance and the proof. |
| `prism check` | none | Verifies digest, provenance, proof, lockfile pins and world against a policy. Prints the assurance level. |
| `prism run` | `docker run` | Instantiates the holo after `check` passes, with exactly its capability set. |
| `prism push` | `docker push` | Sends the holo and its attestations to a registry. |
| `prism pull` | `docker pull` | Fetches a holo and its attestations from a registry. |
| `prism deploy` | `docker compose up`, or none | Publishes the holo to a GitHub repository and GitHub Pages, with the attestations served alongside. |

## What has no Docker equivalent

Three ideas are new. Each gets one section in [Core concepts](/get-started/core-concepts).

- Proof. Every intent sentence becomes a theorem. `build` proves it, or fails and names the sentence.
- Assurance level. `check` reports P0 to P3. P0 is unverified. P3 is proof plus replay plus capabilities within policy.
- Capability set. A holo touches only the hosts, stores and variables its manifest allows. Deny is the default.

## What stays the same

A holo is one file with a digest. You build it once and run the same bytes everywhere: in Node.js, in a browser, in Rust, in Python, or served by Docker. You push it to the registry you already use. You pin it in a lockfile the way you pin any dependency. Nothing about your registry, your CI or your deployment target has to change.

## Next steps

- [Quickstart](/get-started/quickstart)
- [Core concepts](/get-started/core-concepts)
- [Write from examples](/guides/write-from-examples)
