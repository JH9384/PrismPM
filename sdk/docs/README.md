# Docs generator

Generates the Reference and API tabs of the Prism docs, plus `llms.txt` and `llms-full.md`, into `build/docs/`.
Nothing on a generated page is written by hand: tables come from the spec package's JSON Schemas and constants, signatures from type declarations, output blocks from executed examples, and the CLI page from a machine-readable description.
Nothing the generator writes is committed: no pages and no pin.
Design: [docs/proposals/300-docs-pipeline.md](../../docs/proposals/300-docs-pipeline.md).

Node 22. No dependencies: `prism-code` and `@prism-code/spec` are read from this repository.

```
node sdk/docs/generate.mjs                 write the site to build/docs/ (ignored by git)
node sdk/docs/generate.mjs --out <dir>     write it somewhere else
node sdk/docs/generate.mjs verify          generate, run every example, lint every page; exit 1 naming each page that fails
node sdk/docs/changed.mjs <base> <head>    the pages that differ between two generated sites
node sdk/docs/lint.mjs [path...]           vocabulary lint; default: docs/ minus the engineering records
node --test "sdk/docs/test/*.test.mjs"     the generator's own tests
```

## Sources

| Source | Where it is read from | Produces |
| --- | --- | --- |
| `@prism-code/spec` | `sdk/npm/spec` in the checkout the generator runs in | holo format, attestations, lockfile, manifest, spec package page, the declarations on the API pages |
| `prism-code` | `sdk/npm/prism-code` in this checkout | API signatures, the error code table, the executed examples |
| `Calculator.holo` | `sdk/npm/prism-code/fixtures` | the input every example runs against |
| `cli.json` | this directory | the CLI page and the exit codes |
| `pages.json` | this directory | page paths, titles, descriptions, next steps, status lines, `llms.txt` |

### The spec comes from the checkout

The generator reads `sdk/npm/spec` from the working tree.
There is no pin and no `--pin` step: a page describes the spec of the checkout it was generated from, so a pull request that changes the spec changes no generated file.
This is what lets two pull requests that each add a schema merge without touching each other.

The spec package's entry point (`index.mjs`, `index.d.ts`) is itself generated from the files in the package and is not committed.
The generator builds it first (`sdk/npm/spec/scripts/build.mjs`), which writes only git-ignored files.
The schema and predicate tables on the spec package page come from the same discovery, so adding a schema adds its row without anyone editing a list.
They sit between `<!-- generated:schemas:begin -->` and `<!-- generated:schemas:end -->` markers (and `predicates` likewise).

Every spec page ends with `Generated from @prism-code/spec <revision> at <commit>`, where the commit is `git rev-parse HEAD` of the checkout.
In a pull request that is the merge commit CI built.

### The CLI stand-in

`cli.json` is written by hand from the agreed verb list and flags.
It stands in for `prism --help --json` until the CLI emits its own description.
It is replaced, not edited, when that happens; the page's footer and status line say it is a stand-in.

## What runs today

Every example under `examples/` is executed on every generation, with `cwd` at the fixture directory and the bare specifiers `prism-code` and `@prism-code/spec` resolved to this repository through a module hook (`lib/register.mjs`), so the scripts read as they would in a project.
Standard output is the page's output block.
An example that exits non-zero fails the pages that show it.

| Example | Page | Runs against |
| --- | --- | --- |
| `load.mjs` | api/load | `prism-code` 0.2.0, `Calculator.holo` |
| `dispatch.mjs` | api/dispatch | same |
| `acceptance.mjs` | api/history-and-replay | same |
| `three-calls.mjs` | api/index | same |
| `verify.mjs` | api/verify | `prism-code` source, `Calculator.holo` |
| `spec-constants.mjs` | api/spec-package | the spec in this checkout |

Pages whose example cannot run yet (`inspect`, `instantiate`, `as-tool`, the manifest, the verify and testing packages) carry one generated status line from `pages.json` and the relevant declarations.
No prose stands in for a missing example.

## Page shape

Frontmatter `title` and `description`; a `Source:` line; task headings; tables with `Field | Type | Required | Constraint`; one code block per task followed by its captured output; `## Next steps`; a footer naming every source.

Schema tables carry constraints, not descriptions.
The schema descriptions are the spec author's prose and name internal tooling, which the vocabulary lint bans; the constraints are data.
Literal values, patterns, identifiers and file names are code spans.
A schema's `title` is prose on the spec package page and is held to the lint.

## Verify

`verify` is the check CI runs.
It generates every page into a temporary directory, runs every example, and applies the vocabulary lint to every generated page.
It collects all failures rather than stopping at the first, and names each by page:

```
docs: api/load: example: example load exited with 1: ...
docs: reference/lockfile: lint: line 12, kappa: ...
docs: api/spec-package: generation: ...
```

An example that fails fails only the pages that show it.
The kinds are `example` (an example script exited non-zero), `generation` (a page generator threw) and `lint` (a banned word, em dash or emoji).

## The vocabulary lint

`lint.mjs` applies the docs style guide's banned-word list (`lib/banned.mjs`) to Markdown prose and reports `file:line: word`.
Prose is every line outside a fenced code block with inline code spans removed.
Identifiers inside code are the sources' own names, not vocabulary; the only identifiers allowed in prose are the predicate type URIs and the site hostname.
Em dashes and emoji are reported on every line, code included.

By default it lints `docs/` except `docs/adr`, `docs/decisions`, `docs/proposals` and `docs/release`, the engineering records that cite issues and internal names by design, and `docs/vocabulary.md`, which maps the docs' terms onto the repository's own names and so must name them.
The generated pages are linted by `verify`.

## CI

`.github/workflows/docs-generate.yml` runs on every pull request and every push to main:

1. the generator's tests,
2. `generate.mjs verify`,
3. `lint.mjs` over the hand-written docs,
4. `generate.mjs --out build/docs`, uploaded as the workflow artifact `docs-site`.

On a pull request it also checks out the base branch, generates its site, and runs `changed.mjs` on the two.
The pages that differ, with their diff, go to the job summary and to the artifact `docs-diff`.
The commit in each page's footer is ignored, so only a real change to a page shows.
It does not post a comment, because that needs `pull-requests: write`, and it does not commit anything: main is unprotected, and a bot commit would hide a failure instead of catching it.

## What remains to publish the site

The workflow produces the site; it does not publish it.
The site to publish to is `https://universal-coordinate-foundation.lovable.app/docs` (`site` in `pages.json`).
Three things are needed, none of them in this repository:

1. A decision on the mechanism. Either a deploy job here, added after `Upload the site` and restricted to `push` on main, or the hosting site pulling the artifact of the latest successful run of `docs generate` on main. GitHub requires a token even to download an artifact of a public repository.
2. The credential or repository setting that mechanism needs, which only the site's owner can create: a deploy key or token for the site's repository or storage, or GitHub Pages enabled with `pages: write` and `id-token: write` on that one job.
3. The site's side: it must read the output layout below.

The output layout is the contract: `api/*.md` and `reference/*.md`, one file per page with frontmatter `title` and `description`, served at the site path plus the file name without `.md` (`api/index.md` is served at `api`); `llms.txt` and `llms-full.md` at the root.
`build/docs/` after `node sdk/docs/generate.mjs` is exactly that tree, ready to copy.

## Layout

```
generate.mjs        entry: write the site, verify
changed.mjs         the pages that differ between two generated sites
lint.mjs            the vocabulary lint
cli.json            the CLI description stand-in
pages.json          the page list
examples/           the executed example scripts, shown verbatim on the pages
lib/spec.mjs        the spec in this checkout: build its entry point, load it, name the commit
lib/runtime.mjs     prism-code: types, version, error codes, the fixture
lib/examples.mjs    run one example and capture its output
lib/generate.mjs    render every page, collecting problems by page
lib/schema.mjs      JSON Schema to table rows
lib/dts.mjs         declarations out of .d.ts files
lib/markdown.mjs    frontmatter, tables, fences, footer
lib/pages/          one module per tab: reference, cli, api, llms
test/               node --test
```
