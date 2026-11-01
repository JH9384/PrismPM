---
title: Proof and assurance
description: What a proof adds to tests, how assurance levels measure evidence, and where the guarantee stops.
available_in: "0.5"
---

<Note>This page describes Prism 0.5, which has not shipped. [Release status](/reference/release-status) says what works today.</Note>

A test shows how a program behaves on the inputs you tried. A proof shows how it behaves on every input the types allow. Prism makes the proof part of the build, then uses assurance levels to say how much of that evidence a reader could confirm.

## Why levels

A holo either carries a piece of evidence or it does not, and a checker either confirms it or it cannot. A single pass or fail would hide that difference. So `check` computes a level from the evidence, and a separate policy decides whether that level is enough for you.

| Level | Name | What is confirmed |
| --- | --- | --- |
| P0 | unverified | The holo loaded and its digests match. Nothing more. |
| P1 | provenance | How and from what the holo was built. |
| P2 | proof checked | P1, plus every theorem checked against the holo. |
| P3 | proof, replay and world | P2, plus every history replays unchanged, plus the world is within policy. |

Each level includes the ones below it. A policy never changes the level: it only accepts or rejects it. The default policy asks for P2 or above.

## How to read a low level

A low level says evidence is missing, not that the program is wrong. The sample holo carries no statements, so it checks at P0, as [Check a holo](/examples/check-a-holo) shows, and it still replays every example it carries.

## Where the guarantee stops

A proof is exactly as strong as what it assumes.

- The proof checker and the SDK image are trusted, not proven. Pinning the image by digest says which ones you trusted.
- The intent sentences are yours. A proof shows they hold, not that they are the right sentences.
- The runtime enforces the capability set. The proof covers what the holo asks for, not what a host hands it.

[Audit a holo](/guides/audit) walks through these limits for the person who signs off.

## Next steps

- [World and capabilities](/concepts/world-and-capabilities)
- [Verify and inspect](/guides/verify-and-inspect)
- [Policy reference](/reference/policy)
