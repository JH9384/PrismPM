---
title: Registries and releases
description: Why holos use the registries you already run, and how a digest keeps them honest there.
available_in: "1.0-beta"
---
A registry stores and serves holos. Prism has no registry of its own: it uses any registry that speaks the OCI Image and Distribution 1.1 specifications, the one you already use for images.

## Why not a new registry

A new registry would mean new credentials, new access rules and new scanning to set up. A holo travels as an OCI artifact, so your existing registry, its permissions and its retention rules apply as they are.

## What moves

`push` sends the holo and sends its attestations as referrers, so tools that already look up a sha256 digest discover them. `pull` brings both back. A pull that does not match the digest you asked for fails.

Pull by digest when you need exact bytes, and by tag when you want whatever is current. Tags can move, and digests cannot.

## Product releases

A holo is one application. A product release is the root artifact that ties a whole release together: it references the holo, packages, locks and evidence by digest. It plays the part an image index plays in Docker, and it gives you one digest to name what you shipped.

## Next steps

- [Ship a holo](/docs/guides/ship)
- [The holo](/docs/concepts/holo)
- [Reproducible builds](/docs/concepts/reproducible-builds)
