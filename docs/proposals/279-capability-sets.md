# Proposal 279: capability sets, deny by default

| | |
| --- | --- |
| Issue | [#279](https://github.com/UOR-Foundation/PrismPM/issues/279) |
| Milestone | M3 v0.6 Replay, capabilities, conformance |
| Status | Proposed, Experimental |
| Depends on | #278 (the WIT world, `WORLDS`), #276 (`CapabilityDeniedError`) |
| Used by | #280 (`prism.toml`), #282 (`prism run` gated on check), #283 (world within policy) |

## Summary

A capability file is a data file that grants a holo access to outbound hosts, key-value stores and variables.
Nothing is accessible until an entry allows it.
The file holds named sets; the runtime applies the set called `default` unless told otherwise.
Each set has `allow-*` and `deny-*` lists per kind, and a deny entry always wins.
`prism-code run` with no capability file grants nothing.
A guest import the grant does not allow fails the load with `CapabilityDeniedError`.

## Motivation

The guest is sandboxed by construction: the Core-Wasm world `hologram:guest/core-wasm@1` has no imports.
That stops being enough once a holo talks to the outside, through an outbound HTTP call, a store or a configuration variable.
Today there is no way to say which of those an operator gives a holo, and #283 has nothing to compare a world against.
The answer has to be data, so a reviewer can read it, a lock can pin it and a policy can check it.
It has to deny by default, so a forgotten line never opens a door.

### Goals

1. One file format, `prism/capabilities/1`, with a JSON Schema in `@prism-code/spec`.
2. Three resource kinds: outbound hosts, key-value stores, variables.
3. Deny by default: no file, an empty set and a set with only `deny-*` entries all grant nothing.
4. Deny wins: a resource matched by both an allow and a deny entry is denied.
5. Enforcement in the JavaScript runtime at the two points where a holo can reach out: when the guest's imports are linked, and when a host function uses a resource.
6. A typed error, `CapabilityDeniedError`, at both points.

### Non-goals

- The holo's own requested capability set (the `capability-set` blob a holo already carries) and the static check that a world fits inside a grant. Both are #283.
- `prism.toml` (#280) and the run gate (#282). They read this format; they do not change it.
- Host functions for HTTP, stores or variables. No world imports them yet (see unresolved question 1).
- The Rust CLI. It has no `run` verb today.
- Closures. A browser closure's imports belong to its wasm-bindgen glue, not to a world.

## Proposal

### The file

```json
{
  "schema": "prism/capabilities/1",
  "sets": {
    "default": {
      "allow-outbound-hosts": ["https://api.example.com", "https://*.cdn.example.com:8443"],
      "deny-outbound-hosts": ["https://admin.cdn.example.com:8443"],
      "allow-key-value-stores": ["default"],
      "allow-variables": ["*"],
      "deny-variables": ["signing_key"]
    }
  }
}
```

- `schema` is `prism/capabilities/1`. A change to the meaning of any member is `prism/capabilities/2`.
- `sets` maps a set name (`^[a-z][a-z0-9-]*$`) to a set. `default` is required.
- A set has up to six members: `allow-` and `deny-` for each of `outbound-hosts`, `key-value-stores` and `variables`. Each is an array of unique strings. A missing member is an empty list.
- Any other member, at any level, is rejected. A typo such as `allow-outbound-host` must fail loudly, never grant less or more than the author meant.

The file has no default location.
The caller names it: `prism-code run app.holo --capabilities caps.json`, or `load(bytes, { capabilities })`.
`--capability-set <name>` picks a set other than `default`; a name the file lacks is an error, never an empty grant.
#280 will name the file and the set in `prism.toml`.

### Entries

| Kind | Entry | Matches |
| --- | --- | --- |
| `outbound-hosts` | `scheme://host[:port]`, lower case. `scheme` may be `*`; `host` may be `*` or start with `*.`; `port` may be `*`. | A URL whose scheme, host and port match. With no port in the entry, only the scheme's default port matches (`http` 80, `https` 443, `ws` 80, `wss` 443). `*.example.com` matches every subdomain and not `example.com` itself. The path is ignored. |
| `key-value-stores` | A store label, `[a-z0-9][a-z0-9_-]*`, or `*`. | That label, or any label. |
| `variables` | A variable name, `[a-z][a-z0-9_]*`, or `*`. | That name, or any name. |

A resource is granted when some `allow-` entry of its kind matches it and no `deny-` entry of its kind does.
There is no other rule, no ordering and no precedence beyond "deny wins".

### How a set maps to the world

A world row in `WORLDS` (#278) lists the guest's imports.
An import is the only way a guest can reach the host, so it is the unit the runtime grants.
Each import a world lists will name the capability kind it uses, as a `capability` member of its import entry (`outbound-hosts`, `key-value-stores` or `variables`).
The runtime links an import only when its world lists it with a kind and the grant allows at least one resource of that kind.
Every other import is denied, which covers an import the world does not list and an import whose kind the grant leaves empty.

`hologram:guest/core-wasm@1` lists no imports.
So today the runtime links none, and every import a guest declares fails with `CapabilityDeniedError`.
That is the same guest the runtime accepted before (it refused any import with `core.imports`), now refused with the typed error.
The `capability` member arrives with the first world that has imports, which is a new contract `@2` and a new row, as #278's versioning rule requires.

### Enforcement

There are two points, both in the runtime, both raising `CapabilityDeniedError`.

| Point | When | `check` |
| --- | --- | --- |
| Link | `compileGuest` reads the guest's import section, before any instance exists. | `capabilities.import` |
| Use | A host function is about to reach a resource; it calls `app.capabilities.assert(kind, resource)`. | `capabilities.outbound-hosts`, `capabilities.key-value-stores`, `capabilities.variables` |

The error's `details` names the import or the resource, the kind and the set.
`classForCheck` maps every `capabilities.*` check to `CapabilityDeniedError`, next to the verdict's `world.capabilities` (#283).
The link check runs at load, so `prism-code run`, `vectors` and `load()` all refuse a guest before it runs.

The application object gains `capabilities`, frozen:

```js
app.capabilities.set;                                       // 'default', or null when no file was given
app.capabilities.allows('outbound-hosts', 'https://api.example.com/v1');  // true or false
app.capabilities.assert('variables', 'signing_key');        // throws CapabilityDeniedError
```

`parseCapabilities(json)` validates a file and returns it frozen; it throws `PrismCodeError` `capabilities.invalid` naming the bad member.
The runtime validates in code and a test runs the schema's own fixtures through it, so the code and the schema cannot drift.
`prism-code` keeps no dependency on `@prism-code/spec`.

### What `run` prints

`prism-code run` adds one line after the address: `capabilities: none granted`, or `capabilities: set default of caps.json`.

## Test plan

In `sdk/npm/spec`: fixtures under `test/fixtures/capabilities/capabilities-v1/`, valid (`deny-by-default`, `web-client`) and invalid (no `default`, an unknown top-level member, an unknown set member, a malformed host, a wrong schema name).

In `sdk/npm/prism-code/test/capabilities.test.mjs`:

- No file grants nothing: every kind denies every resource, `set` is null, and the reference archive still loads and runs its vectors.
- An empty `default` and a deny-only `default` grant nothing.
- Allow works for each kind, with the host rules (default port, wildcard port, `*.` subdomains, scheme `*`).
- Deny wins over allow, including a specific deny under a wildcard allow.
- Unknown members, a missing `default`, a missing named set and malformed entries are rejected with `capabilities.invalid`.
- `assert` throws `CapabilityDeniedError` with `code` `capability_denied`, the check and the details.
- A guest with an import fails `load` with `CapabilityDeniedError` `capabilities.import`, with and without a grant.
- The schema's valid fixtures parse and its invalid fixtures are rejected by `parseCapabilities`.
- `prism-code run --capabilities` prints the grant line; a bad file exits 2.

## Graduation criteria

- Experimental (M3). The format, the schema, the runtime grant and both checks are merged.
- Frozen (M3 freeze). #280, #282 and #283 read the format with no change to it, and the first world with imports carries `capability`.
- Stable (1.0). `prism/capabilities/1` and the `capabilities.*` check ids are final.

## Precedent

- Tauri capabilities and `permissions/`: commands are inaccessible until a permission allows them; `allow-*` and `deny-*` identifiers; a `default` permission set; deny takes precedence.
- Spin `allowed_outbound_hosts` (`scheme://host:port` with `*` wildcards and default ports), `key_value_stores` and `variables` per component.
- Deno permissions: deny flags win over allow flags.

## Alternatives

- Allow-only lists, as in Spin. Simpler, but a wildcard grant cannot then carve out one host or one secret, and the issue asks for `deny-*`.
- TOML instead of JSON. `prism.toml` (#280) can embed or name the file; the schema stays JSON Schema like every other format in `@prism-code/spec`.
- A capability file inside the holo. A grant is the operator's decision, not the author's; the holo already carries what it requests (#283 compares the two).
- Per-resource ordered rules (first match wins). Harder to read and to review; "deny wins" needs no ordering.

## Unresolved questions

1. Which WIT interfaces carry the three kinds once a world has imports? Candidates are `wasi:http/outgoing-handler`, `wasi:keyvalue/store` and `wasi:config/store`, or `hologram:host/*` interfaces of our own. This decides the first `@2` world and belongs to afflom.
2. Should the link check need any allowed resource of the import's kind, as proposed, or should a world also be able to declare which resources it needs, so #283 can compare them statically?
3. Should `capabilities.*` failures get `PP56xx` diagnostics, like `PP5602` for `world.capabilities`?
4. Should the lock (#264) pin the capability file's digests, as it pins the world's?
