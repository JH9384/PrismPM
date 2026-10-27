---
title: Write the model
description: Write the model files yourself when examples and intent are not enough.
available_in: "0.6"
---
This is the fourth and last level of authoring. You write the files in `model/` directly, instead of having `build` write them from examples and intent. You do it when you need a component the generated model does not reach, or when you want to read every line of what is proved.

## When to write the model

Most applications never need this page. Examples and intent cover them. Write the model yourself when one of three things is true.

- The generated model does not prove a sentence you know is true, and narrowing the types is not an option.
- You need a component from the standard library that the generated model does not use.
- You are reviewing an application where every proved line must be read by a person.

## What a model file is

A model file is written in the compiler's own modelling language. The compiler turns one model into two things. For the proof checker it compiles to Lean 4, and every intent sentence becomes a theorem the Lean 4 kernel checks. For the program it compiles to WebAssembly, the bytes that run in the instance. Both come from the same source, which is why the proof is about the program and not about a description of it.

A small model file for calculator has five parts, in this order.

- A header that names the component and lists the standard library components it uses. Calculator uses the integer component and nothing else.
- Two type declarations, one for the input and one for the output. They mirror the types in `types.ts`, and `build` checks that they agree.
- One function, `calculate`, that takes the input and returns the output. For calculator it reads the operation and adds the two numbers.
- One theorem for each sentence in `intent.md`, with the sentence as its name and a short proof under it. Commutativity of addition comes from the standard library in one step. The 32-bit bound needs the type of the inputs and a few lines.
- The examples, listed as checks that the function gives the expected output on each input.

That is the whole file. A reader who knows the input, the output and the two sentences can follow it top to bottom.

## Point the manifest at your model

The `[model]` table of `prism.toml` says where the model comes from and what `dev` watches. Its `source` key names your `model/` directory instead of the examples, and its `watch` key lists the files that trigger a rebuild.

```toml
[model]
source = "model"
watch = ["model/**/*.lex.tex", "intent.md", "examples/*.json"]
```

The [Manifest reference](/docs/reference/manifest) has every key.

`build` now compiles `model/` as it is. It still reads `intent.md` and fails if a sentence there has no theorem of the same name in the model. It still reads `examples/` and replays each one. Nothing about the holo, the lockfile or `check` changes.

## Build and iterate

The loop is the same as for generated models. `dev` rebuilds on every save and shows the result in the studio:

```bash
prism dev
```

```text
Watching model/, intent.md, examples/, prism.toml
Studio at http://localhost:4100  tabs: Check, Replay
Compiling model
Proving
  add is commutative.                 checked
  The result never exceeds 32 bits.   checked
Built calculator@sha256:3f9c… in 3.4s  Proof: 2 theorems checked  Level: P2
```

A theorem that does not check prints the sentence and the step that failed, the same as the generated path. Fix the proof, not the sentence.

## Keep the two paths together

You can start from examples, let `build` write `model/`, and then take it over. Point `source` at `model/` and the generated files become yours. The lockfile pins the model digest either way, so a reviewer sees exactly when the hand-off happened.

## Next steps

- [Write from examples](/docs/guides/write-from-examples)
- [Audit a holo](/docs/guides/audit)
- [Holo format](/docs/reference/holo-format)
