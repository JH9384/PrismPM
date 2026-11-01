---
title: Python SDK
description: Install prism-code from PyPI and run a holo from Python.
available_in: "1.1"
---
The `prism-code` package is the Python runtime. It exposes the same calls, errors and environment variables as the TypeScript runtime, as coroutines you run under `asyncio`.

Status: the `prism-code` Python package is not published. This page gains its install output, its code and its captured output when the package ships.

## Install

```bash
pip install prism-code
```

## What it exposes

- `load`, `inspect`, `verify`, `instantiate`, `dispatch`, `history` and `replay`, with the names the TypeScript runtime uses.
- `PrismError` as the base exception, and one subclass for each error the TypeScript runtime throws.
- `prism_code.FORMAT_REVISION`, the format revision the package accepts. It refuses a newer holo by name.

It passes `@prism-code/conformance` before release, like every runtime.

## Next steps

- [SDK overview](/docs/sdks/overview)
- [API reference](/docs/api)
- [Release status](/docs/reference/release-status)
