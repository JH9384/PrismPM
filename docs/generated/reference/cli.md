---
title: CLI reference
description: Every prism verb, its flags, its exit codes and its usage.
---

Source: `sdk/docs/cli.json` 2026-10-23, the stand-in for `prism --help --json`.

`prismpm` is an alias of `prism` and is kept through every 1.x release.

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

Compile the model into a holo inside the pinned toolchain image, record provenance and the proof attestation, and cache the result by spec digest.

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
| `--port <n>`         | none               | Serve the instance over HTTP instead of dispatching once.     |

```bash
prism run calculator@sha256:3f9c --input '{"op":"add","a":2,"b":3}'
```

### dev

Watch the model, rebuild and re-check on every change, and serve a local studio with Check and Replay tabs.

```bash
prism dev [flags]
```

| Flag              | Default            | Meaning                              |
| ----------------- | ------------------ | ------------------------------------ |
| `--port <n>`      | 4100               | Studio port.                         |
| `--no-open`       | off                | Do not open the studio in a browser. |
| `--policy <file>` | the default policy | Policy the Check tab judges against. |

```bash
prism dev
```

### replay

Re-execute a recorded history against the current build and fail on the first divergence.

```bash
prism replay <history> [flags]
```

| Flag           | Default           | Meaning                                                  |
| -------------- | ----------------- | -------------------------------------------------------- |
| `--holo <ref>` | the current build | Which holo to replay against.                            |
| `--all`        | off               | Continue past the first divergence and report every one. |

```bash
prism replay history/2026-10-23.jsonl
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

| Flag                      | Default    | Meaning                  |
| ------------------------- | ---------- | ------------------------ |
| `--out <dir>`             | generated/ | Output path.             |
| `--lang <js,rust,python>` | all three  | Which bindings to write. |

```bash
prism generate
```

### lock

Write or refresh the lockfile from the current toolchain image, model and inputs.

```bash
prism lock [flags]
```

| Flag      | Default | Meaning                                           |
| --------- | ------- | ------------------------------------------------- |
| `--check` | off     | Exit 1 when the lockfile is stale. Write nothing. |

```bash
prism lock
```

### update

Bump the pinned toolchain image and print the old and new digests.

```bash
prism update [flags]
```

| Flag                | Default         | Meaning                                        |
| ------------------- | --------------- | ---------------------------------------------- |
| `--toolchain <ref>` | the current 1.x | Toolchain image to pin.                        |
| `--dry-run`         | off             | Print the change without writing the lockfile. |

```bash
prism update
```

## Next steps

- [Manifest reference](/docs/reference/manifest)
- [Errors reference](/docs/reference/errors)
- [Lockfile reference](/docs/reference/lockfile)

Generated from sdk/docs/cli.json 2026-10-23 (stand-in for prism --help --json).
