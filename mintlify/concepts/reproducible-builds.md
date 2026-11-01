---
title: Reproducible builds
description: How the SDK image and the lockfile make the same inputs produce the same holo.
available_in: "0.5"
---

<Note>This page describes Prism 0.5, which has not shipped. [Release status](/reference/release-status) says what works today.</Note>

A reproducible build means anyone with your inputs gets your bytes. Prism gets there by pinning everything a build reads, and running the build in one fixed place.

## Why it matters

A digest only identifies a build. Reproducibility lets a second person confirm it: they rebuild from your source, compare digests, and need not trust the machine that built the first copy.

## The SDK image

The compiler and the provers run in the SDK image, a Linux image for `linux/amd64` and `linux/arm64`, pulled by digest. It plays the part of a base image pinned with `FROM image@sha256:...`. Nothing on your machine takes part beyond Docker, so your local tools cannot change the result.

## The lockfile

`prismpm.lock` names the SDK image by digest and pins the other inputs of the build. Commit it with your source. Two rules keep it honest:

- `lock` writes pins for what the project already uses, and leaves pins that still resolve as they are.
- `update` is the only verb that moves a pin forward, and it prints the old and new digests.

So a pin never moves as a side effect of a build, and every change to one shows in a diff.

## What can still differ

Maximum provenance adds timestamps and an invocation id, so it gives up identical statements by design. Minimum provenance, the default, stays reproducible. [Rebuild and update](/guides/rebuild-and-update) shows the commands.

## Next steps

- [Rebuild and update](/guides/rebuild-and-update)
- [Lockfile reference](/reference/lockfile)
- [Registries and releases](/concepts/registries-and-releases)
