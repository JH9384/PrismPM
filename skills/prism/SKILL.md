---
name: prism
description: Install prism-code, then load, run, inspect and verify a holo, the Prism package that carries its own proof and provenance. Use when a task mentions Prism, a .holo file or prism-code, or asks whether an application can be trusted before it runs.
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
npm install prism-code
```

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
| Command                                                                                                                                                                                                                                                                                            | What it does                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prism-code run <app.holo> [<input>] [--input <text>] [--rm] [--port <n>] [--policy <file>] [--allow-unverified] [--capabilities <file>]`                                                                                                                                                          | Check the holo against the policy. With an input, this is one run as a container: dispatch the input, print the output and exit with the container's code, keeping the container until `rm` unless `--rm`. Without one, serve its view on a local port; a POST to `/_hologram/intent` dispatches one request. A holo that fails check is refused unless `--allow-unverified`, which warns on every start. |
| `prism-code rm <container>...`                                                                                                                                                                                                                                                                     | Remove containers, by id or unique id prefix. A running container is refused.                                                                                                                                                                                                                                                                                                                             |
| `prism-code init [<dir>] [--sdk-image <ref>]`                                                                                                                                                                                                                                                      | Scaffold a project: `prism.toml`, a language-1.2 model and its Lean workspace. With `--sdk-image`, also copy that image's `standards.lock` and write `prismpm.lock` (needs Docker). `npm create prism-code` runs the same command.                                                                                                                                                                        |
| `prism-code manifest [<dir>] [--target <target>]`                                                                                                                                                                                                                                                  | Check and lint the project's `prism.toml`, with the overlay for the target merged in, and print the application, the grant and the variables.                                                                                                                                                                                                                                                             |
| `prism-code providers <verb> [<dir>] [--target <target>] [--json]`                                                                                                                                                                                                                                 | `up` runs the `prism-provider-<type>` each capability in `prism.toml` declares and prints the variables it produced, and `down` releases them. Text output names them, and `--json` also prints their values. The capability set must allow the type and each variable. Experimental.                                                                                                                     |
| `prism-code vectors <app.holo>`                                                                                                                                                                                                                                                                    | Replay every acceptance vector the holo carries and exit 1 on a failure.                                                                                                                                                                                                                                                                                                                                  |
| `prism-code inspect <holo-or-container> [--format <path>]`                                                                                                                                                                                                                                         | Print what the holo says about itself, without running it, or a container's state, exit code, image digest and output.                                                                                                                                                                                                                                                                                    |
| `prism-code attest <app.holo> --predicate <file> --type <uri>`                                                                                                                                                                                                                                     | Sign an in-toto statement about the holo into its attestation section: keyless with an OIDC token, or with `--key`.                                                                                                                                                                                                                                                                                       |
| `prism-code verify-attestation <app.holo> --certificate-identity <id> --certificate-oidc-issuer <url>`                                                                                                                                                                                             | Check the holo's attestations against the signer you expect, or against `--key`.                                                                                                                                                                                                                                                                                                                          |
| `prism-code export <name@sha256:digest> [--out <dir>] [--tar <file>] [--project <dir>] [--json]`                                                                                                                                                                                                   | Write a release's six-file browser export or tarball, byte-checked against the build manifest, attestations beside.                                                                                                                                                                                                                                                                                       |
| `prism-code check <app.holo> [--policy <file>] [--json]`                                                                                                                                                                                                                                           | Judge the holo against a policy and print its verdict: the assurance level, whether the policy passed, and every reason. `--policy` takes a Rego file, the name of a shipped policy (`pure-only`, `provenance-only`) or a JSON file. Exit 1 when the policy denies, 2 when it cannot be parsed or evaluated. Without a holo, the deprecated spelling of `build --check`, removed in 0.4.0.                |
| `prism-code push <app.holo> <reference> [--key <file>] [--keyless] [--no-attestations] [--signing-config <file>] [--store <dir>] [--plain-http] [--json]`                                                                                                                                          | Put the holo in an OCI registry or a local store as a deterministic manifest, each attestation a referrer. With `--key` or `--keyless`, also sign a statement naming the manifest, so `cosign verify-attestation` passes on the same reference.                                                                                                                                                           |
| `prism-code pull <reference> [<out.holo>] [--policy <file>] [--key <file>] [--certificate-identity <id>] [--certificate-identity-regexp <re>] [--certificate-oidc-issuer <url>] [--type <uri>] [--trusted-root <file>] [--entries <n>] [--timestamps <n>] [--store <dir>] [--plain-http] [--json]` | Fetch a holo and write it only after its digests, archive, verdict and attestations pass; the signer flags are those of `verify-attestation`. A reference is `registry/repo:tag`, `@sha256:`, `@blake3:` or `dir://`.                                                                                                                                                                                     |
| `prism-code build [--check]`                                                                                                                                                                                                                                                                       | Build the project into a holo inside the SDK image the lockfile pins. With `--check`, validate the model and write nothing.                                                                                                                                                                                                                                                                               |
| `prism-code verify`                                                                                                                                                                                                                                                                                | Run verify in the SDK image the lockfile pins.                                                                                                                                                                                                                                                                                                                                                            |
| `prism-code conformance`                                                                                                                                                                                                                                                                           | Run the conformance suite in the SDK image the lockfile pins.                                                                                                                                                                                                                                                                                                                                             |

| Exit code | Name           | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0         | ok             | The verb did what you asked, or `check` reached a verdict the policy accepts.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 1         | vectors failed | At least one acceptance vector did not replay or the holo carries none, `verify-attestation` did not verify, `check` reached a verdict the policy rejects, or `pull` found a digest that does not match or a holo that fails verification and wrote nothing.                                                                                                                                                                                                                                      |
| 2         | refused        | The holo, capability file or manifest cannot be read or fails its checks, an identity check failed, a guest import, the holo's world or a provider is not granted, or a provider failed; or `check` reached no verdict: not a holo, an unreadable policy or an unknown format revision; or `push` or `pull` got no answer: an unreachable registry, refused credentials, a reference that does not exist or referrers that cannot be stored; or an export's bytes differ from the build manifest. |
| 3         | signing failed | `attest` could not sign, or the optional sigstore packages are not installed.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 10        | proof mismatch | `run` refused a holo for a proof reason. 11 is a world mismatch, 12 a determinism violation, 13 a replay error.                                                                                                                                                                                                                                                                                                                                                                                   |
| 64        | usage          | The arguments were wrong, or `prismpm.lock` is missing.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 69        | no Docker      | Docker is not installed or not on the PATH.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 70        | untyped        | Dispatch threw something untyped: a guest trap, or a bug in the runtime.                                                                                                                                                                                                                                                                                                                                                                                                                          |

Node.js 22 or later. build, verify and conformance also need Docker and a `prismpm.lock` in the current directory.
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
- `check`, `build`, `verify` and `conformance` run the project's SDK image, so they need Docker and a `prismpm.lock` in the current directory. Say so when Docker is missing instead of working around it.
- The docs say which release each feature needs. Read the release status page before you promise a feature.

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
There is no MCP server yet. This section is filled in when the Prism MCP server ships. Until then, use the commands above.
<!-- mcp:end -->
