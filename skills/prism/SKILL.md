---
name: prism
description: Build a new Prism app from one sentence and publish it, or load, run, inspect and verify a holo, the Prism package that carries its own proof and provenance. Use when asked to build, start or ship a Prism app, when a task mentions Prism, LexLean, a .holo file or prism-code, or when it asks whether an application can be trusted before it runs.
---

# Prism

Prism works like Docker. A model is built into a holo, an immutable package addressed by its digest, like an image. A runtime runs the holo, like a container runtime runs an image, and every run starts from a loaded, verified instance, like a container. A holo carries its own proof and provenance, so you check it before anything runs.

| Docker | Prism |
| --- | --- |
| Dockerfile | model |
| image, tag and digest | holo |
| container | instance |
| base image pinned in `FROM` | SDK image pinned in the lockfile |
| `docker run` | `prism-code run` |
| `docker inspect` | `prism-code inspect` |

## Install

```bash
npx prism-code@latest setup
```

One run adds two MCP servers to every agent on the machine, `lexlean` (remote: checks and proves LexLean) and `prism` (local: the guided build), installs this skill, checks the GitHub sign-in, and ends with what to do next: restart the agent if it changed, then ask it for an app. It needs no Docker; `--local` also readies Docker and the SDK image for local builds. Spell it `prism-code@latest`, because `npx` prefers an older `prism-code` installed in any folder above the current one. To use the package from code, `npm install prism-code`.

Use `npx prism-code` followed by a verb to run it without installing. The package ships a sample holo, `Calculator.holo`, so you can try every command below without building anything.

## Try it

<!-- generated:try:begin -->
```bash
npx prism-code --version   # print the installed version
npx prism-code inspect node_modules/prism-code/fixtures/Calculator.holo   # print what the holo says about itself, without running it
npx prism-code vectors node_modules/prism-code/fixtures/Calculator.holo   # replay its acceptance vectors; exit 0 means every one passed
```
<!-- generated:try:end -->

## Commands

Run `npx prism-code --help` for the list your installed version has. The commands below are the ones that ship today.

<!-- generated:commands:begin -->
| Command | What it does |
| --- | --- |
| `prism-code run <app.holo> [<input>] [--input <text>] [--rm] [--port <n>] [--policy <file>] [--allow-unverified] [--capabilities <file>]` | Check the holo against the policy. With an input, this is one run as a container: dispatch the input, print the output and exit with the container's code, keeping the container until `rm` unless `--rm`. Without one, serve its view on a local port; a POST to `/_hologram/intent` dispatches one request. A holo that fails check is refused unless `--allow-unverified`, which warns on every start. |
| `prism-code rm <container>...` | Remove containers, by id or unique id prefix. A running container is refused. |
| `prism-code init [<dir>] [--sdk-image <ref>]` | Scaffold a project: `prism.toml`, a language-1.2 model and its Lean workspace, and a `.gitattributes` that keeps sources LF, because LexLean refuses CRLF. Print the build tiers to run next, cheapest first. With `--sdk-image`, also copy that image's `standards.lock` and write `prismpm.lock` (needs Docker). `npm create prism-code` runs the same command. This is a LexLean project, not a Prism application: an application has one input, `prism/spec.json`, and its model is rendered from that JSON (the `mcp` verb's `prism` server writes it). Hand-written LexLean is for a project like this one. |
| `prism-code manifest [<dir>] [--target <target>]` | Check and lint the project's `prism.toml`, with the overlay for the target merged in, and print the application, the grant and the variables. |
| `prism-code providers <verb> [<dir>] [--target <target>] [--json]` | `up` runs the `prism-provider-<type>` each capability in `prism.toml` declares and prints the variables it produced, and `down` releases them. Text output names them, and `--json` also prints their values. The capability set must allow the type and each variable. Experimental. |
| `prism-code vectors <app.holo> [--allow-unverified]` | Replay every acceptance vector the holo carries and exit 1 on a failure. An altered holo is refused; `--allow-unverified` replays it and still exits 1. |
| `prism-code record <app.holo> [--output <file>]` | Write the acceptance vectors the image carries as a recording, its first. `history` is the deprecated spelling, kept through 0.8. |
| `prism-code replay <recording>... --image <app.holo> [--statement <file>] [--json]` | Re-execute recordings, or every recording in a directory, against this build and compare every outcome: exit 0 unchanged, 1 diverged, 2 could not replay. `--statement` writes the `prism/replay/v1` statement, also on a divergence. |
| `prism-code inspect <holo-or-container> [--format <path>]` | Print what the holo says about itself, without running it, or a container's state, exit code, image digest and output. |
| `prism-code attest <app.holo> --predicate <file> --type <uri>` | Sign an in-toto statement about the holo into its attestation section: keyless with an OIDC token, or with `--key`. `--unsigned` signs the statements the build left unsigned, and `--statement <file>` signs a whole statement, such as the proof statement in the verified directory. |
| `prism-code verify-attestation <app.holo> --certificate-identity <id> --certificate-oidc-issuer <url>` | Check the holo's attestations against the signer you expect, or against `--key`. |
| `prism-code export <name@sha256:digest> [--out <dir>] [--tar <file>] [--project <dir>] [--json]` | Write a release's six-file browser export or tarball, byte-checked against the build manifest, attestations beside. |
| `prism-code generate <app.holo> --out <dir> [--lang <language>]` | Write bindings and a typed client (`--lang` js, the default, rust or python) from the holo's WIT world and model into `<dir>`, with a record of what they came from. A second run with the same inputs writes nothing. |
| `prism-code check <app.holo> [--policy <file>] [--replay <file>] [--key <file>] [--certificate-identity <id>] [--certificate-oidc-issuer <url>] [--trusted-root <file>] [--json]` | Judge the holo against a policy and print its verdict: the assurance level, whether the policy passed, and every reason. `--policy` takes a Rego file, the name of a shipped policy (`pure-only`, `provenance-only`) or a JSON file. Exit 1 when the policy denies, 2 when it cannot be parsed or evaluated. A holo that carries signed provenance and proof statements reaches P1 and P2 only when `--key`, or a certificate identity and issuer, names the signer that signed them. Without a holo it is a usage error that names `build --check`, the model check. |
| `prism-code images <verb> ... [--dangling] [--force] [--all] [--json]` | The `images` module's verbs. `build`, `inspect`, `pull`, `push` and `verify` are each the same command as the flat verb it names (`verify` is `check`). `ls`, `tag`, `rm` and `prune` read and change the local image store (`$PRISM_IMAGES`, else `$PRISM_HOME/images`): `ls` lists repository, tag, image id, created and size; `rm` untags one of several tags and removes an image only when no container references it, unless `--force`; `prune` removes untagged images no container references, and with `--all` every image none references. `images` alone is `images ls`, and the top-level verbs `tag` and `rmi` are `images tag` and `images rm`. `prism-code images --help` lists them. |
| `prism-code containers <verb> ...` | The `containers` module's verbs: `create`, `inspect`, `logs`, `ls`, `ps`, `rm`, `run` and `start`. `run`, `rm` and `inspect` are the flat verbs they name; `create` prints the new container's id, `ps` lists running containers (every one with `--all`), `ls` is `ps`, and `logs` prints a container's stored output. The top-level verbs `ps` and `logs` are `containers ps` and `containers logs`, and Docker's singular spellings `container`, `image` and `volume` name the same groups as `containers`, `images` and `volumes`. `prism-code containers --help` lists them. |
| `prism-code volumes <verb> ... [--project <dir>]` | The `volumes` module's verbs: `create`, `inspect`, `ls` and `rm`, over the capability grant and provider declarations of a project's prism.toml. A volume is a declared store, never a host folder; `create` prints the names of the variables a provider returned, never their values. `prism-code volumes --help` lists them. |
| `prism-code push [<app.holo>] <reference> [--key <file>] [--keyless] [--no-attestations] [--signing-config <file>] [--store <dir>] [--plain-http] [--json]` | Put the holo in an OCI registry or a local store as a deterministic manifest, each attestation a referrer. With `--key` or `--keyless`, also sign a statement naming the manifest, so `cosign verify-attestation` passes on the same reference. With no holo, push the image of that name in the local image store. |
| `prism-code pull <reference> [<out.holo>] [--policy <file>] [--key <file>] [--certificate-identity <id>] [--certificate-identity-regexp <re>] [--certificate-oidc-issuer <url>] [--type <uri>] [--trusted-root <file>] [--entries <n>] [--timestamps <n>] [--store <dir>] [--plain-http] [--json]` | Fetch a holo and write it only after its digests, archive, verdict and attestations pass; the signer flags are those of `verify-attestation`. A reference is `registry/repo:tag`, `@sha256:`, `@blake3:` or `dir://`. A verified holo is also kept in the local image store under the name it was pulled by. |
| `prism-code dev [<dir>] [--port <n>] [--no-open] [--policy <file>] [--build <command>] [--image <path>]` | Watch the project, rebuild and re-check on every change, and serve the local studio at `http://localhost:4100`, with a Check tab and a Replay tab. The page loads nothing from outside the machine. |
| `prism-code setup [--agent <id>] [--hosted] [--local] [--pull] [--image <ref>] [--agents-only] [--machine-only] [--json] [--dry-run]` | Get this machine and its agents ready, with no Docker needed. The machine rows: Node 22 or later; `* text eol=lf` in the project's `.gitattributes`, unless it already keeps every file byte for byte (`* -text`); and, read only, whether apps can build on GitHub Actions: outside a repository, a GitHub sign-in (`GITHUB_TOKEN`, `GH_TOKEN` or `gh`); inside one, a github.com origin, the token and `.github/workflows/build.yml`. With `--local`, which `--pull`, `--image` and `--machine-only` imply, also Docker on the PATH or, on Windows without Docker Desktop, inside the first WSL distribution whose `docker version` answers, recorded in `$PRISM_HOME/config.json` so every delegated verb spawns it; the SDK image `prismpm.lock` pins (or `--image`), pulled only with `--pull` or `--image` and otherwise deferred: the first `build`, `verify` or `axioms` pulls it, about 5.5 GB, saying so first; and a cache volume per image, mounted at `/tmp`. Then add the local Prism server `prism`, the `mcp` verb, to every agent found: Claude Code, Codex, Cursor, VS Code and Claude Desktop. It is the one way an app is made: the agent writes or edits one JSON spec, `prism/spec.json`, and Prism turns it into LexLean, the same bytes from the same JSON, proves it and builds it on this machine. With `--hosted`, also add the MCP server `lexlean` at `https://mcp.uor.foundation/`, which stores what it is sent unlisted, not privately; Install the `prism` skill this package ships into `~/.claude/skills` and `~/.agents/skills`. Install the `holo://` link handler and remember the preferred agent. A server already there, and a `holo://` handler another program owns, are left alone. Last, it prints the next steps: sign in to GitHub when that is missing, restart the agent it changed, and the first sentence to ask it. Then one line on gap telemetry: what the journey sends and that `PRISM_TELEMETRY=0` turns it off. `--agent` limits it to one agent. `--dry-run` prints every file and command and changes nothing; `--json` prints the report, next steps included. |
| `prism-code mcp [--project <dir>]` | Serve the Prism MCP server on stdio, for any agent that speaks MCP. Every app has one input, `prism/spec.json`: a `prism/spec/1` spec the agent writes from one sentence, through `prism_spec` or by editing the file. Prism reads it strictly (no unknown member, no duplicate key, whole numbers only, text never altered), keeps it as canonical JSON (RFC 8785) with its SHA-256, and renders the LexLean model from it alone, so the same JSON always gives the same model. The user approves the spec once; Lean then proves every stated property and the holo is built, both on this machine in the SDK image (the hosted verifier only with `PRISM_CODE_TIER=hosted`, GitHub Actions only when the user names a repository). A model that does not match spec.json is refused at build. An app with no repository yet gets one only after the user approves its name: `prism_build` returns `needs: "repository"` with a suggestion, then creates the public repository from `UOR-Foundation/template`, writes the app into it with a row, a scenario and a pinned test for each property, and its page, pushes, and returns the GitHub Pages URL once the gate and the page pass. The workflow and the SDK locks a GitHub build needs are read from the template at a pinned commit and checked against pinned SHA-256 digests. What a user asked for that Prism or Lean could not do is recorded as a fingerprint, never the user's text, in `$PRISM_HOME/gaps.jsonl` and sent with the next hosted call; `PRISM_TELEMETRY=0` or `DO_NOT_TRACK=1` turns it off. `setup` adds it to every agent it configures. Experimental. |
| `prism-code open <link> [--dry-run]` | Hand a `holo://build?agent=<id>&q=<sentence>` link to its agent. Claude Code and Codex get a new terminal that shows the sentence and runs `claude` or `codex` with it after Enter. Cursor and VS Code get their MCP install link and the sentence on the clipboard. Claude and ChatGPT get their prompt URL. Another host, an unknown agent or parameter, or a sentence over 2000 characters exits 2. |
| `prism-code build [--check] [--hosted] [--local] [--remote github] [--repo <owner/name>] [--ref <commit>] [--timeout <s>] [--allow-dirty] [--json]` | Build the project into a holo inside the SDK image the lockfile pins. With `--remote github`, the repository's own GitHub Actions builds one commit instead, pushed to `prism/build/<sha>` so the run is that commit and no other, and this machine verifies what comes back before anything lands under `.prism/build/`: the commit and repository named in the artifact, the holo's SHA-256, the signed provenance (its subject, its repository and commit, and its signature by a workflow of the repository through GitHub's issuer), then `check` at the P0 policy unless `--policy` names one, the recorded fingerprint, and every acceptance vector replayed here. Needs the template's `build.yml` in the repository, a token (`GITHUB_TOKEN`, `GH_TOKEN` or `gh`), and the Sigstore packages or `gh` for the signature. No Docker. With `--check`, validate the model and write nothing: the full check in the image when it is on this machine, or with `--local`; otherwise `prism.toml` here and `lexlean check` of the files under `src/` on the hosted verifier, which skips the lockfile and SDK pins and says so. The hosted check sends the files under `src/`, unlisted but not private. |
| `prism-code verify [--lean] [--hosted] [--local] [--all]` | Run verify in the SDK image the lockfile pins. With `--lean`, run `lexlean verify` on the project's LexLean project instead: every theorem through Lean and leanchecker with its exact axiom policy, about a minute. It runs in the image when the image is on this machine, or with `--local`; otherwise on the hosted verifier at `https://mcp.uor.foundation/` (profile `prism-app`), which takes a project whose only source root is `src` and passes only when every entrypoint module comes back verified, and writes its record to `.lexlean/hosted/`. The hosted verify sends the files under `src/`, unlisted but not private. |
| `prism-code axioms [--write] [--json]` | Compile the project once in the SDK image and print the axiom set Lean observes for every definition and theorem beside the set the source declares; exit 1 while any differs. With `--write`, set each `axioms` member to the observed set and format the project. |
| `prism-code conformance` | Run the conformance suite in the SDK image the lockfile pins. |
| `prism-code system <verb> [--project <dir>] [--since <time>] [--until <time>] [--filter <key=value>] [--verbose] [--force] [--all] [--json]` | Report on this installation and tidy it, with the verbs info, version, events, df and prune: `info` and `version` name the package, the holo format, the runtime and the toolchain and builder image the project's `prismpm.lock` pins; `events` prints container create, start, die and destroy events from the container store and follows it until `--until`; `df` says what the container records and the local image store take; `prune` removes exited containers, then untagged images no container references (with `--all`, every such image), asking first unless `--force`. |
| `prism-code auth <verb> [<registry>] [--username <name>] [--password-stdin] [--json]` | Log in to a registry or out of it, with the verbs login and logout. `login` checks the username and password with the registry, then stores them where Docker would, so `push`, `pull` and `docker` find them; the password comes from `--password-stdin` or a prompt that does not echo, never from the command line. `logout` removes the credential from every store that holds it. |
| `prism-code login [<registry>] --username <name> [--password-stdin] [--json]` | The same as `prism-code auth login`. |
| `prism-code logout [<registry>] [--json]` | The same as `prism-code auth logout`. |
| `prism-code ps [--all] [--json]` | The same as `prism-code containers ps`. |
| `prism-code logs <container>` | The same as `prism-code containers logs`. |
| `prism-code tag <image> <name>` | The same as `prism-code images tag`. |
| `prism-code rmi [--force] <image>...` | The same as `prism-code images rm`. |

| Exit code | Name | Meaning |
| --- | --- | --- |
| 0 | ok | The verb did what you asked, or `check` reached a verdict the policy accepts. |
| 1 | vectors failed | At least one acceptance vector did not replay or the holo carries none, `replay` diverged, `verify-attestation` did not verify, `check` reached a verdict the policy rejects, or `pull` found a digest that does not match or a holo that fails verification and wrote nothing. |
| 2 | refused | The holo, capability file or manifest cannot be read or fails its checks, an identity check failed, a guest import, the holo's world or a provider is not granted, or a provider failed; or `check` reached no verdict: not a holo, an unreadable policy or an unknown format revision; or `push` or `pull` got no answer: an unreachable registry, refused credentials, a reference that does not exist or referrers that cannot be stored; or an export's bytes differ from the build manifest; or `generate` refused to write: the guest does not conform to its world, or a file in the output directory is not one it wrote; or `replay` could not be carried out. |
| 3 | signing failed | `attest` could not sign, or the optional sigstore packages are not installed. |
| 10 | proof mismatch | `run` refused a holo for a proof reason. 11 is a world mismatch, 12 a determinism violation, 13 a replay error. |
| 64 | usage | The arguments were wrong, or `prismpm.lock` is missing. |
| 69 | no Docker | Docker is not installed or not on the PATH. |
| 70 | untyped | Dispatch threw something untyped: a guest trap, or a bug in the runtime. |

Node.js 22 or later. build, verify, axioms and conformance also need Docker and a `prismpm.lock` in the current directory; `build --check` and `verify --lean` find the lockfile here or above, up to the repository's root, and run on the hosted verifier without the image. `--help` after any command prints that command's usage and runs nothing.
<!-- generated:commands:end -->

## Load a holo from code

Three calls: `load` opens a holo and verifies its digests, `dispatch` runs one request on the instance, `acceptance` replays the examples the holo carries. The script expects `Calculator.holo` beside it; copy it from `node_modules/prism-code/fixtures/`.

<!-- generated:example:begin -->
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
<!-- generated:example:end -->

## How to work with a holo

- Check before you run. `inspect` and `vectors` read a holo without trusting it. A holo that fails an identity check exits 2: stop and report it. Do not run it, and do not edit its bytes.
- Report what the output says. `inspect` prints the holo's identities, limits, provenance and view files. Do not infer a proof or a signed statement from what it leaves out; say what is and is not there.
- Read the exit code before the text. 0 is ok, 1 is a failed vector, 2 is a refused holo, 64 is a usage error, 69 is no Docker.
- `check`, `build`, `verify`, `axioms` and `conformance` run the project's SDK image, so they need Docker and a `prismpm.lock` in the current directory. `build --check` and `verify --lean` also run on the hosted verifier when the image is not here. Say so when Docker is missing instead of working around it.
- The docs say which release each feature needs. Read the release status page before you promise a feature.

## Build a new app

The user says something like "build me a Prism app that tells whether a year is a leap year". That sentence is the whole brief. Give back a live page where anyone can load the app, check its fingerprint and replay its examples.

**The canonical path.** Every Prism app is built this way, and no other: you write one JSON file, `prism/spec.json`, a `prism/spec/1` spec, and Prism turns it into LexLean, proves it and builds it on this machine. The same JSON always gives the same LexLean and the same app, byte for byte. You never write LexLean. It covers an app that decides one answer from a line of fields, each a number or a choice from a fixed list (`prism/spec/1`), and an app that keeps state between steps, such as a count, a total or a phase (`prism/spec/2`, with `"schema": "prism/spec/2"`: bounded `state` with a start, `actions` with inputs, ordered rules whose `change` sets, adds to or subtracts from the state, and an `otherwise` each; properties over every reachable state; examples as sessions of `steps` and `answers`; see `docs/proposals/664-stateful-spec.md`). Say so before drafting if the user's app is neither, for instance one that keeps a list of entries or free text. It is experimental. Call `prism_start`, then translate the user's sentence into a draft and pass it to `prism_spec`. Your job is translation, nothing more: for a `prism/spec/1` app write only what the user said, which is a `title`, the `fields`, the ordered `rules` and the `otherwise` answer, as compact JSON with no whitespace padding. Write a property only when the user stated one ("a clerk must never approve above the limit"), with its reason; do not invent guarantees, and do not write `outcomes`, `purpose` or `examples`. Prism completes the draft, the same way every time: the answers are the ones the rules and `otherwise` give; the purpose and the name come from the title, the answers and the fields; the examples are the first request each rule decides; and when the draft has fewer than three guarantees, Prism proposes some from the rules, up to three in all, each checked against every request and each carrying a `why` that starts "Proposed by Prism" (`proposed` in the result lists their ids). A spec that already holds `purpose`, `outcomes`, `properties` and `examples` is taken as written and nothing is proposed again, so a guarantee the user struck stays struck: to change the app, read the whole spec with `prism_spec` and pass it back changed. `prism_spec` reads it strictly (a member `prism/spec/1` does not define, a duplicate key, a number that is not a whole number within plus or minus 2³, or text the model cannot carry is refused, naming its JSON path), then checks every example against the rules and every property for a counterexample. `notes` says what Prism dropped (an `invalid` listed among the answers, a guarantee no request can meet). When a guarantee you wrote is false, `repair` names it beside the rule that decides against it and the request that shows it: delete that guarantee or change the rules, as it says, and pass the spec again. Prism writes it to `prism/spec.json` as canonical JSON (RFC 8785) and records its SHA-256. To change the app later, pass the changed spec to `prism_spec` or edit `prism/spec.json` yourself: Prism reads the file each call and takes your edit as the spec. Ask only what you cannot infer, and if the app is neither kind, say so before drafting. When a result has an `issue`, fix the draft, or explain it in a sentence and ask the user when only they can decide. Show the checked draft for approval in one message, properties first as plain sentences, and the proposed ones first of all, marked as proposed by Prism and not said by the user: Lean proves them, so the user must agree they are the right ones, and may strike any. When you can draw HTML in the chat (a visual or widget tool), draw one editable card for it, never a multiple-choice question: a question shows the spec as fixed text, and the user cannot change a part where it stands. The card starts with an editable App name field, the spec's `title`, with the ID and repository name it gives shown under it (`name`, lower case with hyphens) and updated as the user types; a name in the header alone cannot be changed. Then come numbered parts split by hairlines (purpose, guarantees, rules, request, answers, examples, out of scope), each a plain text box under its label that grows to fit its text, written in plain words ("Single, under 65, income ≥ $15,750 → must file"), with Skip on the left and a solid approve button on the right that sends the reply itself. Prism writes the approved spec as `prism/SPEC.md` in the OpenSpec format, each requirement marked proved or tested, and the app's repository carries it at `openspec/specs/<name>/spec.md`. On approval, answer the review step with `yes` through `prism_answer`, then call `prism_build`, and call it again while it says `running`. Prism renders the model from `prism/spec.json` alone and Lean proves every property, both in the SDK image on this machine; nothing is sent anywhere unless the user sets `PRISM_CODE_TIER=hosted`, and the first build downloads the image (about 5.5 GB). A model that is not what `prism/spec.json` renders to is refused at build, naming the file: regenerate it from the spec, never edit it. It builds on GitHub Actions only when the user names a repository. The first GitHub build returns `needs: "repository"` with a suggested name: ask the user to approve creating that public repository, and call `prism_build` with `repository` only after they say yes. Prism creates it from `UOR-Foundation/template`, so the app gets the template's frame, page and gate. It writes the app into it with, for each property, a row in `model/ids.toml`, a scenario and a test that pins its theorem, plus the page, and pushes. When the gate and the page pass, it returns the live URL, after replaying the live holo's examples here. Give the user that URL. `prism/spec.json` is the one file you may write or edit; never write or edit LexLean, or anything else under `prism/`. Say "proved" only for what it reports as proved; the acceptance vectors are tested. The steps below are for a LexLean project that is not a Prism app built from a spec, or to publish a page by hand.

Publishing a page is part of that path, not a route beside it. `prism_build` with no repository builds the holo on this machine; call it with `repository` once the user approves the name, and Prism creates the repository from `UOR-Foundation/template`, writes the app into it from the same `prism/spec.json`, pushes, and returns the live GitHub Pages URL when the gate and the page pass.

Report in three lines: the live URL, the repository, and the fingerprint with how many examples replay.

There is no second way to build a Prism app. Do not write LexLean, do not create the repository by hand, and do not use the `lexlean` MCP server to draft a model for an app: a model that is not what `prism/spec.json` renders to is refused at build. Hand-written LexLean belongs to this repository's own templates and library projects, which are not apps built from a spec.

### Verify locally in tiers

`npx prism-code@latest setup --local` also readies the machine: it finds Docker, also inside WSL on Windows, and creates the build cache. It does not pull the SDK image (about 5.5 GB) unless you pass `--pull`. Until the image is here, `build --check` and `verify --lean` run on the hosted verifier at `https://mcp.uor.foundation/`, which receives the files under `src/` (unlisted, not private), and the first `build`, `verify` or `axioms` pulls the image and says so first. Then judge every edit by the cheapest gate that can refuse it:

```bash
npx prism-code build --check
npx prism-code verify --lean
npx prism-code axioms --write
npx prism-code verify
```

- `build --check` takes seconds: the model is well formed and locked. Run it after every edit. Hosted, it checks the model and `prism.toml` but not the lockfile pins, and its last line says so.
- `verify --lean` takes about a minute: every theorem through Lean and leanchecker, every axiom policy exact. Run it before the full build, never instead of it. Hosted, it passes only when every entrypoint module comes back verified, and writes its record to `.lexlean/hosted/`; `hosted.layout` means the project's shape needs `--local`.
- When `verify --lean` names an axiom policy, run `axioms --write` once. It sets every declaration's `axioms` member from what Lean observes, in one pass. Do not guess axiom lists by hand; the verify reports only the first wrong one per run.
- `verify` takes minutes: the guest, the vectors and the holo. Run it once the cheaper gates pass.
- Keep sources LF. `init` writes `* text eol=lf`; LexLean refuses a file with CRLF.
- Exit 69 means no Docker. Run `npx prism-code@latest setup --local` and report what its `docker` row says, or build on GitHub instead (below).

### Build without Docker: GitHub builds, this machine checks

```bash
npx prism-code build --remote github
```

The repository's own GitHub Actions builds one commit, and this machine verifies what comes back before it counts as built. Nothing here needs Docker, the SDK image or a toolchain, so it works from any machine with Node and a token, and the same run serves a phone: an edit committed on github.com or GitHub Mobile builds the app, signs its provenance and publishes the page, which verifies the holo again in the visitor's browser.

- It needs: the template's `.github/workflows/build.yml` in the repository (a new instance has it; an older one copies it from the template), a token (`GITHUB_TOKEN`, `GH_TOKEN` or `gh auth login`), and the commit pushed as the working tree stands. A tree with uncommitted changes is refused; commit, or name a commit with `--ref`.
- What happens: the commit goes to `refs/heads/prism/build/<sha>`, so the run is that commit and no other; `build.yml` runs the full verify in the SDK image and uploads `prism-build-<sha>` with the holo and its signed provenance; the ref is deleted afterwards. A run that already exists for the commit, from a push to `main` for instance, is reused with no push.
- What is checked here, in order, before anything lands under `.prism/build/`: the artifact names this commit and repository; the holo's SHA-256 is the one recorded; the provenance's subject is that digest and its build names this repository and commit; the signature is by a workflow of this repository through GitHub's issuer (prism-code's Sigstore verifier, else `gh attestation verify`, else refused); `check` passes at the P0 policy, or the one `--policy` names; the fingerprint matches; every acceptance vector replays. Report the fingerprint and the run URL it prints.
- Read the exit code: 2 is a refusal (`remote.*`, the message says which check), 1 is bytes that differ from their digest or a verdict or vector that failed, 0 is verified. A run that ended in failure is reported as a failure and nothing is written: read its log on GitHub.
- `setup`'s `github` row says what is in place: outside a repository, whether you are signed in; inside one, the origin repository, where a token would come from, and whether `build.yml` is there. Pages on a private repository needs a paid plan; the artifact and the run's summary need none.

## Docs

<!-- generated:docs:begin -->
- https://universal-coordinate-foundation.lovable.app/docs/llms.txt: the index of every page, written for agents
- https://universal-coordinate-foundation.lovable.app/docs/llms-full.md: every page in one file
- https://universal-coordinate-foundation.lovable.app/docs/reference/cli: every command, flag and exit code
- https://universal-coordinate-foundation.lovable.app/docs/reference/release-status: what has shipped and what is planned
- https://universal-coordinate-foundation.lovable.app/docs/guides/verify-and-inspect: check and inspect a holo
- https://universal-coordinate-foundation.lovable.app/docs/guides/agents: agents and holos
- https://universal-coordinate-foundation.lovable.app/docs/reference/holo-format: the byte layout of a holo
- Append `.md` to any page URL to get that page as Markdown.
<!-- generated:docs:end -->

## MCP

<!-- mcp:begin -->
The MCP server `lexlean` at `https://mcp.uor.foundation/` checks, formats and kernel-verifies LexLean models with no local toolchain or Docker. It is not added to any agent unless you ask: `npx prism-code@latest setup --hosted` adds it to Claude Code, Codex, Cursor and VS Code; in Claude Desktop, claude.ai and ChatGPT, add that URL as a custom connector. It stores what it is sent unlisted, not privately, so a Prism app never needs it: every proof runs on this machine. Never use it to draft a model for an app: an app's model is rendered from `prism/spec.json`, and one that is not would be refused at build. Its tools serve a LexLean project of this repository's own kind; ask the server for its tool list. Drafts are unlisted but not private, so put no secrets in a module.

`npx prism-code@latest setup` adds the local server `prism`, which is `prism-code mcp` on stdio, to every agent it finds, Claude Desktop included. Its tools are `prism_start`, `prism_answer`, `prism_spec`, `prism_prove`, `prism_build`, `prism_try` and `prism_status`: the canonical path under Build a new app, where one JSON spec becomes a proved app. Proving runs in the SDK image on this machine. Building needs both; the first build downloads the image. When it says Docker is missing, tell the user to run `npx prism-code@latest setup`.
<!-- mcp:end -->
