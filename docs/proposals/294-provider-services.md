# Proposal 294: provider services in `prism.toml`

| | |
| --- | --- |
| Issue | [#294](https://github.com/UOR-Foundation/PrismPM/issues/294) |
| Milestone | M4 v1.0-beta.1 Freeze, ship, docs |
| Status | Proposed, Experimental |
| Depends on | #280 (`prism.toml`), #293 (CLI plugins), #279 (capability sets) |

## Summary

A capability in `prism.toml` can name a provider: an executable that provisions something the holo needs and says how to reach it.
Prism runs `prism-provider-<type>` from the PATH with the options as flags, reads key/values from its stdout, and produces them as `<NAME>_<VAR>` environment variables.
The design is Docker Compose provider services (v2.36.0, 2025-07), narrowed where Compose's protocol does more than a deny-by-default grant should allow.
This change ships the manifest shape, the wire protocol, the resolver in `prism-code/node`, a `prism-code providers` verb, and a reference provider, `prism-provider-kv`, a local key-value store.

## Motivation

A holo that needs a database or a key-value store has no way to say so today.
Someone provisions the store by hand and copies its address into the environment, so the manifest does not describe what the application needs.
Compose solved this without building any provider into the tool: the tool knows one small protocol, and anyone can ship a binary that speaks it.

### Goals

1. One declaration in `prism.toml`, under `[capabilities]`, because a provider is something the application is granted.
2. A protocol small enough to implement in a shell script.
3. Nothing runs and nothing reaches the holo unless the capability set allows it.
4. Failures a caller can branch on, and error messages that never echo a value a provider returned.
5. No dependency added to `prism-code`.

### Non-goals

- Runtime middleware (#295).
- `prism-code run` reading `prism.toml`. It does not read the manifest today, and this change does not make it. See [Where the environment goes](#where-the-environment-goes).
- Compose's `depends_on`, `metadata`, `stop`, `pull`, `rawsetenv`, `publish-endpoint` and its stdin requests. The verbs `metadata`, `stop` and `pull` are reserved for later.
- The Rust CLI running providers. It does not read `prism.toml` yet (#280).

## Proposal

### The manifest

```toml
[capabilities]
allow-providers = ["kv"]
allow-variables = ["rates_url", "rates_store"]

[capabilities.rates]
provider = { type = "kv", options = { store = "rates", set = ["base=EUR", "quote=USD"] } }
```

- Each table under `[capabilities]` that is not a member of the set declares one capability. Its key is the capability's name, and `provider` is its only member.
- A name matches `^[a-z][a-z0-9_]*$`, and `file` and `set` are reserved. A name has no hyphen, so a misspelt `alow-variables` is still rejected and every name maps to one environment prefix.
- `type` matches `^[a-z][a-z0-9-]*$`, the rule #293 uses for plugin names.
- `options` is optional. A key matches `^[a-z][a-z0-9_-]*$`. A value is a string, an integer, a boolean, or an array of those.
- A string option may not hold a control character, because `cmd.exe` would end the command line at a newline. It may not be `env(NAME)` either: a command line is visible to every process on the machine, so a provider reads its secrets from its own environment. The `credential` lint of #280 covers options like any other string.
- Declarations sit beside either form of `[capabilities]`, an inline set or a capability file.
- Overlays need no new rule. `options` merges key by key, and `deny-providers = ["*"]` in `prism.browser.toml` turns providers off for that target.

### The invocation protocol

Prism looks up `prism-provider-<type>` exactly as #293 looks up a plugin: the first PATH directory wins, and Windows resolves by `PATHEXT` and quotes `.cmd` arguments so npm shims work.

```text
prism-provider-<type> --project-name <application> up   [--<option>=<value> ...] <name>
prism-provider-<type> --project-name <application> down [--<option>=<value> ...] <name>
```

| Part | Rule |
| --- | --- |
| `<application>` | `application.name` from the manifest. It sits before the verb so that no option can collide with it. |
| `--<option>=<value>` | Always one argument, sorted by option. An array repeats the flag, an empty array passes none, and a boolean is `true` or `false`. |
| `<name>` | The capability's name. |
| Working directory | The project directory, the one holding `prism.toml`. |
| Environment | The caller's, plus `PRISM_PROVIDER_MESSAGES`, the accepted message types separated by commas. |
| stdin | Closed. |
| stderr | Passed through for people, never parsed. |

`up` provisions what the capability needs and is idempotent, because running it again is how a caller recovers from a partial failure.
`down` releases it, gets the same options, and succeeds when there is nothing to release.
A provider exits with a non-zero code on a verb it does not know.

A provider replies on stdout with JSON Lines, one object per line with exactly the members `type` and `message`, both strings:

```json
{"type":"info","message":"created store rates"}
{"type":"setenv","message":"URL=file:///home/ada/exchange/.prism/kv/exchange/rates.json"}
{"type":"setenv","message":"STORE=rates"}
```

| `type` | Meaning |
| --- | --- |
| `info` | Progress. `prism-code providers` prints it on stderr. |
| `debug` | Detail. Given to the API's `onMessage`; the CLI does not print it. |
| `error` | Why it failed. The call fails with this text, even if the provider then exits 0. |
| `setenv` | `VAR=value`, split at the first `=`. `VAR` matches `^[A-Z][A-Z0-9_]*$`, and the value may hold anything but NUL. It becomes `<NAME>_<VAR>`. A repeated `VAR` takes the last value. `down` ignores it. |

Any other line fails the call, blank lines aside: invalid UTF-8, a line that is not JSON, an unknown type, or an extra member.
Compose also fails on an unknown type, and it publishes the accepted list the same way, so a provider can check before sending a newer message.
A reply is capped at 1 MiB, and a call at 120 seconds unless the caller passes `timeoutMs`.

A provider's reply may hold secrets, so no error message quotes a reply line.
The one exception is the text of an `error` message, which the provider wrote to be read.

### Exit codes and errors

Exit 0 means success when no `error` message was sent; anything else is a failure.
Every failure is a `ProviderError`, which is a `PrismError`:

| Failure | Class, `code` | `check` |
| --- | --- | --- |
| The grant does not allow the type | `CapabilityDeniedError`, `capability_denied` | `capabilities.providers` |
| No `prism-provider-<type>` on the PATH | `ProviderNotFoundError`, `provider_not_found` | `provider.not-found` |
| A line that breaks the protocol, or an oversized reply | `ProviderReplyError`, `provider_reply_invalid` | `provider.reply` |
| Two sources for one variable | `ProviderReplyError`, `provider_reply_invalid` | `provider.collision` |
| A non-zero exit, a signal, or an `error` message | `ProviderFailedError`, `provider_failed` | `provider.failed` |
| The executable would not start | `ProviderFailedError`, `provider_failed` | `provider.spawn` |
| The timeout passed | `ProviderFailedError`, `provider_failed` | `provider.timeout` |

`CapabilityDeniedError` is the class #279 already throws for a denied resource, so it is not a `ProviderError`.
`prism-code providers` exits 2 on all of these, the code it already uses for a refused artifact.

### Deny by default

A capability set bounds what a holo can reach. A provider is a program that runs as the user, outside the holo, so the set bounds it at two points.

1. **Running the provider.** A new capability kind, `providers`, adds `allow-providers` and `deny-providers` to `prism/capabilities/1`. An entry is a provider type or `*`. A declaration alone grants nothing: without an allow entry that matches, the provider never starts and the call throws `CapabilityDeniedError`.
2. **Reaching the holo.** A returned `RATES_URL` is the variable `rates_url`, and it is produced only when the `variables` kind allows that name. Otherwise it is withheld and reported by name, never by value.

Withholding is a warning, not an error, for the same reason the `variable-not-granted` lint of #280 is a warning: the holo simply cannot read it, and a provider may return more than this application uses.
A secret a provider returns therefore stays out of the environment until someone names it.

Three more rules keep the grant meaningful:

- All declarations are checked against the grant and the PATH before any provider starts, so a denied second provider cannot leave the first provisioned.
- Prefixing is not optional. Compose's `rawsetenv` is refused, because an unprefixed key could overwrite `PATH`.
- A name produced twice is an error, whether by two capabilities (`a_b` with `C` and `a` with `B_C`) or by a provider and a variable declared in `[variables]`. Which source won would otherwise depend on the order.

`allow-outbound-hosts` and the other kinds do not constrain the provider's own process. It is software the user installed, and `allow-providers` is the consent to run it. It inherits the caller's environment for that reason, as Compose providers do and as #293 plugins do.
A capability's name chooses the prefix, so a capability named `node` could produce `NODE_OPTIONS`. It takes an explicit `allow-variables` entry, or `*`, to do so, and the manifest's author chose both. A caller that passes this environment to a process should know that.

Providers run in order of capability name, one at a time. There is no rollback: `down` may delete data, so a failed `up` throws with `details.started` naming the capabilities already up, and the caller decides.

### Plugins and providers share a namespace

`prism-provider-kv` also starts with `prism-`, so the plugin scan would list it, and it does not answer `prism-cli-plugin-metadata`.
The plugin scan now skips names starting with `provider-`, and that prefix is reserved.
`prism-code provider-kv` is not a command, and a provider need not implement the plugin calls.

### Where the environment goes

`resolveProviders` returns the environment. It does not set it on any process.
Today nothing inside a holo can read it: the world `hologram:guest/core-wasm@1` imports nothing, so a guest has no way to read a variable, and `prism-code run` does not read `prism.toml`.
What works today is everything up to that line: a host that embeds `prism-code/node` merges the result into what it gives its holo, and `prism-code providers up --json` hands it to anything else.
Connecting it to the guest needs a world with a variables import, which is separate work; see unresolved question 1.

### The reference provider

`prism-provider-kv` ships as a third binary of the package, beside `prism-doctor`. It keeps a store as one JSON file and starts no daemon, because a provider's `up` must exit.

| Flag | Default | Meaning |
| --- | --- | --- |
| `--store=<label>` | the capability's name | The store, matching the `allow-key-value-stores` entry syntax. |
| `--dir=<path>` | `.prism/kv` | Where stores live, relative to the project. |
| `--set=<key>=<value>` | none | Repeats. Sets a key only if it is missing, so `up` never overwrites data. |

`up` writes `<dir>/<application>/<store>.json` and returns `URL` (a `file:` URL) and `STORE`. `down` deletes the file.

### API and CLI

| Surface | What it does |
| --- | --- |
| `manifestProviders(manifest)` | The declarations in name order, each `{ name, type, options, flags }`. Needs no Node.js. |
| `resolveProviders(project, options)` (`prism-code/node`) | Runs `up` for each. `project` is the result of `readManifest`. Returns `{ env, providers, withheld }`. |
| `releaseProviders(project, options)` (`prism-code/node`) | Runs `down` for each in reverse order, attempting all of them. |
| `prism-code providers up\|down [<dir>] [--target browser\|node] [--json]` | The same from the command line. Text output names variables and never prints a value; `--json` prints the values, because that is what asking for it means. |

A new lint warning, `provider-not-granted`, fires on a declared provider the inline set does not allow.

## What stays experimental

Everything here: the `provider` table, the `providers` capability kind, the protocol and its message types, the verb, the API, the error classes and the `prism-provider-kv` flags and file layout.
All of it is listed in `STABILITY.md` section 6 and moves up a tier with the rest of that section.

## Test plan

- `sdk/npm/spec`: valid manifest and capability fixtures with providers, and invalid fixtures for a bad type, an unknown member, a reserved name, a hyphenated name, an `env(NAME)` option and a control character. `manifest.test.mjs` already runs these through `validateManifest`, so code and schema cannot drift.
- `sdk/npm/prism-code/test/providers.test.mjs`: the flags a real process receives; each failure and its class, with no value echoed; the grant checked before anything runs; withholding; collisions; the timeout; plugin scan and provider scan kept apart; Windows `.cmd` shims; `prism-provider-kv` end to end through `prism-code providers`.
- `sdk/npm/verify`: a capability set with `allow-providers` is accepted.

## Graduation criteria

- Experimental (M4): this change is merged and a holo can read the variables (unresolved question 1).
- Frozen: one provider outside this repository has been written against the protocol with no change to it.
- Stable (1.0 or later): the protocol, the kind and the error codes are final.

## Precedent

- [Docker Compose provider services](https://docs.docker.com/compose/how-tos/provider-services/) and [the extension protocol](https://github.com/docker/compose/blob/main/docs/extension.md): `provider = { type, options }`, options as `--key=value`, the service name as a positional argument, JSON Lines with `info`, `error`, `debug` and `setenv`, `<SERVICE>_<VAR>`, and an environment variable listing accepted messages.
- Where this differs: a dedicated binary needs no `compose` subcommand, `down` receives the options so a provider can stay stateless, and `rawsetenv` is refused.

## Alternatives

- A top-level `[providers]` table. The issue says a capability declares it, and keeping declarations under `[capabilities]` puts what is requested beside what is granted.
- The declaration as the grant. Then a capability file could not refuse what a manifest asks for, and deny by default would mean nothing here.
- Matching `allow-providers` on the capability's name. The type is what chooses the program that runs, so the type is what needs consent.
- Failing on a returned variable that is not granted. An application would then have to allow everything a provider returns, secrets it does not use included.
- Resolving `env(NAME)` in options. It would put secrets on a command line.

## Unresolved questions

1. How does a holo read these variables? It needs a world that imports a variables interface, and `prism-code run` reading `prism.toml`. This proposal delivers the environment up to that boundary.
2. Should `prism-code run` run `up` by itself, as `docker compose up` does? It should not run `down` on exit, because `down` may delete data.
3. Should Prism read a `metadata` verb to check options before running a provider, as Compose does?
4. Should `prism-provider-kv` enforce `allow-key-value-stores`? It cannot see the grant today, and the store is a file the user already owns.
