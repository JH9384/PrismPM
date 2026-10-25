# Proposal 265: `prism lock` and `prism update`

| | |
| --- | --- |
| Issue | [#265](https://github.com/UOR-Foundation/PrismPM/issues/265) |
| Milestone | M2 v0.5 Lock, check, proof |
| Status | Proposed, Experimental |
| Result schema | `prismpm/sdk-lock-change/1` (new) |
| Depends on | #264 (`prismpm/sdk-lock/3`, `build --update`) |

## Summary

Today the only way to write the pinned inputs of `prismpm.lock` is `prismpm build --update`, which also builds, and the only way to move the SDK image is `prismpm lock update`, which proposes a patch and applies nothing.
This proposal adds two verbs.
`lock` writes or refreshes the lock without building.
`update` moves the pins forward and prints the old and new digests.
Both rewrite `prismpm.lock` atomically and report what changed as one new closed contract, `prismpm/sdk-lock-change/1`.
The command names are the issue's.
The existing `lock check`, `lock migrate` and `lock update` subcommands are unchanged.

The CLI is still `prismpm`.
Read `prismpm lock` and `prism lock` as the same command ([vocabulary](../vocabulary.md)).

## Motivation

The issue gives the precedent: `nix flake lock` writes the lock for the inputs that are not pinned yet and leaves the ones that are, and `nix flake update` moves them forward.
npm has the same pair: `npm install` honors `package-lock.json` where it still resolves, and `npm update` moves it.
Without the pair, a reviewer who wants to refresh the lock after a model edit has to run a build, and a maintainer who wants a new SDK has to run `lock update`, read a patch, and apply it by hand.

### Goals

- `lock` brings the pins the project determines up to date, deterministically, and changes nothing that still resolves.
- `update` moves the pins that only a deliberate act should move, and shows exactly what moved.
- `update` prints old and new digests.
- A lock that cannot be resolved exits 2.
- The SDK fields keep their review step: a build never changes them.

### Non-goals

- Resolving "the latest SDK". PrismPM has no channel or index to ask, so `update` takes the image to pin from the user.
- Changing `lock update` and `lock migrate`, which stay proposal-only.
- Building anything, or skipping a build because the lock matches (a #264 follow-up).

## Proposal

### Commands

```text
prismpm lock [--check]
prismpm update [--toolchain REF [--standards-lock DIGEST]] [--dry-run]
```

`--toolchain` is the flag the docs describe for the SDK image; `--sdk-image` is accepted as an alias so `update` reads like `lock update --sdk-image`.
`--toolchain` takes an immutable manifest-list reference (`NAME@sha256:DIGEST`).
`--standards-lock` defaults to the digest of the project's `standards.lock`, which is what an SDK lock selects, so one flag is enough.

### Which pins each verb moves

The `inputs` object of #264 mixes two kinds of pin.
The project determines some: the model document digests, the spec digest, and the guest world.
The running PrismPM determines the others: the toolchain versions and the generator identities.

| Pin | `lock` | `update` | `update --toolchain` |
| --- | --- | --- | --- |
| `inputs.model`, `inputs.spec`, `inputs.world` | refreshed when they differ | refreshed | refreshed |
| `inputs.toolchain`, `inputs.generation` | pinned when the lock has no `inputs`; a difference is refused | moved | moved |
| `sdk_image`, `sdk_index`, `platforms`, `standards_lock`, `sdk_version` | never | never | replaced by the captured platform lock |

A refresh rewrites a pin only when its value differs, and `lock` run twice writes nothing the second time.
This is the reading closest to npm and Nix: `lock` fills in and repairs what the project says, `update` is the deliberate move.
`prismpm build --update` still rewrites all of `inputs`, as in #264; it is the one-step form for a developer who is building anyway.

A `/2` lock gains `inputs` and becomes `/3` under `lock` and under `update`.
A `/1` lock is refused and pointed at `lock migrate`.
`update --toolchain` on a project with no `prismpm.lock` creates it.
`lock` on a project with no `prismpm.lock` is refused: there is no SDK to pin inputs to, and the error names `update --toolchain`.

### `update --toolchain`

The platform lock of the new image comes from the same bounded metadata acquisition `lock update` uses: the OCI index, the two child manifests, configurations and terminal metadata layers, never a filesystem layer and never target code.
The captured lock must name exactly the requested image and standards lock, as `lock update` requires.
The SDK fields of the new lock replace the old ones and `inputs` is recomputed.

The toolchain pins of `inputs` come from the PrismPM that runs the command, which is the old SDK.
`update --toolchain` says so in `notes`, and one more `prismpm update` inside the new SDK image pins its toolchain.
Reading the versions out of the captured inventory would remove the second step, and is a follow-up once the inventory carries them as data.

### Output

Both verbs print one `prismpm/sdk-lock-change/1` value with `--json`, and the same facts as text otherwise.

```json
{
  "changed": true,
  "changes": [
    { "from": "1.97.0", "path": "/inputs/toolchain/rustc", "to": "1.97.1" },
    { "from": "sha256:…", "path": "/platforms/linux~1amd64/manifest_digest", "to": "sha256:…" }
  ],
  "command": "update",
  "dry_run": false,
  "lock_digest": { "from": "sha256:…", "to": "sha256:…" },
  "notes": [],
  "schema": "prismpm/sdk-lock-change/1",
  "sdk_image": { "from": "ghcr.io/acme/sdk@sha256:…", "to": "ghcr.io/acme/sdk@sha256:…" },
  "written": true
}
```

`changes` lists every pin that differs, by RFC 6901 path, in key order.
It covers `sdk_image`, `sdk_version`, `standards_lock`, each platform's `manifest_digest` and `inventory_digest`, and every leaf of `inputs`.
The bulky `sdk_index` and platform inventories are not listed; their digests are.
`lock_digest` is the SHA-256 of the lock file, the value provenance names as `urn:prismpm:sdk-lock`.
`written` is false for a dry run, for `lock --check`, and when nothing changed.

### Exit codes

| Condition | Code | Exit |
| --- | --- | --- |
| Done, or nothing to do | none | 0 |
| `lock` with no `prismpm.lock`, a legacy `/1` lock, or `update` with neither a lock nor `--toolchain` | `PP1101` | 2 |
| `update --toolchain` whose image or metadata cannot be resolved | `PP1101` | 2 |
| `lock --check` on a stale lock | `PP5401` | 4 |
| `lock` over a moved toolchain or generator pin | `PP5401` | 4 |
| The lock disagrees with the running SDK, or changed while the command ran | `PP5401` | 4 |

"A lock that cannot be resolved" is the issue's exit 2, and `PP1101` ("missing or invalid immutable lock") is the registered code that already maps to 2.
A stale lock is not unresolvable, so it keeps the exit class of every other `PP540x` authority failure, the same code `build` uses.
The documented v1.0 exit table (0 pass, 1 fail, 2 cannot verify) does not exist in the binary yet; the stand-in in `sdk/docs/cli.json` says `--check` fails and leaves the number to the binary.

### Writing

A rewrite stages a temporary file in the project root and renames it over `prismpm.lock` after confirming the bytes are still the ones it read, exactly as `build --update` does.
A first lock is created with a no-clobber rename, so a lock that appears meanwhile is never replaced.
Nothing else in the project changes, and a failed command leaves `prismpm.lock` byte for byte as it was.
`lock` and `update` load the model the way `check` does: in memory, with no LexLean build and nothing written to the build tree.

### Contract registration

`prismpm/sdk-lock-change/1` is a new closed contract: `schemas/sdk-lock-change.schema.json`, media type `application/vnd.prismpm.sdk-lock-change.v1+json`, 1 MiB and 4096 items, `exact-major`.
It is the result schema of `lock` and of the new `update` command in `model/commands.toml`.
`lock` and `update` are mutation class `explicit-update-only`, the class `template` already uses for a command with a read-only `check` and an explicit writing form; this answers the mutation-class question left open in the #264 proposal for these two commands.
It is not part of `@prism-code/spec`, which publishes the holo and lock documents, not CLI results.

## Alternatives

**`lock` moves every stale pin, like `build --update`.**
It would be the smaller change, and `update` would then differ from `lock` only by the SDK image.
It was rejected because a toolchain pin that moves is the event a reviewer most wants to see on purpose, and Nix and npm separate the two the same way.

**`update` resolves the newest SDK by itself.**
It would need a channel the project does not have, and a floating "latest" is the opposite of a lock.
The user names the image; the digest in the reference is what gets pinned.

**A new diagnostic for a stale lock.**
Question 1 of the #264 proposal.
A new code needs a conformance fixture, a register row and an exit mapping, and this change does not need it: `PP5401` already names the changed fields.
It stays open.

**Print only the changed digests as text.**
It is what the issue asks for, but a second, structured form costs one schema and lets CI and the offline verifier read the change without parsing prose.

## Unresolved questions

1. Should `update --toolchain` read the toolchain versions from the captured inventory, so one command is enough? It needs the inventory to carry versions as data.
2. Should `lock --check` have its own exit class, so CI can tell a stale lock from an authority failure without parsing the code?
3. Should `update` with no flag look at a registry for a newer SDK, once PrismPM publishes a channel?
4. `lock` and `update` take no `--release`. The pinned inputs do not depend on the system release today, so a flag would change nothing.
