# Proposal 300: docs generated from the spec and the CLI, examples executed, claims bound

| | |
| --- | --- |
| Issues | [#300](https://github.com/UOR-Foundation/PrismPM/issues/300), [#327](https://github.com/UOR-Foundation/PrismPM/issues/327), [#328](https://github.com/UOR-Foundation/PrismPM/issues/328) |
| Milestone | M4 v1.0-beta.1 Freeze, ship, docs |
| Status | Proposed; generation and storage revised by [#340](https://github.com/UOR-Foundation/PrismPM/issues/340) |
| Depends on | #263 (`@prism-code/spec`, PR #326), the CLI verbs (#270 and M3), the conformance suite (#287) |

## Summary

The Reference and API tabs of the docs are generated, never written by hand.
A generator reads the spec package, the CLI's machine-readable description and the reference application.
It writes one Markdown page per topic, plus `llms.txt` and `llms-full.md`.
Every code block on a generated page is executed in CI against the reference holo.
The captured output becomes the output block.
A second stage checks hand-written guides.
Each claim cites a conformance check id, and a lint enforces the vocabulary.
Nothing generated is committed. CI generates the docs from the checkout, fails when a page cannot be generated, an example fails or the lint fails, and names the page.

## Motivation

Hand-written reference pages drift from the code the day they ship.
The v1.0 draft already shows this.
It invents a seven-kind section table with 50-byte entries.
The spec package says eight rows of 24 bytes, with kinds 15, 8, 14 and 16.
A generator that reads the spec cannot make that mistake.
Readers and agents also need to know which statements are backed by evidence.

### Goals

- Every Reference and API page comes from a named source, with no hand-written body text.
- Every example runs in CI, and its output block is the captured output.
- Changing the spec or the CLI so that a page cannot be generated, an example fails or the lint fails fails CI and names the page.
- A pull request changes no generated file, so two pull requests that change the spec never conflict on the docs.
- Guides keep hand-written prose, but every product claim resolves to a passing check.
- `llms.txt`, `llms-full.md` and per-page Markdown are generated outputs.
- No manual publish step exists anywhere.

### Non-goals

- Proving that prose means what it says. Nothing here does that.
- Generating Get started or Guides prose.
- Choosing the site framework. The site consumes Markdown with frontmatter.
- Rust and Python examples before those runtimes exist.

## Proposal

### Sources of truth, in order of authority

1. `@prism-code/spec` in `sdk/npm/spec/`: JSON Schemas, type declarations, world files, `FORMAT_REVISION`, the predicate registry.
2. The CLI description from `prism --help --json`: every verb with flags, defaults and exit codes.
3. The reference application's examples: `Calculator.holo` and its acceptance examples.
4. The conformance results: check ids with pass or fail, from the suite in #287.

A higher source wins on conflict.
The generator never reconciles sources by hand.

Until `prism --help --json` exists, `sdk/docs/cli.json` is the stand-in.
It is written by hand from the agreed verb list and flags.
It is replaced, not edited, once the CLI emits its own description.

### What is generated and what stays hand-written

| Tab | Pages | Body |
| --- | --- | --- |
| Get started | introduction, quickstart, core concepts | hand-written, claims bound |
| Guides | every guide | hand-written, claims bound |
| Reference | holo format, attestations, manifest, lockfile, errors, CLI, policy | generated |
| API | one page per export, plus package pages | generated |
| Agent index | `llms.txt`, `llms-full.md` | generated |

### The page model

Every generated page has the same shape.

- Frontmatter `title` of two to four words and `description` of one sentence.
- One opening sentence taken from the source's own description field.
- Task-shaped `##` headings.
- Tables built from schemas, one row per property, with type, required and meaning.
- One copy-paste block per task, followed by its captured output.
- `## Next steps` with two or three links from the page list.
- A footer line: `Generated from <source> <revision> at <commit>`.

## Design details

### The executable-example rule

Every code block with an output block is an example file the generator runs.
It runs under Node 22 against the reference holo through `prism-code`.
Standard output is captured and written as the output block.
A diff between committed and captured output fails the build.
A block that cannot run today is never shown as working.
Its page carries one generated status line instead, naming what it waits on.
A docs example that is not an example file is a build error.

Today `load`, `dispatch` and `acceptance` run against `Calculator.holo`.
Every other API page is emitted from the spec's type declarations with the status line.

### Claim binding and the vocabulary lint (#327)

This is the second stage of the same pipeline.
A guide sentence that states product behaviour ends with a reference such as `[check: VR-12]`.
The build resolves every id against the conformance results.
A missing id or a red check fails the build and names page and sentence.
The resolved ids are emitted as page metadata, so agents can read them.

The vocabulary lint runs over everything under `docs/`.
It fails on any banned word and reports file and line.
The banned list is the docs style guide's list: internal project names, digest nicknames, tooling names.
It also fails on a verb, flag, export or manifest key absent from the sources.

### llms.txt and per-page Markdown

`llms.txt` is generated from the page list: one line per page, with URL and description.
`llms-full.md` concatenates the generated pages in page-list order.
Each page's Markdown is the file the generator wrote, served at the page URL plus `.md`.

### Three layers of verification, stated honestly

| Layer | What is checked | How |
| --- | --- | --- |
| Consistency | Generated text matches the spec and the CLI description. | The pages are generated from them in the same checkout, so they cannot differ. |
| Execution | Every shown example runs and prints what is shown. | Run in CI and compare captured output. |
| Evidence | Every guide claim cites a check that passes. | Resolve ids against conformance results. |

Prose meaning is never proved.
A sentence can cite a passing check and still mislead.
The docs say so on the page that explains verification.

### Automation

The generator lives in `sdk/docs/`.
It needs Node 22 and no dependencies beyond `prism-code` and the spec package.
It reads the spec from the sibling path `sdk/npm/spec/` in the checkout it runs in, not a vendored copy and not a pinned commit.
A vendored copy would be a second source that can drift.
A pin is a second source too, and it made every spec pull request edit the same file.
Nothing it writes is committed: no pages and no pin.

```
node sdk/docs/generate.mjs [--out <dir>]   write the site (default build/docs, ignored by git)
node sdk/docs/generate.mjs verify          generate, run every example, lint every page; exit 1 naming the page
node sdk/docs/changed.mjs <base> <head>    the pages that differ between two generated sites
```

`verify` generates every page into a temporary directory and runs every example against `Calculator.holo`.
It then applies the vocabulary lint to every generated page.
It collects failures instead of stopping at the first, and names each one by page: `api/load: example: ...`, `reference/lockfile: lint: line 12, ...`.
An example that fails fails only the pages that show it.

The workflow `docs-generate.yml` runs on every pull request and every push to main.
It runs the generator's tests, `verify`, and the lint of the hand-written docs.
It uploads the generated site as the workflow artifact `docs-site`.
On a pull request it also generates the base branch's site and writes the pages that differ, with their diff, to the job summary and the artifact `docs-diff`.
The footer commit of each page is ignored in that comparison, so only a real change shows.
A comment on the pull request would need `pull-requests: write`, which the workflow does not hold.
Nothing is committed back: main is unprotected, and a bot commit would hide a failure instead of catching it.

The site is to deploy from the generator's output on every push to main, with no manual step.
The workflow produces that output as the `docs-site` artifact of the push and stops there: it holds no deploy credential.
Connecting the hosting site to the artifact is a configuration step outside this repository (see `sdk/docs/README.md`).

### Why nothing is committed (issue #340)

Until #340 the pages lived in `docs/generated/` and the spec was pinned in `sdk/docs/spec.lock.json`.
Every pull request that touched the spec regenerated the same pages and rewrote the same pin.
On 2026-10-24 six such pull requests could not land independently and had to be combined by hand.
A page is a function of the checkout, so storing it adds a second copy that can only drift or conflict.
Reviewers still see what a change does to a page through the `docs-diff` artifact and the job summary.

### Path to #328

Later the docs site becomes a Prism application built by `prism build`.
The generator's output becomes the model's input, and each page a rendered module.
Each page then carries an attestation a reader verifies like any holo.
Nothing here blocks that, because pages are already deterministic outputs of named sources.

### Test plan

- Unit tests with `node --test` for schema-to-table, page rendering and the footer.
- A test that breaks the spec in a temp copy and expects `verify` to fail naming the page whose example it breaks.
- A test that plants a banned word in a page and expects `verify` to name the page and the line.
- A test that asserts no generated page and no pin is committed.
- A test that plants a banned word and expects the lint to report file and line.
- A test that runs the three executable examples and compares their output blocks.
- CI runs all of these on Ubuntu with Node 22.

### Graduation criteria

- Reference and API tabs on the site come only from the generator.
- Every example runs green in CI.
- A deliberate spec change that breaks a documented example fails CI with the page named.
- `prism --help --json` replaces `cli.json`.
- Guides build with zero unresolved claims and zero lint hits.

## Precedent

- Docker generates its CLI reference from YAML the CLI emits.
- Stripe generates its API reference and snippets from its API description.
- Rust doctests execute every example in documentation.
- This repository already renders its conformance page from claim registers.

## Alternatives

- Hand-written reference with a review checklist. Rejected: the draft already drifted.
- Commit the generated pages. Chosen first, rejected by #340: every spec pull request edits the same files, so they cannot land independently. Reviewers see page diffs through the CI summary instead.
- Commit regenerated output from CI on main. Rejected: it hides drift on an unprotected branch.
- Vendor the spec into `sdk/docs/`. Rejected: two copies of one source.

## Prior art

- OpenTelemetry's spec compliance matrix links statements to implementations.
- Vale lints prose against a vocabulary.
- TypeDoc and rustdoc generate API pages from type declarations.

## Unresolved questions

1. The claim reference syntax in Markdown, and how it renders.
2. Whether `policy.md` waits for the policy issue or ships with a status line.
3. Where the conformance results file lives before #287 lands.
4. How the hosting site reads the `docs-site` artifact: pulled by the host, or pushed by a deploy job with a credential the repository does not hold yet.
