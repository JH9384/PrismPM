# Proposal 631: host effects for guests, by replay

| | |
| --- | --- |
| Issue | [#631](https://github.com/UOR-Foundation/PrismPM/issues/631) |
| Milestone | M3 v0.6 Replay, capabilities, conformance |
| Status | Proposed, Experimental. Needs a maintainer decision (unresolved question 1) before implementation. |
| Depends on | #279 (capability sets), #283 (world within policy), #284 (histories), SPEC 12.15 (`prismpm/host-effects/1`), #630 (the binary profile that declares the effects) |
| Coordinates with | #216 and #217 (server host effects, landed as #561, #564, #570, #572; #617 open), #294 (provider services, `prism-provider-kv`) |

## Summary

A holo's guest gets the two host effects an inference engine needs, a ranged fetch from an outbound host and key-value storage, without any import.
It uses the protocol a `Server` application already has on `main`, `prismpm/host-effects/1` (SPEC 12.15): the pure root answers a *turn* (the request and the outcomes of the effects completed so far) with a *step*, either `done` and the response or `perform`, an effect's tag and its request; the host performs the effect and calls the root again, at most the declared budget of times.
The JavaScript runtime becomes the host: it checks every effect against the capability set before performing it, refuses a denied one with `CapabilityDeniedError`, and records every outcome in the history, so a replay feeds the recorded outcomes back and needs neither the network nor the store.
The guest world stays `core-wasm@1` (or `@2`, #629); no world gains an import.

## Motivation

Capability grants for holos are inert today.
`core-wasm@1` imports nothing, and proposal 279 left open which WIT interfaces a first world with imports would use (its unresolved question 1, assigned to a maintainer).
Meanwhile `main` already has a complete, specified, tested way for a pure LexLean root to use host effects, with a codec, a budget, closed failures, transcripts and replay, for native server applications.
An engine that downloads a model in byte ranges and caches it in a store needs exactly that, inside a holo.

### Goals

1. Effects for holo guests with no guest import, reusing `prismpm/host-effects/1` byte for byte.
2. Two standard effects with model-declared bounds: `net.fetch-range` and `kv.get` / `kv.put`.
3. Deny by default through `prism/capabilities/1` (`outbound-hosts`, `key-value-stores`); a refusal is a typed error and is recorded.
4. A history format that carries every effect outcome, so `replay` runs offline and detects a guest that asks for different effects.

### Non-goals

- Guest imports and the WASI interfaces of 279's question 1. This proposal makes that question unnecessary for these effects; it does not answer it.
- Streaming response bodies. A fetch returns one bounded range; an engine fetches a large file as many ranges.
- Server applications. They keep their generated Rust host; nothing here changes 12.15.

## Proposal

### The protocol in a guest

The profile that declares a holo's effects (#630, `prismpm/binary-application/1`) holds a `host` record of the same type as a server application's: `Foundation.Server.V1.Model.HostProtocol`, protocol `prismpm/host-effects/1`, its `effectBudget`, closed `effects` and acceptance `transcripts`.
The guest's entry stays `Bytes -> Bytes`.
When `host` declares effects, the entry's argument is the turn and its result is the step, encoded as SPEC 12.15 encodes them (big-endian, `u32`-length-prefixed, the effect's wire tag its position in `effects`); the step's octets are the entry's response bytes.
With no effect declared, the entry is the plain request-to-response function, exactly as today.

The loop is the runtime's:

```text
outcomes = []
repeat at most effectBudget + 1 times:
  step = guest(turn(request, outcomes))
  if step is done: return its response
  check the effect's tag, payload and bounds         (EffectUndeclared, EffectMalformed, EffectRequestLimit)
  check the grant for the resource it names          (CapabilityDeniedError)
  outcome = perform(effect)                          (bounded by its declared outcome maximum)
  outcomes.push(outcome)
fail EffectBudget
```

No continuation state exists for the host to hold or forge; each call is a fresh, pure computation over the turn.
For the session world (#629) the same loop runs inside one step; the shim keeps the state it was given until the root answers `done`, so a `perform` answer cannot change the state. That is a shim mode of `@2` and is specified with it once this proposal is accepted.

### The two effects

Declared in the model like any effect, with the bounds there; the runtime implements these names and no others.

| Effect | Request fields | Result fields | Failures |
| --- | --- | --- | --- |
| `net.fetch-range` | `url` Text, `offset` U64, `length` U32 | `status` U32, `total` U64, `body` Bytes | `unreachable`, `status`, `too-large`, `not-ranged` |
| `kv.get` | `store` Text, `key` Bytes | `found` Flag, `value` Bytes | `unavailable` |
| `kv.put` | `store` Text, `key` Bytes, `value` Bytes | (none) | `unavailable`, `too-large` |

- `net.fetch-range` sends one `GET` with `Range: bytes=offset-(offset+length-1)`, refuses redirects, requires `206` (or `200` when `offset` is 0 and the body is at most `length`), and never reads more than `length` bytes. `total` is the length from `Content-Range`, or the body length. The URL must be `https:`, or `http:` on a loopback host.
- `kv.get` and `kv.put` use a store the caller provides by label (`load(bytes, { stores })`); `prism-code` provides a file-backed store under `$PRISM_HOME/kv/<application>/<label>.json`, the layout `prism-provider-kv` already writes (#294).

### Deny by default

Two checks, both before anything leaves the runtime:

1. **At load.** The effects the holo declares map to capability kinds (`net.*` to `outbound-hosts`, `kv.*` to `key-value-stores`). A holo that declares an effect whose kind the grant gives nothing of fails `load` with `CapabilityDeniedError`, check `world.capabilities`, as #283 does for a world. The holo's capability-set blob, already in every archive, carries the declared kinds.
2. **At use.** Before performing an effect, the runtime calls `app.capabilities.assert(kind, resource)` with the URL or the store label (#279). A denied resource fails the dispatch with `CapabilityDeniedError`, check `capabilities.outbound-hosts` or `capabilities.key-value-stores`. The effect is not performed.

The model never sees a denial; see unresolved question 2.

### Recording and replay: `prism/history/3`

`prism/history/1` cannot say what effects a dispatch performed, and #284 states that an effectful world needs a new schema version.
`prism/history/3` is `/1` with one added member per event:

```json
{
  "request": "…",
  "effects": [
    { "tag": 0, "request": "…", "outcome": "…" },
    { "tag": 1, "request": "…", "outcome": "…" }
  ],
  "response": "…"
}
```

`effects` lists, in order, each effect the root asked for: its wire tag, its encoded request and its encoded outcome, all lowercase hex.
A refused effect ends the event in `error` (`capabilities.outbound-hosts`), with the effects before it listed.
Replay runs the loop with a *scripted host* exactly as the generated server host does (SPEC 12.15): each requested effect must equal the next recorded one, by tag and request bytes, and gets its recorded outcome; a different, missing or extra effect is a divergence, `replay.divergence` (`PP5701`).
So a replay needs neither the network nor the store, and it detects a build that fetches something different.
A recording run uses the real host and writes what it observed.
Acceptance vectors use the model's `transcripts` as their script, as server acceptance already does, so `vectors` and `check` never touch the network either.

### What the runtime adds

| Surface | Meaning |
| --- | --- |
| `load(bytes, { capabilities, stores, fetch })` | The grant, the key-value stores by label, and the `fetch` to use (default: the platform's). |
| `app.host.effects` | The declared effects, each with its kind, bounds and failures. |
| `EffectError` (`effect.*` codes) | `effect.undeclared`, `effect.malformed`, `effect.request-limit`, `effect.result-limit`, `effect.budget`, `effect.step`: the runtime's names for the `ServerFailure` vocabulary of `model/host-effects-diagnostics.toml`. |
| `prism/history/3` | Schema, types, `parseHistory` support, the recorder and `experimental_replay`. |

`prism-code run <holo> <input> --capabilities caps.json` performs effects live; `record` writes a `/3` history; `replay` replays it offline.

### Acceptance fixture

A generated holo whose root fetches bytes 16 to 31 of a file from an allowed host and stores them under a key, then answers the stored bytes.

- Live: `prism-code run` with `allow-outbound-hosts = ["http://127.0.0.1:*"]` and `allow-key-value-stores = ["cache"]` against a loopback server, answering the 16 bytes, and `record` writing the history.
- Denied: the same run with no `outbound-hosts` grant fails `CapabilityDeniedError` (`capabilities.outbound-hosts`) and performs no request (the server sees none).
- Replay: the recorded history replays with the server stopped; a history whose recorded body differs is one divergence.
- Its transcripts make `vectors` and `check` pass offline.

## Test plan

- `sdk/npm/prism-code/test/effects.test.mjs`: the codec agrees byte for byte with the Rust `server_host` wire for every field kind (shared vectors generated from the Rust tests); each failure of the loop (`effect.*`) and each denial has a negative test; the budget is exact (budget effects succeed, one more fails); a fetch never reads past `length` and refuses a redirect; the file store and an in-memory store behave alike.
- `sdk/npm/prism-code/test/replay.test.mjs`: a `/3` history replays offline; a changed outcome, a missing effect, an extra effect and a different effect request are each one divergence.
- `sdk/npm/spec`: the `/3` schema with valid and invalid fixtures.
- Planted defects: a runtime that skips the use-time grant check must fail the denial test; a replay host that ignores the recorded effect requests must fail the different-request test.
- The acceptance fixture above, in CI with a loopback server.

## Graduation criteria

- Experimental: the loop, the two effects, `/3` and the fixture are merged.
- Frozen: an engine fixture fetches a model in ranges through it with no change to the effect declarations.
- Stable: `/3`, the effect names and the `effect.*` codes are final.

## Precedent

- `prismpm/host-effects/1` itself (SPEC 12.15), copied unchanged.
- Temporal activities: side effects run by the host, recorded in the history, and replayed from it without running again.
- Spin `allowed_outbound_hosts` and `key_value_stores`, through #279.

## Alternatives

- **Guest imports** (`wasi:http/outgoing-handler`, `wasi:keyvalue/store`, or `hologram:host/*`), as #279's question 1 anticipates. They need a world with imports (`@3`), a host that records every import call to replay it, and an answer to a maintainer question; they also let a guest observe the order and timing of host calls inside a step. Replay through the turn needs none of this, at the cost of re-running the root once per effect.
- **Effects outside the guest**: the caller fetches everything first and passes it by digest (#630). That works for static inputs and is what #630 provides; it cannot express "fetch the range the model asks for next".
- **Refusal as a modeled failure** the root sees and answers. See unresolved question 2.

## Unresolved questions

1. **Maintainer decision.** Proposal 279 assigned the choice of how a guest reaches host effects to a maintainer, expecting a world with imports. This proposal recommends effects by replay instead, for holos as for servers. If imports are preferred, this proposal is withdrawn in favour of a `@3` world.
2. Should a denied effect be an outcome the model sees (a `denied` failure it can answer), or a runtime error that ends the dispatch, as proposed? A model that can observe its grant can behave differently under different grants, which makes a history depend on the operator's policy; a runtime error keeps the model's behaviour a function of its inputs and outcomes.
3. A root re-runs once per effect, so a dispatch with *k* effects costs *k* + 1 runs. For an engine that fetches thousands of ranges this is quadratic in the effects of one dispatch. Combined with the session world (#629), the engine can fetch one range per step instead; is that enough, or is a resumable form needed?
4. Should the use-time check also bound the total bytes fetched per dispatch, as a capability member (`outbound-bytes`), or is the declared per-effect bound and the budget enough?
