---
title: Manifest reference
description: Every table and key in prism.toml.
available_in: "0.6"
---

Source: `@prism-code/spec` 2026-10-23, `schemas/manifest/manifest-v1.schema.json`.

Status: experimental. prism-code reads and checks this manifest today (prism-code manifest); the prism CLI reads it from 0.6.

Schema: `https://schemas.uor.foundation/prism/manifest/1`, file `schemas/manifest/manifest-v1.schema.json`.

`prism.toml` is TOML. The tables below are the manifest after the overlay for the build target, `prism.browser.toml` or `prism.node.toml`, is merged in: a table merges key by key, and any other value, arrays included, replaces the one it overrides. An overlay may not set `manifest_version`.

## Top level

| Field              | Type   | Required | Constraint |
| ------------------ | ------ | -------- | ---------- |
| `manifest_version` | number | no       | = `1`      |

## `[application]`

| Field         | Type   | Required | Constraint                                                                                                                                                                                           |
| ------------- | ------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`        | string | yes      | matches `^[a-z][a-z0-9-]{0,62}$`                                                                                                                                                                     |
| `version`     | string | yes      | matches `^(0\|[1-9]\d*)\.(0\|[1-9]\d*)\.(0\|[1-9]\d*)(?:-((?:0\|[1-9]\d*\|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0\|[1-9]\d*\|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$` |
| `description` | string | no       |                                                                                                                                                                                                      |
| `authors`     | array  | no       | unique items                                                                                                                                                                                         |
| `authors[]`   | string | yes      | at least 1 character                                                                                                                                                                                 |

## `[model]`

| Field     | Type   | Required | Constraint           |
| --------- | ------ | -------- | -------------------- |
| `source`  | path   | no       | see path             |
| `build`   | string | no       | at least 1 character |
| `watch`   | array  | no       | unique items         |
| `watch[]` | path   | yes      | see path             |

Every path is relative to the project, uses forward slashes and has no `..` segment.

## `[capabilities]`

Without this table the holo is granted nothing. It takes one of two forms: a capability file and the set of it to apply, or the members of one `prism/capabilities/1` set written inline, which become its `default` set.

### A capability file

| Field  | Type   | Required | Constraint                  |
| ------ | ------ | -------- | --------------------------- |
| `file` | path   | yes      | see path                    |
| `set`  | string | no       | matches `^[a-z][a-z0-9-]*$` |

### Inline

| Field                      | Type   | Required | Constraint                                                                                                                                   |
| -------------------------- | ------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `allow-outbound-hosts`     | array  | no       | unique items                                                                                                                                 |
| `allow-outbound-hosts[]`   | string | yes      | matches `^([*]\|[a-z][a-z0-9+.-]*)://([*]\|([*][.])?[a-z0-9]([a-z0-9-]*[a-z0-9])?([.][a-z0-9]([a-z0-9-]*[a-z0-9])?)*)(:([*]\|[0-9]{1,5}))?$` |
| `deny-outbound-hosts`      | array  | no       | unique items                                                                                                                                 |
| `deny-outbound-hosts[]`    | string | yes      | matches `^([*]\|[a-z][a-z0-9+.-]*)://([*]\|([*][.])?[a-z0-9]([a-z0-9-]*[a-z0-9])?([.][a-z0-9]([a-z0-9-]*[a-z0-9])?)*)(:([*]\|[0-9]{1,5}))?$` |
| `allow-key-value-stores`   | array  | no       | unique items                                                                                                                                 |
| `allow-key-value-stores[]` | string | yes      | matches `^([*]\|[a-z0-9][a-z0-9_-]*)$`                                                                                                       |
| `deny-key-value-stores`    | array  | no       | unique items                                                                                                                                 |
| `deny-key-value-stores[]`  | string | yes      | matches `^([*]\|[a-z0-9][a-z0-9_-]*)$`                                                                                                       |
| `allow-variables`          | array  | no       | unique items                                                                                                                                 |
| `allow-variables[]`        | string | yes      | matches `^([*]\|[a-z][a-z0-9_]*)$`                                                                                                           |
| `deny-variables`           | array  | no       | unique items                                                                                                                                 |
| `deny-variables[]`         | string | yes      | matches `^([*]\|[a-z][a-z0-9_]*)$`                                                                                                           |
| `allow-providers`          | array  | no       | unique items                                                                                                                                 |
| `allow-providers[]`        | string | yes      | matches `^([*]\|[a-z][a-z0-9-]*)$`                                                                                                           |
| `deny-providers`           | array  | no       | unique items                                                                                                                                 |
| `deny-providers[]`         | string | yes      | matches `^([*]\|[a-z][a-z0-9-]*)$`                                                                                                           |

## Provider services

Any other table under `[capabilities]` declares a capability that a provider provisions, beside either form above. Its name matches `^[a-z][a-z0-9_]*$`, and `file` and `set` are reserved. A declaration grants nothing: the set must allow the provider's type, and must allow each variable before it is produced.

```toml
[capabilities]
allow-providers = ["kv"]
allow-variables = ["rates_url", "rates_store"]

[capabilities.rates]
provider = { type = "kv", options = { store = "rates", set = ["base=EUR"] } }
```

| Field     | Type   | Required | Constraint                  |
| --------- | ------ | -------- | --------------------------- |
| `type`    | string | yes      | matches `^[a-z][a-z0-9-]*$` |
| `options` | object | no       |                             |

An option key matches `^[a-z][a-z0-9_-]*$`. A value is a string, an integer, a boolean or an array of those. A string may hold no control character and may not be `env(NAME)`, because every process on the machine can read a command line. A provider reads its secrets from its own environment.

### The wire protocol

`prism-code providers up` finds `prism-provider-<type>` on the PATH the way a plugin is found, and runs it in the project directory with the caller's environment and stdin closed. `down` takes the same arguments and releases what `up` provisioned. `up` must be safe to run again.

```text
prism-provider-<type> --project-name <application> up   [--<option>=<value> ...] <name>
prism-provider-<type> --project-name <application> down [--<option>=<value> ...] <name>
```

Each option is one argument, sorted by option. An array repeats the flag. A provider replies on stdout with one JSON object per line, with exactly the members `type` and `message`. Exit 0 with no `error` message is success. Any other exit fails the call, and so does any other line. `PRISM_PROVIDER_MESSAGES` lists the accepted types. stderr is passed through and never parsed.

| Type     | Meaning                                                                                                                                             |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `info`   | Progress, printed on stderr.                                                                                                                        |
| `debug`  | Detail, given to the `onMessage` option of the API.                                                                                                 |
| `error`  | Why it failed. The call fails with this text, even on exit 0.                                                                                       |
| `setenv` | `VAR=value`, split at the first `=`. `VAR` matches `^[A-Z][A-Z0-9_]*$`. It becomes `<NAME>_<VAR>`, and the variable `<name>_<var>` must be allowed. |

| Failure                               | Error                   | Check                    |
| ------------------------------------- | ----------------------- | ------------------------ |
| The set does not allow the type       | `CapabilityDeniedError` | `capabilities.providers` |
| Not on the PATH                       | `ProviderNotFoundError` | `provider.not-found`     |
| A line that breaks the protocol       | `ProviderReplyError`    | `provider.reply`         |
| Two sources for one variable          | `ProviderReplyError`    | `provider.collision`     |
| A non-zero exit or an `error` message | `ProviderFailedError`   | `provider.failed`        |
| Would not start                       | `ProviderFailedError`   | `provider.spawn`         |
| Ran out of time                       | `ProviderFailedError`   | `provider.timeout`       |

A variable the set does not allow is withheld and reported by name. Today nothing inside a holo can read the result: the guest world imports nothing, and `prism-code run` does not read this manifest.

## `[variables]`

Each key is a variable name matching `^[a-z][a-z0-9_]*$`. Its value is a string, `env(NAME)` to read the environment at run time, or a table `{ value, secret }`. A secret takes its value from `env(NAME)`, or from the variable's name in upper case when it has no `value`. A secret written as a literal is an error, and so is any string shaped like a credential.

```toml
[variables]
log_level = "info"
region = "env(REGION)"
exchange_api_key = { secret = true }
signing_key = { value = "env(SIGNING_KEY)", secret = true }
```

## Next steps

- [Lockfile reference](/docs/reference/lockfile)
- [CLI reference](/docs/reference/cli)
- [Holo format](/docs/reference/holo-format)

Generated from @prism-code/spec 2026-10-23 at e84124f0fed01510843772ae11d8a3068cef47ea.
