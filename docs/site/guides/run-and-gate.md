---
title: Run and gate
description: Run a checked holo with exactly its capability set, and decide what happens when the check fails.
available_in: "0.6"
---
This guide shows you how `run` gates on `check`, how to declare what a holo may touch, how to set it per target, and what the one escape hatch costs.

## The gate

`run` never starts an instance it has not checked. It runs `check` at the policy's level first. On exit code 0 it instantiates the holo and grants exactly the capability set. On 1 or 2 it stops and prints the verdict. Pass a stricter policy the same way you do for `check`:

```bash
prism run calculator --input '{"op": "add", "a": 2, "b": 3}' --policy policy
```

```text
Check: PASS  Level: P3  (policy: policy)
Instance calculator@sha256:3f9c…  capabilities: none
5
History: 1 call recorded
```

The runtime API does the same. `holo.instantiate(capabilities)` throws `VerificationError` when the check fails, so there is no path to a running instance that skips it.

## Declare the capability set

The capability set lives in `prism.toml`. It names the hosts, stores and variables the holo may touch. Deny is the default. Calculator touches nothing, so it has no `[capabilities]` table. Here is a version that fetches exchange rates and keeps a cache:

```toml
[capabilities]
allow-outbound-hosts = ["https://api.exchange.example"]
allow-key-value-stores = ["rates"]
allow-variables = ["log_level", "exchange_api_key"]

[variables]
log_level = "info"
exchange_api_key = { secret = true }
```

A variable with `secret = true` resolves from the environment at run time: `exchange_api_key` reads `EXCHANGE_API_KEY`, and `{ value = "env(NAME)", secret = true }` reads `NAME`. An unset name is an error. A secret written as a literal is rejected when the manifest is read, and so is any string shaped like a credential. The secret never enters the holo and never enters the history. Instead of listing the set inline, `file = "capabilities.json"` and `set = "<name>"` name a capability file.

`check` compares the holo's world against this set. A world that imports a host, a store or a variable the set does not name fails the check. The instance can only touch what both the world and the set agree on.

## Set it per target

An overlay file changes `prism.toml` for one target. `prism.browser.toml` applies when the holo runs in a browser, `prism.node.toml` when it runs in Node.js. Pick the overlay at build time with `--target`:

```toml
# prism.browser.toml
[capabilities]
allow-outbound-hosts = []
allow-key-value-stores = []
```

```bash
prism build --target browser
```

With this overlay the browser build of the exchange-rate calculator fetches nothing and keeps no cache. The holo digest changes, because the manifest section is part of it. A table in the overlay merges into the main manifest key by key, and an array replaces the array it overrides, so `allow-variables` stays as `prism.toml` set it. The [Manifest reference](/docs/reference/manifest) has every key.

## When a call leaves the set

The capability set is enforced at every call, not only at `check`. An instance that reaches for a host outside the set gets `CapabilityDeniedError` and the call does not happen:

```text
CapabilityDeniedError: outbound host api.other.example is not in the capability set of calculator@sha256:3f9c…
```

The denied call is still recorded in the history, so `replay` sees it.

## Run unverified

`--allow-unverified` runs a holo whose check failed or could not finish. Use it to debug a build on your own machine. It prints a warning you cannot silence:

```bash
prism run calculator --input '{"op": "add", "a": 2, "b": 3}' --allow-unverified
```

```text
Check: FAIL  Level: P1  proof does not match holo
WARNING: running unverified. Nothing this instance does is covered by the proof.
Instance calculator@sha256:5e07…  capabilities: none
5
History: 1 call recorded (unverified)
```

The history is marked unverified and `replay` refuses it as evidence. Never pass the flag in CI or in production. If a holo fails `check`, fix the holo.

## Next steps

- [Ship a holo](/docs/guides/ship)
- [Verify and inspect](/docs/guides/verify-and-inspect)
- [Manifest reference](/docs/reference/manifest)
