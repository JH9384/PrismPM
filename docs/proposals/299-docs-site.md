# Proposal 299: docs site on Mintlify, organized by Diátaxis

| | |
| --- | --- |
| Issue | [#299](https://github.com/UOR-Foundation/PrismPM/issues/299) |
| Milestone | M4 v1.0-beta.1 Freeze, ship, docs |
| Status | Proposed |
| Depends on | #260 (vocabulary, done), #340 (nothing generated is committed, done) |
| Works with | #300 (reference pages), #301 (migration guide), #327 (claims bound to checks) |

## Summary

The site has three tabs, Docs, Reference and Changelog, and seven groups: Get started, Concepts, Guides, Examples, Reference, Changelog and Migration.
The generator from #300 stays the only build.
It gains one derived output: a `mintlify/` directory holding `docs.json` and every page in the form Mintlify accepts.
Nothing generated is committed, and the existing `docs-site` branch publish carries the new directory with no new job.
The site has one version per major, and `pages.json` refuses any other version name.

## Motivation

The built site could not be served by Mintlify. Running the Mintlify CLI (`mint` 4.2.1178) on it found three problems:

- HTML comments are a parse error in Mintlify's MDX parser. The generated-region markers on `reference/release-status` and `api/spec-package` break those pages.
- Every internal link is `/docs/<path>`, the path the current hosting site serves. Mintlify serves pages at `/<path>`, so every link is broken.
- `available_in` means nothing to Mintlify. A reader would see a page describing an unreleased verb with no sign that it has not shipped.

The content also has gaps. There is no Concepts, Examples or Migration group, and no how-to for rebuilding and updating a pinned project.

### Goals

- `docs.json` and the page tree come from one command, from the checkout.
- `pages.json` stays the one page list. The tabs map onto its groups, and a group in no tab fails the build.
- Each Diátaxis form has a home: tutorial in Get started, explanation in Concepts, how-to in Guides, reference in Reference.
- Every page on the Mintlify site says when it needs a release that has not shipped.
- The existing hosting site keeps working through the cutover.

### Non-goals

- Reference page bodies, executing the remaining examples and replacing `cli.json`. These stay with #300.
- The full 0.x to 1.0 guide. The page exists here and #301 owns its content.
- Claim references on guide sentences. These stay with #327.
- Creating the Mintlify account or pointing a domain at it. That happens outside this repository.

## Proposal

### Tabs and groups

| Tab | Group | Diátaxis form | Pages |
| --- | --- | --- | --- |
| Docs | Get started | tutorial | home, what Prism is, quickstart, core concepts |
| Docs | Concepts | explanation | holo, proof and assurance, world and capabilities, provenance and attestations, reproducible builds, registries and releases |
| Docs | Guides | how-to | one per key scenario, listed below |
| Docs | Examples | executed samples | call, inspect, replay and check a holo, from code and from the command line |
| Reference | Reference | reference | formats, CLI, errors, policy, release status, with API Reference and SDKs nested inside |
| Changelog | Changelog | reference | the changelog |
| Changelog | Migration | how-to | one guide per major |

`pages.json` keeps API Reference and SDKs as their own page groups, so `llms.txt` keeps those sections and #300's generators are untouched.
On the site they nest inside the Reference group, which gives the seven groups the issue names.

### Key scenarios and their how-tos

The vocabulary page names three people: a user runs a holo, a developer rebuilds it and a security officer audits it. Those expand to these scenarios:

| Scenario | How-to |
| --- | --- |
| Write an application from examples | `guides/write-from-examples` |
| Write the model by hand | `guides/write-the-model` |
| Check a holo and read the verdict | `guides/verify-and-inspect` |
| Run a holo behind the gate | `guides/run-and-gate` |
| Ship through a registry, Pages or Docker | `guides/ship` |
| Rebuild and update a pinned project | `guides/rebuild-and-update` (new) |
| Use a holo from an agent | `guides/agents` |
| Audit a holo | `guides/audit` |

### Generated and hand-written

| Output | Source | Committed |
| --- | --- | --- |
| Reference and API pages | spec, runtime and `cli.json`, as in #300 | no |
| Concepts, Guides, Get started, Migration, Changelog | `docs/site/`, by hand | yes, as source |
| Examples | prose in `docs/site/examples/`, code and output from executed `sdk/docs/examples/` | prose and scripts only |
| `docs.json` | `pages.json` and its `mintlify` table | no |
| `llms.txt`, `llms-full.md`, `llms-full.txt` | the page list and the rendered pages | no |

### The Mintlify tree

`renderSite` derives `mintlify/` from the rendered pages. Each page gets three changes and no others:

1. HTML comments outside code fences are removed.
2. `/docs/<path>` links become `/<path>`.
3. A page whose `available_in` names a planned release gets a note under its frontmatter naming that release and linking to Release status. The note disappears when `release-status.json` marks the release shipped.

The changelog is written as `changelog/index.md`, because Mintlify skips a file named `changelog.md`. Its URL stays `/changelog`.

The tree also holds `docs.json`, `llms.txt` and `llms-full.txt`, the extension Mintlify requires for a custom full index.
`docs.json` redirects `/docs/:slug*` to `/:slug*`, so links to today's paths keep working if the domain moves to Mintlify.

The check is two layers. `generate.mjs verify` checks the tree without dependencies: every listed page exists, every page is listed, no comment or `/docs/` link survives. A CI job also runs the exact-pinned Mintlify CLI on the tree, because only Mintlify's parser can say what Mintlify accepts.

### Versions per major

`pages.json` holds a `versions` list. Each entry names a major as `v<N>` and any other spelling fails the build, so a minor cannot gain its own version.
Today the list has `v1`, and a page's `available_in` marks the release it needs inside that major.

When work on 2.0 starts, the last 1.x commit is cut to a `release/1.x` branch and its tree is copied under `v1/`, with `docs.json` listing `v2` first and `v1` after it.
No code for that step is written now, because no second major exists to test it against.

## Design details

### Publishing

`mintlify/` is one more top-level entry in the built site, so the check job uploads it and the publish job pushes it to `docs-site`.
Mintlify reads that branch with `mintlify/` as its content directory.
The current hosting site ignores the directory, and the new top-level `concepts/`, `examples/` and `migration/` directories hold ordinary pages under the existing contract.

`changed.mjs` leaves `mintlify/` out of the pull request summary, because each page would otherwise show twice. `publish.mjs` still compares it, so a navigation-only change publishes.

### Coverage

The issue is done when every public item has a reference entry and an example.
`node sdk/docs/coverage.mjs` lists the CLI verbs and runtime exports and says which have each.
A missing reference entry fails it. A missing example is reported and does not fail it until #300 finishes, because most of those examples wait on verbs that have not shipped.

### Vocabulary

The hand-written pages and `cli.json` said "toolchain image" where the vocabulary page says "SDK image", and the introduction mapped the model to a build context where the vocabulary maps it to a Dockerfile. Both now follow the vocabulary page.

### Test plan

- Unit tests for the page transform, `docs.json`, the version-name rule, and a group missing from every tab.
- A test that the tree holds every page and no comment or `/docs/` link.
- A test that the note appears for a planned release and not for a shipped one.
- The Mintlify CLI's `validate` and `broken-links` on the built tree, in CI.

### Graduation criteria

- Every public item has a reference entry and an example, by `coverage.mjs`.
- The Mintlify project reads `docs-site` and the site is live.
- `site` in `pages.json` names the Mintlify domain.

## Precedent

- Docker's Get started, Guides, Manuals and Reference.
- Diátaxis's four forms of documentation.
- Docusaurus's advice to version per major only.

## Alternatives

- Make every page valid for Mintlify in place, and drop the current host's `/docs/` paths. Rejected: it breaks the running site before the new one exists.
- Publish the Mintlify tree to a second branch. Rejected: a second publish job and a second lease for no gain.
- Hand-write `docs.json`. Rejected: it becomes a second page list that drifts from `pages.json`.
- Add a version per minor. Rejected by the issue: `available_in` already says which release a page needs.

## Unresolved questions

1. Who owns the Mintlify project, and which domain does it serve? Until that is decided, `llms.txt` links stay on the current host.
2. The `prism` CLI has not shipped, so the quickstart's output blocks are written by hand, not captured. They should become executed examples before they are presented as working.
