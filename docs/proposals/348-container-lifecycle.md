# Proposal 348: the container lifecycle

| | |
| --- | --- |
| Issue | [#348](https://github.com/UOR-Foundation/PrismPM/issues/348) |
| Milestone | M3 v0.6 Replay, capabilities, conformance |
| Status | Proposed, Experimental |
| Depends on | #346 (stakeholder views), #282 (`run` gated on `check`), #276 (typed errors) |
| Used by | #347 (developer surface), #350 (long-running holos) |

## Summary

One run of a holo is a container: an object with Docker's states (`created`, `running`, `exited`), a start and finish time, an exit code and the returned output, kept until removed.
The SDK has `prism.containers.run`, `create`, `start`, `get` and `remove`, and each container has `start`, `inspect` and `remove`.
`prism-code run <holo> <input>` is the same lifecycle with the record on disk, and `--rm` removes it on exit.
Exit codes come from one table, `EXIT_CODES` in `src/errors.mjs`, which the command line reuses.

This is the developer view of an instance (#346).
No model term, schema identifier or error code changes, and nothing that exists is renamed; that is #347.

## Decisions

### States

| Transition | When | Note |
| --- | --- | --- |
| none to `created` | `create` opened the image | An image that cannot be opened makes no container, and the call rejects, as `docker create` does. |
| `created` to `running` | `check` passed, or `allowUnverified` | `startedAt` is set. |
| `running` to `exited` | The guest returned or threw | `exitCode`, `finishedAt`, and `error` or `output` are set. |
| `created` to `exited` | `check` refused the holo | `startedAt` stays null: the guest never ran. |
| `exited` to `running` | `start` again | Runs again from the same input, as `docker start` does. |

The refused case is the one departure from Docker, which leaves such a container in `created` with an error.
Here `exited` is honest about the run being over, and a null `startedAt` says the guest never ran.

`start` resolves when the container has exited, not when it has started.
A one-shot guest has no detached form until #350, and code written in Docker's order still works.
A failed run is an exit code and never a rejection, so `run` always returns the container.
The rejections are about the call: the container is missing, or it was read back from a store and has no input to run again.

`--rm` and `rm: true` remove the container on exit whatever its code.
The object you hold keeps its result; `inspect()` rejects with `container.missing`, because the container is gone.

### The record

`inspect()` returns `prism/container/1`: `id`, `image` (`name`, `kind`, `digest`), `created`, `rm`, `state`, `verdict` and `output`.
`image.digest` is the archive fingerprint as `blake3:<hex>`, the same string as `verdict.holo`, and null for a closure.
`#347` owns the versioned view schemas, so this shape has no JSON Schema in `@prism-code/spec` yet.

The SDK keeps records in memory; `createPrism({ store })` takes another store.
The command line uses `fileContainerStore`: one JSON file per container in `$PRISM_HOME/containers`, by default `~/.prism/containers`, mode 0600 in a 0700 directory, written by rename.
A record holds the output and never the input, because an input can carry anything and a record outlives the run.
So a container read back from disk reports everything and cannot be started again.

A process that dies mid-run leaves a record that says `running`.
No command acts on that yet, and `ps` in #350 has to account for it.

### Exit codes

| Code | Source |
| --- | --- |
| 0 | Success. |
| 1, 2, 3 | The meanings `prism-code` already gave them: failed verdict or other typed error, refused artifact or no verdict, signing. |
| 10 to 13 | New: `ProofMismatchError`, `WorldMismatchError`, `DeterminismViolationError`, `ReplayError`. |
| 64 | `lock.*`, and a `policy.invalid` from a flag at the top of the command line. |
| 70 | Anything untyped: a guest trap, or a bug in the runtime. |

The table avoids 64 to 78 (BSD sysexits), and 125 and up (Docker and the shell), for typed errors.
`check` reports a verdict, so it keeps 0, 1, 2, and its contract in proposal 269 is unchanged.

A guest trap is 70 and not a new code, because the runtime cannot tell a trap in the guest from a bug in itself by the thrown value alone without wrapping every failure, and `container.error` already carries the `RuntimeError`.

### What this breaks

`prism-code run` used to exit 1 for every failed verdict (proposal 282).
It now exits with the code of the error that explains the verdict: still 1 for a provenance, document or policy reason, which is every holo today, but 10 for a proof reason and 2 for a world outside the grant.
A `VerificationError` with no verdict that reaches the top of the command line is 2, where it was 1.
Both are Experimental surfaces, and both are in the changelog.

### What stays out

`prism-code run <holo>` with no input still serves, and is not a container; `--rm` there is a usage error.
A long-running container needs a process to outlive the command and is #350, with `ps`, `stop`, `logs`, `exec`, `prism.containers.list`, and `run -d`.
This change adds the two verbs a kept record cannot do without: `prism-code inspect <container>` and `prism-code rm <container>`.
`create` and `start` are SDK-only: the command line does not keep the input a later `start` would need.

## Test plan

`sdk/npm/prism-code/test/containers.test.mjs` covers every state transition with a held dispatch, every row of the exit table, a run that fails `check`, a run with no verdict, dispatch throwing a typed error, a real guest trap, `--rm` and `rm: true`, the file store across clients, the same lifecycle through the command line, and the 0.2.0 calls.
It also holds the table in the docs page equal to `EXIT_CODES`.
