# Docs generator

Builds the whole Prism docs site into `build/docs/`: the Reference and API pages it generates, the hand-written pages under [`docs/site/`](../../docs/site), `llms.txt` and `llms-full.md`.
Nothing on a generated page is written by hand: tables come from the spec package's JSON Schemas and constants, signatures from type declarations, output blocks from executed examples, and the CLI page from a machine-readable description.
Nothing the generator writes is committed to main: no pages and no pin.
On every push to main, CI publishes the built site to the `docs-site` branch, which the hosting site reads (see [The docs-site branch](#the-docs-site-branch)).
Design: [docs/proposals/300-docs-pipeline.md](../../docs/proposals/300-docs-pipeline.md).

Node 22. No dependencies: `prism-code` and `@prism-code/spec` are read from this repository.

```
node sdk/docs/generate.mjs                 write the site to build/docs/ (ignored by git)
node sdk/docs/generate.mjs --out <dir>     write it somewhere else
node sdk/docs/generate.mjs verify          build, run every example, check and lint every page; exit 1 naming each page that fails
node sdk/docs/changed.mjs <base> <head>    the pages that differ between two generated sites
node sdk/docs/publish.mjs <site> --commit <sha> [--previous <dir>]
                                           stage a built site as the docs-site tree; print changed=true|false
node sdk/docs/lint.mjs [path...]           vocabulary lint; default: docs/ minus the engineering records
node --test "sdk/docs/test/*.test.mjs"     the generator's own tests
node sdk/docs/skill.mjs                    rebuild the generated blocks of skills/prism/SKILL.md
node sdk/docs/skill.mjs --check            fail when a block is stale or the skill names a command that does not ship
node sdk/docs/skill.mjs smoke              install prism-code from npm and run every command the skill tells an agent to try
```

## Sources

| Source | Where it is read from | Produces |
| --- | --- | --- |
| `@prism-code/spec` | `sdk/npm/spec` in the checkout the generator runs in | holo format, attestations, lockfile, manifest, spec package page, the declarations on the API pages |
| `prism-code` | `sdk/npm/prism-code` in this checkout | API signatures, the error code table, the executed examples |
| `Calculator.holo` | `sdk/npm/prism-code/fixtures` | the input every example runs against |
| `cli.json` | this directory | the CLI page and the exit codes; the verbs and flags a narrative page may show |
| `pages.json` | this directory | the page list in site order: every page's path, and for a generated page its title, description, `available_in`, next steps and status line; `llms.txt` |
| narrative pages | `docs/site/**/*.md` | Get started, Guides, SDKs, Changelog, and the policy and release status reference pages |
| `release-status.json` | `docs/site/` | the releases every `available_in` must name, and the tables of the release status page |

### Narrative pages

The hand-written pages live in `docs/site/` at the path they have on the site, so `docs/site/guides/ship.md` is `guides/ship`.
Each one is listed in `pages.json` as `{ "path": ..., "narrative": true }`; its title, description and `available_in` are its own frontmatter.
A narrative page must not exist at a generated page's path: the generated page wins, and the build names the copy to delete.
A file in `docs/site/` that is not in the list, or a listed page with no file, fails the build.

The generator fills three things in a narrative page and leaves the rest as written:

| In the source | Becomes |
| --- | --- |
| `{{FORMAT_REVISION}}` | `FORMAT_REVISION` from the spec in this checkout |
| `{{example:<name>}}` | the example script from `examples/` and its captured output, as on the API pages |
| `<!-- generated:distribution -->`, `releases`, `features` | the matching table from `release-status.json`, between `begin` and `end` markers |

Any other `{{...}}` fails the build, so a typo cannot ship.

### available_in and release-status.json

Every page, narrative and generated, has frontmatter `title`, `description` and `available_in`, and nothing else.
`available_in` is the first release in which everything the page shows works as shown.
It must be the `id` of a release in `docs/site/release-status.json`; the build rejects any other value and names the page.
It is written quoted, `available_in: "1.0"`, because YAML reads an unquoted `1.0` as the number 1.
`release-status.json` is the one place that says what has shipped: its releases, what is published today and the feature list are rendered into `reference/release-status`, the changelog must have one entry per release under its title, and the file itself is published at the site root for the hosting site to read.
To move a feature, edit that file.

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
| `three-calls.mjs` | api/index, sdks/typescript | same |
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
It builds every page into a temporary directory, runs every example, checks every page against the site contract, and applies the vocabulary lint to every page.
It collects all failures rather than stopping at the first, and names each by page:

```
docs: api/load: example: example load exited with 1: ...
docs: reference/lockfile: lint: line 12, kappa: ...
docs: api/spec-package: generation: ...
```

An example that fails fails only the pages that show it.
The kinds are:

| Kind | What failed |
| --- | --- |
| `example` | an example script exited non-zero |
| `generation` | a page generator threw |
| `source` | a narrative file is missing, unlisted, duplicates a generated page, or has an unknown token; a changelog heading is not a release |
| `frontmatter` | `title`, `description` or `available_in` is missing, `available_in` is not a release, or another key is present |
| `link` | a link is not a `/docs/...` path of a page on the site |
| `command` | a `prism` line in a `bash` block uses a verb or flag `cli.json` does not have |
| `lint` | a banned word, em dash or emoji |

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
4. `generate.mjs --out build/docs`, uploaded as the workflow artifact `docs-site`,
5. on a push to main only, and only when steps 1 to 4 pass, the `publish` job, which updates the `docs-site` branch.

On a pull request it also checks out the base branch, generates its site, and runs `changed.mjs` on the two.
The pages that differ, with their diff, go to the job summary and to the artifact `docs-diff`.
The commit in each page's footer is ignored, so only a real change to a page shows.
It does not post a comment, because that needs `pull-requests: write`, and it never commits to main: a bot commit there would hide a failure instead of catching it.

## The agent skill

`skills/prism/SKILL.md` is the Agent Skill that teaches an agent Prism in Docker's words: install `prism-code`, load, run, inspect and verify a holo, and where these docs and `llms.txt` live.
It is committed, because an agent installs it from the repository with `npx skills add`, and it is hand-written prose around four blocks the generator owns, each between `<!-- generated:<name>:begin -->` and `:end` markers: the command table and exit codes (from `prismCode` in `cli.json`), the executed three-call example, the commands to try, and the docs links (from `pages.json`).
The `<!-- mcp:begin -->` spot is left for the MCP section.

`prismCode` in `cli.json` lists the `prism-code` verbs that ship today. A test compares them with the command's own `--help`, so they cannot drift from the binary, and the CLI reference renders them above the `prism` verbs, which have not shipped.
`skill.mjs --check` fails when a block is stale, and when the skill:

- names a `prism-code` verb or flag `prismCode` does not list, or any `prism` or `prismpm` command;
- links a page the site does not have, or has frontmatter other than `name` (the directory's name) and `description`;
- breaks the vocabulary lint.

The same check runs on the narrative pages: a `prism-code` line in a `bash` block must use a listed verb and flag.
`.github/workflows/agent-skill.yml` installs the skill with `npx skills add` from this checkout and from its GitHub source on a clean runner, compares the installed file with the repository's, and runs `skill.mjs smoke`.

## The docs-site branch

The hosting site at `https://universal-coordinate-foundation.lovable.app/docs` (`site` in `pages.json`) pulls the `docs-site` branch of this repository on a schedule.
Nothing pushes to the website: no token for it exists, and none is needed.

The branch is the contract:

- Its tree is exactly the built site plus `README.md`. At the root: `api/`, `reference/`, `get-started/`, `guides/`, `sdks/`, `changelog.md`, `index.md`, `llms.txt`, `llms-full.md` and `release-status.json`. `build/docs/` after `node sdk/docs/generate.mjs` is that tree without the README.
- Every page is one Markdown file with frontmatter `title`, `description` and `available_in`, served at the site path plus the file name without `.md`. `api/index.md` is served at `api`, and `index.md` at the site root.
- Links between pages are `/docs/<site path>`.
- `README.md` names the main commit the tree was built from and says the branch must not be edited.
- The branch has one commit. Each publish replaces it with a new orphan commit, `docs: site generated from main at <sha>`, by force push, so the branch never accumulates history. A reader must fetch it, not fast-forward it.

The `publish` job in `docs-generate.yml`:

1. runs only for a push to main, after the `check` job passed, and is the only job with `contents: write`;
2. downloads the `docs-site` artifact the check job verified, so it publishes exactly what was checked;
3. reads the current branch anonymously, the repository being public;
4. runs `publish.mjs`, which checks the layout, writes `README.md`, and compares page by page with the current branch, ignoring the commit in spec page footers and the README. When no page differs it publishes nothing, so a main commit that does not touch the docs leaves the branch as it was, README included;
5. otherwise commits the tree as one orphan commit and pushes it with `--force-with-lease` against the commit it read, so a concurrent writer is refused rather than overwritten. The token reaches git as a header, never a remote URL or a file.

Two pushes to main cannot race: the workflow's concurrency group cancels the older run, a push is atomic, and the `publish` job has its own group that never cancels a running publish.
The push uses the workflow token, and a push made with that token starts no workflow; no workflow in this repository runs on pushes to `docs-site` either.

## Layout

```
generate.mjs        entry: write the site, verify
changed.mjs         the pages that differ between two generated sites
publish.mjs         stage a built site as the docs-site branch tree
lint.mjs            the vocabulary lint
cli.json            the CLI description stand-in
pages.json          the page list
examples/           the executed example scripts, shown verbatim on the pages
lib/spec.mjs        the spec in this checkout: build its entry point, load it, name the commit
lib/runtime.mjs     prism-code: types, version, error codes, the fixture
lib/examples.mjs    run one example and capture its output
lib/generate.mjs    render every page, narrative and generated, collecting problems by page
lib/site.mjs        narrative pages, release-status.json, frontmatter, link, command and layout checks
lib/schema.mjs      JSON Schema to table rows
lib/dts.mjs         declarations out of .d.ts files
lib/markdown.mjs    frontmatter, tables, fences, footer
lib/pages/          one module per tab: reference, cli, api, llms
skill.mjs           the agent skill: rebuild, check, smoke
lib/skill.mjs       the skill's generated blocks and rules
test/               node --test
```
