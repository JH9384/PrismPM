# Releases

This file says how PrismPM releases are cut, what each kind may contain, and how long each is supported.
[STABILITY.md](STABILITY.md) says what you can rely on between versions. This file says when those versions appear.

It covers every package we publish: the `prismpm` crate and SDK, the `prism-code` npm package, and every `@prism-code/*` package.
Each package has its own version and its own tag.

| Package | Tag |
| --- | --- |
| `prismpm` crate and SDK images | `vX.Y.Z` |
| `prism-code` | `prism-code-vX.Y.Z` |
| `@prism-code/spec` | `prism-code-spec-vX.Y.Z` |
| `@prism-code/verify` | `prism-code-verify-vX.Y.Z` |
| `create-prism-code` | `create-prism-code-vX.Y.Z` |
| `@prism-code/conformance` | `prism-code-conformance-vX.Y.Z` |

## How a release is cut

1. A maintainer runs the `release-please` workflow. It opens a release pull request for each package with releasable commits.
2. A maintainer reviews and merges the release pull request. That merge is the decision to release.
3. Automation creates the tag and the GitHub Release. The release body is the changelog entry.
4. A maintainer publishes from the tag.

Nobody has to edit a changelog by hand. Each entry is written from the commit subjects, so a pull request title is a line of the changelog.
A longer note can go under `## [Unreleased]`, and the release pull request folds it into the new entry.
[docs/proposals/303-release-automation.md](docs/proposals/303-release-automation.md) has the details.

## Who may cut a release

Repository maintainers cut releases, as the foundation's [governance](https://github.com/UOR-Foundation/.github/blob/main/governance/GOVERNANCE.md) assigns them.
A release pull request needs the reviews that governance sets for any change, from someone other than the person who started it.
A major version and a release candidate window each need two maintainers to approve.

Nothing publishes on its own. A tag cut by the automation starts no workflow.

## Cadence

- **Before 1.0:** a release at least monthly while unreleased commits exist, as OCI specifications do, so that users can give feedback.
- **From 1.0:** minor and patch releases as needed.
- **Majors:** only when a Stable surface has to break, under the twelve-month deprecation rule in [STABILITY.md](STABILITY.md) section 4.

## What each version may contain

| Bump | Before 1.0 | From 1.0 |
| --- | --- | --- |
| Patch | Anything that breaks nothing, features included. | Bug fixes, security fixes, documentation and dependency updates. |
| Minor | Breaking changes, each listed in the changelog. | New features and deprecations. Nothing that breaks a Stable surface. |
| Major | Not used. | Breaking changes to a Stable surface, with a published migration guide. |

These hold in every patch:

- It never breaks a Stable or Beta surface, and it never adds a `.holo` format revision.
- It may change an Experimental surface, as [STABILITY.md](STABILITY.md) section 1 allows. If you use one, pin the exact version.

A commit's type sets the bump: `fix` is a patch, `feat` a minor (a patch before 1.0), and `!` or a `BREAKING CHANGE:` footer the breaking bump.

## Release candidates

A major version ships only after three release candidates. The rules follow the [OCI image-spec](https://github.com/opencontainers/image-spec/blob/main/RELEASES.md).

- Candidates are numbered `X.0.0-rc.N`, and each one is a real tag and a real publication.
- Candidates are at least one week apart.
- A breaking change restarts the count: three more candidates are needed after it. A number is never reused, so after `rc.3` the next one is `rc.4`, and it counts as the first.
- A candidate is marked as a prerelease on GitHub and published under the `next` dist-tag on npm, so it never becomes `latest`.
- The final version needs no open `priority/critical-urgent` issue, and meets the gates of [#305](https://github.com/UOR-Foundation/PrismPM/issues/305).
- A minor or patch needs no candidate.

The aim of the window is zero breaking changes. Work that can wait for the next minor should wait.

## Support windows

| Line | Bug fixes | Security fixes |
| --- | --- | --- |
| Latest minor of the current major | Yes | Yes |
| Older minors of the current major | No, upgrade to the latest minor | No, upgrade to the latest minor |
| Latest minor of the previous major | No | For twelve months after the next major ships |
| Anything older | No | No |
| Before 1.0: latest minor | Yes | Yes |
| Before 1.0: anything older | No | No |

A minor is a safe upgrade from 1.0 on, which is why older minors get no fixes of their own.
The twelve months match the deprecation window in [STABILITY.md](STABILITY.md) section 4.
Format revisions are supported separately: every reader states which revisions it accepts.

A fix for the previous major is cut from a branch for that line. The release automation runs on `main` only today, so such a release is cut by hand until the first one is needed.

[SECURITY.md](SECURITY.md) says how to report a vulnerability.
