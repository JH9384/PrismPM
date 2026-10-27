# Proposal 280: the `prism.toml` manifest

| | |
| --- | --- |
| Issue | [#280](https://github.com/UOR-Foundation/PrismPM/issues/280) |
| Milestone | M3 v0.6 Replay, capabilities, conformance |
| Status | Proposed, Experimental |
| Depends on | #279 (capability sets, `prism/capabilities/1`) |
| Used by | #281 (`prism init`), #282 (`prism run` gated on check), #288 (`prism dev`), #294 (provider services) |

## Summary

`prism.toml` is the project manifest: the application's name and version, where its model comes from, what it is granted and which variables it reads.
Its shape follows the Spin manifest: `[application]`, `[model]`, `[capabilities]`, `[variables]`.
A variable marked `secret = true` is read from the environment through `env(NAME)`; a secret written as a literal is a lint error, never a warning.
Per-target overlays, `prism.browser.toml` and `prism.node.toml`, are merged into the main manifest before it is checked.
This change ships the format (`prism/manifest/1`, a JSON Schema and types in `@prism-code/spec`), the reader in `prism-code`, a `prism-code manifest` verb, and the generated manifest reference page.

## Motivation

The docs already show `prism.toml` in the quickstart, the run guide and the model guide, with keys nothing reads (`allowed_outbound_hosts`, `stores`, `environment`).
#279 left the capability file with no default location and said #280 would name it.
`prism init` (#281) cannot scaffold a manifest that has no format, and `prism run` (#282) needs one place to find the grant.

### Goals

1. One format, `prism/manifest/1`, with a JSON Schema in `@prism-code/spec` and fixtures the runtime is tested against.
2. A grant that is the #279 format, unchanged: one capability set inline, or a capability file by path.
3. Secrets that cannot be committed by accident: a literal secret, or any string shaped like a credential, fails the read.
4. Overlays per target with one merge rule.
5. No dependency added to `prism-code`.

### Non-goals

- The Rust CLI reading the manifest. `prismpm` already reads `prismpm.toml` (`prismpm/project/1`), the SDK's own project file; how the two relate is unresolved question 1.
- `prism build --target`. The overlay is selected by the caller (`--target` on `prism-code manifest`, `target` in the API); the build verb arrives with #268's successors.
- Provider services (#294) and dependencies on other holos. They add tables; this version rejects unknown tables so they are added deliberately.
- The lock pinning the manifest's digest (#264 pins inputs; see unresolved question 3).

## Proposal

### The file

```toml
manifest_version = 1                 # optional; absent means 1

[application]
name = "exchange"                    # ^[a-z][a-z0-9-]{0,62}$
version = "0.1.0"                    # Semantic Versioning 2.0.0
description = "Converts currencies."
authors = ["Ada <ada@example.com>"]

[model]
source = "model"                     # paths: relative, forward slashes, no ..
build = "prism build"
watch = ["model/**/*.lex.tex", "examples/*.json", "intent.md"]

[capabilities]                       # one prism/capabilities/1 set, inline ...
allow-outbound-hosts = ["https://api.exchange.example"]
allow-key-value-stores = ["rates"]
allow-variables = ["log_level", "exchange_api_key"]
# ... or: file = "capabilities.json" and set = "online"

[variables]
log_level = "info"                               # a literal
region = "env(REGION)"                           # read at run time
exchange_api_key = { secret = true }             # reads EXCHANGE_API_KEY
signing_key = { value = "env(SIGNING_KEY)", secret = true }
```

- `application.name` and `application.version` are required; nothing else is.
- Any other table or key is rejected (`manifest.invalid`), as #279 rejects unknown members: a typo must fail, never grant less or more than meant.
- `[capabilities]` has two forms and never both. Inline members are the six `allow-`/`deny-` members of a #279 set and become its `default` set. `file` names a capability file relative to the project; `set` picks a set of it, `default` unless named. No table grants nothing.
- Variable names match `^[a-z][a-z0-9_]*$`, the pattern a capability set's `variables` entries use, so the set can name them.

### Secrets

A variable is a literal, `env(NAME)`, or a table `{ value, secret }`.
A secret's value is `env(NAME)`, or absent, in which case it reads the variable's name in upper case.
`resolveVariables(manifest, env)` returns name to value and throws `manifest.env` for an unset name, naming the variable and the environment name and never a value.

Two lint rules are errors (`manifest.secret`); neither message echoes the value it found:

| Rule | Fires on |
| --- | --- |
| `secret-literal` | a variable with `secret = true` whose value is not `env(NAME)` |
| `credential` | any string anywhere in the manifest shaped like a private key, a GitHub, AWS, Slack or Google token, or an `sk-` API key |

One rule is a warning: `variable-not-granted`, a declared variable the inline capability set does not allow, so the holo could never read it.

### Overlays

`prism.<target>.toml`, for target `browser` or `node`, is merged into `prism.toml` before validation: a table merges key by key, and any other value, arrays included, replaces the value it overrides.
Replacing arrays is what lets `allow-outbound-hosts = []` in `prism.browser.toml` take the browser build offline.
An overlay may not set `manifest_version`.
The merged manifest is validated and linted as one, so an overlay cannot smuggle in a literal secret.

### TOML

`prism-code` has no dependencies, so it carries a strict reader for the TOML subset a manifest uses: tables, dotted and quoted keys, the four string forms, decimal integers, booleans, arrays and inline tables.
It refuses, naming the line (`manifest.toml`): floats, dates and times, arrays of tables, hex/octal/binary integers, duplicate keys, a table defined twice, and the keys `__proto__`, `constructor` and `prototype`.
A manifest has none of those, and refusing them is what keeps the reader small enough to review.

### API and CLI

| Surface | What it does |
| --- | --- |
| `parseManifest(source, { target, overlay })` | Parse, merge, validate, lint; returns `{ manifest, target, warnings }`, deeply frozen. |
| `validateManifest`, `lintManifest`, `mergeOverlay` | The three steps on their own. |
| `manifestCapabilities(manifest)` | `{ capabilities, capabilitySet, file }`, the options `load` and `fromFile` take. |
| `resolveVariables(manifest, env)` | Variable values, `env(NAME)` resolved. |
| `parseToml(source)` | The TOML reader. |
| `readManifest(dir, { target })` (`prism-code/node`) | Reads `prism.toml`, the overlay when it exists, and a named capability file; returns the above plus `files` and `grant`. |
| `prism-code manifest [<dir>] [--target browser\|node] [--json]` | Prints the application, the grant and the variables (secrets flagged, never shown); exit 2 on any failure, 64 on usage. |

## Test plan

- `sdk/npm/spec`: `schemas/manifest/manifest-v1.schema.json` with three valid fixtures (minimal, inline capabilities, capability file) and eight invalid ones (no application, a bad version, a secret literal, an unknown table, file plus inline members, a path with `..`, an upper-case variable name, `set` without `file`). The package's own fixture rule runs them.
- `sdk/npm/prism-code/test/manifest.test.mjs`: the TOML subset and each refusal with its line; every table; the secret and credential errors with no echo; `env(NAME)` resolution and the unset error; the warning; the overlay merge and its checks; the schema's fixtures run through `validateManifest` and `lintManifest`, so code and schema cannot drift; `readManifest` with and without an overlay and with a capability file; the CLI's output, `--json`, `--target` and exit codes.

## Graduation criteria

- Experimental (M3): the format, the schema, the reader and `prism-code manifest` are merged.
- Frozen (M3 freeze): #281, #282 and #288 read the manifest with no change to it, and the Rust CLI reads the same file.
- Stable (1.0): `prism/manifest/1`, the `manifest.*` codes and the overlay rule are final.

## Precedent

- Spin manifest v2: `[application]`, `[variables]` with `secret = true` and `required`, `allowed_outbound_hosts`, `key_value_stores`.
- Supabase `env()` substitution in `config.toml`; Prisma `env("...")`, which throws when the variable is undefined.
- Tauri `tauri.<platform>.conf.json`, merged over `tauri.conf.json` with JSON Merge Patch (objects merge, arrays replace).

## Alternatives

- A full TOML library. Adds the first dependency to `prism-code`, and a manifest needs a fraction of TOML.
- Spin's key names (`allowed_outbound_hosts`). The grant would then have two spellings, one in the manifest and one in the capability file; #279's names keep one.
- A literal secret as a warning. The issue asks for an error, and a warning is how secrets get committed.
- Arrays that concatenate in overlays. An overlay could then only add hosts, never take a build offline.

## Unresolved questions

1. `prismpm.toml` (`prismpm/project/1`) is the SDK's project file today. Should `prism.toml` absorb it, sit beside it, or should the Rust CLI read `prism.toml` and generate the other? This belongs to afflom.
2. Should `required = true` (Spin) be added for non-secret variables that must come from the environment, or is `env(NAME)` enough?
3. Should the lock (#264) pin the manifest's digest, as it pins the world's?
4. Should the `manifest.*` codes get `PP` diagnostics in `model/errors.toml` once the Rust CLI reads the file?
