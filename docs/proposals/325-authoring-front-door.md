# Proposal 325: authoring front door

| | |
| --- | --- |
| Issue | [#325](https://github.com/UOR-Foundation/PrismPM/issues/325) |
| Milestone | M3 v0.6 Replay, capabilities, conformance |
| Status | Withdrawn: `--unstable-author` was removed. Every app comes from one `prism/spec/1` spec through the guided path; an agent never writes the model. The checks named below no longer exist. |
| Depends on | #264 (input lock), #266 (proof predicate), #280 (`prism.toml`), #284 (replay of `examples/`) |
| Waits for | #267 (statements in the holo), `lexlean-mcp` v0.1 (a running gateway) |

## Summary

A developer writes examples, plain sentences and types.
An agent writes the LexLean model.
The pinned toolchain, the Lean kernel and the examples decide whether the model is accepted.
The agent's word counts for nothing, so its mistakes cost a build and never reach a holo.

```bash
prism-code build --unstable-author
prism-code check .prism/build/<id>/<Name>.holo --unstable-author
```

The guide is [Write from examples](../site/guides/write-from-examples.md).

## What is verified and what is not

Read this table first. It separates what ran from what has not.

| Claim | State | How |
| --- | --- | --- |
| The loop, the cache, the lock record, rollback and the reports | Verified with test doubles | `sdk/npm/prism-code/test/author.test.mjs`: the agent and the toolchain are fakes, and the holo is the real reference archive |
| The negative fixture fails by name, with no agent, lock or Docker | Verified end to end | The same test file, through the real command line |
| The Calculator examples equal the reference acceptance vectors, byte for byte | Verified | Checked against `fixtures/Calculator.holo`; 22 of 22, in order |
| `spec_digest` in Rust equals `specDigest` in JavaScript | Verified | `author.spec.digest` and `the_calculator_authoring_fixture_has_the_digest_javascript_pins` pin the same digest of the same fixture |
| The Rust change and the lock schema change compile and pass | Verified | The 14 `input_lock` tests pass in a Linux container with Rust 1.97.1. No CI workflow runs them, so run `cargo xtask unit-tests` when this code changes |
| A real agent writes a Calculator model that passes the kernel | **Not run** | No API key, `claude` CLI or `lexlean-mcp` gateway on the build host, and no SDK image with this change |
| The Core-Wasm section is byte-identical to the reference | **Not run, and not expected** | See [Byte identity](#byte-identity) |
| Payment Approval rebuilds against a reference | **Impossible as written** | No Payment Approval archive exists anywhere; the spec in the fixtures is new and its rules are a proposal |
| `model/lexlean.toml` under a root `prismpm.toml` builds | **Not run** | Rust reads a nested project path, but no fixture exercises it; it is the first thing a real run tests |
| The default agent against the live API | **Not run** | The two pure halves are tested offline; the one call between them is not |

## The files

| File | Who writes it | In the spec digest |
| --- | --- | --- |
| `prism.toml` | developer | yes |
| `intent.md` | developer | yes |
| `examples/**/*.json` | developer | yes |
| `types/*.ts`, `*.json`, `*.py` | developer, optional | yes |
| `model/` | agent, plus the scaffold; committed | no: pinned by its own digest |
| `model/author.json` | Prism: what the agent claimed, for review | no: inside the model digest |
| `prismpm.toml` | Prism, when absent: points at `model/lexlean.toml` | no |
| `prismpm.lock` | PrismPM and Prism | no |
| `.prism-author/` | Prism: the rejected attempt; do not commit | no |

The digest is `inputs.spec` of #264, so `prism-code` and the toolchain compute one value.
This settles #264 question 5: `intent.md` replaces the reserved `intent/` directory.
`build` compares the two values and fails if they differ, which is how a stale SDK image shows up.

### `prismpm.lock`

`prismpm/sdk-lock/3` gains one optional, closed member, written last and only after every gate passed:

```json
"authoring": {
  "agent": { "adapter": "anthropic", "model": "claude-opus-5-5" },
  "model_tree": { "blake3": "..." },
  "spec": { "blake3": "..." }
}
```

The `/2` projection drops it, so every SDK rule is unchanged.
A lock with this member needs an SDK image built from this change, since the schema is closed.
No SDK release exists yet, so no released image is affected.

### `intent.md`

One sentence per line. Blank lines and `#` headings are skipped.
A sentence ends with a period and uses exactly one of always, never or only.

The theorem name comes from the sentence alone: `intent_`, up to six lowercase words, and eight hex characters of its BLAKE3.
So a checker holding only `intent.md` can name every theorem, and the agent has no say in the mapping.
The proof predicate needs no new field: `theorems[]` already lists them, and the join is by name.

One form is also judged against the examples, before any agent runs:

```text
X never returns `L`.
X always returns `L` when the input contains `M`.
X returns `L` only when the input contains `M`.
```

Here `L` and `M` are byte strings, with `\t`, `\n` and `\\` as escapes.
A sentence in this form that the examples contradict fails the build by name, and it cannot be argued with.
Any other sentence is left to the agent and the kernel.

### `examples/`

Each file is `{ "input", "output", "name"? }`.
A string is its UTF-8 bytes, `{ "hex": "..." }` is those bytes, and anything else is its canonical JSON.
The file order, bytewise by path, is the vector order.

## The gates

Every build passes all of them, with or without a new model.

1. The examples do not contradict a sentence. No agent is called if they do.
2. `prismpm check` accepts the model.
3. `prismpm build` publishes a holo, and the lock's spec digest equals ours.
4. The holo matches its own digests and loads under the capabilities `prism.toml` grants.
5. The holo's vectors equal `examples/`, byte for byte, in order.
6. The guest replays every vector as a history, through `experimental_replay`. A divergence names the example file.
7. `prismpm verify` accepts the model, or its evidence for this model already exists.
8. Each sentence has a theorem the kernel passed that does not lean on `sorry`.

A failing gate goes back to the agent as diagnostics, up to the budget.
An agent that reports a sentence unproved stops the build at once: that sentence, its explanation and exit 1.
A failed build restores `model/` and the lock's bytes, and keeps the attempt in `.prism-author/rejected/`.

`replayExamplesGate` in `src/author/build.mjs` is gate 6, wired to #284. It does not yet keep the `prism/replay/v1` statement the replay produces.

## Decisions

Ilya accepted all four as written on 2026-10-31, so they are confirmed. Each is the simplest option that keeps builds reproducible, and each is one seam to swap.

1. **Agent and pinning.** The default is the Anthropic adapter with `claude-opus-5-5`, pinned in `prismpm.lock`. The pin records what wrote the model and does not make the model reproducible: no agent is deterministic. The committed model and its digest are the anchor. Changing the pin alone calls nothing; `--no-cache` or a spec change does. Any process can be the agent: `--author-command`, one JSON document in and one out. The adapter sets `fallbacks: "default"`, so a safety decline is retried on another model and the reply can come from a model other than the pinned one. To swap: change `DEFAULT_MODEL` and `DEFAULT_COMMAND`.
2. **Controlled grammar: yes, tiny.** Exactly one of always, never or only, and one sentence per line. This makes the mapping deterministic and refuses a sentence with no quantifier, such as "add is commutative.". The backticked form adds a check no agent can argue with. To swap: `parseIntent` and `ruleOf`.
3. **Stdlib surfacing: `llms.txt` plus the scaffold, for now.** The request names the docs index and carries the `init` template. MCP resources join when the gateway ships; `PRISM_LEXLEAN_MCP_URL` already passes through. Prism owns the iteration today because no gateway exists: `lexlean-mcp` models its tools but does not yet run them as a server. To swap: `authorRequest`.
4. **Budget: local, bounded, in tokens.** The author step runs on the developer's machine or CI, and the model it calls may be hosted. Ten attempts, 600 seconds each, and 2,000,000 tokens across attempts. At the listed `claude-opus-5-5` price ($4 input, $20 output per million tokens, as of 2026-10-06) that caps a spec change between $8 and $40. An unchanged spec costs nothing. These limits are chosen, not measured. To swap: `--max-iterations`, `--author-timeout`, `--author-max-tokens`.

Two smaller choices follow from the above.
Levels are numbered 0 to 3, as in the issue; the guide said 1 to 4 and is corrected.
The command is `prism-code` until the rename to `prism`.

## Byte identity

The issue asks for Core-Wasm and acceptance sections byte-identical to the reference, or every difference explained.
`prism-code check <holo> --unstable-author --reference <holo>` produces the measured table.
Until a real run exists, this is the prediction, and none of the rows but the second has been measured.

| Part | Expected | Why |
| --- | --- | --- |
| Acceptance vectors | **Identical (measured)** | `examples/` was extracted from the reference, and the gate requires equality |
| Core-Wasm guest | Different | The guest is compiled from the model. Another body, declaration order or name changes its bytes, and the reference is language 1.1 while the scaffold is 1.2 |
| View | Different | Examples and intent do not state the Calculator's labels, so the agent must invent them |
| Capability set | Likely identical | Both models are pure and declare nothing |
| Model document | Different | It carries this model's sources and identities |

**So byte-identical Core-Wasm is the wrong gate for a freshly authored model, and I recommend replacing it.**
Two correct programs differ in bytes. What the design can promise is identical acceptance vectors, behaviour on those vectors, and proofs of the sentences.
The one way to get identical guest bytes is to hand the agent the reference model, which proves nothing.

## What the gate does not catch

The largest hole is the one `prism check` already names: a theorem may not mean what its sentence says.
An agent can name a theorem correctly and prove something weaker, and the kernel will accept it.
The backticked form narrows this for sentences the examples can judge, and `model/author.json` puts each sentence beside the statement the agent claims for it, for review.
Only a reader closes it fully. A second, independent agent that audits statements against sentences is the natural next step, and it is not built.

Types get a name check only: each record the agent names must appear in a source.
`types/` is passed to the agent as text. No TypeScript, JSON Schema or Pydantic parser is involved.

Deleting `model/` while the spec is unchanged calls the agent again, because deleting it is an explicit request.

## MUST to check id

Each MUST of the issue's design maps to a check id.
A test named `<id>: ...` in `sdk/npm/prism-code/test/author.test.mjs` holds it today. `check --unstable-author` reports the ids marked with a star, and the test `author.check` holds those rows.
Moving these into the conformance suite is left to #287.

| MUST | Check id |
| --- | --- |
| The spec digest is BLAKE3 over `prism.toml`, `examples/`, `intent.md` and the type files | `author.spec.digest` * |
| It is recorded in `prismpm.lock` next to the model digest | `author.lock.record` * |
| `check` can prove the model was generated from this spec | `author.spec.digest` *, `author.model.digest` *, `author.holo.model` * |
| The generated model is committed and digest-pinned | `author.model.digest` * |
| An unchanged spec never calls the agent | `author.cache.hit` |
| Intent sentences map one to one to named theorems | `author.intent.theorem`, `author.response` |
| Intent follows the controlled grammar | `author.intent.grammar` |
| The proof predicate lists them with verdicts | `author.intent.verdicts` *, `author.evidence.kernel` |
| The report shows the sentence, not the theorem name | `author.report.sentence` |
| An unproved sentence fails the build, names it, and offers the agent's explanation | `author.intent.unproved` |
| A sentence false for the examples fails the build and is named | `author.intent.false` |
| `examples/` are the holo's acceptance vectors | `author.examples.vectors` *, `author.examples.wire` |
| A replay failure names the example file | `author.examples.replay` *, `author.replay.hook` |
| The agent's output is checked, never accepted | `author.evidence.kernel`, `author.iterate`, `author.rollback` |
| The holo embeds no weights or network access | `author.holo.closed` * |
| Types map to stdlib records | `author.types.record` |
| A hand-written `model/` with no spec files is accepted as today | `author.level3` * |

## Running it for real

This needs an SDK image built from this change, and credentials or an agent of your own.

```bash
npm install @anthropic-ai/sdk
cp -r sdk/npm/prism-code/test/fixtures/authoring/calculator /tmp/calculator
cd /tmp/calculator
docker run --rm -v "$PWD:/work" -w /work <image> prismpm update --toolchain <image>
prism-code build --unstable-author
prism-code check .prism/build/<id>/<Name>.holo --unstable-author --reference <path to Calculator.holo>
```

The first run tests the assumptions in the table at the top.
If the nested `model/lexlean.toml` does not build, the fix is in `ensureProjectFile` and `modelScaffold`.

## Graduation criteria

As the issue states: Beta when both reference apps and one new app are built by a stranger in under five minutes on Mac, Windows and Linux; Stable at 1.0.
