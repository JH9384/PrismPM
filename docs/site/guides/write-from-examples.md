---
title: Write from examples
description: Author an application from examples, intent and types, build it, and read the report.
available_in: "0.6"
---
This guide is the main way to write a Prism application. You give `build` examples of what the application does, sentences about what it must always and never do, and types for its input and output. `build` writes the model, proves every sentence, and fails by name on any sentence it cannot prove.

## The four levels

Prism has four ways in. Pick the lowest one that does the job.

1. Run someone's holo. No model. Just `pull`, `check` and `run`.
2. Compose in `prism.toml`. Name the holos you depend on and the capability set. No code.
3. Examples and intent. This guide. You write data and sentences, `build` writes the model.
4. Write the model directly. See [Write the model](/docs/guides/write-the-model).

## The five inputs

`build` reads five inputs. Everything else is generated.

| Input | What it holds |
|---|---|
| `prism.toml` | The manifest: name, version, where the model comes from, the capability set. |
| `examples/` | One JSON file per example: an input and its expected output. |
| `intent.md` | One sentence per line. Each becomes a theorem. |
| types | The input and output types, in TypeScript, JSON Schema or Pydantic. |
| `prismpm.lock` | The lockfile: the SDK image digest, the model, spec and world digests, and the version of every tool in the SDK image. |

For calculator, `prism.toml` names the application:

```toml
[application]
name = "calculator"
version = "0.1.0"
description = "Adds two numbers."
```

`examples/add.json` holds the one example:

```json
{"input": {"op": "add", "a": 2, "b": 3}, "output": 5}
```

`intent.md` holds two sentences:

```md
add is commutative.
The result never exceeds 32 bits.
```

`types.ts` holds the input and output types. `build` reads TypeScript, JSON Schema or Pydantic by file extension:

```ts
export type Input = { op: "add"; a: number; b: number };
export type Output = number;
```

Write each sentence the way you would state the rule to a colleague. One rule per sentence. Use the operation name from your examples. A sentence is proved for every input the types allow, not only for the examples, so narrow the types when the rule needs it.

## What build does with them

`build` runs the same steps every time.

- Pulls the SDK image at the digest in the lockfile. The compiler and the provers live there, not on your machine.
- Reads the examples, the intent and the types.
- Has an agent write the model through the Model Context Protocol, then compiles and proves it. Each unproved sentence goes back to the agent with a counterexample. The loop ends when every sentence is a theorem.
- Replays every example against the compiled program.
- Records provenance and the proof as attestations inside the holo.
- Writes the model to `model/` and pins its digest in the lockfile.
- Caches by spec digest, so the same inputs never build twice.

Commit `model/` with the rest of the project. The lockfile pins it, so the next build reuses it unless an input changed. A reviewer can read `model/` and see exactly what was proved.

## Read the report

Add a third sentence to `intent.md`: "add never returns a negative number." Then build:

```bash
prism build
```

```text
Pulling SDK image sha256:91ab… (cached)
Generating model from examples/, intent.md, types.ts
Compiling model
Proving
  add is commutative.                     checked
  The result never exceeds 32 bits.       checked
  add never returns a negative number.    UNPROVED
    counterexample: {"op": "add", "a": -1, "b": 0} gives -1
Build failed: 1 intent sentence unproved (exit 1)
```

Read it top to bottom. Each sentence gets one line and one of two words: `checked` or `UNPROVED`. An unproved sentence comes with a counterexample, a real input the types allow on which the sentence is false. No holo was written. Exit code 1 says the build failed, not that it could not run.

You have two fixes. Narrow the types so `a` and `b` cannot be negative, and the sentence becomes provable. Or delete the sentence, because it was never true. There is no third option. A holo only exists when every sentence is a theorem.

## Iterate with dev

`dev` watches the inputs, rebuilds and re-checks on every save, and serves a local studio:

```bash
prism dev
```

```text
Watching examples/, intent.md, types.ts, prism.toml
Studio at http://localhost:4100  tabs: Check, Replay
Built calculator@sha256:3f9c… in 2.1s  Proof: 2 theorems checked  Level: P2
```

The Check tab shows the verdict and the reason for each line. The Replay tab shows every example and whether it still replays. Add an example, save, and watch both tabs update.

## Next steps

- [Verify and inspect](/docs/guides/verify-and-inspect)
- [Run and gate](/docs/guides/run-and-gate)
- [Write the model](/docs/guides/write-the-model)
