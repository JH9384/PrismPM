---
title: Rust SDK
description: Add the prism-code crate and run a holo from Rust.
available_in: "1.0-beta"
---

<Note>This page describes Prism 1.0-beta.1, which has not shipped. [Release status](/reference/release-status) says what works today.</Note>

The `prism-code` crate is the Rust runtime. It exposes the same calls, errors and environment variables as the TypeScript runtime, and it is async.

Status: the `prism-code` crate is not published. This page gains its install output, its code and its captured output when the crate ships.

## Install

```bash
cargo add prism-code
```

## What it exposes

- `load`, `inspect`, `verify`, `instantiate`, `dispatch`, `history` and `replay`, with the names the TypeScript runtime uses.
- `PrismError` and one case for each error the TypeScript runtime throws: verification, proof mismatch, capability denied, determinism violation and replay.
- `prism_code::FORMAT_REVISION`, the format revision the crate accepts. It refuses a newer holo by name.

It passes `@prism-code/conformance` before release, like every runtime.

## Next steps

- [SDK overview](/sdks/overview)
- [API reference](/api)
- [Release status](/reference/release-status)
