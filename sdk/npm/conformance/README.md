# @prism-code/conformance

The suite every Prism runtime runs in CI.
It checks that a runtime reads the `.holo` format and keeps the runtime contract, in any language, through a small program you write called a shim.

The results become [COMPLIANCE.md](../../../COMPLIANCE.md), a matrix of feature by runtime.
[CONFORMANCE.md](../../../CONFORMANCE.md) is a different register: the SDK capabilities the Rust tests cover.

The design and what it leaves out are in [docs/proposals/287-conformance.md](../../../docs/proposals/287-conformance.md).
Everything here is Experimental until the v0.6 freeze ([STABILITY.md](../../../STABILITY.md)).

## Run it

Node 22 or later. No dependencies.

```bash
node sdk/npm/conformance/bin/prism-conformance.mjs run --runtime js
```

```text
js: prism-code 0.3.0
pass            capabilities.none.denies-everything
...
xfail           replay.history.unchanged  #284: Histories and replay are not on main yet; ...

121 checks: 116 pass, 0 fail, 5 xfail, 0 unexpected pass, 0 n/a
PASSED
```

Exit codes: 0 passed, 1 a check failed, the matrix is stale or the gate refused, 2 the suite could not run, 64 bad usage.

| Command | What it does |
| --- | --- |
| `run --runtime <name> [-- <shim command...>]` | Run the suite. A registered runtime needs no command. Also `--declaration <file>`, `--out <file>`, `--only <id or prefix>`, `--timeout <ms>`, `--json`. |
| `matrix [--write \| --check]` | Render `COMPLIANCE.md` from every registered runtime. `--results <dir>` reads saved runs instead of running the shims. |
| `gate --base <commit> --head <commit>` | Judge a format change. See [the gate](#the-format-change-gate). |
| `list` | Print every check id. |
| `corpus --out <dir>` | Write every archive of the corpus, to read while you write a shim. |
| `corpus --update-lock` | Pin the corpus after you change or add a recipe. |

## How it fits together

A scenario is data, not code: a file in `scenarios/` lists checks, and each check names an operation, an input and what the answer must be.
The harness is JavaScript, but a runtime under test never runs any of it.
The harness writes each archive to a temporary file and calls your shim once per check.

```text
scenarios/*.json + corpus  ->  harness  ->  your shim  ->  your runtime
                                  |
                                  v
                    results  ->  COMPLIANCE.md
```

## The shim contract

The contract is `prism/conformance-shim/1`.
A shim is any program that does these four things:

1. It reads one JSON document on stdin, to end of file.
2. It writes one JSON document on stdout. Anything for a person goes to stderr.
3. It exits 0 whenever it answered, including when the runtime refused the request.
4. It handles one request per process, and answers within 30 seconds.

A non-zero exit, output that is not JSON, or a timeout means the shim broke.
That fails the check, and no declaration can excuse it.
A refusal by the runtime is an answer, not a broken shim.

### The request

```json
{
  "contract": "prism/conformance-shim/1",
  "op": "verify",
  "archive": "/tmp/prism-conformance-x/footer-flipped.holo",
  "input": { "policy": { "minimum": "P1" } }
}
```

`archive` is an absolute path, and only the operations marked below receive it.
`input` is always an object.
Bytes in a request and an answer are lowercase hex.
Environment variables a check sets arrive as the process environment; every other `PRISM_*` variable is removed first.

### The answer

There are three shapes.

```json
{ "ok": true, "result": { } }
```

```json
{ "ok": false, "error": { "code": "archive.magic", "check": "...", "diagnostic": "...", "details": { }, "verdict": { } } }
```

```json
{ "ok": false, "unsupported": "a sentence saying what is missing" }
```

Only `error.code` is required.
`check`, `diagnostic`, `details` and `verdict` are present when the runtime's error has them.
A message may be included for the person reading the log, and is never compared.
`unsupported` means the runtime has no such operation yet, and counts as a failed check, so you can start with one operation and declare the rest.

An answer may hold more than a check asks for.
The checks compare what they name and ignore the rest.

### The operations

| `op` | Archive | Input | `result` |
| --- | --- | --- | --- |
| `describe` | no | none | `contract` (required, must be `prism/conformance-shim/1`), `name`, `version`, `revisions`. Called once, before anything else. |
| `load` | yes | `capabilities`, `capabilitySet`, both optional | `kind`, `name`, `verified`, `fingerprint`, `limits` (`request`, `response`, `guestAllocation`), `vectors` (a count), `world` (`contract`, `within`, `pure`, `effects`), `capabilities` (`set`, null when no file was given) |
| `verify` | yes | `policy`, optional; `throw`, optional | A `prism/verdict/1` object. With `throw: true`, a failed verdict is the error that explains it, carrying the verdict. A verdict is always checked against the schema. |
| `inspect` | yes | none | A `prismpm/holo-inspection/1` object |
| `dispatch` | yes | `requests`, an array of hex | `responses`, one per request, in order: `{ "hex": "..." }`, or `{ "error": { "code": "..." } }` when that request was refused |
| `acceptance` | yes | none | `total`, `passed` |
| `capabilities` | no | `capabilities`, `capabilitySet`, `queries` and `asserts`, each a list of `{ kind, resource }`; all optional | `set`, and `answers`, one boolean per query. An assert that is denied is the error. |

`capabilities` in an input is the capability file, as a JSON value or as text.
Text lets a check hand a runtime a file that is not JSON.

Error codes and verdict check ids are compared exactly, so a runtime in another language reports the same `archive.magic` and `verification_failed` as this one.
The JavaScript shim, [`prism-code/conformance/shim.mjs`](../prism-code/conformance/shim.mjs), is the worked example, about a hundred lines.

## Add a runtime

1. Write a shim. Start with `describe` and answer `unsupported` to the rest.
2. Run it: `prism-conformance run --runtime rust -- ./target/debug/prism-shim`.
3. Write a declaration of what fails today, below, and run again with `--declaration`.
4. Register the shim in `runtimes.json`, with its command and declaration, relative to the repository root.
5. Add a step to the `suite` job in `.github/workflows/npm-conformance.yml` that builds the shim and writes `results/<name>.json`.
6. Run `matrix --write` and commit `COMPLIANCE.md`. The column changes from `N/A` to what your runtime measured.

A registered runtime with no results stops the matrix, so a column cannot go blank unnoticed.

## Expected failures

A runtime declares its gaps in `prism/conformance-declaration/1`.

```json
{
  "schema": "prism/conformance-declaration/1",
  "xfail": { "digests.pin.one-of-two-wrong": "Checks only sha256 so far; tracked in #999." },
  "notApplicable": { "dispatch": "This runtime only reads archives." }
}
```

Every entry needs a reason, and an entry naming a check or feature that does not exist stops the run.

| Status | Meaning | The run |
| --- | --- | --- |
| `pass` | It ran and matched. | passes |
| `fail` | It ran and did not match, nothing declared that, or the shim broke. | fails |
| `xfail` | It failed as declared, or it is a placeholder nobody can run yet. | passes |
| `unexpected-pass` | It was declared to fail and it passed, so the gap closed. | fails until you remove the entry |
| `n/a` | Its feature is declared not applicable. It did not run. | passes |

## The matrix

`COMPLIANCE.md` is generated, and CI fails when the committed copy differs from what the suite generates.
Run this and commit the result:

```bash
node sdk/npm/conformance/bin/prism-conformance.mjs matrix --write
```

| Cell | Meaning |
| --- | --- |
| `+` | Every check of the feature passed. |
| `-` | At least one failed as declared, or is a placeholder. |
| `N/A` | Nothing was measured: the runtime has no shim, or declares the feature does not apply. |

The file holds no time, commit or version, so it changes only when a result or a check changes.
Only a run that passed, over the whole current suite, can be published.

## Add a scenario

Add a check to the feature's file in `scenarios/`, or add a file for a new feature; one file is one row of the matrix.

```json
{
  "id": "load.refuse.bad-magic",
  "title": "A file that does not start with HOLO is refused.",
  "op": "load",
  "archive": "bad-magic",
  "expect": { "ok": false, "error": { "code": "archive.magic" } }
}
```

An id is dotted lowercase, starts with its feature, and never changes meaning: declarations and the matrix refer to it.
To change what a check asks, give it a new id.

An expectation is a subset, so members it does not name are free. Arrays match whole unless an operator says otherwise.

| Operator | Means |
| --- | --- |
| `{ "$contains": [a, b] }` | The array holds an element matching each. |
| `{ "$excludes": [a] }` | The array holds no element matching it. |
| `{ "$absent": true }` | The member is missing or null. |
| `{ "$utf8": "text" }` | The hex of these bytes, in a request or an answer. |
| `{ "$zeros": 53 }` | The hex of this many zero bytes. |

`"expect": { "anyOf": [...] }` accepts any of several answers. Use it only when the contract allows both.
Pin a fact from its source, such as ADR-015 for a digest, not from what a runtime printed.

A new archive is a recipe in `src/corpus.mjs` plus `corpus --update-lock`.
Every archive derives from `corpus/Calculator.holo`, the same bytes as the `prism-code` fixture, and the lock pins each result.

A placeholder names work that is not on main yet. It has an issue and a reason, reports `xfail` for every runtime, and never runs:

```json
{ "id": "replay.history.unchanged", "title": "...", "placeholder": { "issue": 284, "reason": "..." } }
```

## The format-change gate

A change to the `.holo` format cannot merge without a scenario.
`.github/workflows/conformance-gate.yml` runs on every pull request and compares the change with the rules in `format-gate.json`, which map format files to the scenario files that cover them.
The format files are the spec package's schemas, constants and worlds, and the Rust writer.

When your change touches a format file, do one of these:

1. **Add or change a check** in a scenario file the rule names, in the same pull request. The failure message names them. The check should fail without your change. This is the normal case.
2. **Exempt the file**, only when the format truly did not change, such as a refactor of the writer that leaves every byte alone. Add an entry to `exemptions` in `format-gate.json`, in the same pull request:

   ```json
   { "files": ["crates/prismpm/src/holo/archive.rs"], "reason": "A rename inside the writer; the golden bytes did not move." }
   ```

Whitespace, a title, a placeholder or a removed check does not satisfy a rule, because none of them tests anything.
An exemption counts only in the change that adds it, and it stays in the file as the record.
Rules are read from the base commit, so a change to them applies to the next pull request and not to the one making it.

Run it yourself before you push:

```bash
node sdk/npm/conformance/bin/prism-conformance.mjs gate --base origin/main --head HEAD
```

The check is named `A format change needs a scenario`.
It blocks a merge only once it is a required status check in the repository's ruleset.
