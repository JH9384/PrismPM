# Docs generator

Generates the Reference and API tabs of the Prism docs, plus `llms.txt` and `llms-full.md`, into `docs/generated/`.
Nothing on a generated page is written by hand: tables come from the spec package's JSON Schemas and constants, signatures from type declarations, output blocks from executed examples, and the CLI page from a machine-readable description.
Design: [docs/proposals/300-docs-pipeline.md](../../docs/proposals/300-docs-pipeline.md).

Node 22. No dependencies: `prism-code` and `@prism-code/spec` are read from this repository.

```
node sdk/docs/generate.mjs                 write docs/generated/
node sdk/docs/generate.mjs --check         regenerate into a temp dir, diff, exit 1 naming each page that differs
node sdk/docs/generate.mjs --pin <commit>  pin the spec package at <commit>, then write
node sdk/docs/lint.mjs [path...]           vocabulary lint; default: docs/ minus the engineering records
node --test "sdk/docs/test/*.test.mjs"     the generator's own tests
```

## Sources

| Source | Where it is read from | Produces |
| --- | --- | --- |
| `@prism-code/spec` | `sdk/npm/spec` at the commit pinned in `spec.lock.json` | holo format, attestations, lockfile, manifest, spec package page, the declarations on the API pages |
| `prism-code` | `sdk/npm/prism-code` in this checkout | API signatures, the error code table, the executed examples |
| `Calculator.holo` | `sdk/npm/prism-code/fixtures` | the input every example runs against |
| `cli.json` | this directory | the CLI page and the exit codes |
| `pages.json` | this directory | page paths, titles, descriptions, next steps, status lines, `llms.txt` |

### The spec pin

The generator never reads the working tree's `sdk/npm/spec`.
It reads the spec at the commit recorded in `spec.lock.json`, fetching that commit by hash when the checkout does not have it, and caches the files under `.spec-cache/` (ignored by git).
This is why every spec-sourced page ends with `Generated from @prism-code/spec <revision> at <commit>`: the commit is a fact, not the checkout of the moment.

The pin today is the head of the `@prism-code/spec` branch, pull request 326, which has not merged yet.
The generator depends on that branch existing at the pinned commit; once 326 merges, `--pin` to the merge commit and the pages regenerate unchanged if the package did not.

When `sdk/npm/spec` is present in the working tree, `--check` also compares its digest with the pin.
A spec change without a re-pin fails CI with the pin named; `--pin <commit>` after committing the spec change regenerates the pages, and the pull request shows the diff.

### The CLI stand-in

`cli.json` is written by hand from the agreed verb list and flags.
It stands in for `prism --help --json` until the CLI emits its own description.
It is replaced, not edited, when that happens; the page's footer and status line say it is a stand-in.

## What runs today

Every example under `examples/` is executed on every generation, with `cwd` at the fixture directory and the bare specifiers `prism-code` and `@prism-code/spec` resolved to this repository through a module hook (`lib/register.mjs`), so the scripts read as they would in a project.
Standard output is the page's output block.
An example that exits non-zero fails the generation.

| Example | Page | Runs against |
| --- | --- | --- |
| `load.mjs` | api/load | `prism-code` 0.2.0, `Calculator.holo` |
| `dispatch.mjs` | api/dispatch | same |
| `acceptance.mjs` | api/history-and-replay | same |
| `three-calls.mjs` | api/index | same |
| `spec-constants.mjs` | api/spec-package | the pinned spec |

Pages whose example cannot run yet (`inspect`, `verify`, `instantiate`, `as-tool`, the typed errors, the manifest, the verify and testing packages) carry one generated status line from `pages.json` and the relevant declarations.
No prose stands in for a missing example.

## Page shape

Frontmatter `title` and `description`; a `Source:` line; task headings; tables with `Field | Type | Required | Constraint`; one code block per task followed by its captured output; `## Next steps`; a footer naming every source.

Schema tables carry constraints, not descriptions.
The schema descriptions are the spec author's prose and name internal tooling, which the vocabulary lint bans; the constraints are data.
Literal values, patterns, identifiers and file names are code spans.

## The vocabulary lint

`lint.mjs` applies the docs style guide's banned-word list (`lib/banned.mjs`) to Markdown prose and reports `file:line: word`.
Prose is every line outside a fenced code block with inline code spans removed.
Identifiers inside code are the sources' own names, not vocabulary; the only identifiers allowed in prose are the predicate type URIs and the site hostname.
Em dashes and emoji are reported on every line, code included.

By default it lints `docs/` except `docs/adr`, `docs/decisions`, `docs/proposals` and `docs/release`, the engineering records that cite issues and internal names by design.
`docs/generated/` is always covered.

## CI

`.github/workflows/docs-generate.yml` runs `--check`, the lint and the tests on every pull request and every push to main.
It fails on drift and names the page.
It does not commit regenerated output: main is unprotected, and a bot commit would hide drift instead of catching it.
Regenerate in the same pull request that changed a source.

## Layout

```
generate.mjs        entry: write, --check, --pin
lint.mjs            the vocabulary lint
spec.lock.json      the pinned spec commit, its content digest and format revision
cli.json            the CLI description stand-in
pages.json          the page list
examples/           the executed example scripts, shown verbatim on the pages
lib/spec.mjs        pinned checkout, digest, loading the spec module
lib/runtime.mjs     prism-code: types, version, error codes, the fixture
lib/examples.mjs    run one example and capture its output
lib/schema.mjs      JSON Schema to table rows
lib/dts.mjs         declarations out of .d.ts files
lib/markdown.mjs    frontmatter, tables, fences, footer
lib/pages/          one module per tab: reference, cli, api, llms
test/               node --test
```
