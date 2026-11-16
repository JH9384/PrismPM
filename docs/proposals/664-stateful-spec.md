# Proposal 664: `prism/spec/2`, a JSON spec for apps that keep state

| | |
| --- | --- |
| Issue | [#664](https://github.com/UOR-Foundation/PrismPM/issues/664) |
| Status | Proposed, Experimental. Implemented in `sdk/npm/prism-code/src/journey/` (`stateful.mjs`, `render-stateful.mjs`). Open questions below. |
| Depends on | `prism/spec/1` and its seal (prism-code 0.8.0), SPEC section 3 (`prismpm/text-application/1`) |
| Coordinates with | #629 (the session world, `hologram:guest/core-wasm@2`), #630 (its holo profile) |

## Summary

`prism/spec/2` is the JSON spec of an app that keeps state between steps: a count, a total, a phase.
A model writes only this JSON. Prism reads it strictly, keeps it as RFC 8785 canonical bytes, renders it deterministically to LexLean, has Lean prove its properties over every reachable state, and builds a holo that carries the same seal as a `prism/spec/1` app: `[prism/spec/2 blake3:<hex>]` in the model's `cargoDescription`.
`checkSpecBinding` and `prism-code check --spec` work on it unchanged.

## Why a new schema, not an extension of `prism/spec/1`

A decision app is one request to one answer; a stateful app is a state and actions over it.
The two share conditions, outcomes, `never`/`always` and the strict reading, but not their top-level shape: spec/1 has `fields`, `rules` and one `otherwise`; spec/2 has `state` and `actions`, each action with its own inputs, rules, changes and `otherwise`.
Folding `state` and `actions` into spec/1 as optional members would make every spec/1 reader learn them, and a spec/1 file's meaning would depend on members it does not hold.
A separate schema leaves every spec/1 file, its canonical bytes and its seal exactly as they are; a reader dispatches on `schema`.

## The shape

```json
{
  "schema": "prism/spec/2",
  "name": "dinner-seats",
  "purpose": "Books seats at a dinner for twelve until the host closes the list.",
  "state": [
    { "name": "booked", "kind": "number", "max": 12 },
    { "name": "list", "kind": "choice", "values": ["open", "closed"] }
  ],
  "outcomes": ["booked", "full", "closed", "cancelled", "nothing"],
  "actions": [
    { "name": "book", "inputs": [{ "name": "seats", "kind": "number", "min": 1, "max": 6 }],
      "rules": [
        { "when": [{ "field": "list", "op": "is", "value": "closed" }], "then": "closed" },
        { "then": "booked", "change": [{ "field": "booked", "op": "add", "value": { "field": "seats" } }] }
      ],
      "otherwise": "full" },
    { "name": "close", "rules": [{ "then": "closed", "change": [{ "field": "list", "op": "set", "value": "closed" }] }], "otherwise": "closed" }
  ],
  "properties": [
    { "kind": "always", "when": [{ "field": "booked", "op": "<=", "value": 12 }] },
    { "kind": "never", "action": "book", "when": [{ "field": "list", "op": "is", "value": "closed" }], "then": "booked" }
  ],
  "examples": [{ "steps": ["book 4", "close", "book 1"], "answers": ["booked", "closed", "closed"] }]
}
```

The whole fixture is `sdk/npm/prism-code/test/fixtures/stateful/dinner-seats.spec.json`.

- **State**: at most eight values, each a number with a `max` (state is bounded) or a choice, with a `start` (default: the min, or the first choice).
- **Actions**: at most eight. A step is the action's name and its inputs, separated by single spaces, as a spec/1 request is a line of fields. At most four inputs, each a number or a choice.
- **Rules**: per action, in order. A rule applies when every condition holds (none means always) and every change keeps its number within bounds; the first that applies answers `then` and makes its changes, each read from the state before the step. Changes are `set` (a choice word, a number, or a number named by `{"field": ...}`), `add` and `subtract`.
- **Total behaviour**: when no rule applies, the action answers its `otherwise` and the state does not change. A malformed step is `invalid`. A rule that would take a number out of bounds does not apply, so an author never writes a capacity check twice.
- **Properties**: a state property (`always` or `never`, `when` over the state) holds in every reachable state. An action property (`never` or `always`, an `action`, `when` over the state and its inputs, `then` an answer) holds in every reachable state.
- **Examples**: acceptance sessions from the start state, one answer per step. An example the rules contradict is refused (`example.disagrees`), naming the step and the rule that decides it.

The vocabulary is spec/1's: a model that can write a spec/1 spec writes conditions, outcomes and properties here the same way, and learns `state`, `actions` and `change`.

## Rendering

The model is a state machine in one LexLean module: a `State` structure of `Nat` (a choice is its code), `initial`, and for each action `after<Action>` (the next state, each field an `if` chain over the rule guards) and `reply<Action>` (the answer's code).
Every guard is a `Nat` comparison, so every theorem is proved by `linear_arithmetic`, the one proof form spec/1 uses; no proof is written by hand and none rests on an axiom outside Lean's three.

The proofs module states, for the induction over a session's steps:

| Theorem | Statement |
| --- | --- |
| `startInBounds` | the start state is within bounds |
| `<action>KeepsBounds` | from any state within bounds, the action leaves it within bounds |
| `<inv>AtStart` | the state property holds at the start |
| `<inv>KeptBy<Action>` | from any state within bounds where every state property holds, the action keeps this one |
| `<inv>Holds` | an action property, in any state within bounds where every state property holds |

Lean checks each theorem. That together they cover every reachable state is the induction, stated in SPEC.md and here, not a Lean theorem: proving it in Lean needs induction over a list of steps, which `linear_arithmetic` does not do.
A true state property that is not inductive (it holds in every reachable state, but some action breaks it from an unreachable one) fails to prove; Prism's search over reachable states then finds no counterexample and says to add the property that rules that state out.

The same JSON gives the same bytes: the render reads nothing but the normalized spec.

## Running it: sessions replayed on the text profile

The buildable profile today is `prismpm/text-application/1`: one request, one response, nothing kept.
A stateful app is projected onto it as replay. A request is a session, its steps separated by `;` (at most 1024 bytes); the guest replays it from `initial` and answers the last step's outcome and the state, as `full booked=10 list=open`.
Every state the guest computes is reachable, so what Lean proves of reachable states holds of every answer.

The state machine does not depend on this projection. When the session world's holo profile (#630) is buildable, the same `after` and `reply` run one step at a time with the state kept inside the instance; the spec, its canonical bytes and its seal do not change.

## What is proved and what is tested

Proved by Lean: the bounds, every state property and every action property, over every reachable state, by the induction above.
Tested by acceptance vectors through the built guest: every prefix of every example, a session per distinct way the rules decide from sampled reachable states, and malformed and oversized sessions.
Reading sessions (bytes to steps) is tested, not proved, as reading requests is for spec/1.

## Refusals

Strict reading is spec/1's (`json.*`, the shared rules in `spec.mjs` `REFUSALS`) plus `STATEFUL_REFUSALS` in `stateful.mjs`: `state.*`, `actions.*`, `action.*`, `inputs.too-many`, `input.clash`, `change.*`, `property.action`, `properties.too-many`, `example.*`.
Each is a `word.word` the gaps gateway accepts; a test holds the list to the rules the code names.

## Open questions

1. **Lists of entries.** A guest list or a log (rows that are kept) is not expressible: state is scalar. A bounded list needs either fixed slots with a count, whose proofs grow with the slot count, or a proof form beyond linear arithmetic. Foundry's notation has tables of at most 16 rows; its promises are about the count and about refusals, which spec/2 can state over a counter. Should spec/2 grow a bounded `list` kind, or should that be a spec/3?
2. **Projection.** Replay on the text profile bounds a session at 1024 bytes and replays it on every request. The session world (#629, #630) removes both limits. Should spec/2 apps wait for #630 for production use, or ship on replay now?
3. **The GitHub template.** `UOR-Foundation/template` writes a decision app's claims, scenarios and Rust tests; a spec/2 app builds on the local SDK image only, and `prism_build` with a repository refuses it with a message. The template needs a stateful variant.
4. **Text answers.** Answers are words and the state is shown as `name=value`. Free text (a guest's name) is out of scope, as in spec/1.
