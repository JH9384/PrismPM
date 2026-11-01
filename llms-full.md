# Prism: every page

> Prism builds your application into a holo, a content-addressed package that carries its own proof and provenance, and checks them before anything runs.

<!-- index -->

---
title: Prism docs
description: Build applications that prove what they do, then check, run and ship them anywhere.
available_in: "1.0-beta"
---
Prism turns a few examples and a few plain sentences into a holo: an image that carries its own proof. A holo is one content-addressed file with a machine-checked proof of its own behaviour inside. You build it, check it, run it and push it with one CLI, the way you work with Docker. These docs take you from an empty directory to a holo on a registry, and show you how to read the proof when it matters.

Every page names the release it needs. [Release status](/docs/reference/release-status) says what you can use today.

- [Get started](/docs/get-started/introduction): what Prism is in Docker terms, a five-minute quickstart, and the core concepts.
- [Concepts](/docs/concepts/holo): why a holo is one file, what a proof covers, and how capabilities, provenance and registries work.
- [Guides](/docs/guides/write-from-examples): write from examples, verify and inspect, run and gate, ship, rebuild and update, use with agents, audit, and write the model directly.
- [Examples](/docs/examples/call-a-holo): small programs and commands you can run today, each with its captured output.
- [Reference](/docs/reference/cli): every CLI verb, the manifest, the lockfile, the holo format, attestations, policy, errors and release status.
- [API Reference](/docs/api): the `prism-code` runtime and its packages.
- [SDKs](/docs/sdks/overview): the runtime for each language.
- [Migration](/docs/migration/to-1-0): what changes between 0.x and 1.0.

## Next steps

- [Quickstart](/docs/get-started/quickstart)
- [Core concepts](/docs/get-started/core-concepts)
- [Release status](/docs/reference/release-status)

<!-- get-started/introduction -->

---
title: What Prism is
description: Prism explained in Docker terms, with every noun and verb side by side.
available_in: "1.0-beta"
---
This page tells you what Prism is and maps each Prism noun and verb to the Docker one you already know. Read it once. After that, every command in these docs should feel familiar.

## Why

Software should prove what it does. Tests show how a program behaves on the inputs you tried. A proof shows how it behaves on every input. Prism makes the proof part of the build. You write examples and plain sentences of intent. `build` turns them into a holo: an image that carries its own proof. `check` reads that proof before anything runs. A holo whose proof is missing or wrong does not run.

That is the whole idea. Everything else is Docker with one extra verb.

## Nouns

| Prism noun | Docker noun | What it is |
|---|---|---|
| model | Dockerfile | The source of your application: examples, intent, types, and the model files that `build` generates or you write. |
| holo | image | The built, content-addressed application. One file, addressed by name or digest, with its proof inside. |
| digest | image digest | The content hash of a holo. Every digest is a sha256 and a BLAKE3 over the same bytes, so Docker tools find the sha256. |
| SDK image | base image | The pinned image the compiler and the provers run in. `build` pulls it by digest and uses nothing on your machine. |
| lockfile | pinned FROM digest | `prismpm.lock`. Pins the SDK image, the model digest and every input. |
| instance | container | A loaded, checked, running holo. |
| registry | registry | Any OCI-compatible registry. Holos push and pull like images. Attestations ride along as referrers. |
| `prism.toml` | none | The manifest: name, model source, capability set, variables. Docker splits these across the Dockerfile and run flags. |

## Verbs

| Prism verb | Docker verb | What it does |
|---|---|---|
| `prism build` | `docker build` | Compiles the model into a holo inside the SDK image. Records provenance and the proof. |
| `prism check` | none | Verifies digest, provenance, proof, lockfile pins and world against a policy. Prints the assurance level. |
| `prism run` | `docker run` | Instantiates the holo after `check` passes, with exactly its capability set. |
| `prism push` | `docker push` | Sends the holo and its attestations to a registry. |
| `prism pull` | `docker pull` | Fetches a holo and its attestations from a registry. |
| `prism deploy` | `docker compose up`, or none | Publishes the holo to a GitHub repository and GitHub Pages, with the attestations served alongside. |

## What has no Docker equivalent

Three ideas are new. Each gets one section in [Core concepts](/docs/get-started/core-concepts).

- Proof. Every intent sentence becomes a theorem. `build` proves it, or fails and names the sentence.
- Assurance level. `check` reports P0 to P3. P0 is unverified. P3 is proof plus replay plus capabilities within policy.
- Capability set. A holo touches only the hosts, stores and variables its manifest allows. Deny is the default.

## What stays the same

A holo is one file with a digest. You build it once and run the same bytes everywhere: in Node.js, in a browser, in Rust, in Python, or served by Docker. You push it to the registry you already use. You pin it in a lockfile the way you pin any dependency. Nothing about your registry, your CI or your deployment target has to change.

## Next steps

- [Quickstart](/docs/get-started/quickstart)
- [Core concepts](/docs/get-started/core-concepts)
- [Write from examples](/docs/guides/write-from-examples)

<!-- get-started/quickstart -->

---
title: Quickstart
description: Scaffold, build, check, run and deploy your first holo in five minutes.
available_in: "1.0-beta"
---
In five minutes you create a calculator from one example and two sentences, build it into a holo, check its proof, run it, and publish it to GitHub Pages. Every command below is one you will use every day.

The `prism` CLI ships with 1.0-beta.1. To try a holo with what is on npm today, start with [Call a holo](/docs/examples/call-a-holo).

## Before you start

You need Node.js 22 or later and Docker. Docker runs the SDK image, so you never install the compiler yourself. The scaffolder adds the `prism` CLI to the project. For the last step you need a GitHub account.

## Create the project

Scaffold a project named `calculator`:

```bash
npm create prism-code calculator
```

```text
Creating calculator
  prism.toml         application calculator 0.1.0
  examples/add.json  one example
  intent.md          two sentences
  prismpm.lock       SDK image sha256:91ab…
Done. Next: cd calculator && prism build
```

The project holds three files you edit. Open them and make them read as follows.

`examples/add.json` is one input and its expected output:

```json
{"input": {"op": "add", "a": 2, "b": 3}, "output": 5}
```

`intent.md` is one sentence per line. Each sentence becomes a theorem:

```md
add is commutative.
The result never exceeds 32 bits.
```

`prism.toml` names the application:

```toml
[application]
name = "calculator"
version = "0.1.0"
description = "Adds two numbers."
```

There is no `[capabilities]` table, and without one the holo is granted nothing.

## Build the holo

Build compiles the model into a holo inside the pinned SDK image. It writes the model from your examples and intent, proves each sentence, replays the example, and records provenance:

```bash
cd calculator
prism build
```

```text
Pulling SDK image sha256:91ab… (cached)
Generating model from examples/ and intent.md
  model/  2 files written, digest sha256:7d2e…
Compiling model
Proving
  add is commutative.                 checked
  The result never exceeds 32 bits.   checked
Replaying examples
  add.json  ok
Built calculator@sha256:3f9c… (holo, 24.8 KB)
Provenance: recorded   Proof: 2 theorems checked   Level: P2
```

The holo is `calculator@sha256:3f9c…`. The digest covers everything inside it, including the proof. Commit `model/` with the rest of the project. The lockfile pins its digest.

## Check it

Check verifies the digest, the provenance, the proof, the lockfile pins and the declared world against the default policy. It prints a verdict with the assurance level:

```bash
prism check
```

```text
calculator@sha256:3f9c…
  digest        ok   matches
  provenance    ok   built from model sha256:7d2e… in SDK image sha256:91ab…
  proof         ok   2 theorems checked
  lockfile      ok   all pins match prismpm.lock
  replay        ok   1 history, 1 call, no divergence
  world         ok   imports none, exports calculate, within capability set
Verdict: PASS  Level: P3  (policy: default, requires P2)
```

Exit code 0 means pass, 1 means fail, 2 means the check could not be completed. P3 is the highest level: proof checked, every history replayed, capabilities within policy.

## Run it

Run calls `check` first and refuses to start unless it passes. Then it instantiates the holo with exactly the capability set from `prism.toml` and dispatches one input:

```bash
prism run calculator --input '{"op": "add", "a": 2, "b": 3}'
```

```text
Check: PASS  Level: P3
Instance calculator@sha256:3f9c…  capabilities: none
5
History: 1 call recorded
```

Leave out `--input` and `run` reads inputs from standard input, one per line. The instance records every input and output. Later, `replay` can prove that a new build behaves the same on all of them.

## Deploy it

Deploy publishes the holo to a GitHub repository and serves it from GitHub Pages, with the attestations alongside:

```bash
prism deploy
```

```text
Publishing calculator@sha256:3f9c… to github.com/you/calculator
  holo           24.8 KB
  attestations   provenance, proof, replay
  pages          https://you.github.io/calculator/
Done.
```

Anyone with the link gets the same bytes and the same proof. They can check it offline in a browser with `@prism-code/verify` and see the verdict you saw.

## What you did

You wrote one example and two sentences. Prism wrote the model, proved both sentences for every input, and sealed the proof into a holo with a digest. `check` confirmed the proof before `run` started anything. `deploy` published holo and proof together. Every later build, pull and run starts from the same check.

## Next steps

- [Core concepts](/docs/get-started/core-concepts)
- [Write from examples](/docs/guides/write-from-examples)
- [Ship a holo](/docs/guides/ship)

<!-- get-started/core-concepts -->

---
title: Core concepts
description: The seven ideas behind every Prism command, each with one example.
available_in: "1.0-beta"
---
This page gives you the vocabulary the rest of the docs use. Each section defines one idea and shows it on the calculator application from the quickstart. The [Concepts](/docs/concepts/holo) group explains why each one works the way it does.

## Model

The model is the source of your application. It is what `build` reads. For calculator it is three things: the examples, the intent, and the model files that `build` generates from them into `model/`.

An example is one input and its expected output:

```json
{"input": {"op": "add", "a": 2, "b": 3}, "output": 5}
```

An intent sentence is something the application must always or never do. `intent.md` holds one per line. Each becomes a theorem that `build` must prove before it writes a holo.

## Holo

A holo is an image that carries its own proof. It is one file, `calculator.holo`, addressed by name or digest:

```text
calculator@sha256:3f9c…
```

Inside are the application manifest, the model document, the provenance, the capability set, the program as WebAssembly, a portable view for the browser, and an attestation bundle. Each part has its own sha256 and BLAKE3 digest, and the last 32 bytes of the file are the BLAKE3 of everything before them. The holo's digest covers all of it. The same model built in the same SDK image gives the same digest, every time. [Holo format](/docs/reference/holo-format) has the byte layout.

## Check

Check is the verification step. It verifies five things: the digest, the provenance, the proof, the lockfile pins, and the declared world against policy. It prints a verdict with an assurance level and reasons:

```text
Verdict: PASS  Level: P3
```

Exit code 0 means pass, 1 means fail, 2 means the check could not be completed. `run` calls `check` first and refuses to start on anything but 0.

## Assurance levels

The level says how much `check` could confirm.

| Level | Name | What is confirmed |
|---|---|---|
| P0 | unverified | Nothing. The holo loaded, that is all. |
| P1 | provenance | How and from what the holo was built. |
| P2 | proof checked | P1, plus every theorem checked against the holo. |
| P3 | proof plus replay plus capabilities | P2, plus every history replays unchanged, plus the world is within policy. |

The default policy requires P2 or above and a world within the granted capabilities.

## Capability set and world

The world is the holo's declared contract: what it imports from the host and what it exports. Calculator imports nothing and exports `calculate`.

The capability set is what a holo may touch: hosts, stores, variables. You declare it in `prism.toml`. Deny is the default: with no `[capabilities]` table, or an empty one, the holo talks to nothing. This one lets it call one host:

```toml
[capabilities]
allow-outbound-hosts = ["https://api.exchange.example"]
```

`check` fails when the world imports more than the capability set allows. `run` grants exactly the set, never more.

## History and replay

A history is the recorded inputs and outputs of an instance. Your examples become the holo's first history. Every run records another. `replay` re-executes a history against the current build and fails on any divergence:

```bash
prism replay examples/ --holo calculator.holo
```

```text
Replaying 1 history against calculator@blake3:2adca3e7ca42
  add.json  1 event, no divergence
Replay: PASS  no divergence
```

A build that replays every history gets the replay attestation that P3 needs.

## Registry

A registry is any OCI-compatible registry. A holo pushes there with its attestations attached as referrers, and pulls back with them:

```text
ghcr.io/you/calculator@sha256:3f9c…
```

The digest is the same in the registry, on disk and in `check`. A pull that does not match it fails.

## Next steps

- [Write from examples](/docs/guides/write-from-examples)
- [Verify and inspect](/docs/guides/verify-and-inspect)
- [Run and gate](/docs/guides/run-and-gate)

<!-- concepts/holo -->

---
title: The holo
description: Why a Prism application is one self-describing file, and what that file holds.
available_in: "0.2.0"
---
A holo is the built form of a Prism application. It plays the part an image plays in Docker: you build it once, address it by digest, and run the same bytes everywhere.

## Why one file

A container image is a set of layers and a manifest, and a registry holds them together. A holo keeps everything in one file, for two reasons. The evidence about a build cannot be separated from the build, because it travels inside it. And anything that can read a file can check it, including a browser with no network.

## What is inside

A holo is a table of sections followed by their bytes. Each section has one job.

| Section | What it holds |
| --- | --- |
| `app-manifest` | The entry point and the digests of the program, the view and the capability set. |
| `source-manifest` | What the holo was built from. |
| `application-directory` | An index of the application. |
| `model-provenance` | What ties the model to what was built. |
| `guest` | The program, as WebAssembly. |
| `view` | The interface a browser shows. |
| `capability-set` | What the holo may touch. |
| `model-document` | The model in its canonical form, `model.prism.json`. |

[Inspect a holo](/docs/examples/inspect-a-holo) prints these sections from a real file, and [Holo format](/docs/reference/holo-format) gives the byte layout.

## How a digest covers it

Each content section has its own digest, as a layer has in an image. The last 32 bytes of the file are a BLAKE3 digest of every byte before them, which plays the part of the image digest. Changing one byte anywhere changes that footer, so a file that does not match its digest is refused when it loads.

## Next steps

- [Proof and assurance](/docs/concepts/proof-and-assurance)
- [Registries and releases](/docs/concepts/registries-and-releases)
- [Holo format](/docs/reference/holo-format)

<!-- concepts/proof-and-assurance -->

---
title: Proof and assurance
description: What a proof adds to tests, how assurance levels measure evidence, and where the guarantee stops.
available_in: "0.5"
---
A test shows how a program behaves on the inputs you tried. A proof shows how it behaves on every input the types allow. Prism makes the proof part of the build, then uses assurance levels to say how much of that evidence a reader could confirm.

## Why levels

A holo either carries a piece of evidence or it does not, and a checker either confirms it or it cannot. A single pass or fail would hide that difference. So `check` computes a level from the evidence, and a separate policy decides whether that level is enough for you.

| Level | Name | What is confirmed |
| --- | --- | --- |
| P0 | unverified | The holo loaded and its digests match. Nothing more. |
| P1 | provenance | How and from what the holo was built. |
| P2 | proof checked | P1, plus every theorem checked against the holo. |
| P3 | proof, replay and world | P2, plus every history replays unchanged, plus the world is within policy. |

Each level includes the ones below it. A policy never changes the level: it only accepts or rejects it. The default policy asks for P2 or above.

## How to read a low level

A low level says evidence is missing, not that the program is wrong. The sample holo carries no statements, so it checks at P0, as [Check a holo](/docs/examples/check-a-holo) shows, and it still replays every example it carries.

## Where the guarantee stops

A proof is exactly as strong as what it assumes.

- The proof checker and the SDK image are trusted, not proven. Pinning the image by digest says which ones you trusted.
- The intent sentences are yours. A proof shows they hold, not that they are the right sentences.
- The runtime enforces the capability set. The proof covers what the holo asks for, not what a host hands it.

[Audit a holo](/docs/guides/audit) walks through these limits for the person who signs off.

## Next steps

- [World and capabilities](/docs/concepts/world-and-capabilities)
- [Verify and inspect](/docs/guides/verify-and-inspect)
- [Policy reference](/docs/reference/policy)

<!-- concepts/world-and-capabilities -->

---
title: World and capabilities
description: Why a holo declares what it needs, and why it gets nothing until something grants it.
available_in: "0.6"
---
The world says what a holo needs from its host and what it offers back. The capability set says what it is allowed to touch. Together they decide what a running holo can reach.

## Why deny by default

A container starts with broad access and you take some away with flags. A holo starts with none. If a program can only reach what someone wrote down, then reading that list tells you everything it can reach, and the review stays short.

## The world

The world is the holo's contract with its host: its imports and its exports. It plays the part `ENTRYPOINT` and `EXPOSE` play for an image, with the difference that the imports are declared too. Calculator imports nothing and exports `calculate`, so it cannot call anything, whatever a host offers it.

## The capability set

A capability set grants access to three kinds of thing: outbound hosts, key-value stores and variables. Each set has allow and deny lists, and a deny entry always wins. Nothing is reachable until an entry allows it.

```toml
[capabilities]
allow-outbound-hosts = ["https://api.exchange.example"]
```

## How they meet

The two are checked against each other at different moments.

| When | What happens |
| --- | --- |
| `check` | Fails when the world imports more than the capability set allows. |
| `run` | Grants exactly the set, never more. |
| During a call | A call outside the set is refused and the instance sees an error. |

## Next steps

- [Run and gate](/docs/guides/run-and-gate)
- [Manifest reference](/docs/reference/manifest)
- [Provenance and attestations](/docs/concepts/provenance-and-attestations)

<!-- concepts/provenance-and-attestations -->

---
title: Provenance and attestations
description: How a holo records where it came from, and how a signature ties that record to someone.
available_in: "0.5"
---
Provenance is a record of how a holo was built. An attestation is a signed statement about a holo. Provenance answers "what made this", and the signature answers "who says so".

## Why statements live inside the holo

Docker keeps attestations beside an image, as separate objects in a registry. A holo carries its statements in its own attestation section, so they arrive with the file however it reached you. Registries still see them, because `push` also sends them as referrers.

## What provenance records

`build` writes a SLSA provenance statement into every holo, with no flag. Its subjects are the holo's content sections, and it names the SDK image and the inputs from the lockfile.

| Mode | Flag | What it adds | Reproducible |
| --- | --- | --- | --- |
| Minimum | the default, `--provenance=min` | Only what the lockfile and the model already say. | Yes: the same inputs write the same statement. |
| Maximum | `--provenance=max` | The build arguments, the platform, an invocation id and timestamps. | No, which is why it is opt-in. |

## What signing adds

A statement written at build is unsigned, so it says what happened and nothing vouches for it. `attest` signs it, keyless by default: the signature ties it to an identity from your OpenID Connect provider, such as a CI workflow, and a transparency log records it publicly. `verify` then checks the signature against the identity you expect, so you decide who to trust rather than whoever signed last.

## Next steps

- [Reproducible builds](/docs/concepts/reproducible-builds)
- [Attestations reference](/docs/reference/attestations)
- [Audit a holo](/docs/guides/audit)

<!-- concepts/reproducible-builds -->

---
title: Reproducible builds
description: How the SDK image and the lockfile make the same inputs produce the same holo.
available_in: "0.5"
---
A reproducible build means anyone with your inputs gets your bytes. Prism gets there by pinning everything a build reads, and running the build in one fixed place.

## Why it matters

A digest only identifies a build. Reproducibility lets a second person confirm it: they rebuild from your source, compare digests, and need not trust the machine that built the first copy.

## The SDK image

The compiler and the provers run in the SDK image, a Linux image for `linux/amd64` and `linux/arm64`, pulled by digest. It plays the part of a base image pinned with `FROM image@sha256:...`. Nothing on your machine takes part beyond Docker, so your local tools cannot change the result.

## The lockfile

`prismpm.lock` names the SDK image by digest and pins the other inputs of the build. Commit it with your source. Two rules keep it honest:

- `lock` writes pins for what the project already uses, and leaves pins that still resolve as they are.
- `update` is the only verb that moves a pin forward, and it prints the old and new digests.

So a pin never moves as a side effect of a build, and every change to one shows in a diff.

## What can still differ

Maximum provenance adds timestamps and an invocation id, so it gives up identical statements by design. Minimum provenance, the default, stays reproducible. [Rebuild and update](/docs/guides/rebuild-and-update) shows the commands.

## Next steps

- [Rebuild and update](/docs/guides/rebuild-and-update)
- [Lockfile reference](/docs/reference/lockfile)
- [Registries and releases](/docs/concepts/registries-and-releases)

<!-- concepts/registries-and-releases -->

---
title: Registries and releases
description: Why holos use the registries you already run, and how a digest keeps them honest there.
available_in: "1.0-beta"
---
A registry stores and serves holos. Prism has no registry of its own: it uses any registry that speaks the OCI Image and Distribution 1.1 specifications, the one you already use for images.

## Why not a new registry

A new registry would mean new credentials, new access rules and new scanning to set up. A holo travels as an OCI artifact, so your existing registry, its permissions and its retention rules apply as they are.

## What moves

`push` sends the holo and sends its attestations as referrers, so tools that already look up a sha256 digest discover them. `pull` brings both back. A pull that does not match the digest you asked for fails.

Pull by digest when you need exact bytes, and by tag when you want whatever is current. Tags can move, and digests cannot.

## Product releases

A holo is one application. A product release is the root artifact that ties a whole release together: it references the holo, packages, locks and evidence by digest. It plays the part an image index plays in Docker, and it gives you one digest to name what you shipped.

## Next steps

- [Ship a holo](/docs/guides/ship)
- [The holo](/docs/concepts/holo)
- [Reproducible builds](/docs/concepts/reproducible-builds)

<!-- guides/write-from-examples -->

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

<!-- guides/dev-studio -->

---
title: Develop with the studio
description: Watch the model, rebuild and re-check on every save, and read the verdict in a local studio that works offline.
available_in: "0.6"
---
This guide shows you how `dev` keeps a verdict next to your editor: what it watches, what each tab shows, and what to do when a save does not build.

## Start it

Run `dev` in a project directory. It builds once, then rebuilds on every save:

```bash
npx prism-code dev
```

```text
Watching src/**/*.lex.tex, model/**/*.lex.tex, language/**/*.toml, prism.toml, prismpm.toml, lexlean.toml
Studio at http://localhost:4100  tabs: Check, Replay
Building with --update: prismpm.lock follows the model, so commit it with your source
Building
Built Calculator in <seconds>s  Level: P0  FAILED, policy default requires P2
Changed src/Calculator.lex.tex; rebuilding
Built Calculator in <seconds>s  Level: P0  FAILED, policy default requires P2  edit to verdict <seconds>s
```

The default policy asks for level `P2`, so a holo with no signed statements fails it. That verdict is correct. Pass a policy of your own to judge by something else.

Stop it with Ctrl-C.

## The port

The studio's port is **4100**. Pass `--port <n>` to use another one. If the port is in use, `dev` stops and says so, because a studio that moves by itself is one you cannot bookmark.

The studio listens on the loopback address only and answers only requests addressed to `localhost` or `127.0.0.1`. Nothing else on your network can read it, and it has no endpoint that changes anything.

## What it watches

The `[model]` table of `prism.toml` decides. `watch` lists the patterns, `source` watches one directory, and without either `dev` watches the defaults in the output above:

```toml
[model]
source = "model"
build = "prism build"
watch = ["model/**/*.lex.tex", "intent.md", "examples/*.json"]
```

`*` stops at a slash and `**` does not. `prism.toml` and a capability file it names are always watched. `.git`, `.prism`, `.lake`, `.lexlean`, `node_modules` and `target` are never watched, so a build does not trigger itself.

A change means changed bytes. Saving a file without changing it rebuilds nothing. Several saves during one build become one more build, which sees all of them.

## The build

`dev` runs the first of these it finds:

1. `--build <command>`, in a shell.
2. `build` in the `[model]` table of `prism.toml`, in a shell. `prism build` means the next item.
3. `prism-code build --update`, in the SDK image `prismpm.lock` names. This needs Docker.

The default build uses `--update` because a plain build refuses a lock whose model pin is stale, which every edit makes it. So `prismpm.lock` follows your model as you save. Commit it with your source.

A build command from `prism.toml` runs on your machine with your permissions, as an npm script does. Read the manifest of a project you did not write before you run `dev` in it.

`dev` judges the holo the build reports. A custom command that prints no build result must write a `.holo` during the run, or name its file with `--holo <path>`. A build that exits 0 and names no holo gets no verdict, rather than a verdict on an older file.

## The Check tab

The Check tab shows the verdict `check` prints for the same holo:

- **The verdict.** `PASSED` or `FAILED`, the level, the policy and the digest.
- **Each reason.** The check id, its diagnostic, the level it withholds and a sentence.
- **In this page.** The page fetches the holo and judges it again with `@prism-code/verify`, and says whether the two verdicts agree.
- **Last cycle.** The files that changed, the time from your edit to the verdict, and the build and check times.

Pass `--policy <file>` to judge by a policy file, or the name of a shipped policy, as for `check`. An edit to a policy file re-checks the same holo without a build.

When a build fails, the tab shows `BUILD FAILED` and the end of its output. The last verdict stays below it, labeled as describing source that has since changed. While a build runs, a line at the top says that what follows describes the last finished build.

## The Replay tab

The Replay tab shows whether the build still reproduces its recorded histories. Until `prism replay` ships in the runtime, it says `Replay unavailable` and shows nothing else.

## Working offline

The studio needs no network. Its page, styles, scripts and verifier ship in the package, and it loads no fonts or scripts from anywhere else. Every response carries a content security policy that lets the page reach only its own origin, so a request to any other address fails in the browser.

The build is separate. `prism-code build` needs the SDK image on your machine, and it fetches any input it does not have.

## Next steps

- [Write the model](/docs/guides/write-the-model)
- [Verify and inspect](/docs/guides/verify-and-inspect)
- [Run and gate](/docs/guides/run-and-gate)

<!-- guides/verify-and-inspect -->

---
title: Verify and inspect
description: Check a holo against a policy, read the verdict, and look inside without running it.
available_in: "0.6"
---
This guide shows you how to decide whether a holo may run, and how to look inside one without running it. Both work on a holo you built and on one you pulled.

## Check against the default policy

`check` verifies five things: the digest, the provenance, the proof, the lockfile pins, and the declared world against policy. The default policy requires P2 or above and a world within the granted capabilities.

The quickstart showed a pass. Here is a fail. Suppose a new build of calculator fetches exchange rates, but `prism.toml` still allows no outbound hosts:

```bash
prism check calculator@sha256:8a41…
```

```text
calculator@sha256:8a41…
  digest        ok    matches
  provenance    ok    built from model sha256:c05d… in SDK image sha256:91ab…
  proof         ok    2 theorems checked
  lockfile      ok    all pins match prismpm.lock
  replay        ok    1 history, 1 call, no divergence
  world         FAIL  imports outbound host api.exchange.example, capability set allows none
Verdict: FAIL  Level: P2  (policy: default, requires P2 and world within capabilities)
```

The level is still P2, because the proof is fine. The verdict is FAIL, because the world asks for more than the capability set gives. Add the host to `[capabilities]` or remove the import. Nothing else changes the verdict.

## Check against your own policy

A policy file replaces the default. It sets the lowest assurance level that passes and what else must be true of the holo. The [Policy reference](/docs/reference/policy) has the format and two worked examples, `pure-only` and `provenance-only`. Pass one to `check`:

```bash
prism check --policy policy
```

```text
calculator@sha256:3f9c…
  digest        ok    matches
  provenance    ok    built from model sha256:7d2e… in SDK image sha256:91ab…
  proof         ok    2 theorems checked
  lockfile      ok    all pins match prismpm.lock
  replay        ok    1 history, 1 call, no divergence
  world         ok    imports none, exports calculate, within policy
Verdict: PASS  Level: P3  (policy: policy, requires P3)
```

The same flag works on `run`. Keep the policy file in the repository and point CI at it.

## Read the verdict in CI

Every verb takes `--json`. The verdict becomes one `prism/verdict/1` object: the archive fingerprint, the computed level, the policy, whether it passed, and the reason for every check that did not:

```bash
prism check calculator@sha256:3f9c… --json
```

```json
{"holo":"blake3:8408…","level":"P2","passed":true,"policy":{"minimum":"P2","name":"default"},"reasons":[{"check":"replay.statement","message":"The holo carries no replay statement.","withholds":"P3"}],"schema":"prism/verdict/1"}
```

Exit codes are the contract. 0 is pass. 1 is fail, and `reasons` says why. 2 means `check` reached no verdict, for example when the file is not a holo, the policy cannot be read, or the format revision is unknown. Treat 2 as a fail in CI. It is not a pass you have not looked at yet. On exit 2, stdout is empty and the cause is on stderr.

The exit code is all a CI step needs, and `prism-code` runs it today with no Docker and no `prism` binary. The sample holo is unsigned, so it is P0. These three runs were captured here, each on the same file. The default policy fails it with exit 1, `pure-only` accepts P0 and exits 0, and `provenance-only` asks for P1 and exits 1:

```bash
prism-code check Calculator.holo # exit 1
prism-code check Calculator.holo --policy pure-only
prism-code check Calculator.holo --policy provenance-only --json # exit 1
```

```text
FAILED  P0 unverified  policy default requires P2 or above
holo    Calculator.holo
digest  blake3:8408e0895572fab09e783f7aadb129dc4cb96d0b62850a16f3ddbe44ed6021ba

Reasons:
  provenance.statement (Verification, withholds P1)
    The holo carries no provenance statement; format revision 2026-10-23 has no attestation bundle (issues #267 and #268).
  proof.statement (ProofMismatch, withholds P2)
    The holo carries no proof statement (issue #266).
  replay.statement (Replay, withholds P3)
    The holo carries no replay statement (issue #284).
  policy.level (PP5601, Verification, policy rule)
    The level is P0; the policy requires P2 or above.
PASSED  P0 unverified  policy pure-only requires P0 or above
holo    Calculator.holo
digest  blake3:8408e0895572fab09e783f7aadb129dc4cb96d0b62850a16f3ddbe44ed6021ba

Reasons:
  provenance.statement (Verification, withholds P1)
    The holo carries no provenance statement; format revision 2026-10-23 has no attestation bundle (issues #267 and #268).
  proof.statement (ProofMismatch, withholds P2)
    The holo carries no proof statement (issue #266).
  replay.statement (Replay, withholds P3)
    The holo carries no replay statement (issue #284).
{"holo":"blake3:8408e0895572fab09e783f7aadb129dc4cb96d0b62850a16f3ddbe44ed6021ba","level":"P0","passed":false,"policy":{"minimum":"P1","name":"provenance-only"},"reasons":[{"check":"provenance.statement","message":"The holo carries no provenance statement; format revision 2026-10-23 has no attestation bundle (issues #267 and #268).","withholds":"P1"},{"check":"proof.statement","message":"The holo carries no proof statement (issue #266).","withholds":"P2"},{"check":"replay.statement","message":"The holo carries no replay statement (issue #284).","withholds":"P3"},{"check":"policy.level","code":"PP5601","message":"The level is P0; the policy requires P1 or above.","withholds":null},{"check":"policy.provenance-only.absent","message":"The holo carries no provenance statement.","withholds":null}],"schema":"prism/verdict/1"}
```

A holo reaches P1 and P2 only through signed statements it carries, and `check` believes a signature only from the signer you name. Pass the public key that signs your releases, or the identity and issuer of your keyless signer:

```bash
npx prism-code check dist/calculator.holo --key release.pub.pem --json > verdict.json
npx prism-code check dist/calculator.holo \
  --certificate-identity-regexp '^https://github.com/acme/calculator/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --trusted-root trusted_root.json --json > verdict.json
```

Without a signer a signed holo is P0, because a signature nobody checked is no evidence. The provenance statement supports P1, the proof statement P2. A proof statement that is about another guest, or a guest changed after signing, fails with `ProofMismatch` (`proof.subject`, `PP5503`) and exits 1.

A GitHub Actions job gates the deploy on the exit code and keeps the verdict when the check fails:

```yaml
- name: Check the holo
  run: npx prism-code check dist/calculator.holo --key release.pub.pem --json > verdict.json
- name: Keep the verdict
  if: failure()
  uses: actions/upload-artifact@v4
  with:
    name: verdict
    path: verdict.json
```

## Assurance levels in practice

You see each level in a predictable place.

- P0 appears on a holo built with `--no-provenance`, or on one whose provenance you cannot read. Do not run it.
- P1 appears when provenance is present but the proof is missing or does not match. Something changed after the build.
- P2 is the default floor. The proof matches the holo and every theorem checked.
- P3 is P2 plus every history replayed and the world within policy. Require it for anything that touches a host.

## Inspect without running

`inspect` prints the manifest, the section digests, the format revision, the world and the attestations. It never instantiates the holo:

```bash
prism inspect calculator@sha256:3f9c…
```

```text
calculator@sha256:3f9c…  format revision 2026-10-23  24.8 KB
Sections
  app-manifest            sha256:0088…   application calculator 0.1.0
  source-manifest         sha256:c0ee…
  application-directory   sha256:9145…
  model-provenance        sha256:6679…   model sha256:7d2e…
  guest                   sha256:cb9f…   WebAssembly, 10.5 KB
  view                    sha256:d817…   portable view
  capability-set          sha256:c857…   requests nothing
  model-document          sha256:8b17…   function calculate
  attestation-bundle      sha256:e9d1…   provenance, proof, replay
World
  imports  none
  exports  calculate(input: Input) -> Output
Attestations
  provenance  signed, keyless, transparency log entry present
  proof       2 theorems, checked at build
  replay      1 history, 1 call
```

Every section has a sha256 and a BLAKE3 digest over the same bytes. `--json` prints both. Pass `--format world` or `--format attestations` to print one part. The Rust CLI inspects a holo file with the same value: `prismpm inspect Calculator.holo --json` prints `prismpm/holo-inspection/1` for the archive, and `prismpm inspect Calculator.holo --format sections[0].digest.sha256` prints one value. Pass `--audit` for the security view, which [Audit a holo](/docs/guides/audit) walks through.

## Next steps

- [Run and gate](/docs/guides/run-and-gate)
- [Audit a holo](/docs/guides/audit)
- [Policy reference](/docs/reference/policy)

<!-- guides/run-a-holo -->

---
title: Run a holo
description: One run of a holo is a container, with a state, an exit code and its output, kept until you remove it.
available_in: "0.6"
---
A holo is an image. Each run of it is a container: an object with a state, a start and finish time, an exit code and the output the program returned. It works the way `docker run` works, so what you know about containers applies here.

## Run one

`prism.containers.run(image, input)` returns the container after it exits. The image is a path, a URL, bytes, a `Blob`, or a holo you already opened with `load`. The input is a string or bytes:

```js
import { prism } from 'prism-code';

const container = await prism.containers.run('./Calculator.holo', '1\tadd\t20\t22', {
  policy: { minimum: 'P0' },
});

const { image, state } = await container.inspect();
console.log(state.status, state.exitCode, image.digest);
console.log(JSON.stringify(container.text()));

await container.remove();
```

```text
exited 0 blake3:8408e0895572fab09e783f7aadb129dc4cb96d0b62850a16f3ddbe44ed6021ba
"1\tok\t42"
```

A run is checked first, as in [Run and gate](/docs/guides/run-and-gate). This example names a policy that accepts the sample holo, because no holo carries a signed statement yet and the default policy requires P2.

The command line does the same. Standard output holds the program's output and nothing else, and the process exits with the container's code:

```bash
prism-code run Calculator.holo "$REQUEST" --policy policy.json
```

```text
1	ok	42
container 3f9c7a…e1 exited 0
```

`--input` is the same as the second argument. Without an input, `prism-code run` serves the holo's view on a port, as it always has. A served holo is not a container yet.

## The states

A container is `created`, `running` or `exited`.

```text
created --start--> running --returned or threw--> exited --start--> running
   |                                                 ^
   +------------- check refused the holo ------------+
```

- **`created`.** The image is open and its digest is known. Nothing has run. An image that cannot be opened makes no container, and `create` and `run` reject with the typed error.
- **`running`.** The check passed and the program has the input.
- **`exited`.** The run is over and `exitCode` is set. A holo that `check` refuses goes straight here, with `startedAt` null, which says the program never ran.

The two-step form separates the first two:

```ts
const container = await prism.containers.create("./Calculator.holo", request, { policy });
await container.start();
```

`start` resolves when the container has exited, and a failed run is an exit code, never a rejection. Starting an exited container runs it again from the same input. A second `start` while it runs joins that run.

## Inspect it

`container.inspect()` reports the state, the exit code and the digest of the image it ran:

```json
{
  "schema": "prism/container/1",
  "id": "3f9c7a…e1",
  "image": { "name": "Calculator", "kind": "holo", "digest": "blake3:8408e089…" },
  "created": "2026-10-30T09:14:02.118Z",
  "rm": false,
  "state": {
    "status": "exited",
    "exitCode": 0,
    "error": null,
    "startedAt": "2026-10-30T09:14:02.131Z",
    "finishedAt": "2026-10-30T09:14:02.133Z"
  },
  "verdict": { "schema": "prism/verdict/1", "level": "P0", "passed": true },
  "output": { "encoding": "utf-8", "data": "1\tok\t42" }
}
```

`verdict` is the whole verdict of the check, shortened here. `output.encoding` is `hex` when the bytes are not text. From the command line, a container's id or a unique prefix of it works where a holo path does:

```bash
prism-code inspect 3f9c7a --format state.exitCode
```

## Remove it

A container is kept until you remove it. In the SDK it lives in memory, so a long-running program removes what it runs. The command line keeps one JSON file per container in `$PRISM_HOME/containers`, by default `~/.prism/containers`, readable only by you. A record holds the output and never the input.

`--rm`, and the SDK's `rm: true`, remove the container when it exits, whatever its exit code:

```bash
prism-code run Calculator.holo "$REQUEST" --policy policy.json --rm
```

```ts
const container = await prism.containers.run("./Calculator.holo", request, { policy, rm: true });
container.exitCode; // 0
container.text();   // "1\tok\t42"
```

The object you hold keeps `status`, `exitCode`, `error` and `output`. `inspect()` rejects with `container.missing`, because the container is gone, as `docker inspect` does.

To remove one yourself, call `container.remove()` or `prism.containers.remove(id)`, or run:

```bash
prism-code rm 3f9c7a
```

A running container cannot be removed.

## Exit codes

A container exits 0 on success. Otherwise the code follows the typed error that ended the run, and `container.error` is that error. `prism-code` exits with the same codes, from the same table.

| Exit | Error | Meaning |
| --- | --- | --- |
| 0 | none | The guest returned its output. |
| 1 | `VerificationError`, with a verdict | The holo failed check, for an archive, document, provenance or policy reason. |
| 2 | `VerificationError`, no verdict | Check could not reach a verdict: an unreadable policy, a closure, an unknown format revision. |
| 2 | `PrismCodeError` | The artifact was refused, or dispatch refused the request: a bad archive, a request over the guest allocation. |
| 2 | `CapabilityDeniedError` | The world exceeds the granted capabilities, or the runtime denied an import or a resource. |
| 3 | `SigningError` | A signature could not be produced. |
| 10 | `ProofMismatchError` | A proof check failed: the statement is absent, malformed, or about another holo. |
| 11 | `WorldMismatchError` | The guest does not have the interface of its declared world, or the world is not the one pinned. |
| 12 | `DeterminismViolationError` | A replay produced output that differs from the recorded history. |
| 13 | `ReplayError` | A replay could not be carried out, or the replay statement failed. |
| 1 | `SignatureInvalidError` | An attestation did not verify: its signature. |
| 1 | `IdentityMismatchError` | An attestation did not verify: its signer. |
| 1 | `TransparencyError` | An attestation did not verify: its log entry or timestamp. |
| 1 | `SubjectMismatchError` | An attestation did not verify: its subject. |
| 1 | `AttestationNotFoundError` | An attestation did not verify: there is none. |
| 1 | `TrustRootError` | An attestation did not verify: the trusted root is unusable. |
| 1 | `PolicyDeniedError`, with a verdict | A policy rule denied the holo. |
| 2 | `PolicyParseError`, no verdict | A policy did not parse. |
| 2 | `PolicyEvaluationError`, no verdict | A policy could not be evaluated. |
| 2 | `RegistryError` | The registry or store failed. |
| 2 | `RegistryAuthError` | The registry refused the credentials. |
| 2 | `ReferrersUnsupportedError` | No referrers API or tag. |
| 2 | `ManifestNotFoundError` | The reference names nothing. |
| 1 | `DigestMismatchError` | Bytes differ from their digest. |
| 1 | `PullVerificationError` | A pulled holo failed verification. |
| 1 | `ReferenceInvalidError` | Not a registry or store reference. |
| 2 | `ProviderNotFoundError` | No provider on the PATH. |
| 2 | `ProviderReplyError` | A provider broke the protocol. |
| 2 | `ProviderFailedError` | A provider failed. |
| 2 | `ExportMismatchError` | A browser export differs from its release. |
| 1 | `MiddlewareError` | A middleware threw something untyped. |
| 1 | `PrismError` | Any other typed error. |
| 70 | anything else | Dispatch threw something untyped: a guest trap, or a bug in the runtime. |

The table is `EXIT_CODES` in `prism-code`, and `exitCodeFor(error)` reads it. A response the program returns is exit 0 even when it says the request was bad: the protocol's error is the program's output, not a failed run.

`check` reports a verdict and not an error, so it keeps its own three codes: 0 passed, 1 failed, 2 no verdict. `prism-code` also exits 64 for wrong arguments and 69 when Docker is missing.

## Next steps

- [Run and gate](/docs/guides/run-and-gate)
- [Verify and inspect](/docs/guides/verify-and-inspect)
- [TypeScript SDK](/docs/sdks/typescript)

<!-- guides/run-and-gate -->

---
title: Run and gate
description: Run a checked holo with exactly its capability set, and decide what happens when the check fails.
available_in: "0.6"
---
This guide shows you how `run` gates on `check`, how to declare what a holo may touch, how to set it per target, and what the one escape hatch costs.

## The gate

`run` never starts an instance it has not checked. It runs `check` at the policy's level first. On exit code 0 it instantiates the holo and grants exactly the capability set. On 1 or 2 it stops and prints the verdict, and `run` exits with the [code of the reason](/docs/guides/run-a-holo). Pass a stricter policy the same way you do for `check`:

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

- [Run a holo](/docs/guides/run-a-holo)
- [Ship a holo](/docs/guides/ship)
- [Verify and inspect](/docs/guides/verify-and-inspect)
- [Manifest reference](/docs/reference/manifest)

<!-- guides/write-a-middleware -->

---
title: Write a middleware
description: Add your own code around the steps the runtime performs, and trace each step with OpenTelemetry.
available_in: "1.0-beta"
---
This guide shows you how to put code around what the runtime does with a holo: checking it, starting an instance, running a request, and keeping the exchange. Tracing is the first middleware that ships, and you add it the same way.

The middleware API is experimental. Pin the exact `prism-code` version if you use it.

## The four steps

The runtime performs four steps. Each one has its own chain of middleware, and each middleware wraps exactly that step.

| Step | When it runs | Takes | Returns |
| --- | --- | --- | --- |
| `verify` | `app.experimental_verify(options)` | `{ options }` | the verdict |
| `instantiate` | every `dispatch`, before the request runs | `{ module, imports }` | a `WebAssembly.Instance` |
| `dispatch` | every `dispatch` | `{ request, instance }` | the response bytes |
| `record` | every `dispatch`, after the response | `{ request, response }` | the response bytes |

`instantiate` is where imports are linked, so a check of what a holo may touch fits there. `record` keeps nothing by itself; a middleware there sees every exchange and can keep it. A closure starts its instance once, when it loads, so it runs `verify`, `dispatch` and `record` only. `acceptance()` dispatches each example, so it runs through the same steps.

## Write one

A middleware is a function that takes `next` and a context and returns a handler. The handler gets the step's arguments, calls `next(args)` to run the rest of the step, and returns the result. It can read or change the arguments on the way in and the result on the way out.

```js
const sizes = (next, context) => async (args) => {
  const response = await next(args);
  console.log(`${context.step}: ${args.request.length} bytes in, ${response.length} bytes out`);
  return response;
};
```

`context.step` is the step and `context.application` is the application. Add the middleware to the application's stack with its step, a name and any tags:

```js
app.experimental_middleware.add(sizes, { step: 'dispatch', name: 'sizes', tags: ['example'] });
```

Here it is with tracing, run against Calculator:

```js
import { load, experimental_tracing } from 'prism-code';

const app = await load('./Calculator.holo');
const stack = app.experimental_middleware;

// A middleware at the dispatch step: it sees the request, calls next, and sees the response.
stack.add(
  (next, context) => async (args) => {
    const response = await next(args);
    console.log(`${context.step}: ${args.request.length} bytes in, ${response.length} bytes out`);
    return response;
  },
  { step: 'dispatch', name: 'sizes', tags: ['example'] },
);

// Tracing takes any OpenTelemetry tracer. This stand-in prints each span as it ends.
const tracer = {
  startActiveSpan(name, options, fn) {
    const span = {
      attributes: { ...options.attributes },
      setAttribute(key, value) { span.attributes[key] = value; },
      setAttributes(more) { Object.assign(span.attributes, more); },
      recordException() {},
      setStatus() {},
      end() { console.log(`span ${name}`, JSON.stringify(span.attributes)); },
    };
    return fn(span);
  },
};
stack.use(experimental_tracing({ tracer, steps: ['dispatch', 'record'] }));

console.log(stack.identify().map((entry) => `${entry.step}:${entry.name}`).join(' '));
await app.dispatch(new TextEncoder().encode('1\tadd\t20\t22'));
```

```text
dispatch:tracing.dispatch dispatch:sizes record:tracing.record
dispatch: 11 bytes in, 7 bytes out
span prism.dispatch {"prism.step":"dispatch","prism.application.name":"Calculator","prism.application.kind":"holo","prism.request.size":11,"prism.response.size":7}
span prism.record {"prism.step":"record","prism.application.name":"Calculator","prism.application.kind":"holo","prism.request.size":11,"prism.response.size":7}
```

## Order

Within a step, the first middleware is the outermost: it sees the arguments first and the result last. The order is set three ways.

- `priority`: `high`, then `normal` (the default), then `low`. Ties keep the order you added them in.
- `addRelativeTo(middleware, { relation: 'before', toMiddleware: 'sizes', name })` places a middleware next to a named one, at that one's step. `after` places it on the other side. Several placed on the same side keep the order you added them in.
- The named middleware may be added later. It must be on the stack when the step runs, or the step fails with `middleware.relative`.

`app.experimental_middleware.identify()` lists every entry in the order it runs.

## Tags, removal and replacement

Names are unique. Adding a second middleware with a name already on the stack fails with `middleware.name`, unless you pass `override: true`, which replaces the first.

- `remove('sizes')` removes by name, and `remove(sizes)` by the function itself.
- `removeByTag('example')` removes every middleware with that tag.
- `clone()` copies the stack, so you can change the copy and leave the original alone.

## Package middleware as a pluggable

A pluggable is an object with `applyToStack(stack)`. It adds one or more middleware in one call, and `use` applies it:

```js
const timing = {
  applyToStack(stack) {
    stack.add(sizes, { step: 'dispatch', name: 'sizes', tags: ['timing'] });
  },
};
app.experimental_middleware.use(timing);
```

Tracing is a pluggable. So is anything you want to hand to another team as one piece.

## Errors

A middleware that throws a `PrismError` keeps it: a capability check that throws `CapabilityDeniedError` reaches the caller as `CapabilityDeniedError`. A middleware that throws anything else raises `MiddlewareError` (`middleware_failed`). Its `details` name the middleware, its step and its tags, and its `cause` is what was thrown. An error from the runtime, or from a middleware further in, passes through each middleware unchanged, so it is never blamed on one that only passed it on.

## Trace with OpenTelemetry

`experimental_tracing({ tracer })` adds one middleware per step, named `tracing.<step>` and tagged `tracing`, first in its step. Each step becomes a span named `prism.<step>`, with these attributes:

| Attribute | On |
| --- | --- |
| `prism.step` | every span |
| `prism.application.name`, `prism.application.kind` | every span |
| `prism.request.size`, `prism.response.size` | `dispatch` and `record` |
| `prism.verdict.level`, `prism.verdict.passed` | `verify` |
| `prism.error.code` | a span whose step failed, with an error status and the exception |

Pass the tracer from your own OpenTelemetry setup:

```js
import { trace } from '@opentelemetry/api';
import { experimental_tracing } from 'prism-code';

app.experimental_middleware.use(experimental_tracing({ tracer: trace.getTracer('my-service') }));
```

`prism-code` does not depend on `@opentelemetry/api`. Tracing uses only the tracer you pass, so an application that does not trace installs nothing extra. Spans start with `startActiveSpan`, so a span you have open around `dispatch` is their parent. Pass `steps` to trace only some steps, and `removeByTag('tracing')` to stop.

## Next steps

- [Run and gate](/docs/guides/run-and-gate)
- [Dispatch inputs](/docs/api/dispatch)
- [Error types](/docs/api/errors)

<!-- guides/ship -->

---
title: Ship a holo
description: Push and pull holos through any registry, publish to GitHub Pages, and export for Docker.
available_in: "1.0-beta"
---
This guide moves a built holo from your machine to wherever it runs. Every path carries the attestations with the holo, so `check` gives the same verdict on the other side.

## Push to a registry

`push` sends the holo to any OCI-compatible registry. The attestations go with it as referrers, so tools that already read sha256 digests discover them:

```bash
prism push calculator ghcr.io/you/calculator
```

```text
Pushing calculator@sha256:3f9c… to ghcr.io/you/calculator
  holo           24.8 KB   sha256:3f9c…
  attestations   provenance, proof, replay   as referrers
Pushed ghcr.io/you/calculator@sha256:3f9c…
```

Pass `--store <dir>` to push to a local directory store instead, for offline use. `pull --store <dir>` reads the same store.

## Pull from a registry

`pull` fetches a holo and its attestations by name or digest. Pull by digest when you want the exact bytes a lockfile pins:

```bash
prism pull ghcr.io/you/calculator@sha256:3f9c…
```

```text
Pulling ghcr.io/you/calculator@sha256:3f9c…
  holo           24.8 KB   digest matches
  attestations   provenance, proof, replay
Pulled calculator@sha256:3f9c…
```

A pulled holo whose digest does not match the reference is discarded. Run `check` after every pull, or pass `--check` to `pull`. It costs nothing and it is the whole point.

## Deploy to GitHub Pages

`deploy` publishes the holo to a GitHub repository and serves it from GitHub Pages. The attestations are served alongside, so a browser can verify the holo with `@prism-code/verify` before loading it:

```bash
prism deploy
```

```text
Publishing calculator@sha256:3f9c… to github.com/you/calculator
  holo           24.8 KB
  attestations   provenance, proof, replay
  pages          https://you.github.io/calculator/
Done.
```

The page serves the holo, the six-file browser export, and the attestation bundle. Nothing on the page is built by the page. It is the same holo you checked.

## Export for the browser

`export` writes the six-file browser export, or a tarball of the same files. Use it when you host the files yourself:

```bash
prism export --out dist
```

```text
Exporting calculator@sha256:3f9c… to dist/
  index.html  app.js  app.css  calculator.js  calculator_bg.wasm  provenance.json
Exported 6 files
```

`provenance.json` names the digest of every other file, so a browser can confirm each one before it runs. Serve `dist/` from any static host. A cache cannot serve a stale file as a fresh one without the digest check failing.

## Export for Docker

`export --oci` writes a runnable OCI image. Docker serves the holo, and the instance inside still passes through `check` on start:

```bash
prism export --oci calculator:1.0
```

```text
Exporting calculator@sha256:3f9c… as OCI image calculator:1.0
  layer  holo + attestations   24.8 KB
  layer  runtime               1.9 MB
Exported calculator:1.0 (sha256:d04a…)
```

Run it the way you run anything else:

```bash
docker run -p 8080:8080 calculator:1.0
```

```text
Check: PASS  Level: P3
Serving calculator@sha256:3f9c… on :8080
```

The holo digest `3f9c…` is unchanged inside the OCI image. The OCI digest `d04a…` covers the runtime layer as well. Pin whichever one your deployment reads.

## Next steps

- [Use with agents](/docs/guides/agents)
- [Audit a holo](/docs/guides/audit)
- [CLI reference](/docs/reference/cli)

<!-- guides/rebuild-and-update -->

---
title: Rebuild and update
description: Reproduce a pinned build, confirm its digest, and move a pin forward on purpose.
available_in: "0.5"
---
This guide is for the developer who maintains a holo after its first release. You rebuild from a pinned checkout, confirm the same bytes come out, and update the pins when you choose to.

## Rebuild from a pinned checkout

Check out the commit you want, then confirm the lockfile still matches the project before you build:

```bash
prism lock --check
prism build --no-cache
```

`lock --check` writes nothing and fails naming any pin that differs. `--no-cache` makes the build run in full rather than reuse an earlier result. Compare the digest it prints with the one you released. The same digest means you have the same bytes, so anything you learned about the released holo holds for this one.

If the digests differ, read the two holos side by side with `prism inspect`, and start with their provenance.

## Refresh the lockfile

Write or refresh the lockfile after you add an input, without building:

```bash
prism lock
```

Pins that still resolve stay as they are, and the SDK image does not move. It exits 2 when there is no lockfile or its SDK cannot be resolved.

## Update on purpose

See what an update would change without writing anything:

```bash
prism update --dry-run
```

Then choose how far to go. With no flag, `update` refreshes the toolchain pins. With `--toolchain`, it also pins a new SDK image:

```bash
prism update
prism update --toolchain <ref>
```

Either command prints the old and new digest of every pin that moved. Add `--standards-lock <digest>` to `--toolchain` when the new image should select a standards lock other than the project's.

## Confirm nothing changed

An update can change behaviour, so check before you release. Rebuild, check the holo, and replay your histories against the new build:

```bash
prism build
prism check
prism replay examples/
```

A replay that diverges names the first call that differs. Commit `prismpm.lock` with the change, so the update shows in review as a diff of digests.

## Next steps

- [Reproducible builds](/docs/concepts/reproducible-builds)
- [Lockfile reference](/docs/reference/lockfile)
- [Verify and inspect](/docs/guides/verify-and-inspect)

<!-- guides/agents -->

---
title: Use with agents
description: Give an agent a holo as a tool, serve it over MCP, or let an agent write the model.
available_in: "1.0-beta"
---
This guide covers three ways agents and holos meet. An agent can call a holo as a tool, an agent can reach it as a Model Context Protocol server, and an agent can write the model that becomes a holo. In every case the holo is checked before the first call.

## As a tool with the Vercel AI SDK

`asTool(holo)` returns a tool shaped for the Vercel AI SDK: an `inputSchema` taken from the holo's world and an `execute` that dispatches to a checked instance. The agent sees a typed tool. It cannot see or change the capability set:

```ts
import { generateText } from "ai";
import { load, asTool } from "prism-code";

const holo = await load("calculator@sha256:3f9c…");

const result = await generateText({
  model: languageModel,
  tools: { calculator: asTool(holo) },
  prompt: "What is 2 plus 3?",
});
```

```text
tool call    calculator  {"op": "add", "a": 2, "b": 3}
tool result  5
```

`asTool` runs `holo.verify()` before the first `execute` and throws `VerificationError` when the verdict is not a pass. Every call is recorded in the instance history, so an agent session replays like any other run. An input outside the schema is rejected before it reaches the instance.

## As an MCP server

`@prism-code/mcp` exposes a holo as a Model Context Protocol server. Each export in the world becomes one tool. Start it on standard input and output:

```bash
npx @prism-code/mcp calculator@sha256:3f9c…
```

```text
Checked calculator@sha256:3f9c…  Level: P3
MCP server on stdio.  Tools: calculate
```

Point any MCP client at it. For a client that reads a JSON configuration:

```json
{
  "mcpServers": {
    "calculator": {
      "command": "npx",
      "args": ["@prism-code/mcp", "calculator@sha256:3f9c…"]
    }
  }
}
```

The server refuses to start when the check fails, and it grants the instance exactly the capability set from the holo. The agent gets the tool description from the world, so it never guesses at the input shape.

## Let an agent write the model

This is what `build` does when you give it examples and intent instead of model files. `build` opens a Model Context Protocol session with an agent, hands it the examples, the intent and the types, and asks for model files. The compiler compiles them, the provers try every intent sentence, and each unproved sentence goes back to the agent with a counterexample. The loop ends when every sentence is a theorem or the agent runs out of attempts. `prism build --max-iterations <n>` sets how many attempts it gets.

Agents are good at this loop because the report is precise. It names the sentence, gives one input that breaks it, and says nothing else. The agent fixes the model, not the sentence, because the sentence is yours.

The result is the same holo a person would produce. `model/` is written to disk, committed, and pinned by digest in the lockfile. `check` does not know or care who wrote the model. The proof is what it reads.

To review what the agent wrote, read `model/` and run `inspect`. To stop an agent from touching the model, write it yourself and point the `[model]` table of `prism.toml` at it, as [Write the model](/docs/guides/write-the-model) describes.

## Next steps

- [Write from examples](/docs/guides/write-from-examples)
- [Audit a holo](/docs/guides/audit)
- [Use a holo as a tool](/docs/api/as-tool)

<!-- guides/audit -->

---
title: Audit a holo
description: Read the security view of a holo, export the report, and know exactly what the proof covers.
available_in: "1.0-beta"
---
This guide is for the person who signs off on what runs. You get the security view of a holo in one command, a report to file, a signature to verify, and a plain statement of what the proof does and does not cover.

## What you are auditing

A holo is one file. It carries its manifest, its model, its program and an attestation bundle, under one digest. The same bundle rides with the holo in every registry, so what you audit on your machine is what runs in production.

## Print the security view

`inspect --audit` prints everything that bears on trust and nothing that does not. It never runs the holo:

```bash
prism inspect calculator@sha256:3f9c… --audit
```

```text
calculator@sha256:3f9c…   format revision 2026-10-23
Built         2026-10-23T10:12:44Z in SDK image sha256:91ab…
Source        model sha256:7d2e…  lockfile pins match
Signed        keyless  identity https://github.com/you/calculator/.github/workflows/release.yml@refs/tags/v0.1.0
              issuer https://token.actions.githubusercontent.com
              transparency log entry 1184…  signed timestamp 2026-10-23T10:12:51Z
Proof         2 theorems checked
              add is commutative.
              The result never exceeds 32 bits.
Replay        1 history, 1 call, no divergence
World         imports none   exports calculate
Capabilities  hosts none   stores none   environment none
Level         P3
```

Read it in three passes. Who built it and from what: Built, Source, Signed. What was proved: Proof and Replay, with every intent sentence spelled out. What it can reach: World and Capabilities.

## Export the report

The same view exports as one JSON document, suitable for filing or for a ticket:

```bash
prism inspect calculator@sha256:3f9c… --audit --report calculator-audit.json
```

```json
{"ref": "calculator@sha256:3f9c…", "level": "P3", "built": {"toolchain": "sha256:91ab…", "at": "2026-10-23T10:12:44Z"}, "proof": {"theorems": 2, "checked": 2, "sentences": ["add is commutative.", "The result never exceeds 32 bits."]}, "world": {"imports": [], "exports": ["calculate"]}, "capabilities": {"hosts": [], "stores": [], "environment": []}}
```

The report comes from the holo, not from the build machine. Anyone with the same digest produces the same report.

## Verify the signature

The attestations are signed keyless by default, with a transparency log entry and a signed timestamp. `verify` checks the signature against the identity you expect:

```bash
prism verify calculator@sha256:3f9c… --certificate-identity https://github.com/you/calculator/.github/workflows/release.yml@refs/tags/v0.1.0 --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

```text
Verified 3 attestations on calculator@sha256:3f9c…
  provenance  signed by the expected identity, log entry 1184…
  proof       signed by the expected identity
  replay      signed by the expected identity
```

For an air-gapped site, sign with `attest --key` and verify with `verify --key`. The holo format is the same.

## What the proof covers

The proof is machine-checked evidence, produced at build and checked at `check`, of three things.

- The program in the holo is the compiled model. Not a similar one, this one.
- Every intent sentence holds for every input the types allow. Not for the examples, for all of them.
- Every recorded history replays on this build without divergence.

If any of the three fails, there is no P2 or P3 and `run` does not start.

## What the proof does not cover

- The proof checker, which is the Lean 4 kernel, and the SDK image are trusted, not proven. The compiler and the provers run in a pinned SDK image whose digest is in the lockfile. Their correctness is assumed. Pin the digest and review what is in the SDK image.
- The intent sentences are yours. The proof shows the sentences hold. It does not show that the sentences are the right ones. An audit reads every sentence and asks what is missing.
- The host enforces the capability set. The proof covers what the holo asks for. The runtime decides what it gets. Use a runtime that passes `@prism-code/conformance`.
- Anything beyond the world is outside the proof. A host you allowed can return anything. The proof says what the holo does with it, not what it is.

A holo at P3 matches its stated intent, was built by a known toolchain, and is signed by a known identity. That is the statement. It says nothing about the toolchain, the host or the intent itself.

## Next steps

- [Verify and inspect](/docs/guides/verify-and-inspect)
- [Attestations reference](/docs/reference/attestations)
- [Policy reference](/docs/reference/policy)

<!-- guides/write-the-model -->

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

<!-- examples/call-a-holo -->

---
title: Call a holo
description: Load the sample holo, send it one request and replay its examples from JavaScript.
available_in: "0.2.0"
---
This example loads the sample calculator, sends it one request and replays the examples it carries. Every output on this page was captured by running the code.

Install the runtime, then run the script from the directory that holds the sample holo, `node_modules/prism-code/fixtures`:

```bash
npm install prism-code
```

```js
import { load } from 'prism-code';

const app = await load('./Calculator.holo');
console.log(app.name, app.identities.verified);

const response = await app.dispatch(new TextEncoder().encode('1\tadd\t20\t22'));
console.log(JSON.stringify(new TextDecoder().decode(response)));

const result = await app.acceptance();
console.log(result.passed, 'of', result.total, 'examples replayed');
```

```text
Calculator true
"1\tok\t42"
22 of 22 examples replayed
```

The request is bytes, because the runtime moves bytes and leaves the encoding to you. This application takes tab-separated text: a leading `1`, the operation and its arguments. Its response has the same leading `1`, then `ok` and the answer.

## Next steps

- [Replay examples](/docs/examples/replay-examples)
- [Load a holo](/docs/api/load)
- [Dispatch inputs](/docs/api/dispatch)

<!-- examples/command-line -->

---
title: From the command line
description: Replay a holo's examples and read what it says about itself with the prism-code command.
available_in: "0.2.0"
---
This example uses the `prism-code` command on the sample holo, with no code of your own. The output below was captured by running these commands. It comes from the command in the source tree, so a published release can print less.

Install the package and move to the directory that holds the sample holo:

```bash
npm install prism-code
cd node_modules/prism-code/fixtures
```

```bash
prism-code vectors Calculator.holo
prism-code inspect Calculator.holo
```

```text
22 of 22 vectors passed (holo, Calculator, identities verified)
Name:      Calculator
Revision:  2026-10-23
Format:    HOLO physical version 4, flags 0
Size:      24801 B
Digest:    sha256:84371aaac82af6b2a81a25a81d43d4097892985f55ae4919cfdcfa8b6e3486e7
           blake3:4efe02106778d44a469cc0fc8f6998167af7c9075a3ac605c150098c0f5243bb
Footer:    8408e0895572fab09e783f7aadb129dc4cb96d0b62850a16f3ddbe44ed6021ba (BLAKE3 of the body)

Sections:
  INDEX  KIND  ROLE                   OFFSET  LENGTH  SHA256                                                            BLAKE3
  0      15    app-manifest           202     356     0088c507ec48bb78288d898327902037749c6bb9527546633c6a1adbc3ba8a6f  4ed201e5a4b5f463686bcbc8d70c1512632183d54cc417778a71e9ef00a40583
  1      8     source-manifest        558     610     c0eef33218ad4ea17f44578ef23df78f2fb9bf822fb5a67dc77cdacc18c73354  1a6f896424c025ae9191ea0f1d856f2bfe1dae2375915c9843a36fc302d81d60
  2      14    application-directory  1168    1078    91459889465d92201587bcac265b322f00bf12d9390110c2472b19c8e4d2dad4  24030fddeb439ceafaa6d0010f85e72368c6c224fec6fafff55562e2f9dd28b8
  3      14    model-provenance       2246    2194    6679fab5c55ac4b06bb541f214f45c62d2c8014c2a0ebc294f97c6a1551875a6  2b3f340117ac82d8cb25a2de78c06bb239e32322603ce084e577540f271243bd
  4      16    guest                  4440    10569   cb9f6b72ff08caab873b53a035e557515d96d3445d4efb695643ee51f690a16e  ab47b9093b47dd455700bb5d79676e2056baae82fc8e12d2363edb9fabca9416
  5      16    view                   15009   3641    d81782cfc45587a74b89a3904caa9bcc8fbfc9a0bc6cb98445bef6c8a5a13f74  54a53265a5e6d1bf5510609cdb12feca468e7f04b1e1a60d63a2fab7ff6bd24e
  6      16    capability-set         18650   175     c85722a1f3f28f6a326e2af9734960401879b60fa3876633028a8118c6f34411  650500808dbf458a84ab6db39ae83dc81cfd118e3de08fe472eb97a8202ef924
  7      16    model-document         18825   5944    8b1726138e5d0062b9d4c218d0c0c389616926755ba232a3445471ceb8196e4c  c0f2c6ea414da1a3176e7a7cba6dc8376bca383e9c3fe159b3b9e2dd30ccce15

Content:
  INDEX  ROLE            LENGTH  SHA256                                                            LABEL
  4      guest           10498   dcf53677c7c80636f8fc2247676b8f747d1549ce4af742c8505eb0f0ae334c03  blake3:2adca3e7ca42d7415a5227a20002baad90047d087249cbb9ea36e557f5a4a380
  5      view            3570    c232ee20ca0115cd9c53b17687dde96292028700e6b626319960331ec6591906  blake3:9860e7054e3f3a8e6ab79c26bcda06bc65778ebdda211160ea66871142b7c808
  6      capability-set  104     888ef9fab26cf92f0a20a1d0fdf7e5dd494f7eb7ec23dfb26a039a7233cb4a02  blake3:cf46eb3028b50fde0444a1a648f5ce7cba94013f541c86537df54adf5d203e1c
  7      model-document  5873    074921890f5c372c89f4ed794d26dd550231d5e9bf99bf9474cc1a78923292c6  blake3:e76544838a98c46341ed8807f72897ec68de5a8a9bf28721738a76761c9df90e

Manifest:
  URI:             https://hologram.foundation/realization/app-manifest
  Capability set:  blake3:cf46eb3028b50fde0444a1a648f5ce7cba94013f541c86537df54adf5d203e1c
  Guest:           blake3:2adca3e7ca42d7415a5227a20002baad90047d087249cbb9ea36e557f5a4a380
  View:            blake3:9860e7054e3f3a8e6ab79c26bcda06bc65778ebdda211160ea66871142b7c808
  Entry:           holo_run
  Contract:        hologram:guest/core-wasm@1
  View entry:      index.html
  Surface:         portable

Model:
  Schema:       prismpm/model-document/1
  Name:         Calculator
  Crate:        prism-calculator 0.1.0
  Description:  A Lean-verified, Prism-generated checked i64 calculator.
  Profile:      none
  Function:     calculate
  Vectors:      22
  Limits:       request 52 B, response 27 B, guest allocation 65536 B
  Digest:       sha256:074921890f5c372c89f4ed794d26dd550231d5e9bf99bf9474cc1a78923292c6
                blake3:e76544838a98c46341ed8807f72897ec68de5a8a9bf28721738a76761c9df90e

Provenance:
  Schema:       prismpm/model-provenance/1
  Application:  blake3:4ed201e5a4b5f463686bcbc8d70c1512632183d54cc417778a71e9ef00a40583
  Model ID:     074921890f5c372c89f4ed794d26dd550231d5e9bf99bf9474cc1a78923292c6
  Compiler:     49561889f77c9c3571da51e8e53233da9df5ab8f46d16165159425ba2e82dc44
  Stdlib:       35a9c91b1b50f2b61d4e1b4a4abddc833b2185837d6d1511dfff246574692234
  LexLean:      0b53334e5846a1f5e5d9bb3bf6959c085daa4d08

World:
  Contract:        hologram:guest/core-wasm@1
  WIT:             hologram:guest@1.0.0 world core-wasm, worlds/core-wasm.wit
  WIT digest:      sha256:a566c87a359cadf98f652747f1b3574aa307ff5f652a190c6d99c350db9cf369
                   blake3:0774a8ecbfa945a427712ee7d7ad406195b2d07492ceae15cca0067276c9ced8
  Imports:         none
  Exports:         holo_alloc, holo_run, memory
  Guest:           conforms to the world
  Purity:          pure: no clock, random, socket or filesystem import
  Capability set:  blake3:cf46eb3028b50fde0444a1a648f5ce7cba94013f541c86537df54adf5d203e1c (requests nothing)

Attestations:
  none

Verification:
  Footer:            ok
  Labels:            ok
  Cross-references:  ok
```

`vectors` replays every example the holo carries and exits 1 if one fails. `inspect` reads the holo without running it, so it is safe on a file you do not yet trust.

## Next steps

- [Inspect a holo](/docs/examples/inspect-a-holo)
- [CLI reference](/docs/reference/cli)
- [The holo](/docs/concepts/holo)

<!-- examples/replay-examples -->

---
title: Replay examples
description: Run every example a holo carries and count how many still give the expected answer.
available_in: "0.2.0"
---
A holo carries the examples it was built from. Replaying them is the quickest check that a file behaves as it did when it was built. The output below was captured by running the code.

```js
import { load } from 'prism-code';

const app = await load('./Calculator.holo');

const result = await app.acceptance();

console.log(result);
```

```text
{ total: 22, passed: 22, failed: [] }
```

Run this from the directory that holds the sample holo, `node_modules/prism-code/fixtures`. Each example runs on a fresh instance of the program, so one cannot affect another.

## Next steps

- [Check a holo](/docs/examples/check-a-holo)
- [History and replay](/docs/api/history-and-replay)
- [Proof and assurance](/docs/concepts/proof-and-assurance)

<!-- examples/inspect-a-holo -->

---
title: Inspect a holo
description: List the sections of a holo from code, without running it.
available_in: "0.5"
---
Inspecting reads a holo and runs nothing, so it is safe on a file you do not yet trust. The output below was captured by running the code against the sample holo.

```js
import { readFile } from 'node:fs/promises';
import { inspect } from 'prism-code';

const inspection = await inspect(await readFile('./Calculator.holo'));
console.log(inspection.name, 'format', inspection.physical_version);
for (const section of inspection.sections) console.log(section.role, section.length);
```

```text
Calculator format 4
app-manifest 356
source-manifest 610
application-directory 1078
model-provenance 2194
guest 10569
view 3641
capability-set 175
model-document 5944
```

Each line is one section and its length in bytes. [The holo](/docs/concepts/holo) explains what each section is for.

## Next steps

- [The holo](/docs/concepts/holo)
- [Inspect a holo from the API](/docs/api/inspect)
- [Holo format](/docs/reference/holo-format)

<!-- examples/check-a-holo -->

---
title: Check a holo
description: Judge a holo against a policy from code, and handle the error when it falls short.
available_in: "0.5"
---
This example checks the sample holo twice: once with a policy that accepts anything, and once asking for an error when the default policy rejects it. The output below was captured by running the code.

The call is experimental, so its name carries the `experimental_` prefix. Pin the exact version if you use it.

```js
import { load } from 'prism-code';

const app = await load('./Calculator.holo');

const verdict = await app.experimental_verify({ minimum: 'P0' });
console.log({ level: verdict.level, passed: verdict.passed });

try {
  await app.experimental_verify({ throw: true });
} catch (error) {
  console.log(error.name, error.code, error.check);
}
```

```text
{ level: 'P0', passed: true }
VerificationError verification_failed provenance.statement
```

The sample holo carries no statements, so it reaches P0 and the default policy rejects it. The first call accepts P0 and reports that it passed. The second raises a typed error whose code and check say what fell short.

## Next steps

- [Proof and assurance](/docs/concepts/proof-and-assurance)
- [Check a holo from the API](/docs/api/verify)
- [Errors reference](/docs/reference/errors)

<!-- examples/read-the-spec -->

---
title: Read the spec package
description: Read the format revision and other constants a tool needs from the spec package.
available_in: "0.5"
---
A tool that reads holos should take its constants from the spec package rather than copy them. The output below was captured by running the code.

```js
import { FORMAT_REVISION, MAGIC, PHYSICAL_VERSION, SECTION_COUNT, SECTION_ORDER, PROOF_PREDICATE_TYPE } from '@prism-code/spec';

console.log(FORMAT_REVISION);
console.log(MAGIC, PHYSICAL_VERSION, SECTION_COUNT);
console.log(SECTION_ORDER.join(' '));
console.log(PROOF_PREDICATE_TYPE);
```

```text
2026-10-23
HOLO 4 8
15 8 14 14 16 16 16 16
https://uor.foundation/prism/proof/v1
```

## Next steps

- [Spec package](/docs/api/spec-package)
- [Holo format](/docs/reference/holo-format)
- [Attestations reference](/docs/reference/attestations)

<!-- reference/holo-format -->

---
title: Holo format
description: The byte layout of a .holo file, its sections, digests and format revisions.
available_in: "0.2.0"
---

Source: `@prism-code/spec` 2026-10-23, `schemas/holo/archive.schema.json`, `index.mjs`.

## Layout

All integers are little-endian. Offsets count from the first byte of the file.

| Offset   | Size     | Field            | Value                                      |
| -------- | -------- | ---------------- | ------------------------------------------ |
| 0        | 4        | magic            | `HOLO`                                     |
| 4        | 2        | physical version | 4                                          |
| 6        | 2        | flags            | 0                                          |
| 8        | 2        | section count    | 8                                          |
| 10       | 192      | section table    | 8 rows of u64 kind, u64 offset, u64 length |
| 202      | variable | section bodies   | contiguous, in table order                 |
| end - 32 | 32       | footer           | BLAKE3 of every earlier byte               |

## Section table

| Row | Kind | Name         | Length            | Content                                                                      |
| --- | ---- | ------------ | ----------------- | ---------------------------------------------------------------------------- |
| 0   | 15   | APP_MANIFEST | 356 bytes         | application manifest, `https://hologram.foundation/realization/app-manifest` |
| 1   | 8    | METADATA     | variable          | source manifest, version 4                                                   |
| 2   | 14   | EXTENSION    | variable          | extension `https://hologram.foundation/extension/application-directory/v1`   |
| 3   | 14   | EXTENSION    | variable          | extension `https://uor.foundation/extension/prismpm-model/v1`                |
| 4   | 16   | CONTENT_BLOB | at least 71 bytes | content blob: a 71-byte `blake3:` label, then the content                    |
| 5   | 16   | CONTENT_BLOB | at least 71 bytes | content blob: a 71-byte `blake3:` label, then the content                    |
| 6   | 16   | CONTENT_BLOB | at least 71 bytes | content blob: a 71-byte `blake3:` label, then the content                    |
| 7   | 16   | CONTENT_BLOB | at least 71 bytes | content blob: a 71-byte `blake3:` label, then the content                    |

The four content blobs are the capability-set, guest, view and model document, sorted by label. Each label is `blake3:` and 64 lowercase hex characters: the BLAKE3 of the content.

## Application manifest

Schema: `https://schemas.uor.foundation/prism/holo/app-manifest/1`, file `schemas/holo/app-manifest.schema.json`.

| Offset | Size | Field                       |
| ------ | ---- | --------------------------- |
| 0      | 57   | prefix: the URI, NUL, u32 3 |
| 57     | 71   | capability-set label        |
| 128    | 71   | guest label                 |
| 199    | 71   | view label                  |
| 270    | 86   | constant suffix             |

The manifest is 356 bytes. Decoded, it has these members.

| Field       | Type   | Required | Constraint                                                                                                                                                                         |
| ----------- | ------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `uri`       | string | yes      | = `"https://hologram.foundation/realization/app-manifest"`                                                                                                                         |
| `labels`    | array  | yes      | exactly 3 items                                                                                                                                                                    |
| `labels[0]` | string | yes      | matches `^blake3:[0-9a-f]{64}$`                                                                                                                                                    |
| `labels[1]` | string | yes      | matches `^blake3:[0-9a-f]{64}$`                                                                                                                                                    |
| `labels[2]` | string | yes      | matches `^blake3:[0-9a-f]{64}$`                                                                                                                                                    |
| `suffix`    | string | yes      | = `"5200000000000000020000000008000000686f6c6f5f72756e1a000000686f6c6f6772616d3a67756573742f636f72652d7761736d4031030a000000696e6465782e68746d6c08000000706f727461626c6500000000"` |

## Source manifest

Schema: `https://schemas.uor.foundation/prism/holo/source-manifest/4`, file `schemas/holo/source-manifest.schema.json`.

| Field             | Type   | Required | Constraint                   |
| ----------------- | ------ | -------- | ---------------------------- |
| `files`           | array  | yes      | exactly 4 items              |
| `files[0]`        | object | yes      | no other members             |
| `files[0].kind`   | string | yes      | = `"lexlean-build-manifest"` |
| `files[0].sha256` | string | yes      | matches `^[0-9a-f]{64}$`     |
| `files[1]`        | object | yes      | no other members             |
| `files[1].kind`   | string | yes      | = `"lean4-prod-coverage"`    |
| `files[1].sha256` | string | yes      | matches `^[0-9a-f]{64}$`     |
| `files[2]`        | object | yes      | no other members             |
| `files[2].kind`   | string | yes      | = `"lean4-prod-kernel-ir"`   |
| `files[2].sha256` | string | yes      | matches `^[0-9a-f]{64}$`     |
| `files[3]`        | object | yes      | no other members             |
| `files[3].kind`   | string | yes      | = `"model-document"`         |
| `files[3].sha256` | string | yes      | matches `^[0-9a-f]{64}$`     |
| `semantic_id`     | string | yes      | matches `^[0-9a-f]{64}$`     |
| `source_id`       | string | yes      | matches `^[0-9a-f]{64}$`     |
| `version`         | number | yes      | = `4`                        |

## Extensions

An extension body is a u16 little-endian name length, the name, then the JSON payload.

### Application directory

Name: `https://hologram.foundation/extension/application-directory/v1`.

Schema: `https://schemas.uor.foundation/prism/holo/application-directory/1`, file `schemas/holo/application-directory.schema.json`.

| Field                     | Type    | Required | Constraint                       |
| ------------------------- | ------- | -------- | -------------------------------- |
| `schema_version`          | number  | yes      | = `1`                            |
| `primary_layer`           | number  | yes      | = `0`                            |
| `requires_kappa`          | string  | yes      | matches `^blake3:[0-9a-f]{64}$`  |
| `layers`                  | array   | yes      | exactly 2 items                  |
| `layers[0]`               | object  | yes      | no other members                 |
| `layers[0].position`      | number  | yes      | = `0`                            |
| `layers[0].kind`          | string  | yes      | = `"wasm"`                       |
| `layers[0].content_kappa` | string  | yes      | matches `^blake3:[0-9a-f]{64}$`  |
| `layers[0].entry`         | string  | yes      | = `"holo_run"`                   |
| `layers[0].contract`      | string  | yes      | = `"hologram:guest/core-wasm@1"` |
| `layers[0].architecture`  | null    | yes      | = `null`                         |
| `layers[0].surface`       | null    | yes      | = `null`                         |
| `layers[0].engine`        | null    | yes      | = `null`                         |
| `layers[1]`               | object  | yes      | no other members                 |
| `layers[1].position`      | number  | yes      | = `1`                            |
| `layers[1].kind`          | string  | yes      | = `"view"`                       |
| `layers[1].content_kappa` | string  | yes      | matches `^blake3:[0-9a-f]{64}$`  |
| `layers[1].entry`         | string  | yes      | = `"index.html"`                 |
| `layers[1].contract`      | null    | yes      | = `null`                         |
| `layers[1].architecture`  | null    | yes      | = `null`                         |
| `layers[1].surface`       | string  | yes      | = `"portable"`                   |
| `layers[1].engine`        | null    | yes      | = `null`                         |
| `children`                | array   | yes      | at most 0 items                  |
| `blobs`                   | array   | yes      | exactly 4 items; unique items    |
| `blobs[]`                 | object  | yes      | no other members                 |
| `blobs[].kappa`           | string  | yes      | matches `^blake3:[0-9a-f]{64}$`  |
| `blobs[].byte_length`     | integer | yes      | 0 to 9007199254740991            |

### Model provenance

Name: `https://uor.foundation/extension/prismpm-model/v1`.

Schema: `https://schemas.uor.foundation/prismpm/model-provenance/1`, file `schemas/documents/model-provenance-v1.schema.json`.

| Field                                                      | Type           | Required | Constraint                       |
| ---------------------------------------------------------- | -------------- | -------- | -------------------------------- |
| `application_kappa`                                        | string         | yes      | matches `^blake3:[0-9a-f]{64}$`  |
| `cargo_crate_sha256`                                       | string         | yes      | matches `^[0-9a-f]{64}$`         |
| `cargo_name`                                               | string         | yes      | matches `^[A-Za-z0-9_-]{1,64}$`  |
| `cargo_version`                                            | string         | yes      | 1 to 128 characters              |
| `compiler_semantics_id`                                    | string         | yes      | matches `^[0-9a-f]{64}$`         |
| `core_wasm_contract`                                       | string         | yes      | = `"hologram:guest/core-wasm@1"` |
| `generated_core_sha256`                                    | string         | yes      | matches `^[0-9a-f]{64}$`         |
| `guest_content_kappa`                                      | string         | yes      | matches `^blake3:[0-9a-f]{64}$`  |
| `hologram_live_commit`                                     | string         | yes      | matches `^[0-9a-f]{40}$`         |
| `lcnf_manifest_sha256`                                     | string         | yes      | matches `^[0-9a-f]{64}$`         |
| `lean4_prod_commit`                                        | string         | yes      | matches `^[0-9a-f]{40}$`         |
| `lean_manifest_sha256`                                     | string         | yes      | matches `^[0-9a-f]{64}$`         |
| `lexlean_commit`                                           | string         | yes      | matches `^[0-9a-f]{40}$`         |
| `lexlean_package_sha256`                                   | string         | yes      | matches `^[0-9a-f]{64}$`         |
| `model_content_kappa`                                      | string         | yes      | matches `^blake3:[0-9a-f]{64}$`  |
| `model_id`                                                 | string         | yes      | matches `^[0-9a-f]{64}$`         |
| `prism_stdlib_crate_sha256`                                | string         | yes      | matches `^[0-9a-f]{64}$`         |
| `schema`                                                   | string         | yes      | = `"prismpm/model-provenance/1"` |
| `semantic_id`                                              | string         | yes      | matches `^[0-9a-f]{64}$`         |
| `snapshot_id`                                              | string         | yes      | matches `^[0-9a-f]{64}$`         |
| `source_id`                                                | string         | yes      | matches `^[0-9a-f]{64}$`         |
| `stdlib_semantics_id`                                      | string         | yes      | matches `^[0-9a-f]{64}$`         |
| `target_profile_id`                                        | string         | yes      | matches `^[0-9a-f]{64}$`         |
| `uor_hologram_commit`                                      | string         | yes      | matches `^[0-9a-f]{40}$`         |
| `view_binding`                                             | one of 2 forms | yes      |                                  |
| `view_binding (form 1)`                                    | object         | yes      | no other members                 |
| `view_binding (form 1).tag`                                | string         | yes      | = `"none"`                       |
| `view_binding (form 2)`                                    | object         | yes      | no other members                 |
| `view_binding (form 2).tag`                                | string         | yes      | = `"present"`                    |
| `view_binding (form 2).browser_projection`                 | one of 2 forms | yes      |                                  |
| `view_binding (form 2).browser_projection (form 1)`        | object         | yes      | no other members                 |
| `view_binding (form 2).browser_projection (form 1).tag`    | string         | yes      | = `"none"`                       |
| `view_binding (form 2).browser_projection (form 2)`        | object         | yes      | no other members                 |
| `view_binding (form 2).browser_projection (form 2).tag`    | string         | yes      | = `"present"`                    |
| `view_binding (form 2).browser_projection (form 2).sha256` | string         | yes      | matches `^[0-9a-f]{64}$`         |
| `view_binding (form 2).view_content_kappa`                 | string         | yes      | matches `^blake3:[0-9a-f]{64}$`  |
| `view_binding (form 2).view_model_id`                      | string         | yes      | matches `^[0-9a-f]{64}$`         |

## Capability set

URI: `https://hologram.foundation/realization/capability-set`. The blob of an application that requests nothing, as hex:

```text
68747470733a2f2f686f6c6f6772616d2e666f756e646174696f6e2f7265616c697a6174696f6e2f6361706162696c6974792d7365740000000000290000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
```

## Model documents

A holo carries one model document. Its `schema` member names one of these.

| Schema                     | File                                              |
| -------------------------- | ------------------------------------------------- |
| `prismpm/model-document/1` | `schemas/documents/model-document-v1.schema.json` |
| `prismpm/model-document/2` | `schemas/documents/model-document-v2.schema.json` |
| `prismpm/model-document/5` | `schemas/documents/model-document-v5.schema.json` |
| `prismpm/model-document/6` | `schemas/documents/model-document-v6.schema.json` |

## Portable view

The view blob is a `HOLOVIEW` bundle, version 1, big-endian, with entry `index.html`.

| Limit       | Value     |
| ----------- | --------- |
| files       | 4096      |
| path bytes  | 1024      |
| file bytes  | 67108864  |
| total bytes | 268435456 |

## World

The guest implements `hologram:guest/core-wasm@1` and exports `holo_alloc`, `holo_run`, `memory`. The world file is `worlds/core-wasm.wit`.

```wit
package hologram:guest@1.0.0;

world core-wasm {
  /// Reserve `length` bytes of guest memory for a request and return their offset.
  export holo-alloc: func(length: u32) -> u32;

  /// Run the request at `offset` with `length` bytes. Returns `offset << 32 | length` of the response.
  export holo-run: func(offset: u32, length: u32) -> u64;
}
```

## Digest footer

The last 32 bytes are the BLAKE3 of every earlier byte. Read the footer, hash the rest of the file, and compare.

## Format revisions

A revision is a date. A file does not carry its revision, so a reader recognizes it by these identifiers.

### 2026-10-23

| Identifier              | Value                                                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `physicalVersion`       | `4`                                                                                                                   |
| `flags`                 | `0`                                                                                                                   |
| `sectionOrder`          | `15`, `8`, `14`, `14`, `16`, `16`, `16`, `16`                                                                         |
| `appManifestUri`        | `https://hologram.foundation/realization/app-manifest`                                                                |
| `extensions`            | `https://hologram.foundation/extension/application-directory/v1`, `https://uor.foundation/extension/prismpm-model/v1` |
| `coreWasmContract`      | `hologram:guest/core-wasm@1`                                                                                          |
| `holoviewVersion`       | `1`                                                                                                                   |
| `sourceManifestVersion` | `4`                                                                                                                   |
| `provenanceSchema`      | `prismpm/model-provenance/1`                                                                                          |
| `modelDocumentSchemas`  | `prismpm/model-document/1`, `prismpm/model-document/2`, `prismpm/model-document/5`, `prismpm/model-document/6`        |

`@prism-code/spec` exports `FORMAT_REVISION`, the revision it describes: `2026-10-23`.

## Next steps

- [Attestations reference](/docs/reference/attestations)
- [Spec package](/docs/api/spec-package)
- [Load a holo](/docs/api/load)

Generated from @prism-code/spec 2026-10-23 at e84124f0fed01510843772ae11d8a3068cef47ea.

<!-- reference/attestations -->

---
title: Attestations reference
description: The statement and envelope a holo's attestations use, the predicate types and their status.
available_in: "0.5"
---

Source: `@prism-code/spec` 2026-10-23, `schemas/attestation/statement.schema.json`, `schemas/attestation/dsse-envelope.schema.json`, `predicates/registry.json`.

## Statement

Every attestation is one statement of type `https://in-toto.io/Statement/v1`.

Schema: `https://schemas.uor.foundation/prism/attestation/statement/1`, file `schemas/attestation/statement.schema.json`.

| Field                | Type               | Required | Constraint                            |
| -------------------- | ------------------ | -------- | ------------------------------------- |
| `_type`              | string             | yes      | = `"https://in-toto.io/Statement/v1"` |
| `subject`            | array              | yes      | at least 1 item; unique items         |
| `subject[]`          | one of 2 forms     | yes      |                                       |
| `subject[] (form 1)` | BlobSubject        | yes      | see BlobSubject                       |
| `subject[] (form 2)` | OciManifestSubject | yes      | see OciManifestSubject                |
| `predicateType`      | string             | yes      | format uri; at least 1 character      |
| `predicate`          | object             | yes      |                                       |

### PrismDigestSet

| Field    | Type   | Required | Constraint               |
| -------- | ------ | -------- | ------------------------ |
| `blake3` | string | yes      | matches `^[0-9a-f]{64}$` |
| `sha256` | string | yes      | matches `^[0-9a-f]{64}$` |

### BlobSubject

| Field    | Type           | Required | Constraint                                 |
| -------- | -------------- | -------- | ------------------------------------------ |
| `name`   | string         | yes      | at least 1 character; not `"oci-manifest"` |
| `digest` | PrismDigestSet | yes      | see PrismDigestSet                         |

### OciManifestSubject

| Field           | Type   | Required | Constraint               |
| --------------- | ------ | -------- | ------------------------ |
| `name`          | string | yes      | = `"oci-manifest"`       |
| `digest`        | object | yes      | no other members         |
| `digest.sha256` | string | yes      | matches `^[0-9a-f]{64}$` |

## Envelope

The bundle wraps each statement in an envelope whose payload type is `application/vnd.in-toto+json`.

Schema: `https://schemas.uor.foundation/prism/attestation/dsse-envelope/1`, file `schemas/attestation/dsse-envelope.schema.json`.

| Field                | Type   | Required | Constraint                         |
| -------------------- | ------ | -------- | ---------------------------------- |
| `payload`            | string | yes      | matches `^[A-Za-z0-9+/_-]*={0,2}$` |
| `payloadType`        | string | yes      | = `"application/vnd.in-toto+json"` |
| `signatures`         | array  | yes      | at least 1 item                    |
| `signatures[]`       | object | yes      | no other members                   |
| `signatures[].keyid` | string | no       |                                    |
| `signatures[].sig`   | string | yes      | matches `^[A-Za-z0-9+/_-]*={0,2}$` |

## Transparency log entries and signed timestamps

A keyless signature is checkable only at the time it was made, so a bundle carries two independent witnesses of that time: log entries with an inclusion proof, and signed timestamps. Both sit in the verification material of the bundle. A verifier checks them offline against a trusted root that it pins; the bundle never supplies its own.

Schema: `https://schemas.uor.foundation/prism/attestation/sigstore-bundle/1`, file `schemas/attestation/sigstore-bundle.schema.json`.

### TransparencyLogEntry

| Field                                   | Type        | Required | Constraint           |
| --------------------------------------- | ----------- | -------- | -------------------- |
| `logIndex`                              | Int64String | yes      | see Int64String      |
| `logId`                                 | object      | yes      | no other members     |
| `logId.keyId`                           | Base64      | yes      | see Base64           |
| `kindVersion`                           | object      | yes      | no other members     |
| `kindVersion.kind`                      | string      | yes      | at least 1 character |
| `kindVersion.version`                   | string      | yes      | at least 1 character |
| `integratedTime`                        | Int64String | no       | see Int64String      |
| `inclusionPromise`                      | object      | no       | no other members     |
| `inclusionPromise.signedEntryTimestamp` | Base64      | yes      | see Base64           |
| `inclusionProof`                        | object      | no       | no other members     |
| `inclusionProof.logIndex`               | Int64String | yes      | see Int64String      |
| `inclusionProof.rootHash`               | Base64      | yes      | see Base64           |
| `inclusionProof.treeSize`               | Int64String | yes      | see Int64String      |
| `inclusionProof.hashes`                 | array       | yes      |                      |
| `inclusionProof.hashes[]`               | Base64      | yes      | see Base64           |
| `inclusionProof.checkpoint`             | object      | yes      | no other members     |
| `inclusionProof.checkpoint.envelope`    | string      | yes      | at least 1 character |
| `canonicalizedBody`                     | Base64      | yes      | see Base64           |

### Trusted root

Schema: `https://schemas.uor.foundation/prism/attestation/trusted-root/1`, file `schemas/attestation/trusted-root.schema.json`.

| Field                      | Type            | Required | Constraint                                                                 |
| -------------------------- | --------------- | -------- | -------------------------------------------------------------------------- |
| `mediaType`                | string          | yes      | matches `^application/vnd\.dev\.sigstore\.trustedroot\+json;version=0\.1$` |
| `tlogs`                    | array           | yes      |                                                                            |
| `tlogs[]`                  | TransparencyLog | yes      | see TransparencyLog                                                        |
| `certificateAuthorities`   | array           | yes      |                                                                            |
| `certificateAuthorities[]` | Authority       | yes      | see Authority                                                              |
| `timestampAuthorities`     | array           | yes      |                                                                            |
| `timestampAuthorities[]`   | Authority       | yes      | see Authority                                                              |
| `ctlogs`                   | array           | no       |                                                                            |

#### TransparencyLog

| Field                  | Type     | Required | Constraint                                                                        |
| ---------------------- | -------- | -------- | --------------------------------------------------------------------------------- |
| `baseUrl`              | string   | yes      | at least 1 character                                                              |
| `hashAlgorithm`        | string   | yes      | = `"SHA2_256"`                                                                    |
| `publicKey`            | object   | yes      |                                                                                   |
| `publicKey.rawBytes`   | Base64   | yes      | see Base64                                                                        |
| `publicKey.keyDetails` | string   | yes      | one of `"PKIX_ED25519"`, `"PKIX_ECDSA_P256_SHA_256"`, `"PKIX_ECDSA_P384_SHA_384"` |
| `publicKey.validFor`   | ValidFor | yes      | see ValidFor                                                                      |
| `logId`                | object   | yes      |                                                                                   |
| `logId.keyId`          | Base64   | yes      | see Base64                                                                        |

#### Authority

| Field                               | Type     | Required | Constraint      |
| ----------------------------------- | -------- | -------- | --------------- |
| `uri`                               | string   | no       |                 |
| `subject`                           | object   | no       |                 |
| `certChain`                         | object   | yes      |                 |
| `certChain.certificates`            | array    | yes      | at least 1 item |
| `certChain.certificates[]`          | object   | yes      |                 |
| `certChain.certificates[].rawBytes` | Base64   | yes      | see Base64      |
| `validFor`                          | ValidFor | yes      | see ValidFor    |

#### ValidFor

| Field   | Type   | Required | Constraint                                                                    |
| ------- | ------ | -------- | ----------------------------------------------------------------------------- |
| `start` | string | yes      | matches `^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$` |
| `end`   | string | no       | matches `^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$` |

## Build provenance

Every holo that `prismpm build` produces carries one statement of predicate type `https://slsa.dev/provenance/v1` and build type `https://uor.foundation/prism/holo-build/v1`. Its subjects are the four content blobs. Its resolved dependencies are the lock. It is written unsigned: the envelope holds one empty signature, which no verifier accepts, until `prism attest` signs it.

Mode `min` is the default and holds nothing that varies between machines or runs. Mode `max` is opt-in with `--provenance=max` because it records the build arguments, the platform, an invocation id and timestamps. `--no-provenance` turns the statement off and is unsafe: a holo built with it cannot reach assurance level P1.

Schema: `https://schemas.uor.foundation/prism/attestation/provenance/1`, file `schemas/attestation/provenance-v1.schema.json`.

### MinPredicate

| Field                                      | Type           | Required | Constraint                                       |
| ------------------------------------------ | -------------- | -------- | ------------------------------------------------ |
| `buildDefinition`                          | object         | yes      | no other members                                 |
| `buildDefinition.buildType`                | string         | yes      | = `"https://uor.foundation/prism/holo-build/v1"` |
| `buildDefinition.externalParameters`       | object         | yes      | no other members                                 |
| `buildDefinition.externalParameters.model` | PrismDigestSet | yes      | see PrismDigestSet                               |
| `buildDefinition.externalParameters.spec`  | Spec           | no       | see Spec                                         |
| `buildDefinition.internalParameters`       | object         | yes      |                                                  |
| `buildDefinition.resolvedDependencies`     | Dependencies   | yes      | see Dependencies                                 |
| `runDetails`                               | object         | yes      | no other members                                 |
| `runDetails.builder`                       | Builder        | yes      | see Builder                                      |

### MaxPredicate

| Field                                            | Type           | Required | Constraint                                       |
| ------------------------------------------------ | -------------- | -------- | ------------------------------------------------ |
| `buildDefinition`                                | object         | yes      | no other members                                 |
| `buildDefinition.buildType`                      | string         | yes      | = `"https://uor.foundation/prism/holo-build/v1"` |
| `buildDefinition.externalParameters`             | object         | yes      | no other members                                 |
| `buildDefinition.externalParameters.arguments`   | array          | yes      |                                                  |
| `buildDefinition.externalParameters.arguments[]` | string         | yes      |                                                  |
| `buildDefinition.externalParameters.model`       | PrismDigestSet | yes      | see PrismDigestSet                               |
| `buildDefinition.externalParameters.spec`        | Spec           | no       | see Spec                                         |
| `buildDefinition.internalParameters`             | object         | yes      | no other members                                 |
| `buildDefinition.internalParameters.platform`    | string         | yes      | matches `^[a-z0-9]+/[a-z0-9]+(/[a-z0-9]+)?$`     |
| `buildDefinition.resolvedDependencies`           | Dependencies   | yes      | see Dependencies                                 |
| `runDetails`                                     | object         | yes      | no other members                                 |
| `runDetails.builder`                             | Builder        | yes      | see Builder                                      |
| `runDetails.metadata`                            | object         | yes      | no other members                                 |
| `runDetails.metadata.invocationId`               | string         | yes      | at least 1 character                             |
| `runDetails.metadata.startedOn`                  | Timestamp      | yes      | see Timestamp                                    |
| `runDetails.metadata.finishedOn`                 | Timestamp      | yes      | see Timestamp                                    |

### ResourceDescriptor

| Field           | Type   | Required | Constraint                       |
| --------------- | ------ | -------- | -------------------------------- |
| `name`          | string | yes      | at least 1 character             |
| `uri`           | string | yes      | format uri; at least 1 character |
| `digest`        | object | no       | no other members                 |
| `digest.blake3` | Hex64  | no       | see Hex64                        |
| `digest.sha256` | Hex64  | no       | see Hex64                        |
| `mediaType`     | string | no       | at least 1 character             |

### Builder

| Field             | Type   | Required | Constraint           |
| ----------------- | ------ | -------- | -------------------- |
| `id`              | string | yes      | at least 1 character |
| `version`         | object | no       | no other members     |
| `version.prismpm` | string | yes      | at least 1 character |

### Spec

| Field    | Type   | Required | Constraint                               |
| -------- | ------ | -------- | ---------------------------------------- |
| `basis`  | string | yes      | one of `"model-sources"`, `"prism-toml"` |
| `blake3` | Hex64  | yes      | see Hex64                                |

## Predicate types

| Type                                     | Status       | Schema                             |
| ---------------------------------------- | ------------ | ---------------------------------- |
| `https://uor.foundation/prism/proof/v1`  | experimental | `predicates/proof-v1.schema.json`  |
| `https://uor.foundation/prism/replay/v1` | experimental | `predicates/replay-v1.schema.json` |

## Example statement

Status: no holo carries a signed statement yet. Every predicate type in the registry is a placeholder, so no statement is captured on this page.

## Next steps

- [Holo format](/docs/reference/holo-format)
- [Errors reference](/docs/reference/errors)
- [Spec package](/docs/api/spec-package)

Generated from @prism-code/spec 2026-10-23 at e84124f0fed01510843772ae11d8a3068cef47ea.

<!-- reference/manifest -->

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

<!-- reference/lockfile -->

---
title: Lockfile reference
description: Every field of the lockfile, from the schema the spec package publishes.
available_in: "0.5"
---

Source: `@prism-code/spec` 2026-10-23, `schemas/documents/sdk-lock-v1.schema.json`, `schemas/documents/sdk-lock-v2.schema.json`, `schemas/documents/sdk-lock-v3.schema.json`.

The lockfile is a JSON document whose `schema` member names its version.

## `prismpm/sdk-lock/3`

Schema: `https://schemas.uor.foundation/prismpm/sdk-lock/3`, file `schemas/documents/sdk-lock-v3.schema.json`.

| Field                                            | Type           | Required | Constraint                                                                                                                                                       |
| ------------------------------------------------ | -------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inputs`                                         | object         | yes      | no other members                                                                                                                                                 |
| `inputs.generation`                              | object         | yes      | no other members                                                                                                                                                 |
| `inputs.generation.application_generator_sha256` | string         | yes      | matches `^[0-9a-f]{64}$`                                                                                                                                         |
| `inputs.generation.library_generator_sha256`     | string         | yes      | matches `^[0-9a-f]{64}$`                                                                                                                                         |
| `inputs.model`                                   | object         | yes      | no other members                                                                                                                                                 |
| `inputs.model.blake3`                            | string         | yes      | matches `^[0-9a-f]{64}$`                                                                                                                                         |
| `inputs.model.sha256`                            | string         | yes      | matches `^[0-9a-f]{64}$`                                                                                                                                         |
| `inputs.spec`                                    | object         | yes      | no other members                                                                                                                                                 |
| `inputs.spec.basis`                              | string         | yes      | one of `"model-sources"`, `"prism-toml"`                                                                                                                         |
| `inputs.spec.blake3`                             | string         | yes      | matches `^[0-9a-f]{64}$`                                                                                                                                         |
| `inputs.toolchain`                               | object         | yes      | no other members                                                                                                                                                 |
| `inputs.toolchain.lean`                          | string         | yes      | matches `^v[0-9]+.[0-9]+.[0-9]+(-[0-9A-Za-z.-]+)?$`; 5 to 64 characters                                                                                          |
| `inputs.toolchain.lexlean`                       | string         | yes      | matches `^[0-9]+.[0-9]+.[0-9]+(-[0-9A-Za-z.-]+)?$`; 5 to 64 characters                                                                                           |
| `inputs.toolchain.prismpm`                       | string         | yes      | matches `^[0-9]+.[0-9]+.[0-9]+(-[0-9A-Za-z.-]+)?$`; 5 to 64 characters                                                                                           |
| `inputs.toolchain.rustc`                         | string         | yes      | matches `^[0-9]+.[0-9]+.[0-9]+(-[0-9A-Za-z.-]+)?$`; 5 to 64 characters                                                                                           |
| `inputs.toolchain.wasm_bindgen`                  | string         | yes      | matches `^[0-9]+.[0-9]+.[0-9]+(-[0-9A-Za-z.-]+)?$`; 5 to 64 characters                                                                                           |
| `inputs.world`                                   | one of 2 forms | yes      |                                                                                                                                                                  |
| `inputs.world (form 1)`                          | null           | yes      |                                                                                                                                                                  |
| `inputs.world (form 2)`                          | object         | yes      | no other members                                                                                                                                                 |
| `inputs.world (form 2).blake3`                   | string         | yes      | matches `^[0-9a-f]{64}$`                                                                                                                                         |
| `inputs.world (form 2).contract`                 | string         | yes      | one of `"hologram:guest/core-wasm@1"`                                                                                                                            |
| `inputs.world (form 2).sha256`                   | string         | yes      | matches `^[0-9a-f]{64}$`                                                                                                                                         |
| `platforms`                                      | array          | yes      | exactly 2 items; unique items                                                                                                                                    |
| `platforms[]`                                    | object         | yes      | no other members                                                                                                                                                 |
| `platforms[].inventory`                          | array          | yes      | 1 to 8192 items; unique items                                                                                                                                    |
| `platforms[].inventory[]`                        | object         | yes      | no other members                                                                                                                                                 |
| `platforms[].inventory[].digest`                 | string         | yes      | matches `^sha256:[0-9a-f]{64}$`                                                                                                                                  |
| `platforms[].inventory[].id`                     | string         | yes      | 1 to 128 characters                                                                                                                                              |
| `platforms[].inventory[].kind`                   | string         | yes      | one of `"binary"`, `"crate"`, `"image"`, `"adapter"`, `"oracle"`, `"schema"`, `"workflow"`, `"base-image"`, `"dependency-lock"`, `"trust-root"`, `"test-corpus"` |
| `platforms[].inventory[].version`                | string         | yes      | 1 to 128 characters                                                                                                                                              |
| `platforms[].inventory_digest`                   | string         | yes      | matches `^sha256:[0-9a-f]{64}$`                                                                                                                                  |
| `platforms[].manifest_digest`                    | string         | yes      | matches `^sha256:[0-9a-f]{64}$`                                                                                                                                  |
| `platforms[].platform`                           | string         | yes      | one of `"linux/amd64"`, `"linux/arm64"`                                                                                                                          |
| `platforms[].inventory_document`                 | string         | yes      | 1 to 8388608 characters                                                                                                                                          |
| `schema`                                         | string         | yes      | = `"prismpm/sdk-lock/3"`                                                                                                                                         |
| `sdk_image`                                      | string         | yes      | matches `^[a-z0-9.-]+(?::[0-9]{1,5})?/[a-z0-9./_-]+@sha256:[0-9a-f]{64}$`                                                                                        |
| `sdk_index`                                      | string         | yes      | 1 to 1048576 characters                                                                                                                                          |
| `sdk_version`                                    | string         | yes      | = `"0.3.0"`                                                                                                                                                      |
| `standards_lock`                                 | string         | yes      | matches `^sha256:[0-9a-f]{64}$`                                                                                                                                  |

## `prismpm/sdk-lock/2`

Schema: `https://schemas.uor.foundation/prismpm/sdk-lock/2`, file `schemas/documents/sdk-lock-v2.schema.json`.

| Field                             | Type   | Required | Constraint                                                                                                                                                       |
| --------------------------------- | ------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `platforms`                       | array  | yes      | exactly 2 items; unique items                                                                                                                                    |
| `platforms[]`                     | object | yes      | no other members                                                                                                                                                 |
| `platforms[].inventory`           | array  | yes      | 1 to 8192 items; unique items                                                                                                                                    |
| `platforms[].inventory[]`         | object | yes      | no other members                                                                                                                                                 |
| `platforms[].inventory[].digest`  | string | yes      | matches `^sha256:[0-9a-f]{64}$`                                                                                                                                  |
| `platforms[].inventory[].id`      | string | yes      | 1 to 128 characters                                                                                                                                              |
| `platforms[].inventory[].kind`    | string | yes      | one of `"binary"`, `"crate"`, `"image"`, `"adapter"`, `"oracle"`, `"schema"`, `"workflow"`, `"base-image"`, `"dependency-lock"`, `"trust-root"`, `"test-corpus"` |
| `platforms[].inventory[].version` | string | yes      | 1 to 128 characters                                                                                                                                              |
| `platforms[].inventory_digest`    | string | yes      | matches `^sha256:[0-9a-f]{64}$`                                                                                                                                  |
| `platforms[].manifest_digest`     | string | yes      | matches `^sha256:[0-9a-f]{64}$`                                                                                                                                  |
| `platforms[].platform`            | string | yes      | one of `"linux/amd64"`, `"linux/arm64"`                                                                                                                          |
| `platforms[].inventory_document`  | string | yes      | 1 to 8388608 characters                                                                                                                                          |
| `schema`                          | string | yes      | = `"prismpm/sdk-lock/2"`                                                                                                                                         |
| `sdk_image`                       | string | yes      | matches `^[a-z0-9.-]+(?::[0-9]{1,5})?/[a-z0-9./_-]+@sha256:[0-9a-f]{64}$`                                                                                        |
| `sdk_index`                       | string | yes      | 1 to 1048576 characters                                                                                                                                          |
| `sdk_version`                     | string | yes      | = `"0.3.0"`                                                                                                                                                      |
| `standards_lock`                  | string | yes      | matches `^sha256:[0-9a-f]{64}$`                                                                                                                                  |

## `prismpm/sdk-lock/1`

Schema: `https://schemas.uor.foundation/prismpm/sdk-lock/1`, file `schemas/documents/sdk-lock-v1.schema.json`.

| Field                 | Type   | Required | Constraint                                                                                                                                                       |
| --------------------- | ------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inventory`           | array  | yes      | 1 to 8192 items; unique items                                                                                                                                    |
| `inventory[]`         | object | yes      | no other members                                                                                                                                                 |
| `inventory[].digest`  | string | yes      | matches `^sha256:[0-9a-f]{64}$`                                                                                                                                  |
| `inventory[].id`      | string | yes      | 1 to 128 characters                                                                                                                                              |
| `inventory[].kind`    | string | yes      | one of `"binary"`, `"crate"`, `"image"`, `"adapter"`, `"oracle"`, `"schema"`, `"workflow"`, `"base-image"`, `"dependency-lock"`, `"trust-root"`, `"test-corpus"` |
| `inventory[].version` | string | yes      | 1 to 128 characters                                                                                                                                              |
| `sdk_image`           | string | yes      | matches `^[a-z0-9.-]+(?::[0-9]{1,5})?/[a-z0-9./_-]+@sha256:[0-9a-f]{64}$`                                                                                        |
| `sdk_version`         | string | yes      | = `"0.3.0"`                                                                                                                                                      |
| `schema`              | string | yes      | = `"prismpm/sdk-lock/1"`                                                                                                                                         |
| `standards_lock`      | string | yes      | matches `^sha256:[0-9a-f]{64}$`                                                                                                                                  |

## Next steps

- [Manifest reference](/docs/reference/manifest)
- [Holo format](/docs/reference/holo-format)
- [CLI reference](/docs/reference/cli)

Generated from @prism-code/spec 2026-10-23 at e84124f0fed01510843772ae11d8a3068cef47ea.

<!-- reference/errors -->

---
title: Errors reference
description: Every error code the runtime raises and every CLI exit code.
available_in: "0.5"
---

Source: `prism-code` 0.3.0 source and type declarations, `sdk/docs/cli.json` 2026-10-30.

## Runtime errors

Status: the typed error classes are in the prism-code source and are not in the published 0.2.0. The table lists every code the source raises.

```ts
export class PrismError extends Error {
  static readonly code: string;
  code: string;
  check?: string;
  diagnostic?: string;
  details?: unknown;
  verdict?: Verdict;
  reasons?: VerdictReason[];
  constructor(
    message: string,
    options?: { code?: string; check?: string; diagnostic?: string; details?: unknown; verdict?: Verdict; reasons?: VerdictReason[]; cause?: unknown },
  );
}

export class PrismCodeError extends PrismError {
  code: string;
  constructor(code: string, message: string, details?: unknown);
}
```

The typed errors, their codes and the verdict checks that map to them are on the error types page.

| Code                    | Raised in                                 |
| ----------------------- | ----------------------------------------- |
| `archive.blob`          | `src/archive.mjs`                         |
| `archive.bounds`        | `src/archive.mjs`, `src/attestations.mjs` |
| `archive.directory`     | `src/archive.mjs`                         |
| `archive.extension`     | `src/archive.mjs`                         |
| `archive.flags`         | `src/archive.mjs`                         |
| `archive.input`         | `src/archive.mjs`                         |
| `archive.kind`          | `src/archive.mjs`                         |
| `archive.magic`         | `src/archive.mjs`                         |
| `archive.manifest`      | `src/archive.mjs`                         |
| `archive.metadata`      | `src/archive.mjs`                         |
| `archive.model`         | `src/archive.mjs`, `src/index.mjs`        |
| `archive.provenance`    | `src/archive.mjs`                         |
| `archive.version`       | `src/archive.mjs`                         |
| `attestation.bundle`    | `src/attestations.mjs`                    |
| `attestation.duplicate` | `src/attestations.mjs`                    |
| `attestation.envelope`  | `src/attestations.mjs`                    |
| `attestation.footer`    | `src/attestations.mjs`                    |
| `attestation.input`     | `src/attestations.mjs`                    |
| `attestation.lines`     | `src/attestations.mjs`                    |
| `attestation.position`  | `src/attestations.mjs`                    |
| `attestation.statement` | `src/attestations.mjs`                    |
| `attestation.subject`   | `src/attestations.mjs`                    |
| `capabilities.invalid`  | `src/capabilities.mjs`, `src/index.mjs`   |
| `capabilities.kind`     | `src/capabilities.mjs`                    |
| `capabilities.path`     | `src/node.mjs`                            |
| `closure.files`         | `src/browser.mjs`, `src/closure.mjs`      |
| `closure.glue`          | `src/closure.mjs`                         |
| `closure.model`         | `src/closure.mjs`                         |
| `closure.provenance`    | `src/closure.mjs`                         |
| `container.ambiguous`   | `src/containers.mjs`                      |
| `container.input`       | `src/containers.mjs`                      |
| `container.missing`     | `src/containers.mjs`                      |
| `container.running`     | `src/containers.mjs`                      |
| `container.state`       | `src/containers.mjs`                      |
| `container.store`       | `src/node.mjs`                            |
| `core.allocation`       | `src/closure.mjs`, `src/core.mjs`         |
| `core.compile`          | `src/core.mjs`                            |
| `core.exports`          | `src/core.mjs`                            |
| `core.request`          | `src/core.mjs`                            |
| `core.response`         | `src/core.mjs`                            |
| `dev.path`              | `src/dev-cli.mjs`                         |
| `dev.port`              | `src/dev-server.mjs`                      |
| `dev.project`           | `src/dev-cli.mjs`                         |
| `init.template`         | `src/init.mjs`                            |
| `inspect.kind`          | `src/index.mjs`                           |
| `inspect.selector`      | `src/inspect.mjs`                         |
| `load.fetch`            | `src/browser.mjs`                         |
| `load.path`             | `src/node.mjs`                            |
| `load.source`           | `src/index.mjs`                           |
| `lock.image`            | `src/docker.mjs`, `src/init.mjs`          |
| `manifest.env`          | `src/manifest.mjs`                        |
| `manifest.invalid`      | `src/manifest.mjs`                        |
| `manifest.overlay`      | `src/manifest.mjs`                        |
| `manifest.path`         | `src/node.mjs`                            |
| `manifest.secret`       | `src/manifest.mjs`                        |
| `manifest.toml`         | `src/toml.mjs`                            |
| `middleware.name`       | `src/middleware.mjs`                      |
| `middleware.relative`   | `src/middleware.mjs`                      |
| `middleware.shape`      | `src/middleware.mjs`, `src/tracing.mjs`   |
| `middleware.step`       | `src/middleware.mjs`                      |
| `mount.environment`     | `src/browser.mjs`                         |
| `provenance.archive`    | `src/provenance.mjs`                      |
| `provenance.duplicate`  | `src/provenance.mjs`                      |
| `provenance.input`      | `src/provenance.mjs`                      |
| `provenance.lock`       | `src/provenance.mjs`                      |
| `provenance.mode`       | `src/provenance.mjs`                      |
| `view.bounds`           | `src/view.mjs`                            |
| `view.entry`            | `src/view.mjs`                            |
| `view.magic`            | `src/view.mjs`                            |
| `view.order`            | `src/view.mjs`                            |
| `view.version`          | `src/view.mjs`                            |

## CLI exit codes

| Code | Name          | Meaning                                                                                               |
| ---- | ------------- | ----------------------------------------------------------------------------------------------------- |
| 0    | pass          | The verb did what you asked and every check it ran passed.                                            |
| 1    | fail          | A check failed, an intent sentence is unproved, or a replay diverged.                                 |
| 2    | cannot verify | No verdict was reached: a missing attestation, an unreachable registry or an unknown format revision. |

## Next steps

- [CLI reference](/docs/reference/cli)
- [Error types](/docs/api/errors)
- [Load a holo](/docs/api/load)

Generated from prism-code 0.3.0, sdk/docs/cli.json 2026-10-30, @prism-code/spec 2026-10-23 at e84124f0fed01510843772ae11d8a3068cef47ea.

<!-- reference/cli -->

---
title: CLI reference
description: The prism-code command that ships today, then every prism verb, its flags, its exit codes and its usage.
available_in: "1.0-beta"
---

Source: `sdk/docs/cli.json` 2026-10-30, the stand-in for `prism --help --json`.

`prismpm` is an alias of `prism` and is kept through every 1.x release.

## The command that ships today

Install `prism-code` with `npm install prism-code`, or run it with `npx prism-code <verb>`. Node.js 22 or later. build, verify and conformance also need Docker and a `prismpm.lock` in the current directory.

| Verb                 | Usage                                                                                                                                                                                                                                                                                              | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run`                | `prism-code run <app.holo> [<input>] [--input <text>] [--rm] [--port <n>] [--policy <file>] [--allow-unverified] [--capabilities <file>]`                                                                                                                                                          | Check the holo against the policy. With an input, this is one run as a container: dispatch the input, print the output and exit with the container's code, keeping the container until `rm` unless `--rm`. Without one, serve its view on a local port; a POST to `/_hologram/intent` dispatches one request. A holo that fails check is refused unless `--allow-unverified`, which warns on every start.                                                                                                                                                           |
| `rm`                 | `prism-code rm <container>...`                                                                                                                                                                                                                                                                     | Remove containers, by id or unique id prefix. A running container is refused.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `init`               | `prism-code init [<dir>] [--sdk-image <ref>]`                                                                                                                                                                                                                                                      | Scaffold a project: `prism.toml`, a language-1.2 model and its Lean workspace. With `--sdk-image`, also copy that image's `standards.lock` and write `prismpm.lock` (needs Docker). `npm create prism-code` runs the same command.                                                                                                                                                                                                                                                                                                                                  |
| `manifest`           | `prism-code manifest [<dir>] [--target <target>]`                                                                                                                                                                                                                                                  | Check and lint the project's `prism.toml`, with the overlay for the target merged in, and print the application, the grant and the variables.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `providers`          | `prism-code providers <verb> [<dir>] [--target <target>] [--json]`                                                                                                                                                                                                                                 | `up` runs the `prism-provider-<type>` each capability in `prism.toml` declares and prints the variables it produced, and `down` releases them. Text output names them, and `--json` also prints their values. The capability set must allow the type and each variable. Experimental.                                                                                                                                                                                                                                                                               |
| `vectors`            | `prism-code vectors <app.holo>`                                                                                                                                                                                                                                                                    | Replay every acceptance vector the holo carries and exit 1 on a failure.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `history`            | `prism-code history <app.holo> [--output <file>]`                                                                                                                                                                                                                                                  | Write the acceptance vectors the holo carries as a history, its first.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `replay`             | `prism-code replay <history>... --holo <app.holo> [--statement <file>] [--json]`                                                                                                                                                                                                                   | Re-execute histories, or every history in a directory, against this build and compare every outcome: exit 0 unchanged, 1 diverged, 2 could not replay. `--statement` writes the `prism/replay/v1` statement, also on a divergence.                                                                                                                                                                                                                                                                                                                                  |
| `inspect`            | `prism-code inspect <holo-or-container> [--format <path>]`                                                                                                                                                                                                                                         | Print what the holo says about itself, without running it, or a container's state, exit code, image digest and output.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `attest`             | `prism-code attest <app.holo> --predicate <file> --type <uri>`                                                                                                                                                                                                                                     | Sign an in-toto statement about the holo into its attestation section: keyless with an OIDC token, or with `--key`.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `verify-attestation` | `prism-code verify-attestation <app.holo> --certificate-identity <id> --certificate-oidc-issuer <url>`                                                                                                                                                                                             | Check the holo's attestations against the signer you expect, or against `--key`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `export`             | `prism-code export <name@sha256:digest> [--out <dir>] [--tar <file>] [--project <dir>] [--json]`                                                                                                                                                                                                   | Write a release's six-file browser export or tarball, byte-checked against the build manifest, attestations beside.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `generate`           | `prism-code generate <app.holo> --out <dir> [--lang js]`                                                                                                                                                                                                                                           | Write bindings and a typed client from the holo's WIT world and model into `<dir>`, with a record of what they came from. A second run with the same inputs writes nothing.                                                                                                                                                                                                                                                                                                                                                                                         |
| `check`              | `prism-code check <app.holo> [--policy <file>] [--replay <file>] [--key <file>] [--certificate-identity <id>] [--certificate-oidc-issuer <url>] [--trusted-root <file>] [--json]`                                                                                                                  | Judge the holo against a policy and print its verdict: the assurance level, whether the policy passed, and every reason. `--policy` takes a Rego file, the name of a shipped policy (`pure-only`, `provenance-only`) or a JSON file. Exit 1 when the policy denies, 2 when it cannot be parsed or evaluated. A holo that carries signed provenance and proof statements reaches P1 and P2 only when `--key`, or a certificate identity and issuer, names the signer that signed them. Without a holo, the deprecated spelling of `build --check`, removed in 0.4.0. |
| `push`               | `prism-code push <app.holo> <reference> [--key <file>] [--keyless] [--no-attestations] [--signing-config <file>] [--store <dir>] [--plain-http] [--json]`                                                                                                                                          | Put the holo in an OCI registry or a local store as a deterministic manifest, each attestation a referrer. With `--key` or `--keyless`, also sign a statement naming the manifest, so `cosign verify-attestation` passes on the same reference.                                                                                                                                                                                                                                                                                                                     |
| `pull`               | `prism-code pull <reference> [<out.holo>] [--policy <file>] [--key <file>] [--certificate-identity <id>] [--certificate-identity-regexp <re>] [--certificate-oidc-issuer <url>] [--type <uri>] [--trusted-root <file>] [--entries <n>] [--timestamps <n>] [--store <dir>] [--plain-http] [--json]` | Fetch a holo and write it only after its digests, archive, verdict and attestations pass; the signer flags are those of `verify-attestation`. A reference is `registry/repo:tag`, `@sha256:`, `@blake3:` or `dir://`.                                                                                                                                                                                                                                                                                                                                               |
| `dev`                | `prism-code dev [<dir>] [--port <n>] [--no-open] [--policy <file>] [--build <command>] [--holo <path>]`                                                                                                                                                                                            | Watch the project, rebuild and re-check on every change, and serve the local studio at `http://localhost:4100`, with a Check tab and a Replay tab. The page loads nothing from outside the machine.                                                                                                                                                                                                                                                                                                                                                                 |
| `build`              | `prism-code build [--check]`                                                                                                                                                                                                                                                                       | Build the project into a holo inside the SDK image the lockfile pins. With `--check`, validate the model and write nothing.                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `verify`             | `prism-code verify`                                                                                                                                                                                                                                                                                | Run verify in the SDK image the lockfile pins.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `conformance`        | `prism-code conformance`                                                                                                                                                                                                                                                                           | Run the conformance suite in the SDK image the lockfile pins.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

| Code | Name           | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | ok             | The verb did what you asked, or `check` reached a verdict the policy accepts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 1    | vectors failed | At least one acceptance vector did not replay or the holo carries none, `replay` diverged, `verify-attestation` did not verify, `check` reached a verdict the policy rejects, or `pull` found a digest that does not match or a holo that fails verification and wrote nothing.                                                                                                                                                                                                                                                                                                                                                                                         |
| 2    | refused        | The holo, capability file or manifest cannot be read or fails its checks, an identity check failed, a guest import, the holo's world or a provider is not granted, or a provider failed; or `check` reached no verdict: not a holo, an unreadable policy or an unknown format revision; or `push` or `pull` got no answer: an unreachable registry, refused credentials, a reference that does not exist or referrers that cannot be stored; or an export's bytes differ from the build manifest; or `generate` refused to write: the guest does not conform to its world, or a file in the output directory is not one it wrote; or `replay` could not be carried out. |
| 3    | signing failed | `attest` could not sign, or the optional sigstore packages are not installed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 10   | proof mismatch | `run` refused a holo for a proof reason. 11 is a world mismatch, 12 a determinism violation, 13 a replay error.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 64   | usage          | The arguments were wrong, or `prismpm.lock` is missing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 69   | no Docker      | Docker is not installed or not on the PATH.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 70   | untyped        | Dispatch threw something untyped: a guest trap, or a bug in the runtime.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

### Plugins (experimental)

An executable named `prism-<name>` on the PATH runs as `prism-code <name>`, and `prism <name>` once the CLI is renamed. On Windows the first `PATHEXT` extension found in a directory wins and names are case-insensitive. The first PATH directory that has the plugin wins, and a built-in verb always wins over a plugin.

A plugin answers `prism-<name> prism-cli-plugin-metadata` with JSON: `schemaVersion` "1", `vendor`, `version`, `shortDescription` and optional `errorHooks`, a list of verbs. A plugin that does not answer is listed as invalid and never runs. Arguments reach the plugin unchanged and its exit code is the command's.

When a verb a plugin names in `errorHooks` exits non-zero, prism-code runs `prism-<name> prism-cli-plugin-hooks` with `{"schemaVersion":"1","command","args","exitCode"}` on stdin and prints the `messages` it returns under What's next, at most ten lines. Set `PRISM_CODE_NO_HOOKS=1` to turn hooks off.

| Plugin   | Binary         | Usage               | What it does                                                                                                                                                                                                                                    |
| -------- | -------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `doctor` | `prism-doctor` | `prism-code doctor` | Check Node.js, Docker, `./prismpm.lock` and the optional sigstore packages; exit 1 when a check fails. Ships in the prism-code package, and its error hook points at it when check, build, verify, conformance or export-browser exit 64 or 69. |

### Providers (experimental)

An executable named `prism-provider-<type>` on the PATH is found the way a plugin is, and is not a plugin: `prism-code provider-<type>` is not a command, and the `provider-` prefix is reserved.

| Type | Binary              | In prism.toml                                               | What it does                                                                                                                                                                            |
| ---- | ------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kv` | `prism-provider-kv` | `provider = { type = "kv", options = { store, dir, set } }` | A local key-value store, kept as one JSON file under `.prism/kv`. Returns `URL` and `STORE`. `up` never overwrites a key, and `down` deletes the file. Ships in the prism-code package. |

## Global flags

| Flag                   | Default            | Meaning                                                      |
| ---------------------- | ------------------ | ------------------------------------------------------------ |
| `--json`               | off                | Print the result as one JSON object instead of text.         |
| `--policy <file>`      | the default policy | Policy file for `check` and `run`.                           |
| `--unstable-<feature>` | off                | Enable one experimental feature by name for this invocation. |
| `--help`               |                    | Print usage for the verb and exit 0.                         |

## Exit codes

| Code | Name          | Meaning                                                                                               |
| ---- | ------------- | ----------------------------------------------------------------------------------------------------- |
| 0    | pass          | The verb did what you asked and every check it ran passed.                                            |
| 1    | fail          | A check failed, an intent sentence is unproved, or a replay diverged.                                 |
| 2    | cannot verify | No verdict was reached: a missing attestation, an unreachable registry or an unknown format revision. |

## Verbs

Status: the prism CLI has not shipped, so no verb output is captured. Usage and flags come from the stand-in description.

### init

Scaffold a new application: `prism.toml`, `examples/`, `intent.md`, a default capability set and the lockfile.

```bash
prism init [<name>] [flags]
```

| Flag                                  | Default | Meaning                                |
| ------------------------------------- | ------- | -------------------------------------- |
| `--types <ts\|json-schema\|pydantic>` | ts      | Which type source the scaffold writes. |
| `--template <name>`                   | minimal | Starting examples and intent.          |
| `--force`                             | off     | Overwrite files that already exist.    |

```bash
prism init calculator
```

### build

Compile the model into a holo inside the pinned SDK image, record provenance and the proof attestation, and cache the result by spec digest.

```bash
prism build [flags]
```

| Flag                       | Default | Meaning                                                                                              |
| -------------------------- | ------- | ---------------------------------------------------------------------------------------------------- |
| `--provenance=<min\|max>`  | min     | How much the provenance records. `max` adds every resolved input and the full toolchain environment. |
| `--no-provenance`          | off     | Skip provenance. Unsafe: the holo cannot pass `check` above P0.                                      |
| `--no-cache`               | off     | Rebuild even when the spec digest is unchanged.                                                      |
| `--target <browser\|node>` | none    | Apply the matching overlay, `prism.browser.toml` or `prism.node.toml`.                               |
| `--max-iterations <n>`     | 10      | How many times the agent may revise the model before the build fails.                                |

```bash
prism build
```

### check

Verify the holo's digest, provenance, proof, lockfile pins and declared world against a policy, then print a verdict with the assurance level and reasons.

```bash
prism check [<ref>] [flags]
```

| Flag              | Default            | Meaning                                                                    |
| ----------------- | ------------------ | -------------------------------------------------------------------------- |
| `--policy <file>` | the default policy | Policy to judge against.                                                   |
| `--offline`       | off                | Do not contact the transparency log or any registry. Missing data exits 2. |

```bash
prism check calculator@sha256:3f9c
```

### run

Instantiate the holo after `check` passes at the policy's level, then grant exactly the capability set it declares.

```bash
prism run <ref> [flags]
```

| Flag                 | Default            | Meaning                                                       |
| -------------------- | ------------------ | ------------------------------------------------------------- |
| `--input <json>`     | stdin              | One input to dispatch. Omit it to read inputs line by line.   |
| `--policy <file>`    | the default policy | Policy the gate judges against.                               |
| `--allow-unverified` | off                | Run even when `check` fails. Prints a warning on every start. |
| `--rm`               | off                | Remove the container when it exits. One input only.           |
| `--port <n>`         | none               | Serve the instance over HTTP instead of dispatching once.     |

```bash
prism run calculator@sha256:3f9c --input '{"op":"add","a":2,"b":3}'
```

### dev

Watch the model, rebuild and re-check on every change, and serve a local studio with Check and Replay tabs.

```bash
prism dev [flags]
```

| Flag                | Default                                      | Meaning                              |
| ------------------- | -------------------------------------------- | ------------------------------------ |
| `--port <n>`        | 4100                                         | Studio port.                         |
| `--no-open`         | off                                          | Do not open the studio in a browser. |
| `--policy <file>`   | the default policy                           | Policy the Check tab judges against. |
| `--build <command>` | `[model].build`, then `prism build --update` | The build to run, in a shell.        |
| `--holo <path>`     | the one the build reports                    | The file the build writes.           |

```bash
prism dev
```

### replay

Re-execute recorded histories against a build and fail on any divergence, reporting every one.

```bash
prism replay <history>... --holo <path> [flags]
```

| Flag                 | Default  | Meaning                                                                     |
| -------------------- | -------- | --------------------------------------------------------------------------- |
| `--holo <path>`      | required | Which holo to replay against.                                               |
| `--statement <file>` | none     | Write the `prism/replay/v1` statement there, also when the replay diverged. |

```bash
prism replay history/2026-10-23.json --holo calculator.holo
```

### push

Push a holo and its attestations to an OCI registry. The attestations travel as referrers of the holo.

```bash
prism push <ref> <registry/repo[:tag]> [flags]
```

| Flag                | Default | Meaning                                                |
| ------------------- | ------- | ------------------------------------------------------ |
| `--store <dir>`     | none    | Push to a local directory store instead of a registry. |
| `--no-attestations` | off     | Push the holo only. The pushed holo checks at P0.      |

```bash
prism push calculator@sha256:3f9c ghcr.io/acme/calculator:1.0
```

### pull

Pull a holo and its attestations from an OCI registry or a local directory store.

```bash
prism pull <registry/repo[:tag]|ref> [flags]
```

| Flag            | Default | Meaning                                                |
| --------------- | ------- | ------------------------------------------------------ |
| `--store <dir>` | none    | Pull from a local directory store.                     |
| `--check`       | off     | Run `check` on the pulled holo and exit with its code. |

```bash
prism pull ghcr.io/acme/calculator:1.0
```

### deploy

Publish the holo to a GitHub repository and GitHub Pages, serving its attestations alongside it.

```bash
prism deploy [<ref>] [flags]
```

| Flag                  | Default        | Meaning                     |
| --------------------- | -------------- | --------------------------- |
| `--repo <owner/name>` | the git remote | Repository to publish to.   |
| `--branch <name>`     | gh-pages       | Branch GitHub Pages serves. |
| `--no-pages`          | off            | Push the repository only.   |

```bash
prism deploy
```

### export

Write the six-file browser export, a tarball, or a runnable OCI image that `docker run` serves.

```bash
prism export [<ref>] [flags]
```

| Flag               | Default | Meaning                                     |
| ------------------ | ------- | ------------------------------------------- |
| `--out <dir>`      | export/ | Where the browser export is written.        |
| `--tar <file>`     | none    | Write one tarball instead of a directory.   |
| `--oci <name:tag>` | none    | Write a runnable OCI image under this name. |

```bash
prism export --oci acme/calculator:1.0
```

### inspect

Print the manifest, section digests, format revision, world and attestations of a holo without running it.

```bash
prism inspect <ref> [flags]
```

| Flag                                                           | Default | Meaning                                                                       |
| -------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------- |
| `--format <manifest\|sections\|world\|attestations\|revision>` | all     | Print one part only.                                                          |
| `--audit`                                                      | off     | Print the security view: signers, trusted base, capability set, theorem list. |
| `--report <file>`                                              | none    | With `--audit`, write the report to a file.                                   |

```bash
prism inspect calculator@sha256:3f9c
```

### attest

Add a signed statement to a holo. Signing is keyless by default.

```bash
prism attest <ref> --predicate <file> --type <uri> [flags]
```

| Flag                 | Default  | Meaning                                                      |
| -------------------- | -------- | ------------------------------------------------------------ |
| `--predicate <file>` | required | JSON file holding the predicate.                             |
| `--type <uri>`       | required | Predicate type URI.                                          |
| `--key <file>`       | none     | Sign with a local key for air-gapped use instead of keyless. |

```bash
prism attest calculator@sha256:3f9c --predicate sbom.json --type https://example.com/sbom/v1
```

### verify

Check a signed statement on a holo against the signing identity you expect.

```bash
prism verify <ref> --certificate-identity <id> --certificate-oidc-issuer <url> [flags]
```

| Flag                              | Default  | Meaning                                               |
| --------------------------------- | -------- | ----------------------------------------------------- |
| `--certificate-identity <id>`     | required | Identity the statement must be signed by.             |
| `--certificate-oidc-issuer <url>` | required | Issuer that identity must come from.                  |
| `--type <uri>`                    | all      | Verify statements of one predicate type only.         |
| `--key <file>`                    | none     | Verify against a local public key instead of keyless. |

```bash
prism verify calculator@sha256:3f9c --certificate-identity ci@acme.example --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

### generate

Regenerate the JS, Rust and Python bindings and the typed client from the world. Nothing is written when nothing changed.

```bash
prism generate [flags]
```

| Flag                      | Default        | Meaning                                                                                                 |
| ------------------------- | -------------- | ------------------------------------------------------------------------------------------------------- |
| `--out <dir>`             | none, required | Output path. There is no default, so nothing lands in `node_modules` or another place you did not name. |
| `--lang <js,rust,python>` | all three      | Which bindings to write.                                                                                |

```bash
prism generate --out generated
```

### lock

Write or refresh the lockfile from the current model and inputs, without building. Pins that still resolve stay as they are, and the SDK image and toolchain pins do not move. Exits 2 when there is no lockfile or its SDK cannot be resolved.

```bash
prism lock [flags]
```

| Flag      | Default | Meaning                                                                       |
| --------- | ------- | ----------------------------------------------------------------------------- |
| `--check` | off     | Write nothing. Fail when the lockfile is stale and name the pins that differ. |

```bash
prism lock
```

### update

Move the lockfile forward and print the old and new digests of every pin that changed. Without a flag it refreshes the toolchain pins; with `--toolchain` it also pins a new SDK image. Exits 2 when the lockfile or the image cannot be resolved.

```bash
prism update [flags]
```

| Flag                        | Default                      | Meaning                                                    |
| --------------------------- | ---------------------------- | ---------------------------------------------------------- |
| `--toolchain <ref>`         | the pinned image             | SDK image to pin, as `name@sha256:digest`.                 |
| `--standards-lock <digest>` | the project's standards lock | Standards lock the new image selects. Needs `--toolchain`. |
| `--dry-run`                 | off                          | Print the change without writing the lockfile.             |

```bash
prism update --toolchain ghcr.io/acme/toolchain@sha256:1f3c --dry-run
```

## Next steps

- [Manifest reference](/docs/reference/manifest)
- [Errors reference](/docs/reference/errors)
- [Lockfile reference](/docs/reference/lockfile)

Generated from sdk/docs/cli.json 2026-10-30 (stand-in for prism --help --json).

<!-- reference/policy -->

---
title: Policy reference
description: The policy check and run judge a holo against, the default policy and how a failure is reported.
available_in: "0.6"
---
Use this page to know what a holo must reach before it runs, and how to write your own rule. A policy says which assurance level a holo must reach and what else must be true of it. `prism check --policy <file>` and `prism run --policy <file>` judge against a policy file. Without the flag, both use the default policy. Today the same flag is on `prism-code check` and `prism-code run`. A policy is always your input at check time, and it never lives in the holo.

## The policy file

A policy file is [Rego](https://www.openpolicyagent.org/docs/policy-language), in the package `prism.policy`. It decides with two rules.

| Rule | Type | Meaning |
|---|---|---|
| `minimum` | one of `P0` to `P3`, required | The lowest assurance level the policy accepts. |
| `deny` | a set of objects, optional | Each member fails the holo. It has exactly `rule`, a dotted name such as `policy.house.builder`, and `message`, one sentence for a person. |

`--policy` takes one of these.

| Value | What it reads |
|---|---|
| `pure-only`, `provenance-only`, `default` | The policy of that name, shipped with the SDK. A file with the same name is reached as `./pure-only`. |
| A path ending in `.rego` | That file. |
| Any other path | A JSON file of `name`, `minimum`, `digests`, `world` and `effects`, which adjust the default policy. |

CUE is not read yet. A `.cue` file exits 2 with `policy.parse`.

A rule named `policy.*` becomes a reason in the verdict, under that name. A rule may also name a reason the check already reported, such as `world.capabilities` or `holo.integrity`, which fails the holo on that reason and adds no other. A policy cannot make up evidence, and it never changes the level.

### Example: pure only

`--policy pure-only` accepts a holo that does nothing beyond pure dispatch: it imports no effect, asks for no capability and is granted none. Any level passes, so copy the file and raise `minimum` when you also need one.

```rego
# Pure only: the holo does nothing beyond pure dispatch. It imports no effect, requests no
# capability and is granted none. Any assurance level passes, so an intact holo with no
# statements passes. Copy this file and raise minimum when you also need a level.
package prism.policy

import rego.v1

minimum := "P0"

# A pure world promises nothing about a holo whose bytes do not hold together.
damage contains reason.check if {
	some reason in input.verdict.reasons
	reason.check in {"holo.integrity", "holo.documents", "world.contract"}
}

deny contains {"rule": check, "message": sprintf("the holo is damaged: %s", [check])} if {
	some check in damage
}

deny contains {"rule": "policy.pure-only.world", "message": "the holo declares no world, so nothing shows that it is pure"} if {
	input.world == null
}

deny contains {"rule": "policy.pure-only.world", "message": sprintf("this reader has no world for %s, so nothing shows that it is pure", [input.world.contract])} if {
	input.world.known == false
}

deny contains {"rule": "policy.pure-only.effects", "message": sprintf("the world imports the impure effects %v", [input.world.effects])} if {
	input.world.pure == false
}

deny contains {"rule": "policy.pure-only.imports", "message": sprintf("the world imports %s.%s", [entry.module, entry.name])} if {
	some entry in input.world.imports
}

deny contains {"rule": "policy.pure-only.requested", "message": "the holo carries a capability set that requests something"} if {
	input.world.capability_set.empty == false
}

deny contains {"rule": "policy.pure-only.granted", "message": sprintf("the caller grants %s", [member])} if {
	some member, entries in input.capabilities
	startswith(member, "allow-")
	count(entries) > 0
}
```

### Example: provenance only

`--policy provenance-only` accepts a holo with a provenance statement whose signature checks, and asks for no proof.

```rego
# Provenance only: the holo carries a provenance statement whose signature checks, and no proof is
# required. P1 includes the integrity of the archive, so a damaged holo cannot reach it.
package prism.policy

import rego.v1

minimum := "P1"

deny contains {"rule": "policy.provenance-only.absent", "message": "the holo carries no provenance statement"} if {
	input.predicates.provenance == null
}

deny contains {"rule": "policy.provenance-only.unverified", "message": "the provenance statement signature does not check against the trust root"} if {
	input.predicates.provenance.verified == false
}
```

### What a policy reads

A policy reads one document, `input`, whose `schema` member is `prism/policy-input/1`. Its JSON Schema is `schemas/policy/policy-input-v1.schema.json` in `@prism-code/spec`.

| Member | What it holds |
|---|---|
| `holo.fingerprint` | The archive fingerprint, as in the verdict. |
| `holo.revision` | The format revision the archive matches, or null. |
| `holo.digests` | `sha256` and `blake3` of `archive`, `capabilities`, `guest`, `view` and `model`. |
| `verdict.level` | The assurance level from the evidence. |
| `verdict.reasons` | Every check that did not pass, before any policy. |
| `world` | `contract`, `known`, `within`, `pure`, `effects`, `imports`, `problems` and `capability_set`. Null when the holo names no contract. |
| `capabilities` | The capability set you granted, or null. A policy file never grants one. |
| `predicates.provenance`, `.proof`, `.replay` | Each `predicateType`, `verified` and `predicate`, or null when the holo carries none. All are null today. |

### The Rego it accepts

The evaluator runs in a browser with no dependencies, so it accepts a part of Rego and refuses the rest. A policy that both it and OPA accept gets the same answer from each, so you can try one there:

```bash
opa eval -d policy.rego -i input.json data.prism.policy
```

`policyInput(bytes)` in `@prism-code/verify` returns the input document of a holo.

| Accepted | Refused, with an error that names it |
|---|---|
| `x := term`, `x if { }`, `default x := term`, `x contains term if { }` | Functions, partial objects, `else` |
| `some v in c`, `some k, v in c`, `every v in c { }`, `not`, `x := term` | `=`, `with`, a bare `some` |
| `==`, `!=`, `<`, `<=`, `>`, `>=`, `x in c` | Arithmetic and the set operators |
| Arrays, objects, sets, comprehensions, `input.a[k]` with `k` bound | `_` or an unbound variable in a reference, `data` |
| `concat`, `contains`, `count`, `endswith`, `object.get`, `object.keys`, `set`, `sprintf`, `startswith`, `type_name` | Every other function |

It is stricter than OPA in three ways, and each one stops a mistake from reading as a pass. A function given the wrong type, or `<` between two types, is an error where OPA gives no value. A rule that neither `minimum` nor `deny` uses is an error, which catches an `allow` nothing consults. A body is read in the order written, so a variable used before it is bound is an error.

It is looser in one way, because it has no type checker. OPA refuses a policy that compares values it can see are different types, such as `1 == "1"`, when it compiles. This evaluator answers false.

## The default policy

The holo must reach P2 or above, and every host, store and variable its world declares must be inside the capability set granted in `prism.toml`. It is a policy file like any other, shipped as `default.rego`:

```rego
# The default policy: P2 or above, and the declared world within the granted capabilities.
# prism check judges a holo by this file when no --policy is given.
package prism.policy

import rego.v1

minimum := "P2"

deny contains {"rule": "world.capabilities", "message": message} if {
	input.world.within == false
	message := concat("; ", input.world.problems)
}
```

| Rule | Default |
|---|---|
| Lowest assurance level that passes | P2 |
| Attestations that must be present and verify | provenance, proof |
| World | within the capability set in `prism.toml` |

The world is what the compiler derived from the model, so a holo cannot declare less than it uses.

## Assurance levels

| Level | Name | What is confirmed |
|---|---|---|
| P0 | unverified | Nothing. The holo loaded, that is all. |
| P1 | provenance | How and from what the holo was built. |
| P2 | proof checked | P1, plus every theorem checked against the holo. |
| P3 | proof plus replay plus capabilities | P2, plus every history replays unchanged, plus the world is within policy. |

## How check reports a failure

`prism check` prints every rule it evaluated, marks the ones that failed, and exits 1. The level is still reported, so you can see how far the holo got.

```bash
prism check calculator@sha256:3f9c… --policy pure-only
```

```text
calculator@sha256:3f9c…
  digest      ok
  provenance  ok   signed, logged
  proof       ok   2 theorems checked
  lockfile    ok   toolchain pinned
  world       FAIL store "results" is not in policy capabilities
Verdict: FAIL  Level: P2  (policy: pure-only)
```

A JSON policy can also list the impure effects the holo's world may import, as `effects`: any of `clock`, `random`, `socket`, `filesystem` and `unknown`. Without it any effect is allowed. `"effects": []` fails a world that imports anything impure, and so does a world importing an interface nothing describes. Add an effect to grant it, such as `"effects": ["clock"]`.

With `--json` the same result is one object with `verdict`, `level`, `policy` and a `reasons` list, one entry per failed rule. `prism run` prints the same report and refuses to instantiate. `prism run --allow-unverified` instantiates anyway and prints a warning on every start.

When `check` cannot evaluate a rule, because a registry or the transparency log is unreachable, it exits 2 and names the rule it could not evaluate. That is not a pass. `--offline` makes `check` contact neither, so any data it would fetch is missing and it exits 2.

| Exit code | Meaning |
|---|---|
| 0 | Every rule passed. |
| 1 | A rule failed, or the policy denied the holo. |
| 2 | No verdict was reached, which includes a policy that cannot be parsed or evaluated. |

A policy that fails is one of three errors, each with a code that does not change.

| Failure | Error | `code` | `check` | Exit | The message names |
|---|---|---|---|---|---|
| The policy does not parse, or uses something it refuses | `PolicyParseError` | `policy_parse_failed` | `policy.parse` | 2 | The line, the column and the construct |
| The policy parsed and could not decide | `PolicyEvaluationError` | `policy_evaluation_failed` | `policy.evaluation` | 2 | The rule and its line |
| The policy denied the holo | `PolicyDeniedError` | `policy_denied` | the rule | 1 | The rule, in `check` |

Treat 2 as a failure in CI. It means nothing was judged, so a broken policy can never read as a pass.

## Next steps

- [Attestations reference](/docs/reference/attestations)
- [Verify and inspect](/docs/guides/verify-and-inspect)
- [Run and gate](/docs/guides/run-and-gate)

<!-- reference/release-status -->

---
title: Release status
description: What you can use today and which release each Prism feature lands in.
available_in: "0.2.0"
---
These docs describe Prism 1.0. Use this page to see what works today and what each release adds. Every other page names the release it needs in its `available_in` field, and that value comes from the table below.

Today `prism-code` 0.2.0 is on npm. It loads a holo, dispatches a request to it, and replays the examples it carries. Its command serves a holo and runs the build in the pinned SDK image. The `prism` CLI has not shipped.

## What is published

<!-- generated:distribution:begin -->
| What                     | Today         | Note                                                                                     |
| ------------------------ | ------------- | ---------------------------------------------------------------------------------------- |
| Documented API           | 1.0           | These docs describe Prism 1.0. Every page says which release it needs in `available_in`. |
| `prism-code` on npm      | 0.2.0         | `load`, `dispatch` and `acceptance`, and the `prism-code` command.                       |
| `prism` CLI              | not shipped   | Today `prism-code check` and `prism-code build` run the build in the pinned SDK image.   |
| `@prism-code/*` packages | not published | `@prism-code/spec` and `@prism-code/verify` are written and publish with 0.5.            |
| Rust crates              | not published | The `prism-code` crate ships with 1.0-beta.1.                                            |
| Python package           | not published | The `prism-code` package ships with 1.1.                                                 |
<!-- generated:distribution:end -->

## Releases

<!-- generated:releases:begin -->
| Release    | Status             | What it brings                                                                                   |
| ---------- | ------------------ | ------------------------------------------------------------------------------------------------ |
| 0.2.0      | shipped 2026-10-23 | The prism-code runtime and command on npm: load a holo, dispatch a request, replay its examples. |
| 0.5        | planned            | Lock, check, proof and attestations.                                                             |
| 0.6        | planned            | The world, capability sets, the run gate, replay and conformance.                                |
| 1.0-beta.1 | planned            | Push, pull, deploy, Docker export, agent bridges, plugins, the Rust runtime and these docs.      |
| 1.0-rc     | planned            | Release candidates and hardening.                                                                |
| 1.0        | planned            | The CLI and the runtime API become Stable.                                                       |
| 1.1        | planned            | The Python runtime, verifier plugins and host plugins.                                           |
<!-- generated:releases:end -->

## Feature by release

<!-- generated:features:begin -->
| Feature                                                                                                                          | Available in |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `prism-code` library: `load`, `dispatch`, and `acceptance`, which replays the examples a holo carries                            | 0.2.0        |
| `prism-code run` serves a holo, `prism-code vectors` replays its examples, `prism-code inspect` prints what it says about itself | 0.2.0        |
| `prism-code check` and `prism-code build` run the build in the SDK image pinned by the lockfile                                  | 0.2.0        |
| The holo format: section table, sha256 and BLAKE3 digests, digest footer                                                         | 0.2.0        |
| `prism lock`, `prism update` and the full input lock                                                                             | 0.5          |
| `prism check` with a verdict, an assurance level and exit codes                                                                  | 0.5          |
| Provenance on by default at `prism build`                                                                                        | 0.5          |
| Proof at build, checked at `check`                                                                                               | 0.5          |
| Attestation bundle inside the holo                                                                                               | 0.5          |
| `prism attest` and `prism verify`, keyless signing, transparency log entries and signed timestamps                               | 0.5          |
| `prism inspect`                                                                                                                  | 0.5          |
| `holo.verify()` and typed errors in `prism-code`                                                                                 | 0.5          |
| `@prism-code/spec` and `@prism-code/verify` on npm                                                                               | 0.5          |
| The world as the holo's contract                                                                                                 | 0.6          |
| Capability sets, deny by default                                                                                                 | 0.6          |
| The `prism.toml` manifest and its overlays                                                                                       | 0.6          |
| Authoring from examples and intent                                                                                               | 0.6          |
| `prism init` and `npm create prism-code`                                                                                         | 0.6          |
| The `run` gate and `--allow-unverified`                                                                                          | 0.6          |
| Containers: `prism.containers`, `run --rm`, `rm` and exit codes from typed errors                                                | 0.6          |
| Policy files for `check` and `run`                                                                                               | 0.6          |
| Histories, `prism replay` and the replay attestation                                                                             | 0.6          |
| `prism dev` and the local studio                                                                                                 | 0.6          |
| `prism generate` bindings and typed client                                                                                       | 0.6          |
| `prism export` browser export and tarball                                                                                        | 0.6          |
| `@prism-code/testing` and `@prism-code/conformance`                                                                              | 0.6          |
| `prism push` and `prism pull` with attestations as referrers                                                                     | 1.0-beta.1   |
| `prism deploy` to GitHub and GitHub Pages                                                                                        | 1.0-beta.1   |
| `prism export --oci`                                                                                                             | 1.0-beta.1   |
| `prism inspect --audit` and the audit report                                                                                     | 1.0-beta.1   |
| Streaming dispatch                                                                                                               | 1.0-beta.1   |
| Vercel AI SDK tool and MCP server bridges                                                                                        | 1.0-beta.1   |
| CLI plugins, provider services and runtime middleware                                                                            | 1.0-beta.1   |
| Rust runtime, the `prism-code` crate                                                                                             | 1.0-beta.1   |
| The CLI and the runtime API are Stable                                                                                           | 1.0          |
| Python runtime, the `prism-code` package                                                                                         | 1.1          |
| Verifier plugins                                                                                                                 | 1.1          |
| Host plugins                                                                                                                     | 1.1          |
<!-- generated:features:end -->

## Next steps

- [Quickstart](/docs/get-started/quickstart)
- [TypeScript SDK](/docs/sdks/typescript)
- [Changelog](/docs/changelog)

<!-- api/index -->

---
title: prism-code at a glance
description: Load a holo, dispatch an input and replay its examples from Node.js with the prism-code runtime.
available_in: "0.2.0"
---

Source: `prism-code` 0.3.0, `types/index.d.ts`.

## Install

```bash
npm install prism-code
```

## Example

```js
import { load } from 'prism-code';

const app = await load('./Calculator.holo');
console.log(app.name, app.identities.verified);

const response = await app.dispatch(new TextEncoder().encode('1\tadd\t20\t22'));
console.log(JSON.stringify(new TextDecoder().decode(response)));

const result = await app.acceptance();
console.log(result.passed, 'of', result.total, 'examples replayed');
```

```text
Calculator true
"1\tok\t42"
22 of 22 examples replayed
```

## Exports

| Export                        | Kind      | Declaration                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PrismError`                  | class     | `PrismError extends Error`                                                                                                                                                                                                                                                                                                                                                                     |
| `PrismCodeError`              | class     | `PrismCodeError extends PrismError`                                                                                                                                                                                                                                                                                                                                                            |
| `VerificationError`           | class     | `VerificationError extends PrismError`                                                                                                                                                                                                                                                                                                                                                         |
| `ProofMismatchError`          | class     | `ProofMismatchError extends PrismError`                                                                                                                                                                                                                                                                                                                                                        |
| `CapabilityDeniedError`       | class     | `CapabilityDeniedError extends PrismError`                                                                                                                                                                                                                                                                                                                                                     |
| `WorldMismatchError`          | class     | `WorldMismatchError extends PrismError`                                                                                                                                                                                                                                                                                                                                                        |
| `PolicyParseError`            | class     | `PolicyParseError extends VerificationError`                                                                                                                                                                                                                                                                                                                                                   |
| `PolicyEvaluationError`       | class     | `PolicyEvaluationError extends VerificationError`                                                                                                                                                                                                                                                                                                                                              |
| `PolicyDeniedError`           | class     | `PolicyDeniedError extends VerificationError`                                                                                                                                                                                                                                                                                                                                                  |
| `DeterminismViolationError`   | class     | `DeterminismViolationError extends PrismError`                                                                                                                                                                                                                                                                                                                                                 |
| `ReplayError`                 | class     | `ReplayError extends PrismError`                                                                                                                                                                                                                                                                                                                                                               |
| `SigningError`                | class     | `SigningError extends PrismError`                                                                                                                                                                                                                                                                                                                                                              |
| `SignatureInvalidError`       | class     | `SignatureInvalidError extends PrismError`                                                                                                                                                                                                                                                                                                                                                     |
| `IdentityMismatchError`       | class     | `IdentityMismatchError extends PrismError`                                                                                                                                                                                                                                                                                                                                                     |
| `TransparencyError`           | class     | `TransparencyError extends PrismError`                                                                                                                                                                                                                                                                                                                                                         |
| `SubjectMismatchError`        | class     | `SubjectMismatchError extends PrismError`                                                                                                                                                                                                                                                                                                                                                      |
| `AttestationNotFoundError`    | class     | `AttestationNotFoundError extends PrismError`                                                                                                                                                                                                                                                                                                                                                  |
| `ProviderError`               | class     | `ProviderError extends PrismError`                                                                                                                                                                                                                                                                                                                                                             |
| `ProviderNotFoundError`       | class     | `ProviderNotFoundError extends ProviderError`                                                                                                                                                                                                                                                                                                                                                  |
| `ProviderReplyError`          | class     | `ProviderReplyError extends ProviderError`                                                                                                                                                                                                                                                                                                                                                     |
| `ProviderFailedError`         | class     | `ProviderFailedError extends ProviderError`                                                                                                                                                                                                                                                                                                                                                    |
| `TrustRootError`              | class     | `TrustRootError extends PrismError`                                                                                                                                                                                                                                                                                                                                                            |
| `RegistryError`               | class     | `RegistryError extends PrismError`                                                                                                                                                                                                                                                                                                                                                             |
| `RegistryAuthError`           | class     | `RegistryAuthError extends PrismError`                                                                                                                                                                                                                                                                                                                                                         |
| `ReferrersUnsupportedError`   | class     | `ReferrersUnsupportedError extends PrismError`                                                                                                                                                                                                                                                                                                                                                 |
| `ManifestNotFoundError`       | class     | `ManifestNotFoundError extends PrismError`                                                                                                                                                                                                                                                                                                                                                     |
| `DigestMismatchError`         | class     | `DigestMismatchError extends PrismError`                                                                                                                                                                                                                                                                                                                                                       |
| `PullVerificationError`       | class     | `PullVerificationError extends PrismError`                                                                                                                                                                                                                                                                                                                                                     |
| `ReferenceInvalidError`       | class     | `ReferenceInvalidError extends PrismError`                                                                                                                                                                                                                                                                                                                                                     |
| `ExportMismatchError`         | class     | `ExportMismatchError extends PrismError`                                                                                                                                                                                                                                                                                                                                                       |
| `MiddlewareError`             | class     | `MiddlewareError extends PrismError`                                                                                                                                                                                                                                                                                                                                                           |
| `ERROR_CLASSES`               | const     | `ERROR_CLASSES: Readonly<Record<string, typeof PrismError>>`                                                                                                                                                                                                                                                                                                                                   |
| `classForCheck`               | function  | `classForCheck(check: string): typeof PrismError`                                                                                                                                                                                                                                                                                                                                              |
| `errorForReason`              | function  | `errorForReason(reason: VerdictReason, verdict?: Verdict): PrismError`                                                                                                                                                                                                                                                                                                                         |
| `errorFromVerdict`            | function  | `errorFromVerdict(verdict: Verdict, ranks: Record<AssuranceLevel, number>): PrismError \| null`                                                                                                                                                                                                                                                                                                |
| `ExitCodeRow`                 | interface | `ExitCodeRow`                                                                                                                                                                                                                                                                                                                                                                                  |
| `EXIT_CODES`                  | const     | `EXIT_CODES: readonly ExitCodeRow[]`                                                                                                                                                                                                                                                                                                                                                           |
| `exitCodeFor`                 | function  | `exitCodeFor(error: unknown): number`                                                                                                                                                                                                                                                                                                                                                          |
| `CONTAINER_SCHEMA`            | const     | `CONTAINER_SCHEMA: 'prism/container/1'`                                                                                                                                                                                                                                                                                                                                                        |
| `ContainerStatus`             | type      | `ContainerStatus = 'created' \| 'running' \| 'exited'`                                                                                                                                                                                                                                                                                                                                         |
| `ContainerRecord`             | interface | `ContainerRecord`                                                                                                                                                                                                                                                                                                                                                                              |
| `Container`                   | interface | `Container`                                                                                                                                                                                                                                                                                                                                                                                    |
| `ContainerStore`              | interface | `ContainerStore`                                                                                                                                                                                                                                                                                                                                                                               |
| `memoryContainerStore`        | function  | `memoryContainerStore(): ContainerStore`                                                                                                                                                                                                                                                                                                                                                       |
| `ContainerOptions`            | interface | `ContainerOptions extends LoadOptions`                                                                                                                                                                                                                                                                                                                                                         |
| `Containers`                  | interface | `Containers`                                                                                                                                                                                                                                                                                                                                                                                   |
| `prism`                       | const     | `prism: { readonly containers: Containers }`                                                                                                                                                                                                                                                                                                                                                   |
| `createPrism`                 | function  | `createPrism(options?: { store?: ContainerStore; warn?: (message: string) => void }): { readonly containers: Containers }`                                                                                                                                                                                                                                                                     |
| `AssuranceLevel`              | type      | `AssuranceLevel = 'P0' \| 'P1' \| 'P2' \| 'P3'`                                                                                                                                                                                                                                                                                                                                                |
| `VerdictReason`               | interface | `VerdictReason`                                                                                                                                                                                                                                                                                                                                                                                |
| `Verdict`                     | interface | `Verdict`                                                                                                                                                                                                                                                                                                                                                                                      |
| `VerifyOptions`               | interface | `VerifyOptions`                                                                                                                                                                                                                                                                                                                                                                                |
| `MINIMUM_LEVEL_ENV`           | const     | `MINIMUM_LEVEL_ENV: 'PRISM_MINIMUM_LEVEL'`                                                                                                                                                                                                                                                                                                                                                     |
| `experimental_verify`         | function  | `experimental_verify(source: Uint8Array \| ArrayBuffer \| Blob \| Application, options?: VerifyOptions): Promise<Verdict>`                                                                                                                                                                                                                                                                     |
| `Client`                      | interface | `Client`                                                                                                                                                                                                                                                                                                                                                                                       |
| `experimental_createClient`   | function  | `experimental_createClient(options?: VerifyOptions): Client`                                                                                                                                                                                                                                                                                                                                   |
| `Limits`                      | interface | `Limits`                                                                                                                                                                                                                                                                                                                                                                                       |
| `Vector`                      | interface | `Vector`                                                                                                                                                                                                                                                                                                                                                                                       |
| `AcceptanceFailure`           | interface | `AcceptanceFailure`                                                                                                                                                                                                                                                                                                                                                                            |
| `AcceptanceResult`            | interface | `AcceptanceResult`                                                                                                                                                                                                                                                                                                                                                                             |
| `View`                        | interface | `View`                                                                                                                                                                                                                                                                                                                                                                                         |
| `ArchiveIdentities`           | interface | `ArchiveIdentities`                                                                                                                                                                                                                                                                                                                                                                            |
| `ClosureIdentities`           | interface | `ClosureIdentities`                                                                                                                                                                                                                                                                                                                                                                            |
| `Evidence`                    | interface | `Evidence`                                                                                                                                                                                                                                                                                                                                                                                     |
| `Application`                 | interface | `Application`                                                                                                                                                                                                                                                                                                                                                                                  |
| `MiddlewareStep`              | type      | `MiddlewareStep = 'verify' \| 'instantiate' \| 'dispatch' \| 'record'`                                                                                                                                                                                                                                                                                                                         |
| `MIDDLEWARE_STEPS`            | const     | `MIDDLEWARE_STEPS: readonly ['verify', 'instantiate', 'dispatch', 'record']`                                                                                                                                                                                                                                                                                                                   |
| `MiddlewareSteps`             | interface | `MiddlewareSteps`                                                                                                                                                                                                                                                                                                                                                                              |
| `MiddlewareContext`           | interface | `MiddlewareContext`                                                                                                                                                                                                                                                                                                                                                                            |
| `MiddlewareHandler`           | type      | `MiddlewareHandler<S extends MiddlewareStep = MiddlewareStep> = (`                                                                                                                                                                                                                                                                                                                             |
| `Middleware`                  | type      | `Middleware<S extends MiddlewareStep = MiddlewareStep> = (next: MiddlewareHandler<S>, context: MiddlewareContext) => MiddlewareHandler<S>`                                                                                                                                                                                                                                                     |
| `MiddlewareOptions`           | interface | `MiddlewareOptions`                                                                                                                                                                                                                                                                                                                                                                            |
| `AbsoluteMiddlewareOptions`   | interface | `AbsoluteMiddlewareOptions<S extends MiddlewareStep = MiddlewareStep> extends MiddlewareOptions`                                                                                                                                                                                                                                                                                               |
| `RelativeMiddlewareOptions`   | interface | `RelativeMiddlewareOptions extends MiddlewareOptions`                                                                                                                                                                                                                                                                                                                                          |
| `Pluggable`                   | interface | `Pluggable`                                                                                                                                                                                                                                                                                                                                                                                    |
| `MiddlewareStack`             | interface | `MiddlewareStack`                                                                                                                                                                                                                                                                                                                                                                              |
| `TracerLike`                  | interface | `TracerLike`                                                                                                                                                                                                                                                                                                                                                                                   |
| `SpanLike`                    | interface | `SpanLike`                                                                                                                                                                                                                                                                                                                                                                                     |
| `experimental_tracing`        | function  | `experimental_tracing(options: { tracer: TracerLike; steps?: MiddlewareStep[] }): Pluggable`                                                                                                                                                                                                                                                                                                   |
| `DigestSet`                   | interface | `DigestSet`                                                                                                                                                                                                                                                                                                                                                                                    |
| `HistoryEvent`                | type      | `HistoryEvent = { request: string; response: string; error?: never } \| { request: string; error: string; response?: never }`                                                                                                                                                                                                                                                                  |
| `History`                     | interface | `History`                                                                                                                                                                                                                                                                                                                                                                                      |
| `HistorySource`               | type      | `HistorySource = string \| Uint8Array \| ArrayBuffer \| History`                                                                                                                                                                                                                                                                                                                               |
| `HISTORY_SCHEMA`              | const     | `HISTORY_SCHEMA: 'prism/history/1'`                                                                                                                                                                                                                                                                                                                                                            |
| `REPLAY_PREDICATE_TYPE`       | const     | `REPLAY_PREDICATE_TYPE: 'https://uor.foundation/prism/replay/v1'`                                                                                                                                                                                                                                                                                                                              |
| `parseHistory`                | function  | `parseHistory(source: HistorySource): History`                                                                                                                                                                                                                                                                                                                                                 |
| `historyBytes`                | function  | `historyBytes(history: HistorySource): Uint8Array`                                                                                                                                                                                                                                                                                                                                             |
| `historyDigest`               | function  | `historyDigest(history: HistorySource): Promise<DigestSet>`                                                                                                                                                                                                                                                                                                                                    |
| `historyJson`                 | function  | `historyJson(history: HistorySource): string`                                                                                                                                                                                                                                                                                                                                                  |
| `acceptanceHistory`           | function  | `acceptanceHistory(app: Application): Promise<History>`                                                                                                                                                                                                                                                                                                                                        |
| `Recorder`                    | interface | `Recorder`                                                                                                                                                                                                                                                                                                                                                                                     |
| `experimental_recorder`       | function  | `experimental_recorder(app: Application): Recorder`                                                                                                                                                                                                                                                                                                                                            |
| `ReplayOutcome`               | type      | `ReplayOutcome = { response: string; error?: never } \| { error: string; response?: never }`                                                                                                                                                                                                                                                                                                   |
| `ReplayDivergence`            | interface | `ReplayDivergence`                                                                                                                                                                                                                                                                                                                                                                             |
| `ReplayedHistoryResult`       | interface | `ReplayedHistoryResult`                                                                                                                                                                                                                                                                                                                                                                        |
| `ReplayStatement`             | interface | `ReplayStatement`                                                                                                                                                                                                                                                                                                                                                                              |
| `ReplayResult`                | interface | `ReplayResult`                                                                                                                                                                                                                                                                                                                                                                                 |
| `ReplayOptions`               | interface | `ReplayOptions`                                                                                                                                                                                                                                                                                                                                                                                |
| `experimental_replay`         | function  | `experimental_replay(app: Application, histories: HistorySource \| HistorySource[], options?: ReplayOptions): Promise<ReplayResult>`                                                                                                                                                                                                                                                           |
| `SectionRole`                 | type      | `SectionRole`                                                                                                                                                                                                                                                                                                                                                                                  |
| `InspectedSection`            | interface | `InspectedSection`                                                                                                                                                                                                                                                                                                                                                                             |
| `InspectedAttestation`        | interface | `InspectedAttestation`                                                                                                                                                                                                                                                                                                                                                                         |
| `Inspection`                  | interface | `Inspection`                                                                                                                                                                                                                                                                                                                                                                                   |
| `INSPECTION_SCHEMA`           | const     | `INSPECTION_SCHEMA: 'prismpm/holo-inspection/1'`                                                                                                                                                                                                                                                                                                                                               |
| `inspect`                     | function  | `inspect(source: Uint8Array \| ArrayBuffer \| Blob): Promise<Inspection>`                                                                                                                                                                                                                                                                                                                      |
| `formatInspection`            | function  | `formatInspection(inspection: Inspection): string`                                                                                                                                                                                                                                                                                                                                             |
| `LoadOptions`                 | interface | `LoadOptions`                                                                                                                                                                                                                                                                                                                                                                                  |
| `CapabilityKind`              | type      | `CapabilityKind = 'outbound-hosts' \| 'key-value-stores' \| 'variables' \| 'providers'`                                                                                                                                                                                                                                                                                                        |
| `Capabilities`                | interface | `Capabilities`                                                                                                                                                                                                                                                                                                                                                                                 |
| `CapabilitySet`               | interface | `CapabilitySet`                                                                                                                                                                                                                                                                                                                                                                                |
| `CapabilityGrant`             | interface | `CapabilityGrant`                                                                                                                                                                                                                                                                                                                                                                              |
| `CAPABILITIES_SCHEMA`         | const     | `CAPABILITIES_SCHEMA: 'prism/capabilities/1'`                                                                                                                                                                                                                                                                                                                                                  |
| `CAPABILITY_KINDS`            | const     | `CAPABILITY_KINDS: readonly ['outbound-hosts', 'key-value-stores', 'variables', 'providers']`                                                                                                                                                                                                                                                                                                  |
| `DEFAULT_SET`                 | const     | `DEFAULT_SET: 'default'`                                                                                                                                                                                                                                                                                                                                                                       |
| `parseCapabilities`           | function  | `parseCapabilities(source: Capabilities \| Uint8Array \| string): Capabilities`                                                                                                                                                                                                                                                                                                                |
| `grantOf`                     | function  | `grantOf(capabilities: Capabilities \| null, setName?: string): CapabilityGrant`                                                                                                                                                                                                                                                                                                               |
| `Manifest`                    | interface | `Manifest`                                                                                                                                                                                                                                                                                                                                                                                     |
| `ManifestTarget`              | type      | `ManifestTarget = 'browser' \| 'node'`                                                                                                                                                                                                                                                                                                                                                         |
| `ManifestProviderDeclaration` | interface | `ManifestProviderDeclaration`                                                                                                                                                                                                                                                                                                                                                                  |
| `manifestProviders`           | function  | `manifestProviders(manifest: Manifest): readonly ManifestProviderDeclaration[]`                                                                                                                                                                                                                                                                                                                |
| `ManifestFinding`             | interface | `ManifestFinding`                                                                                                                                                                                                                                                                                                                                                                              |
| `ParsedManifest`              | interface | `ParsedManifest`                                                                                                                                                                                                                                                                                                                                                                               |
| `MANIFEST_FILE`               | const     | `MANIFEST_FILE: 'prism.toml'`                                                                                                                                                                                                                                                                                                                                                                  |
| `MANIFEST_TARGETS`            | const     | `MANIFEST_TARGETS: readonly ['browser', 'node']`                                                                                                                                                                                                                                                                                                                                               |
| `MANIFEST_VERSION`            | const     | `MANIFEST_VERSION: 1`                                                                                                                                                                                                                                                                                                                                                                          |
| `parseManifest`               | function  | `parseManifest( source: string \| Uint8Array \| Record<string, unknown>, options?: { target?: ManifestTarget \| null; overlay?: string \| Uint8Array \| Record<string, unknown> \| null }, ): ParsedManifest`                                                                                                                                                                                  |
| `validateManifest`            | function  | `validateManifest(manifest: unknown): Manifest`                                                                                                                                                                                                                                                                                                                                                |
| `lintManifest`                | function  | `lintManifest(manifest: Manifest): { errors: ManifestFinding[]; warnings: ManifestFinding[] }`                                                                                                                                                                                                                                                                                                 |
| `mergeOverlay`                | function  | `mergeOverlay(base: Record<string, unknown>, overlay: Record<string, unknown>): Record<string, unknown>`                                                                                                                                                                                                                                                                                       |
| `manifestCapabilities`        | function  | `manifestCapabilities(manifest: Manifest): { capabilities: Capabilities \| null; capabilitySet: string; file: string \| null }`                                                                                                                                                                                                                                                                |
| `resolveVariables`            | function  | `resolveVariables(manifest: Manifest, env: Record<string, string \| undefined>): Readonly<Record<string, string>>`                                                                                                                                                                                                                                                                             |
| `parseToml`                   | function  | `parseToml(source: string \| Uint8Array): Record<string, unknown>`                                                                                                                                                                                                                                                                                                                             |
| `load`                        | function  | `load(source: Uint8Array \| ArrayBuffer \| Blob \| string \| URL, options?: LoadOptions): Promise<Application>`                                                                                                                                                                                                                                                                                |
| `loadArchive`                 | function  | `loadArchive(source: Uint8Array \| ArrayBuffer, options?: Pick<LoadOptions, 'capabilities' \| 'capabilitySet'>): Promise<Application>`                                                                                                                                                                                                                                                         |
| `loadClosure`                 | function  | `loadClosure( files: Map<string, Uint8Array>, importGlue: (name: string) => Promise<Record<string, unknown>>, options?: { model?: Record<string, unknown> \| Uint8Array \| null } & Pick<LoadOptions, 'capabilities' \| 'capabilitySet'>, ): Promise<Application>`                                                                                                                             |
| `ParsedArchive`               | interface | `ParsedArchive`                                                                                                                                                                                                                                                                                                                                                                                |
| `parseArchive`                | function  | `parseArchive(source: Uint8Array \| ArrayBuffer): ParsedArchive`                                                                                                                                                                                                                                                                                                                               |
| `resolveArchive`              | function  | `resolveArchive(parsed: ParsedArchive): { directory: Record<string, unknown>; provenance: Record<string, unknown>; modelDocument: Record<string, unknown>; guest: { label: string; content: Uint8Array }; view: { label: string; content: Uint8Array }; model: { label: string; content: Uint8Array }; capabilities: { label: string; content: Uint8Array }; identities: ArchiveIdentities; }` |
| `canonicalJson`               | function  | `canonicalJson(value: unknown): string`                                                                                                                                                                                                                                                                                                                                                        |
| `decodeHoloview`              | function  | `decodeHoloview(bytes: Uint8Array): View`                                                                                                                                                                                                                                                                                                                                                      |
| `encodeHoloview`              | function  | `encodeHoloview(view: View): Uint8Array`                                                                                                                                                                                                                                                                                                                                                       |
| `compileGuest`                | function  | `compileGuest(wasm: Uint8Array, grant?: CapabilityGrant): Promise<WebAssembly.Module>`                                                                                                                                                                                                                                                                                                         |
| `runGuest`                    | function  | `runGuest(module: WebAssembly.Module, request: Uint8Array, limits?: Partial<Limits>): Uint8Array`                                                                                                                                                                                                                                                                                              |
| `runAcceptance`               | function  | `runAcceptance(vectors: Vector[], dispatch: (request: Uint8Array) => Uint8Array \| Promise<Uint8Array>): Promise<AcceptanceResult>`                                                                                                                                                                                                                                                            |
| `verifyClosure`               | function  | `verifyClosure(files: Map<string, Uint8Array>): Promise<{ stem: string; glueName: string; wasmName: string; provenance: Record<string, unknown>; verification: Pick<ClosureIdentities, 'verified' \| 'mismatches' \| 'unverifiable'>; }>`                                                                                                                                                      |
| `blake3`                      | function  | `blake3(bytes: Uint8Array, length?: number): Uint8Array`                                                                                                                                                                                                                                                                                                                                       |
| `blake3Hex`                   | function  | `blake3Hex(bytes: Uint8Array): string`                                                                                                                                                                                                                                                                                                                                                         |
| `kappa`                       | function  | `kappa(bytes: Uint8Array): string`                                                                                                                                                                                                                                                                                                                                                             |
| `ATTESTATION_EXTENSION`       | const     | `ATTESTATION_EXTENSION: 'https://uor.foundation/extension/attestation-bundle/v1'`                                                                                                                                                                                                                                                                                                              |
| `BUNDLE_MEDIA_TYPE`           | const     | `BUNDLE_MEDIA_TYPE: 'application/vnd.dev.sigstore.bundle.v0.3+json'`                                                                                                                                                                                                                                                                                                                           |
| `AttestationSubject`          | interface | `AttestationSubject`                                                                                                                                                                                                                                                                                                                                                                           |
| `Attestation`                 | interface | `Attestation`                                                                                                                                                                                                                                                                                                                                                                                  |
| `BundleInput`                 | type      | `BundleInput = Record<string, unknown> \| string \| Uint8Array`                                                                                                                                                                                                                                                                                                                                |
| `attestationSection`          | function  | `attestationSection(source: Uint8Array \| ArrayBuffer \| ParsedArchive): { section: number; payload: Uint8Array } \| null`                                                                                                                                                                                                                                                                     |
| `readAttestations`            | function  | `readAttestations(source: Uint8Array \| ArrayBuffer \| ParsedArchive): Attestation[]`                                                                                                                                                                                                                                                                                                          |
| `decodeBundle`                | function  | `decodeBundle(line: string \| Uint8Array, labels?: Set<string>): Omit<Attestation, 'index'>`                                                                                                                                                                                                                                                                                                   |
| `appendAttestations`          | function  | `appendAttestations(source: Uint8Array \| ArrayBuffer \| ParsedArchive, bundles: BundleInput[]): Uint8Array`                                                                                                                                                                                                                                                                                   |
| `stripAttestations`           | function  | `stripAttestations(source: Uint8Array \| ArrayBuffer \| ParsedArchive): Uint8Array`                                                                                                                                                                                                                                                                                                            |
| `PROVENANCE_PREDICATE_TYPE`   | const     | `PROVENANCE_PREDICATE_TYPE: 'https://slsa.dev/provenance/v1'`                                                                                                                                                                                                                                                                                                                                  |
| `HOLO_BUILD_TYPE`             | const     | `HOLO_BUILD_TYPE: 'https://uor.foundation/prism/holo-build/v1'`                                                                                                                                                                                                                                                                                                                                |
| `PROVENANCE_MODES`            | const     | `PROVENANCE_MODES: Readonly<{ MIN: 'min'; MAX: 'max' }>`                                                                                                                                                                                                                                                                                                                                       |
| `ProvenanceDependency`        | interface | `ProvenanceDependency`                                                                                                                                                                                                                                                                                                                                                                         |
| `ProvenanceStatement`         | interface | `ProvenanceStatement`                                                                                                                                                                                                                                                                                                                                                                          |
| `ProvenanceOptions`           | interface | `ProvenanceOptions`                                                                                                                                                                                                                                                                                                                                                                            |
| `resolvedDependencies`        | function  | `resolvedDependencies(lock: Uint8Array \| string): Promise<ProvenanceDependency[]>`                                                                                                                                                                                                                                                                                                            |
| `provenanceStatement`         | function  | `provenanceStatement(source: Uint8Array \| ArrayBuffer \| ParsedArchive, options: ProvenanceOptions): Promise<ProvenanceStatement>`                                                                                                                                                                                                                                                            |
| `statementBytes`              | function  | `statementBytes(statement: ProvenanceStatement): Uint8Array`                                                                                                                                                                                                                                                                                                                                   |
| `provenanceBundle`            | function  | `provenanceBundle(statement: ProvenanceStatement): Uint8Array`                                                                                                                                                                                                                                                                                                                                 |
| `readProvenance`              | function  | `readProvenance(source: Uint8Array \| ArrayBuffer \| ParsedArchive): { index: number; mode: 'min' \| 'max'; signed: boolean; statement: ProvenanceStatement }[]`                                                                                                                                                                                                                               |
| `attachProvenance`            | function  | `attachProvenance(source: Uint8Array \| ArrayBuffer \| ParsedArchive, options: ProvenanceOptions): Promise<Uint8Array>`                                                                                                                                                                                                                                                                        |
| `encodeArchive`               | function  | `encodeArchive(sections: { kind: number; body: Uint8Array }[], options?: { version?: number; flags?: number }): Uint8Array`                                                                                                                                                                                                                                                                    |
| `canonicalize`                | export    | `from ../src/canonical/index.js`                                                                                                                                                                                                                                                                                                                                                               |
| `codeHash`                    | export    | `from ../src/canonical/index.js`                                                                                                                                                                                                                                                                                                                                                               |
| `describe`                    | export    | `from ../src/canonical/index.js`                                                                                                                                                                                                                                                                                                                                                               |
| `differs`                     | export    | `from ../src/canonical/index.js`                                                                                                                                                                                                                                                                                                                                                               |

## Next steps

- [Load a holo](/docs/api/load)
- [Dispatch inputs](/docs/api/dispatch)
- [History and replay](/docs/api/history-and-replay)

Generated from prism-code 0.3.0, Calculator.holo sha256:84371aaac82af6b2a81a25a81d43d4097892985f55ae4919cfdcfa8b6e3486e7.

<!-- api/load -->

---
title: Load a holo
description: Read a holo from a path, a URL or bytes and get an application you can inspect and run.
available_in: "0.2.0"
---

Source: `prism-code` 0.3.0, `types/index.d.ts`.

## Signature

```ts
export function load(source: Uint8Array | ArrayBuffer | Blob | string | URL, options?: LoadOptions): Promise<Application>;

export interface LoadOptions {
  model?: Record<string, unknown> | Uint8Array | string | null;
  stem?: string;
  files?: string[];
  capabilities?: Capabilities | Uint8Array | string | URL | null;
  capabilitySet?: string;
}
```

## Returns

```ts
export interface Application {
  kind: 'holo' | 'closure';
  name: string | null;
  model: Record<string, unknown> | null;
  profile: string | null;
  limits: Limits | null;
  vectors: Vector[];
  provenance: { model: Record<string, unknown> | null; browser: Record<string, unknown> | null };
  directory: Record<string, unknown> | null;
  metadata: unknown;
  identities: ArchiveIdentities | ClosureIdentities;
  evidence: Evidence;
  view: View;
  capabilities: CapabilityGrant;
  world: {
    readonly contract: string | null;
    readonly within: boolean | null;
    readonly pure: boolean | null;
    readonly effects: ReadonlyArray<'clock' | 'random' | 'socket' | 'filesystem' | 'unknown'> | null;
  };
  dispatch(request: Uint8Array | ArrayBuffer): Promise<Uint8Array>;
  acceptance(): Promise<AcceptanceResult>;
  history(): Promise<History>;
  experimental_recorder(): Recorder;
  experimental_replay(histories: HistorySource | HistorySource[], options?: ReplayOptions): Promise<ReplayResult>;
  inspect(): Promise<Inspection>;
  experimental_verify(options?: VerifyOptions): Promise<Verdict>;
  attestations(): Attestation[];
  experimental_middleware: MiddlewareStack;
}
```

## Example

```js
import { load } from 'prism-code';

const app = await load('./Calculator.holo');

console.log(app.name);
console.log(app.identities.verified);
console.log(app.limits);
```

```text
Calculator
true
{ request: 52, response: 27, guestAllocation: 65536 }
```

## Next steps

- [Dispatch inputs](/docs/api/dispatch)
- [Inspect a holo](/docs/api/inspect)
- [Holo format](/docs/reference/holo-format)

Generated from prism-code 0.3.0, Calculator.holo sha256:84371aaac82af6b2a81a25a81d43d4097892985f55ae4919cfdcfa8b6e3486e7.

<!-- api/inspect -->

---
title: Inspect a holo
description: Read the manifest, digests, world and attestations of a holo without running it.
available_in: "0.5"
---

Source: `prism-code` 0.3.0, `types/index.d.ts`; `@prism-code/spec` 2026-10-23, `types/holo.d.ts`.

## Example

Status: `inspect()` is not in prism-code 0.2.0. This page gains an executed example when the runtime ships it. The declarations below are what a reader decodes.

## Signature

```ts
export interface ArchiveIdentities {
  archiveFingerprint: string;
  footer: string;
  guestKappa: string;
  viewKappa: string;
  modelKappa: string;
  capabilitiesKappa: string;
  applicationKappa: string | null;
  verified: boolean;
  consistent: boolean;
}

export interface ParsedArchive {
  bytes: Uint8Array;
  body: Uint8Array;
  version: number;
  flags: number;
  sections: { index: number; kind: number; offset: number; length: number; body: Uint8Array }[];
  manifest: { uri: string; labels: string[]; suffix: Uint8Array; section: number };
  metadata: { text: string; section: number } | null;
  extensions: { name: string; payload: Uint8Array; text: string; section: number }[];
  blobs: { label: string; content: Uint8Array; section: number }[];
  footer: string;
  fingerprint: string;
  verification: { footer: boolean; labels: boolean; labelMismatches: { section: number; label: string; actual: string }[] };
}
```

## What a reader decodes

```ts
export interface SectionTableEntry {
  kind: SectionKindCode;
  offset: number;
  length: number;
}

export type AppManifestLabels = [capabilitySet: KappaLabel, guest: KappaLabel, view: KappaLabel];

export type ExtensionName =
  | 'https://hologram.foundation/extension/application-directory/v1'
  | 'https://uor.foundation/extension/prismpm-model/v1';

export type ContentBlobRole = 'capability-set' | 'guest' | 'model-document' | 'view';
```

## Next steps

- [Load a holo](/docs/api/load)
- [Check a holo](/docs/api/verify)
- [Holo format](/docs/reference/holo-format)

Generated from prism-code 0.3.0, @prism-code/spec 2026-10-23 at e84124f0fed01510843772ae11d8a3068cef47ea.

<!-- api/verify -->

---
title: Check a holo
description: Check digest, provenance, proof and world against a policy and get a verdict.
available_in: "0.5"
---

Source: `prism-code` 0.3.0, `types/index.d.ts`.

Status: `experimental_verify()` is in the prism-code source and not in the published 0.2.0, which checks the digest footer and every section label on load. It is experimental until the v0.6 freeze. No holo carries an attestation bundle yet, so every holo is P0 and the default policy fails it.

## Signature

```ts
export function experimental_verify(source: Uint8Array | ArrayBuffer | Blob | Application, options?: VerifyOptions): Promise<Verdict>;

experimental_verify(options?: VerifyOptions): Promise<Verdict>;

export interface VerifyOptions {
  name?: string;
  minimum?: AssuranceLevel;
  digests?: Partial<Record<'archive' | 'capabilities' | 'guest' | 'view' | 'model', Partial<DigestSet>>>;
  world?: { contract?: string; blake3?: string; sha256?: string } | null;
  capabilities?: CapabilitySet | null;
  effects?: Array<'clock' | 'random' | 'socket' | 'filesystem' | 'unknown'>;
  replay?: unknown;
  throw?: boolean;
  env?: Record<string, string | undefined>;
}

export function experimental_createClient(options?: VerifyOptions): Client;
```

## Returns

```ts
export interface Verdict {
  schema: 'prism/verdict/1';
  holo: string;
  level: AssuranceLevel;
  policy: { name: string; minimum: AssuranceLevel };
  passed: boolean;
  reasons: VerdictReason[];
}

export interface VerdictReason {
  check: string;
  code?: string;
  withholds: AssuranceLevel | null;
  message: string;
}
```

## Example

```js
import { load } from 'prism-code';

const app = await load('./Calculator.holo');

const verdict = await app.experimental_verify({ minimum: 'P0' });
console.log({ level: verdict.level, passed: verdict.passed });

try {
  await app.experimental_verify({ throw: true });
} catch (error) {
  console.log(error.name, error.code, error.check);
}
```

```text
{ level: 'P0', passed: true }
VerificationError verification_failed provenance.statement
```

## Next steps

- [Instantiate a holo](/docs/api/instantiate)
- [Attestations reference](/docs/reference/attestations)
- [Load a holo](/docs/api/load)

Generated from prism-code 0.3.0, Calculator.holo sha256:84371aaac82af6b2a81a25a81d43d4097892985f55ae4919cfdcfa8b6e3486e7.

<!-- api/instantiate -->

---
title: Instantiate a holo
description: Create a running instance with exactly the capability set you grant.
available_in: "0.6"
---

Source: `@prism-code/spec` 2026-10-23, `types/holo.d.ts`, `worlds/core-wasm.wit`.

## Example

Status: `instantiate()` is not in prism-code 0.2.0, which runs each request on a fresh guest instance inside `dispatch()`. The world below is what an instance exports.

## What an instance exports

```ts
export type CoreWasmContract = 'hologram:guest/core-wasm@1';

export interface CoreWasmExports {
  memory: WebAssembly.Memory;
  holo_alloc(length: number): number;
  holo_run(offset: number, length: number): bigint;
}

export interface World {
  readonly version: 1;
  readonly package: string;
  readonly world: string;
  readonly file: string;
  readonly digest: { readonly blake3: string; readonly sha256: string };
  readonly imports: readonly WorldImport[];
  readonly exports: readonly WorldExport[];
}
```

```wit
package hologram:guest@1.0.0;

world core-wasm {
  /// Reserve `length` bytes of guest memory for a request and return their offset.
  export holo-alloc: func(length: u32) -> u32;

  /// Run the request at `offset` with `length` bytes. Returns `offset << 32 | length` of the response.
  export holo-run: func(offset: u32, length: u32) -> u64;
}
```

## Next steps

- [Dispatch inputs](/docs/api/dispatch)
- [Check a holo](/docs/api/verify)
- [Holo format](/docs/reference/holo-format)

Generated from @prism-code/spec 2026-10-23 at e84124f0fed01510843772ae11d8a3068cef47ea.

<!-- api/dispatch -->

---
title: Dispatch inputs
description: Send one request to the holo and get its response.
available_in: "0.2.0"
---

Source: `prism-code` 0.3.0, `types/index.d.ts`.

## Signature

```ts
dispatch(request: Uint8Array | ArrayBuffer): Promise<Uint8Array>;

export interface Limits {
  request: number;
  response: number;
  guestAllocation: number;
}
```

## Example

```js
import { load } from 'prism-code';

const app = await load('./Calculator.holo');

const request = new TextEncoder().encode('1\tadd\t20\t22');
const response = await app.dispatch(request);

console.log(JSON.stringify(new TextDecoder().decode(response)));
```

```text
"1\tok\t42"
```

## Next steps

- [History and replay](/docs/api/history-and-replay)
- [Error types](/docs/api/errors)
- [Load a holo](/docs/api/load)

Generated from prism-code 0.3.0, Calculator.holo sha256:84371aaac82af6b2a81a25a81d43d4097892985f55ae4919cfdcfa8b6e3486e7.

<!-- api/history-and-replay -->

---
title: History and replay
description: Replay the examples a holo carries and prove its behaviour unchanged.
available_in: "0.6"
---

Source: `prism-code` 0.3.0, `types/index.d.ts`.

Status: `acceptance()` is in prism-code 0.2.0. `history()`, `experimental_replay()` and `experimental_recorder()` are in this checkout and are experimental until the 0.6 freeze; both examples below are executed.

## Signature

```ts
acceptance(): Promise<AcceptanceResult>;

export interface AcceptanceResult {
  total: number;
  passed: number;
  failed: AcceptanceFailure[];
}

export interface AcceptanceFailure {
  index: number;
  request: Uint8Array;
  expected: Uint8Array;
  actual?: Uint8Array;
  error?: unknown;
}

export interface Vector {
  request: Uint8Array;
  response: Uint8Array;
}
```

## Example

```js
import { load } from 'prism-code';

const app = await load('./Calculator.holo');

const result = await app.acceptance();

console.log(result);
```

```text
{ total: 22, passed: 22, failed: [] }
```

## Signature

```ts
history(): Promise<History>;

export interface History {
  schema: 'prism/history/1';
  application: string | null;
  recordedFrom?: { guest: DigestSet; model: DigestSet };
  events: HistoryEvent[];
}

export type HistoryEvent = { request: string; response: string; error?: never } | { request: string; error: string; response?: never };

export function experimental_replay(app: Application, histories: HistorySource | HistorySource[], options?: ReplayOptions): Promise<ReplayResult>;

export interface ReplayOptions {
  throw?: boolean;
  runtime?: { name: string; version: string };
}

export interface ReplayResult {
  application: string | null;
  runtime: { name: string; version: string };
  events: number;
  divergenceCount: number;
  histories: ReplayedHistoryResult[];
  statement: ReplayStatement | null;
}

export interface ReplayDivergence {
  index: number;
  request: string;
  expected: ReplayOutcome;
  actual: ReplayOutcome;
}

export interface ReplayStatement {
  _type: 'https://in-toto.io/Statement/v1';
  subject: [{ name: string; digest: DigestSet }];
  predicateType: 'https://uor.foundation/prism/replay/v1';
  predicate: {
    runtime: { name: string; version: string };
    model: DigestSet;
    histories: Array<{ digest: DigestSet; events: number; divergences: number }>;
    divergenceCount: number;
  };
}

export function experimental_recorder(app: Application): Recorder;

export interface Recorder {
  dispatch(request: Uint8Array | ArrayBuffer): Promise<Uint8Array>;
  history(): Promise<History>;
  events(): number;
}
```

## Example

```js
import { load } from 'prism-code';

const app = await load('./Calculator.holo');

const history = await app.history();
const result = await app.experimental_replay(history);

console.log(result.events, 'events,', result.divergenceCount, 'divergences');
console.log(result.statement.predicateType);
console.log(result.statement.predicate.histories);
```

```text
22 events, 0 divergences
https://uor.foundation/prism/replay/v1
[
  {
    digest: {
      blake3: '507d9bdf6de96117e3823f6614ed3f24544d6a4224e2ef0637f2057dfbafce98',
      sha256: '56d4c9c4bcf9f5c26fecd78d9709f9e3caef761d76f9a13ab94d7c31fe92ad1a'
    },
    events: 22,
    divergences: 0
  }
]
```

## Next steps

- [Dispatch inputs](/docs/api/dispatch)
- [CLI reference](/docs/reference/cli)
- [Check a holo](/docs/api/verify)

Generated from prism-code 0.3.0, Calculator.holo sha256:84371aaac82af6b2a81a25a81d43d4097892985f55ae4919cfdcfa8b6e3486e7.

<!-- api/as-tool -->

---
title: Use a holo as a tool
description: Wrap a checked holo as a Vercel AI SDK tool so a model can call it.
available_in: "1.0-beta"
---

Source: `prism-code` 0.3.0, `types/index.d.ts`.

## Example

Status: `asTool()` is not in prism-code 0.2.0. This page gains its declaration and an executed example when the runtime ships it.

## Next steps

- [Dispatch inputs](/docs/api/dispatch)
- [Load a holo](/docs/api/load)
- [Error types](/docs/api/errors)

Generated from prism-code 0.3.0.

<!-- api/errors -->

---
title: Error types
description: Every error the runtime throws and the code it carries.
available_in: "0.5"
---

Source: `prism-code` 0.3.0, `types/index.d.ts`.

Status: the classes are in the prism-code source and not in the published 0.2.0. `DeterminismViolationError` and `ReplayError` are defined and mapped, and nothing raises them until replay ships.

## Signature

```ts
export class PrismError extends Error {
  static readonly code: string;
  code: string;
  check?: string;
  diagnostic?: string;
  details?: unknown;
  verdict?: Verdict;
  reasons?: VerdictReason[];
  constructor(
    message: string,
    options?: { code?: string; check?: string; diagnostic?: string; details?: unknown; verdict?: Verdict; reasons?: VerdictReason[]; cause?: unknown },
  );
}

export class PrismCodeError extends PrismError {
  code: string;
  constructor(code: string, message: string, details?: unknown);
}

export class VerificationError extends PrismError {
  static readonly code: 'verification_failed';
}

export class ProofMismatchError extends PrismError {
  static readonly code: 'proof_mismatch';
}

export class CapabilityDeniedError extends PrismError {
  static readonly code: 'capability_denied';
}

export class WorldMismatchError extends PrismError {
  static readonly code: 'world_mismatch';
}

export class DeterminismViolationError extends PrismError {
  static readonly code: 'determinism_violation';
}

export class ReplayError extends PrismError {
  static readonly code: 'replay_failed';
}

export class MiddlewareError extends PrismError {
  static readonly code: 'middleware_failed';
  details: { name: string | null; step: MiddlewareStep; tags: string[] };
}
```

## Classes

| Class                       | Code                    | Verdict checks                                                |
| --------------------------- | ----------------------- | ------------------------------------------------------------- |
| `VerificationError`         | `verification_failed`   | `holo.*`, `provenance.*`, `policy.*`, and no verdict reached  |
| `ProofMismatchError`        | `proof_mismatch`        | `proof.*`                                                     |
| `CapabilityDeniedError`     | `capability_denied`     | `world.capabilities`, and the runtime's `capabilities.*`      |
| `WorldMismatchError`        | `world_mismatch`        | `world.contract`, `world.hash`                                |
| `DeterminismViolationError` | `determinism_violation` | `replay.divergence`                                           |
| `ReplayError`               | `replay_failed`         | every other `replay.*`                                        |
| `MiddlewareError`           | `middleware_failed`     | none: a middleware threw something that is not a `PrismError` |

## Codes of load and archive failures

| Code                    | Raised in                                 |
| ----------------------- | ----------------------------------------- |
| `archive.blob`          | `src/archive.mjs`                         |
| `archive.bounds`        | `src/archive.mjs`, `src/attestations.mjs` |
| `archive.directory`     | `src/archive.mjs`                         |
| `archive.extension`     | `src/archive.mjs`                         |
| `archive.flags`         | `src/archive.mjs`                         |
| `archive.input`         | `src/archive.mjs`                         |
| `archive.kind`          | `src/archive.mjs`                         |
| `archive.magic`         | `src/archive.mjs`                         |
| `archive.manifest`      | `src/archive.mjs`                         |
| `archive.metadata`      | `src/archive.mjs`                         |
| `archive.model`         | `src/archive.mjs`, `src/index.mjs`        |
| `archive.provenance`    | `src/archive.mjs`                         |
| `archive.version`       | `src/archive.mjs`                         |
| `attestation.bundle`    | `src/attestations.mjs`                    |
| `attestation.duplicate` | `src/attestations.mjs`                    |
| `attestation.envelope`  | `src/attestations.mjs`                    |
| `attestation.footer`    | `src/attestations.mjs`                    |
| `attestation.input`     | `src/attestations.mjs`                    |
| `attestation.lines`     | `src/attestations.mjs`                    |
| `attestation.position`  | `src/attestations.mjs`                    |
| `attestation.statement` | `src/attestations.mjs`                    |
| `attestation.subject`   | `src/attestations.mjs`                    |
| `capabilities.invalid`  | `src/capabilities.mjs`, `src/index.mjs`   |
| `capabilities.kind`     | `src/capabilities.mjs`                    |
| `capabilities.path`     | `src/node.mjs`                            |
| `closure.files`         | `src/browser.mjs`, `src/closure.mjs`      |
| `closure.glue`          | `src/closure.mjs`                         |
| `closure.model`         | `src/closure.mjs`                         |
| `closure.provenance`    | `src/closure.mjs`                         |
| `container.ambiguous`   | `src/containers.mjs`                      |
| `container.input`       | `src/containers.mjs`                      |
| `container.missing`     | `src/containers.mjs`                      |
| `container.running`     | `src/containers.mjs`                      |
| `container.state`       | `src/containers.mjs`                      |
| `container.store`       | `src/node.mjs`                            |
| `core.allocation`       | `src/closure.mjs`, `src/core.mjs`         |
| `core.compile`          | `src/core.mjs`                            |
| `core.exports`          | `src/core.mjs`                            |
| `core.request`          | `src/core.mjs`                            |
| `core.response`         | `src/core.mjs`                            |
| `dev.path`              | `src/dev-cli.mjs`                         |
| `dev.port`              | `src/dev-server.mjs`                      |
| `dev.project`           | `src/dev-cli.mjs`                         |
| `init.template`         | `src/init.mjs`                            |
| `inspect.kind`          | `src/index.mjs`                           |
| `inspect.selector`      | `src/inspect.mjs`                         |
| `load.fetch`            | `src/browser.mjs`                         |
| `load.path`             | `src/node.mjs`                            |
| `load.source`           | `src/index.mjs`                           |
| `lock.image`            | `src/docker.mjs`, `src/init.mjs`          |
| `manifest.env`          | `src/manifest.mjs`                        |
| `manifest.invalid`      | `src/manifest.mjs`                        |
| `manifest.overlay`      | `src/manifest.mjs`                        |
| `manifest.path`         | `src/node.mjs`                            |
| `manifest.secret`       | `src/manifest.mjs`                        |
| `manifest.toml`         | `src/toml.mjs`                            |
| `middleware.name`       | `src/middleware.mjs`                      |
| `middleware.relative`   | `src/middleware.mjs`                      |
| `middleware.shape`      | `src/middleware.mjs`, `src/tracing.mjs`   |
| `middleware.step`       | `src/middleware.mjs`                      |
| `mount.environment`     | `src/browser.mjs`                         |
| `provenance.archive`    | `src/provenance.mjs`                      |
| `provenance.duplicate`  | `src/provenance.mjs`                      |
| `provenance.input`      | `src/provenance.mjs`                      |
| `provenance.lock`       | `src/provenance.mjs`                      |
| `provenance.mode`       | `src/provenance.mjs`                      |
| `view.bounds`           | `src/view.mjs`                            |
| `view.entry`            | `src/view.mjs`                            |
| `view.magic`            | `src/view.mjs`                            |
| `view.order`            | `src/view.mjs`                            |
| `view.version`          | `src/view.mjs`                            |

## Next steps

- [Errors reference](/docs/reference/errors)
- [Load a holo](/docs/api/load)
- [Dispatch inputs](/docs/api/dispatch)

Generated from prism-code 0.3.0.

<!-- api/spec-package -->

---
title: Spec package
description: The types, JSON Schemas, world file and format revision that every runtime is built from.
available_in: "0.5"
---

Source: `@prism-code/spec` 0.1.0, format revision 2026-10-23, `constants.d.ts`, `index.d.ts`.

## Install

```bash
npm install @prism-code/spec
```

## Example

```js
import { FORMAT_REVISION, MAGIC, PHYSICAL_VERSION, SECTION_COUNT, SECTION_ORDER, PROOF_PREDICATE_TYPE } from '@prism-code/spec';

console.log(FORMAT_REVISION);
console.log(MAGIC, PHYSICAL_VERSION, SECTION_COUNT);
console.log(SECTION_ORDER.join(' '));
console.log(PROOF_PREDICATE_TYPE);
```

```text
2026-10-23
HOLO 4 8
15 8 14 14 16 16 16 16
https://uor.foundation/prism/proof/v1
```

## Exports

| Export                  | Kind   | Declaration                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FORMAT_REVISION`       | const  | `FORMAT_REVISION: '2026-10-23'`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `FORMAT_REVISIONS`      | const  | `FORMAT_REVISIONS: Readonly<Record<FormatRevision, Readonly<FormatRevisionIdentifiers>>>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `MAGIC`                 | const  | `MAGIC: 'HOLO'`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `PHYSICAL_VERSION`      | const  | `PHYSICAL_VERSION: 4`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `FLAGS`                 | const  | `FLAGS: 0`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `HEADER_LENGTH`         | const  | `HEADER_LENGTH: 10`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `TABLE_ENTRY_LENGTH`    | const  | `TABLE_ENTRY_LENGTH: 24`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `SECTION_COUNT`         | const  | `SECTION_COUNT: 8`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `BODY_OFFSET`           | const  | `BODY_OFFSET: 202`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `FOOTER_LENGTH`         | const  | `FOOTER_LENGTH: 32`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `SECTION_KIND`          | const  | `SECTION_KIND: Readonly<SectionKind>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `SECTION_ORDER`         | const  | `SECTION_ORDER: readonly [15, 8, 14, 14, 16, 16, 16, 16]`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `LABEL_PREFIX`          | const  | `LABEL_PREFIX: 'blake3:'`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `LABEL_LENGTH`          | const  | `LABEL_LENGTH: 71`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `APP_MANIFEST`          | const  | `APP_MANIFEST: Readonly<{ URI: 'https://hologram.foundation/realization/app-manifest'; LENGTH: 356; PREFIX_LENGTH: 57; SUFFIX_LENGTH: 86; PREFIX_HEX: string; SUFFIX_HEX: string; LABELS: readonly ['capability-set', 'guest', 'view']; }>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `CAPABILITY_SET`        | const  | `CAPABILITY_SET: Readonly<{ URI: 'https://hologram.foundation/realization/capability-set'; EMPTY_HEX: string; }>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `EXTENSION`             | const  | `EXTENSION: Readonly<{ APPLICATION_DIRECTORY: Extract<ExtensionName, 'https://hologram.foundation/extension/application-directory/v1'>; PRISMPM_MODEL: Extract<ExtensionName, 'https://uor.foundation/extension/prismpm-model/v1'>; }>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `CORE_WASM`             | const  | `CORE_WASM: Readonly<{ CONTRACT: CoreWasmContract; EXPORTS: readonly ['holo_alloc', 'holo_run', 'memory']; ALLOCATOR: 'holo_alloc'; ENTRY: 'holo_run'; WORLD: 'worlds/core-wasm.wit'; }>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `WORLDS`                | const  | `WORLDS: Readonly<Record<CoreWasmContract, World>>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `HOLOVIEW`              | const  | `HOLOVIEW: Readonly<HoloviewLimits>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `ATTESTATION`           | const  | `ATTESTATION: Readonly<{ STATEMENT_TYPE: 'https://in-toto.io/Statement/v1'; DSSE_PAYLOAD_TYPE: 'application/vnd.in-toto+json'; OCI_MANIFEST_SUBJECT: 'oci-manifest'; STATEMENT_SCHEMA: 'schemas/attestation/statement.schema.json'; ENVELOPE_SCHEMA: 'schemas/attestation/dsse-envelope.schema.json'; }>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `ATTESTATION_BUNDLE`    | const  | `ATTESTATION_BUNDLE: Readonly<{ EXTENSION: 'https://uor.foundation/extension/attestation-bundle/v1'; SECTION_KIND: 14; MEDIA_TYPE: 'application/vnd.dev.sigstore.bundle.v0.3+json'; LINE_TERMINATOR: 10; SCHEMA: 'schemas/attestation/sigstore-bundle.schema.json'; PROVENANCE_PREDICATE_TYPE: 'https://slsa.dev/provenance/v1'; OCI_ANNOTATIONS: Readonly<{ CONTENT: 'dev.sigstore.bundle.content'; PREDICATE_TYPE: 'dev.sigstore.bundle.predicateType' }>; export declare const OCI: Readonly<{ HOLO_MEDIA_TYPE: 'application/vnd.uor.prism.holo.v1'; CREATED: '1970-01-01T00:00:00Z'; ANNOTATIONS: Readonly<{ FINGERPRINT: 'foundation.uor.prism.holo.fingerprint'; APPLICATION: 'foundation.uor.prism.holo.application'; BLAKE3: 'foundation.uor.prism.digest.blake3'; }>; FINGERPRINT_TAG_PREFIX: 'blake3-'; }>; OCI_CONTENT: 'dsse-envelope'; }>`                                                                                           |
| `OCI`                   | const  | `OCI: Readonly<{ HOLO_MEDIA_TYPE: 'application/vnd.uor.prism.holo.v1'; CREATED: '1970-01-01T00:00:00Z'; ANNOTATIONS: Readonly<{ FINGERPRINT: 'foundation.uor.prism.holo.fingerprint'; APPLICATION: 'foundation.uor.prism.holo.application'; BLAKE3: 'foundation.uor.prism.digest.blake3'; }>; FINGERPRINT_TAG_PREFIX: 'blake3-'; }>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `PROVENANCE`            | const  | `PROVENANCE: Readonly<{ PREDICATE_TYPE: 'https://slsa.dev/provenance/v1'; BUILD_TYPE: 'https://uor.foundation/prism/holo-build/v1'; SCHEMA: 'schemas/attestation/provenance-v1.schema.json'; MODES: Readonly<{ MIN: 'min'; MAX: 'max' }>; DEFAULT_MODE: 'min'; FLAGS: Readonly<{ MODE: '--provenance'; DISABLE: '--no-provenance' }>; SUBJECTS: Readonly<{ GUEST: 'core-wasm/<cargo_name with - as _>_core_wasm.wasm'; VIEW: 'view/hologram/view.holoview'; MODEL: 'model.prism.json'; CAPABILITIES: 'application/capability-request.bin'; }>; DEPENDENCIES: Readonly<{ LOCK: 'urn:prismpm:sdk-lock'; STANDARDS_LOCK: 'urn:prismpm:standards-lock'; TOOLCHAIN: 'urn:prismpm:toolchain:'; GENERATOR: 'urn:prismpm:generator:'; LOCK_MEDIA_TYPES: Readonly<{ 'prismpm/sdk-lock/2': 'application/vnd.prismpm.sdk-lock.v2+json'; 'prismpm/sdk-lock/3': 'application/vnd.prismpm.sdk-lock.v3+json'; }>; }>; UNSIGNED: Readonly<{ SIGNATURE: '' }>; }>` |
| `POLICY`                | const  | `POLICY: Readonly<{ INPUT: 'prism/policy-input/1'; INPUT_SCHEMA: 'schemas/policy/policy-input-v1.schema.json'; LANGUAGE: 'rego'; PACKAGE: 'prism.policy'; SHIPPED: Readonly<{ default: 'policies/default.rego'; 'pure-only': 'policies/pure-only.rego'; 'provenance-only': 'policies/provenance-only.rego'; }>; }>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `BrowserProvenance`     | type   | `BrowserProvenance = BrowserProvenanceV1`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `BuildManifest`         | type   | `BuildManifest = BuildManifestV1`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `ModelDocument`         | type   | `ModelDocument = ModelDocumentV1 \| ModelDocumentV2 \| ModelDocumentV3 \| ModelDocumentV4 \| ModelDocumentV5 \| ModelDocumentV6`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `ModelProvenance`       | type   | `ModelProvenance = ModelProvenanceV1`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `SdkLock`               | type   | `SdkLock = SdkLockV1 \| SdkLockV2 \| SdkLockV3`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `DocumentSchemaName`    | type   | `DocumentSchemaName`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `SCHEMAS`               | const  | `SCHEMAS: Readonly<Record<DocumentSchemaName, string>>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `HOLO_SCHEMAS`          | const  | `HOLO_SCHEMAS: Readonly<{ APP_MANIFEST: 'schemas/holo/app-manifest.schema.json'; APPLICATION_DIRECTORY: 'schemas/holo/application-directory.schema.json'; ARCHIVE: 'schemas/holo/archive.schema.json'; SOURCE_MANIFEST: 'schemas/holo/source-manifest.schema.json'; }>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `ASSURANCE`             | export | `from ./assurance-levels.js`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `PROOF_PREDICATE_TYPE`  | export | `from ./predicates/proof-v1.js`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `REPLAY_PREDICATE_TYPE` | export | `from ./predicates/replay-v1.js`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## Schemas

The package finds its schemas by reading its folders, so a new schema appears here, in the exports above and in the types without anyone editing a list.

| Document                       | File                                                  |
| ------------------------------ | ----------------------------------------------------- |
| `prismpm/browser-provenance/1` | `schemas/documents/browser-provenance-v1.schema.json` |
| `prismpm/build-manifest/1`     | `schemas/documents/build-manifest-v1.schema.json`     |
| `prismpm/model-document/1`     | `schemas/documents/model-document-v1.schema.json`     |
| `prismpm/model-document/2`     | `schemas/documents/model-document-v2.schema.json`     |
| `prismpm/model-document/3`     | `schemas/documents/model-document-v3.schema.json`     |
| `prismpm/model-document/4`     | `schemas/documents/model-document-v4.schema.json`     |
| `prismpm/model-document/5`     | `schemas/documents/model-document-v5.schema.json`     |
| `prismpm/model-document/6`     | `schemas/documents/model-document-v6.schema.json`     |
| `prismpm/model-provenance/1`   | `schemas/documents/model-provenance-v1.schema.json`   |
| `prismpm/sdk-lock/1`           | `schemas/documents/sdk-lock-v1.schema.json`           |
| `prismpm/sdk-lock/2`           | `schemas/documents/sdk-lock-v2.schema.json`           |
| `prismpm/sdk-lock/3`           | `schemas/documents/sdk-lock-v3.schema.json`           |

| Section                 | File                                             |
| ----------------------- | ------------------------------------------------ |
| `APP_MANIFEST`          | `schemas/holo/app-manifest.schema.json`          |
| `APPLICATION_DIRECTORY` | `schemas/holo/application-directory.schema.json` |
| `ARCHIVE`               | `schemas/holo/archive.schema.json`               |
| `SOURCE_MANIFEST`       | `schemas/holo/source-manifest.schema.json`       |

### Every schema

<!-- generated:schemas:begin -->

| Schema                                                               | Title                           | File                                                  |
| -------------------------------------------------------------------- | ------------------------------- | ----------------------------------------------------- |
| `https://uor.foundation/prism/proof/v1/schema.json`                  | ProofPredicateV1                | `predicates/proof-v1.schema.json`                     |
| `https://schemas.uor.foundation/prism/predicate-registry/1`          | PredicateRegistry               | `predicates/registry.schema.json`                     |
| `https://uor.foundation/prism/replay/v1/schema.json`                 | ReplayPredicateV1               | `predicates/replay-v1.schema.json`                    |
| `https://schemas.uor.foundation/prism/attestation/dsse-envelope/1`   | DsseEnvelope                    | `schemas/attestation/dsse-envelope.schema.json`       |
| `https://schemas.uor.foundation/prism/attestation/provenance/1`      | HoloProvenance                  | `schemas/attestation/provenance-v1.schema.json`       |
| `https://schemas.uor.foundation/prism/attestation/sigstore-bundle/1` | SigstoreBundle                  | `schemas/attestation/sigstore-bundle.schema.json`     |
| `https://schemas.uor.foundation/prism/attestation/statement/1`       | InTotoStatement                 | `schemas/attestation/statement.schema.json`           |
| `https://schemas.uor.foundation/prism/attestation/trusted-root/1`    | SigstoreTrustedRoot             | `schemas/attestation/trusted-root.schema.json`        |
| `https://schemas.uor.foundation/prism/capabilities/1`                | Capabilities                    | `schemas/capabilities/capabilities-v1.schema.json`    |
| `https://schemas.uor.foundation/prismpm/browser-provenance/1`        | BrowserProvenance               | `schemas/documents/browser-provenance-v1.schema.json` |
| `https://schemas.uor.foundation/prismpm/build-manifest/1`            | BuildManifest                   | `schemas/documents/build-manifest-v1.schema.json`     |
| `prismpm/model-document/1`                                           | ModelDocument                   | `schemas/documents/model-document-v1.schema.json`     |
| `prismpm/model-document/2`                                           | TextModelDocument               | `schemas/documents/model-document-v2.schema.json`     |
| `prismpm/model-document/3`                                           | NativeLibraryModelDocument      | `schemas/documents/model-document-v3.schema.json`     |
| `prismpm/model-document/4`                                           | BrowserApplicationDeclaration   | `schemas/documents/model-document-v4.schema.json`     |
| `prismpm/model-document/5`                                           | BoundedTextModelDocument        | `schemas/documents/model-document-v5.schema.json`     |
| `prismpm/model-document/6`                                           | BoundedTextCommandModelDocument | `schemas/documents/model-document-v6.schema.json`     |
| `https://schemas.uor.foundation/prismpm/model-provenance/1`          | ModelProvenance                 | `schemas/documents/model-provenance-v1.schema.json`   |
| `https://schemas.uor.foundation/prismpm/sdk-lock/1`                  | SdkLockV1                       | `schemas/documents/sdk-lock-v1.schema.json`           |
| `https://schemas.uor.foundation/prismpm/sdk-lock/2`                  | SdkLockV2                       | `schemas/documents/sdk-lock-v2.schema.json`           |
| `https://schemas.uor.foundation/prismpm/sdk-lock/3`                  | SdkLockV3                       | `schemas/documents/sdk-lock-v3.schema.json`           |
| `https://schemas.uor.foundation/prism/history/1`                     | HistoryV1                       | `schemas/history/history-v1.schema.json`              |
| `https://schemas.uor.foundation/prism/holo/app-manifest/1`           | HoloAppManifest                 | `schemas/holo/app-manifest.schema.json`               |
| `https://schemas.uor.foundation/prism/holo/application-directory/1`  | HoloApplicationDirectory        | `schemas/holo/application-directory.schema.json`      |
| `https://schemas.uor.foundation/prism/holo/archive/1`                | HoloArchive                     | `schemas/holo/archive.schema.json`                    |
| `https://schemas.uor.foundation/prism/holo/source-manifest/4`        | HoloSourceManifest              | `schemas/holo/source-manifest.schema.json`            |
| `https://schemas.uor.foundation/prism/manifest/1`                    | Manifest                        | `schemas/manifest/manifest-v1.schema.json`            |
| `https://schemas.uor.foundation/prism/policy-input/1`                | PolicyInput                     | `schemas/policy/policy-input-v1.schema.json`          |
| `https://schemas.uor.foundation/prism/verdict/1`                     | Verdict                         | `schemas/verdict/verdict-v1.schema.json`              |

<!-- generated:schemas:end -->

## Predicates

<!-- generated:predicates:begin -->

| Predicate type                           | Status       | Schema                                               |
| ---------------------------------------- | ------------ | ---------------------------------------------------- |
| `https://uor.foundation/prism/proof/v1`  | experimental | `https://uor.foundation/prism/proof/v1/schema.json`  |
| `https://uor.foundation/prism/replay/v1` | experimental | `https://uor.foundation/prism/replay/v1/schema.json` |

<!-- generated:predicates:end -->

## World

`worlds/core-wasm.wit` declares `hologram:guest/core-wasm@1`.

## Next steps

- [Holo format](/docs/reference/holo-format)
- [Attestations reference](/docs/reference/attestations)
- [prism-code at a glance](/docs/api)

Generated from @prism-code/spec 2026-10-23 at e84124f0fed01510843772ae11d8a3068cef47ea.

<!-- api/verify-package -->

---
title: Check in the browser
description: Check a holo offline in any browser without loading the runtime.
available_in: "0.5"
---

Source: none at `@prism-code/spec` 2026-10-23.

## Example

Status: `@prism-code/verify` does not exist yet. This page is generated from its declarations once it does.

## Next steps

- [Check a holo](/docs/api/verify)
- [Spec package](/docs/api/spec-package)
- [Load a holo](/docs/api/load)

Generated from @prism-code/spec 2026-10-23 at e84124f0fed01510843772ae11d8a3068cef47ea.

<!-- api/testing-package -->

---
title: Testing package
description: Test code that drives a holo with a mock host, skipped time and scripted dispatch.
available_in: "0.6"
---

Source: none at `@prism-code/spec` 2026-10-23.

## Example

Status: `@prism-code/testing` does not exist yet. This page is generated from its declarations once it does.

## Next steps

- [History and replay](/docs/api/history-and-replay)
- [Dispatch inputs](/docs/api/dispatch)
- [prism-code at a glance](/docs/api)

Generated from @prism-code/spec 2026-10-23 at e84124f0fed01510843772ae11d8a3068cef47ea.

<!-- sdks/overview -->

---
title: SDK overview
description: The runtime for each language, where it is published, its stability tier and the one spec they share.
available_in: "0.2.0"
---
Prism has one runtime per language. Each one loads, checks, instantiates and dispatches holos with the same calls and the same errors. Pick the language your application already uses.

## Choose a language

| Language | Package | Install | Published | Tier |
|---|---|---|---|---|
| TypeScript | `prism-code` on npm | `npm install prism-code` | 0.2.0 | Experimental |
| Rust | `prism-code` on crates.io | `cargo add prism-code` | not yet, ships with 1.0-beta.1 | none yet |
| Python | `prism-code` on PyPI | `pip install prism-code` | not yet, ships with 1.1 | none yet |

Every public surface carries one of four tiers. Experimental may change in any release, including a patch, so pin the exact version. Beta is feature-complete and changes only with a changelog entry. Stable gets twelve months notice before removal, from 1.0. Deprecated keeps working through the current major. Nothing is Stable today.

## One spec, one suite

Every runtime is built from `@prism-code/spec`. The types, the JSON Schemas, the world files and the section layout come from that one package. A runtime adds no field the spec does not name.

Every runtime passes `@prism-code/conformance` before release. The suite loads the same holos and applies the same policies. It dispatches the same inputs and expects the same verdicts, outputs and errors. A runtime that fails one case does not ship.

## Format revision

Holo format revisions are named by date. The current revision is `2026-10-23`. Every runtime states which revisions it accepts and refuses the rest by name. `@prism-code/spec` exports the current one as `FORMAT_REVISION`, and [Spec package](/docs/api/spec-package) shows it printed.

## What every runtime shares at 1.0

- `load`, `inspect`, `verify`, `instantiate`, `dispatch`, `history` and `replay`, with the same names.
- The error set: `PrismError`, `VerificationError`, `ProofMismatchError`, `CapabilityDeniedError`, `DeterminismViolationError`, `ReplayError`.
- Configuration from `PRISM_*` environment variables, overridden by options passed to the client, overridden by options passed to one call.
- The default policy: assurance level P2 or above and a declared world within the granted capabilities.

`asTool` ships in TypeScript only, because the Vercel AI SDK is a TypeScript library. Rust and Python expose a holo to agents through `@prism-code/mcp` instead. [Release status](/docs/reference/release-status) says which release brings each call.

## Next steps

- [TypeScript](/docs/sdks/typescript)
- [Rust](/docs/sdks/rust)
- [Python](/docs/sdks/python)

<!-- sdks/typescript -->

---
title: TypeScript SDK
description: Install prism-code from npm and run a holo from Node.js or the browser.
available_in: "0.2.0"
---
`prism-code` is the runtime for Node.js 22 and later and for browsers with WebAssembly. It ships its own types and has no dependencies. Version 0.2.0 is on npm and its API is Experimental, so pin the exact version.

## Install

```bash
npm install prism-code@0.2.0
```

## Load, dispatch, replay

Three calls cover what 0.2.0 does. `load` opens a holo and checks its digest footer and every section label. `dispatch` sends one request to the program on a fresh instance and returns the response. `acceptance` replays every example the holo carries:

```js
import { load } from 'prism-code';

const app = await load('./Calculator.holo');
console.log(app.name, app.identities.verified);

const response = await app.dispatch(new TextEncoder().encode('1\tadd\t20\t22'));
console.log(JSON.stringify(new TextDecoder().decode(response)));

const result = await app.acceptance();
console.log(result.passed, 'of', result.total, 'examples replayed');
```

```text
Calculator true
"1\tok\t42"
22 of 22 examples replayed
```

The calculator holo speaks a line-based text protocol, so the request and the response are bytes you encode and decode yourself. `load` also takes a `Uint8Array`, a `Blob`, or a URL ending in `.holo`.

## Use it in the browser

The same import works in a bundled browser page. Fetch the holo and pass the bytes:

```ts
import { load } from "prism-code";

const bytes = new Uint8Array(await (await fetch("./Calculator.holo")).arrayBuffer());
const app = await load(bytes);
```

## What comes next

`verify` with a verdict and an assurance level, the typed errors, `instantiate` with a capability set, streaming `dispatch`, `history`, `replay` and `asTool` arrive in later releases. [Release status](/docs/reference/release-status) says which one brings each call. To check a holo without the runtime, use `@prism-code/verify`.

## Next steps

- [Run a holo](/docs/guides/run-a-holo)
- [API reference](/docs/api)
- [Release status](/docs/reference/release-status)
- [Check in the browser](/docs/api/verify-package)

<!-- sdks/rust -->

---
title: Rust SDK
description: Add the prism-code crate and run a holo from Rust.
available_in: "1.0-beta"
---
The `prism-code` crate is the Rust runtime. It exposes the same calls, errors and environment variables as the TypeScript runtime, and it is async.

Status: the `prism-code` crate is not published. This page gains its install output, its code and its captured output when the crate ships.

## Install

```bash
cargo add prism-code
```

## What it exposes

- `load`, `inspect`, `verify`, `instantiate`, `dispatch`, `history` and `replay`, with the names the TypeScript runtime uses.
- `PrismError` and one case for each error the TypeScript runtime throws: verification, proof mismatch, capability denied, determinism violation and replay.
- `prism_code::FORMAT_REVISION`, the format revision the crate accepts. It refuses a newer holo by name.

It passes `@prism-code/conformance` before release, like every runtime.

## Next steps

- [SDK overview](/docs/sdks/overview)
- [API reference](/docs/api)
- [Release status](/docs/reference/release-status)

<!-- sdks/python -->

---
title: Python SDK
description: Install prism-code from PyPI and run a holo from Python.
available_in: "1.1"
---
The `prism-code` package is the Python runtime. It exposes the same calls, errors and environment variables as the TypeScript runtime, as coroutines you run under `asyncio`.

Status: the `prism-code` Python package is not published. This page gains its install output, its code and its captured output when the package ships.

## Install

```bash
pip install prism-code
```

## What it exposes

- `load`, `inspect`, `verify`, `instantiate`, `dispatch`, `history` and `replay`, with the names the TypeScript runtime uses.
- `PrismError` as the base exception, and one subclass for each error the TypeScript runtime throws.
- `prism_code.FORMAT_REVISION`, the format revision the package accepts. It refuses a newer holo by name.

It passes `@prism-code/conformance` before release, like every runtime.

## Next steps

- [SDK overview](/docs/sdks/overview)
- [API reference](/docs/api)
- [Release status](/docs/reference/release-status)

<!-- changelog -->

---
title: Changelog
description: What each Prism release makes available, newest first.
available_in: "0.2.0"
---
Each entry gives the release date, the version, a tag of Feature or Fix, and what became available. Read the newest entry first; older entries stay for the history. A release that has not shipped says so in place of a date, and [Release status](/docs/reference/release-status) is where each feature is placed. Each feature of a shipped release links the request it closed.

## 1.1

Date: not released. Tag: Feature.

### Python runtime and plugins

Prism runs from Python, and plugins extend the verifier and the host.

- `prism-code` on PyPI exposes the same API as the npm package and the Rust crate, and reports the format revision it accepts.
- Verifier plugins add checks to `check`.
- Host plugins pair a `prism-plugin-<name>` crate with an `@prism-code/plugin-<name>` package.

## 1.0

Date: not released. Tag: Feature.

### Stable

The CLI and the runtime API are Stable. From this release, anything Stable gets twelve months notice before removal, and a patch never breaks you.

- The sixteen verbs, their flags, `--json` on every verb and the exit codes 0, 1 and 2 are Stable.
- `load`, `inspect`, `verify`, `instantiate`, `dispatch`, `history`, `replay` and `asTool` are Stable; experimental calls carry the `experimental_` prefix.
- [Migrate to 1.0](/docs/migration/to-1-0) lists what you rewrite.

## 1.0-rc

Date: not released. Tag: Fix.

### Release candidates

Release candidates harden what 1.0-beta.1 froze. Nothing new is added.

## 1.0-beta.1

Date: not released. Tag: Feature.

### Ship, bridge, extend

Holos move through registries, GitHub Pages and Docker. Agents use them as tools, and you extend the CLI and the runtime without forking either.

- `push` and `pull` move holos and their attestations through any OCI registry, with attestations as referrers; a local directory store works offline.
- `deploy` publishes to a GitHub repository and GitHub Pages and serves the attestations alongside; `export --oci` writes an OCI image that `docker run` serves.
- `inspect --audit` prints the security view and exports the report.
- `asTool(holo)` returns a Vercel AI SDK tool, and `@prism-code/mcp` exposes a holo as an MCP server.
- `dispatch` streams its events.
- CLI plugins run as `prism <name>` from `prism-<name>` on PATH; provider services are declared in `prism.toml`; runtime middleware wraps verify, instantiate, dispatch and record.
- The `prism-code` Rust crate exposes the same API as the npm package.

## 0.6

Date: not released. Tag: Feature.

### World, capabilities and the run gate

A holo declares what it imports and exports, and runs with exactly the capability set you grant. The loop from examples to a running instance closes.

- `init` scaffolds `prism.toml`, `examples/`, `intent.md`, a default capability set and the lockfile; `npm create prism-code` does the same from npm.
- `build` writes the model from examples and intent through an agent, and fails by name on an unproved sentence.
- `run` starts an instance only after `check` passes at the policy's level; `--allow-unverified` prints a warning. `check` and `run` take a policy file.
- One run of a holo is a container, `created`, `running` or `exited`, with an exit code that follows the typed error and its output, kept until `--rm` or `rm` removes it. `prism.containers` is the same in the SDK.
- `replay <history>` re-executes recorded inputs and fails on divergence; `dev` watches, rebuilds, re-checks and serves the local studio.
- `generate` writes JS, Rust and Python bindings and the typed client from the world.
- `export` writes the six-file browser export or a tarball.
- `@prism-code/testing` drives a holo with a mock host, and `@prism-code/conformance` is the suite every runtime passes.

## 0.5

Date: not released. Tag: Feature.

### Check, proof and attestations

Every build carries a proof and a provenance attestation, and `check` verifies both against a policy. The lockfile pins everything the build depends on.

- `check` verifies digest, provenance, proof and lockfile pins and prints a verdict with its assurance level and reasons.
- `build` always emits provenance and the proof attestation and caches by spec digest.
- `lock` writes the lockfile; `update` bumps the SDK image and prints old and new digests.
- `attest` adds a signed statement and `verify` checks it, keyless by default with `--key` for air-gapped use.
- `inspect` prints manifest, section digests, format revision and attestations without running.
- `holo.verify()` returns a verdict, and the runtime throws typed errors.
- `@prism-code/spec` ships the types, JSON Schemas, world files and the format revision constant; `@prism-code/verify` checks a holo offline in the browser with no runtime attached.

## 0.2.0

Date: 2026-10-23. Tag: Feature.

### First runtime on npm

`prism-code` 0.2.0 is on npm for Node.js 22 and later and for browsers.

- `load` opens a holo from bytes, a `Blob`, a path or a URL, and checks its digest footer and every section label.
- `dispatch` sends one request to the program on a fresh instance and returns the response bytes.
- `acceptance` replays every example the holo carries and reports how many passed.
- `prism-code run` serves a holo, `prism-code vectors` replays its examples, and `prism-code inspect` prints what it says about itself.
- `prism-code check` and `prism-code build` run the build inside the SDK image pinned by `prismpm.lock`. Docker is required.

Closes [#249](https://github.com/UOR-Foundation/PrismPM/issues/249).
Closes [#250](https://github.com/UOR-Foundation/PrismPM/issues/250).

## Next steps

- [Release status](/docs/reference/release-status)
- [Migrate to 1.0](/docs/migration/to-1-0)
- [Quickstart](/docs/get-started/quickstart)

<!-- migration/to-1-0 -->

---
title: Migrate to 1.0
description: What changes between 0.x and 1.0, what you rewrite by hand, and what is still planned.
available_in: "1.0"
---
This guide takes a project on any 0.x release to 1.0. 1.0 has not shipped, so every change below has one of three states:

- **0.3.0** means the change is in `prism-code` 0.3.0, and you can make it now.
- **Next release** means the change is merged and in the Unreleased changelog entry, and in no version yet.
- **Planned** means the change is on the road to 1.0 and in no release yet. Names can still change until the feature freeze.

[Release status](/docs/reference/release-status) says what is published today.

## What to do, in order

1. Pin exact versions. Every CLI verb and SDK export is Experimental until 1.0, so any release may change them.
2. Read Breaking Changes in the `CHANGELOG.md` entry of every version you cross. It is the complete list.
3. Make the 0.3.0 changes: the `run` gate, the meaning of `check`, the `inspect` output and the import error. Then handle the new `run` exit codes.
4. Bring your lock to the current schema.
5. Make the planned renames when you upgrade to the release that ships them. The new names do not exist before then.

## The command becomes `prism`

```diff
- prismpm build
+ prism build
```

State: Planned. `prismpm` stays as an alias through every 1.x release, so scripts keep working. Nothing schedules the removal of the `prism-code` command.

## Verbs that change

These verbs change meaning or spelling, not only the command name. The verbs `build`, `lock`, `update` and `deploy` keep their meaning.

| Today | At 1.0 | What changes | State |
| --- | --- | --- | --- |
| `prism-code check <holo>` | `prism check <ref>` | Same verdict and exit codes, under the new command. | 0.3.0 for the verdict; Planned for `prism` |
| `prism-code check` with no holo | `prism-code build --check` | The old spelling warns, and `prism-code` 0.4.0 removes it. | 0.3.0 |
| `prismpm check` | `prism check <ref>` | Today it validates the model. At 1.0 it judges a holo. The `prism` spelling of the model check is not decided. | Planned |
| `prismpm verify` | Not settled | Today it checks the Lean proofs and runs the acceptance vectors. | Planned |
| `prism-code verify-attestation <holo>` and `prismpm verify-attestation <holo>` | Not settled | Both commands check a signed statement today. The 1.0 verb list calls this `prism verify`, but today's commands keep `verify` for the build check above. | Planned |
| `prismpm push <ref>` and `prismpm pull <ref>` | `prism push` and `prism pull` | Today they move a product release. `prism-code push` and `prism-code pull` move one holo with its attestations, which is what the 1.0 verbs do. | Planned |
| `prismpm export-browser <ref> --output <dir>` | `prism export <ref> --out <dir>` | The verb and the flag are both renamed. `prism-code export <ref> --out <dir>` already uses the 1.0 spelling. | 0.3.0 for `prism-code export`; Planned for `prism` |
| `prism-code inspect <holo> --format <path>` | `prism inspect <ref> --format <section>` | `--format` takes a section name instead of a value path. | Planned |
| `prismpm run <ref>` and `prism-code run <holo>` | `prism run <ref>` | Today `prismpm run` runs a release through its modeled Compose target. At 1.0 `run` starts an instance of a checked holo. | Planned |

The operator verbs `plan`, `backup`, `restore`, `status`, `rollback`, `destroy`, `sign` and `promote` are not on the 1.0 verb list. No decision about them is recorded, and `prism-code vectors` has no named `prism` verb either. They all work as they do today until a changelog entry says otherwise.

Exit codes also change. `check` exits 0 for pass, 1 for fail and 2 for no verdict. `run` has its own codes, listed below and in the [Errors reference](/docs/reference/errors). `prismpm` still uses class exit codes today: a stale `lock --check` exits 4. Update CI that matches an exact number.

## `run` starts only a checked holo

State: 0.3.0. `prism-code run` used to start any holo that compiled. It now judges the holo first, against the policy and the capability set it will run under. The default policy requires level P2.

Every holo is at level P0 until holos carry signed statements, so under the default policy `run` refuses every holo today:

```text
FAILED  P0 unverified  policy default requires P2 or above
...
run refused: the holo did not pass check. Raise its evidence, run it under a policy that accepts it (--policy), or pass --allow-unverified.
```

Name the level you accept in a policy file, here `policy.rego`:

```rego
package prism.policy

minimum := "P0"
```

```diff
- prism-code run app.holo
+ prism-code run app.holo --policy policy.rego
```

`run` then starts and prints the verdict it acted on:

```text
check: passed, P0, policy policy.rego
```

State: Next release for Rego files and for the shipped policies `pure-only` and `provenance-only`. In 0.3.0 a policy is a JSON file such as `{ "minimum": "P0" }`, and JSON keeps working. The [Policy reference](/docs/reference/policy) has the full format.

The other way through is `--allow-unverified`. It prints a warning on every start and is never the default. It relaxes the verdict only, and never grants an import the capability set does not allow.

| Situation | `run` does | Exit |
| --- | --- | --- |
| The verdict passes the policy | Starts | Serves |
| The verdict fails on a provenance, document or policy reason, which is every holo today | Refuses and prints the verdict | 1 |
| The verdict fails on a proof reason | Refuses and prints the verdict | 10 in the next release, 1 in 0.3.0 |
| The world is outside the grant | Refuses and prints the verdict | 2 in the next release, 1 in 0.3.0 |
| No verdict: a bad policy, not a holo, an unknown format revision | Refuses and says why | 2 |
| A closure directory, which `check` cannot judge | Refuses | 2 |

A JSON policy may also list the impure effects a world may import, as `effects`. Leave it out and nothing changes. `"effects": []` is the pure-world policy.

## `check` judges a holo

State: 0.3.0. `prism-code check <holo>` returns a verdict with a level and reasons. It no longer runs the build tooling. The Docker-backed model check moved to its own spelling:

```diff
- prism-code check
+ prism-code build --check
```

The old spelling still runs in 0.3.0 and prints a warning. `prism-code` 0.4.0 removes it.

## Other breaks in 0.3.0

**`inspect` output.** On a `.holo`, `prism-code inspect` prints a human summary instead of the 0.2.0 JSON. Scripts that parse it need the flag, and the shape is `prismpm/holo-inspection/1`. A closure directory keeps the 0.2.0 summary.

```diff
- prism-code inspect app.holo
+ prism-code inspect app.holo --json
```

**Guest imports.** A guest that declares an import now fails to load with `CapabilityDeniedError`. The exit code of `prism-code` stays 2.

```diff
- if (error instanceof PrismCodeError && error.code === 'core.imports') {
+ if (error instanceof CapabilityDeniedError && error.check === 'capabilities.import') {
```

**Canonicalization imports.** The top-level canonicalization functions from `prism-code` 0.1.0 are deprecated, and they still work in 0.3.0. Move them now.

```diff
- import { canonicalize, codeHash } from 'prism-code';
+ import { canonicalize, codeHash } from 'prism-code/canonical';
```

## `experimental_` names graduate

State: Planned. An Experimental surface moves up one tier at the feature freeze and is Stable at 1.0. A Stable name carries no prefix.

| Today | At 1.0 | Import from |
| --- | --- | --- |
| `experimental_verify` | `verify` | `prism-code` |
| `experimental_createClient` | `createClient` | `prism-code` |
| `holo.experimental_verify()` | `holo.verify()` | `prism-code` |
| `experimental_attest` | `attest` | `prism-code/node` |
| `experimental_verifyAttestations` | `verifyAttestations` | `prism-code/node` |
| `experimental_verifyBundle` | `verifyBundle` | `prism-code/node` |
| `experimental_push` | `push` | `prism-code/node` |
| `experimental_pull` | `pull` | `prism-code/node` |
| `experimental_exportBrowser` | `exportBrowser` | `prism-code/node` |
| `experimental_checkExport` | `checkExport` | `prism-code/node` |

```diff
- import { experimental_verify } from 'prism-code';
- const verdict = await experimental_verify(bytes);
+ import { verify } from 'prism-code';
+ const verdict = await verify(bytes);
```

Two more names carry the prefix and have no date: `holo.experimental_middleware` and `experimental_tracing`. The schedule in `STABILITY.md` section 6 does not list them, so keep using them under these names and pin the exact version.

Every other Experimental surface has no prefix, so only its tier moves and you rename nothing:

- the typed error classes and their codes
- `inspect`, the capability functions and the manifest functions
- `prism.containers`, `createPrism` and `EXIT_CODES`
- the exports of `@prism-code/verify` and `@prism-code/spec`
- the fields of `prism/verdict/1`
- CLI plugins

Nothing is removed from this list except the `check` spelling above. The `prism/replay/v1` predicate is a placeholder and carries no promise.

## Lock and manifest

**The lock.** The file stays `prismpm.lock`. Its schema has moved twice, and each step is explicit: no reader promotes an old lock silently.

| Your lock | `build` | To move forward |
| --- | --- | --- |
| `prismpm/sdk-lock/1` | Builds | `prismpm lock migrate`, then adopt the proposal it prints |
| `prismpm/sdk-lock/2` | Builds | `prismpm lock` or `prismpm build --update` |
| `prismpm/sdk-lock/3`, inputs match | Builds | Nothing to do |
| `prismpm/sdk-lock/3`, inputs differ | Refused with `PP5401`, naming the changed fields | `prismpm lock` or `prismpm build --update` |

State: these commands work in `prismpm` today. At 1.0 `lock` and `update` keep their meaning under `prism`.

```diff
- prismpm lock update --sdk-image <ref> --standards-lock <digest>
+ prism update --toolchain <ref>
```

`lock update` only proposes a patch. `update --toolchain` applies it and prints the old and new digests, and it takes the standards lock digest from your project.

**The manifest.** `prism.toml` is new and optional. It holds the application, the model, the capability set and the variables, with `prism.browser.toml` and `prism.node.toml` as per-target overlays.

```toml
[application]
name = "calculator"
version = "0.1.0"

[model]
source = "src/Calculator.lex.tex"
```

State: `prism-code` reads it in 0.3.0, and the `prism` CLI reads it from 0.6. `prismpm.toml` stays the project file of `prismpm`, and how the two relate is not decided. Adding `prism.toml` changes what the spec digest covers, so `build` refuses your lock until you refresh it.

**The holo.** Physical format 4 does not change, so existing holos keep loading. A holo stays at level P0 until it is rebuilt by a release that adds signed statements. From here on, format revisions are dated, and a reader refuses a revision it does not accept.

## Docker-aligned names

State: Mostly Planned, and the most likely part of this page to change. The developer surface of 1.0 is planned to use Docker's words. Your project changes only where it names these terms in the CLI, the SDK or a data shape printed by `--json`.

| Term today | Developer term |
| --- | --- |
| holo | image (the `.holo` extension stays) |
| section fingerprint, archive fingerprint | layer digest, digest |
| model document | config |
| product release | manifest |
| SDK image | builder image |
| instance | container |

The first part has landed. State: Next release for `prism.containers` with `run`, `create`, `start`, `get` and `remove`, and for `prism-code rm`.

The rest is Planned. The SDK gains `prism.images.*` (`build`, `pull`, `push`, `inspect`, `verify`, `tag`, `list`, `remove`), and `prism.containers` gains `list`, `logs`, `exec` and `stop`. The CLI gains `ps`, `stop`, `logs`, `exec`, `images`, `tag` and `rmi`. If these land, they can replace the 1.0 names in the tables above.

Each renamed verb and export keeps a deprecated alias for one minor release, and the alias prints one warning naming the new term. Model terms, schema identifiers, predicate URIs and error codes do not change.

## There is no codemod

No codemod ships for 1.0, for three reasons:

- The rename is ten names in nine spellings, and each maps to one name. A search and a replace cover it.
- The changes that matter most are about behavior: the `run` gate, what `check` and `verify` mean, and exit codes. A rewrite cannot decide which policy you accept.
- The new names do not exist yet, so a rewrite run today would break your imports.

List what you use, then rewrite it once you are on the release that ships the names:

```bash
grep -rnE 'experimental_(verify|createClient|attest|verifyAttestations|verifyBundle|push|pull|exportBrowser|checkExport)\b' src
sed -E -i 's/\bexperimental_(verify|createClient|attest|verifyAttestations|verifyBundle|push|pull|exportBrowser|checkExport)\b/\1/g' src/app.mjs
```

A file that also imports `verify` from `@prism-code/verify` now has two names for one word. Give one of them a local alias by hand.

We will reconsider if the Docker-aligned names land as a large set of renames, because moving calls into `prism.images.*` is harder than a text replacement.

## After 1.0

From 1.0, every package follows Semantic Versioning, and only a major bump may break a Stable surface. A Stable surface is deprecated at least twelve months before it is removed, and the deprecation appears in the changelog with its date and a guide. Each major version gets one guide here.

## Next steps

- [Changelog](/docs/changelog)
- [Run and gate](/docs/guides/run-and-gate)
- [Lockfile reference](/docs/reference/lockfile)
- [Manifest reference](/docs/reference/manifest)
- [CLI reference](/docs/reference/cli)

