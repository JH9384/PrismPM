---
title: World and capabilities
description: Why a holo declares what it needs, and why it gets nothing until something grants it.
available_in: "0.6"
---

<Note>This page describes Prism 0.6, which has not shipped. [Release status](/reference/release-status) says what works today.</Note>

The world says what a holo needs from its host and what it offers back. The capability set says what it is allowed to touch. Together they decide what a running holo can reach.

## Why deny by default

A container starts with broad access and you take some away with flags. A holo starts with none. If a program can only reach what someone wrote down, then reading that list tells you everything it can reach, and the review stays short.

## The world

The world is the holo's contract with its host: its imports and its exports. It plays the part `ENTRYPOINT` and `EXPOSE` play for an image, with the difference that the imports are declared too. Calculator imports nothing and exports `calculate`, so it cannot call anything, whatever a host offers it.

## The capability set

A capability set grants access to three kinds of thing: outbound hosts, key-value stores and variables. Each set has allow and deny lists, and a deny entry always wins. Nothing is reachable until an entry allows it.

```toml
[capabilities]
allow-outbound-hosts = ["https://api.exchange.example"]
```

## How they meet

The two are checked against each other at different moments.

| When | What happens |
| --- | --- |
| `check` | Fails when the world imports more than the capability set allows. |
| `run` | Grants exactly the set, never more. |
| During a call | A call outside the set is refused and the instance sees an error. |

## Next steps

- [Run and gate](/guides/run-and-gate)
- [Manifest reference](/reference/manifest)
- [Provenance and attestations](/concepts/provenance-and-attestations)
