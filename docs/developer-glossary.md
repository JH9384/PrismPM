# Developer view glossary

The developer view of #346: the words of the `prism-code` CLI, its SDK namespaces and their developer docs, each mapped onto the canonical term of the model, which does not change.
Generated from `bindings/src/Foundation/Views/V1/Developer.lex.tex` by `cargo xtask check-developer-view --write`; edit the model, not this file.

A Docker word is used only for its Docker meaning. Where Docker has a behaviour Prism lacks, the word waits for the issue that builds it.

| Developer view | Kind | Canonical term | Available |
|---|---|---|---|
| `image` | noun | holo | Now |
| `digest` | noun | archive fingerprint | Now |
| `layer digest` | noun | section fingerprint | Now |
| `config` | noun | model document | Now |
| `manifest` | noun | product release | Now |
| `builder image` | noun | SDK image | Now |
| `container` | noun | instance | Now |
| `recording` | noun | history | Now |
| `network` | noun | outbound capability grant | Now |
| `volume` | noun | store capability grant | Now |
| `run` | verb | instantiate and dispatch, one shot | Now |
| `rm` | verb | remove an exited instance | Now |
| `record` | verb | write the acceptance vectors as a history | Now |
| `ps` | verb | list running instances | Now |
| `stop` | verb | stop a running instance | After #350 |
| `logs` | verb | read an instance's output | Now |
| `ls` | verb | list the store capability grants | Now |
| `images` | verb | list the local store | Now |
| `tag` | verb | name a local store entry | Now |
| `rmi` | verb | remove a local store entry | Now |

## Other words of the surface

Docker's own verbs and the terms that are new with Prism (verify, proof, replay, world) keep their names.

`attest`, `auth`, `axioms`, `build`, `check`, `conformance`, `connect`, `containers`, `create`, `dev`, `df`, `disconnect`, `dispatch`, `errors`, `events`, `export`, `export-browser`, `fromKey`, `generate`, `get`, `identities`, `images`, `info`, `init`, `inspect`, `keyless`, `list`, `lock`, `login`, `logout`, `manifest`, `mcp`, `networks`, `open`, `providers`, `prune`, `pull`, `push`, `remove`, `replay`, `setup`, `start`, `stores`, `system`, `template`, `usage`, `vectors`, `verify`, `verify-attestation`, `version`, `volumes`

## Deprecated aliases

Each alias prints one warning that names the new term, and is removed in the release shown.

| Kind | Old | New | Removed in |
|---|---|---|---|
| verb | `history` | `record` | 0.9.0 |
| flag | `holo` | `image` | 0.9.0 |
