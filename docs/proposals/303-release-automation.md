# Release automation: from a commit on main to a tag

Issue [#303](https://github.com/UOR-Foundation/PrismPM/issues/303). Done when a tag is cut by automation from `main` with no manual changelog edit.

It includes the release-please configuration and changelog check from [#398](https://github.com/UOR-Foundation/PrismPM/pull/398), and builds on [#410](https://github.com/UOR-Foundation/PrismPM/pull/410), which regrouped the changelog under the four headers.
The policy lives in [RELEASES.md](../../RELEASES.md) and [SECURITY.md](../../SECURITY.md). This file says how the machinery works and why.

## The flow

| Step | What happens | Whose |
| --- | --- | --- |
| 1 | A pull request has a Conventional Commit title. `conventional-commits.yml` refuses any other. | Author, enforced |
| 2 | The pull request merges, and its subject lands on `main`. | Maintainer |
| 3 | Someone runs `release-please` with mode `open-pr`. It opens one release pull request per package with releasable commits, holding the version bump and the changelog entry. | Maintainer starts it, then automatic |
| 4 | The same job folds `## [Unreleased]` into each new entry, normalizes it to the four headers, runs `cargo update --workspace`, checks the result and pushes it to the release branch. | Automatic |
| 5 | A maintainer reviews and merges the release pull request. This is the decision to release. | Maintainer |
| 6 | The merge changes `.release-please-manifest.json`, which starts the `tag` job. It creates the tag and the GitHub Release, and sets the release body to the changelog entry. | Automatic |
| 7 | A maintainer publishes the packages from the tag. | Maintainer |

No step asks anyone to edit a changelog. Step 7 is deliberately separate.

## Why the tag does not publish

The `tag` job uses `GITHUB_TOKEN`. GitHub does not start workflows from events that token causes, so the new tag fires nothing.
This is what keeps publication a human decision: `npm-prism-code.yml` publishes on any `prism-code-v*` tag push, so a personal token here would turn merging a release pull request into an npm publish.
A test in `sdk/docs/test/release-config.test.mjs` holds the job to `GITHUB_TOKEN`, and holds the workflow to containing no publish command.

The consequence is that a tag cut this way needs a manual start to publish.
`npm-prism-code.yml` gains `workflow_dispatch` for that. Its publish job already keys on the ref, so this runs at the tag and nowhere else:

```bash
gh workflow run npm-prism-code.yml --ref prism-code-v0.3.1
```

## How RELEASE_NOTES.md and release.yml fit

They have different jobs, and each stays the only record of its own subject.

- **`CHANGELOG.md` says what changed.** The tag job copies the version's entry into the GitHub Release body.
- **`RELEASE_NOTES.md` says how to verify the release.** `release.yml` adds it below the changelog entry when it attaches assets. It sets `append_body: true`, because without that it would replace the body the tag job wrote.
- **`release.yml` publishes.** It builds and signs the images and native archives, attaches them, and uploads the crates. Nothing in `release-please.yml` overlaps with it.

For a release with no existing GitHub Release, such as a hand-pushed `v0.4.0`, `append_body` changes nothing: the body is `RELEASE_NOTES.md`, as today.

### The gap: release.yml can only publish 0.4.0

Closed by the factory's release cut: `release.yml` now reads the workspace
version, rehearses on `main` or `release/vMAJOR.MINOR`, and publishes at the tag
`vVERSION`, which `release-cut.yml` creates once a rehearsal passed and the
certified plan says the commit is cuttable (`prism-factory/README.md`,
"Cutting a release"). The root package now sets `skip-github-release`, so step 6
below tags only the npm packages. What follows is the record of the gap.

The root package gets its tag from this flow, but `release.yml` cannot yet publish that tag. Three things stand in the way, and this pull request fixes none of them.

- **The version is fixed.** `release.yml`, `scripts/release-phases.mjs`, `crates/model/src/release.rs`, `xtask/src/main.rs` and others name `0.4.0`, and the workflow triggers only on that tag.
- **A dispatch runs from `main`.** `publicationPolicy` refuses any other ref. Dispatching from `main` produces a cosign identity of `release.yml@refs/heads/main`, while `RELEASE_NOTES.md` tells consumers to expect `release.yml@refs/tags/v0.4.0`, so their check would fail. The workflow has to run at the tag.
- **`RELEASE_NOTES.md` names 0.4.0** in its title and its verification command.

So until that work lands, every root release needs a preparation pull request.
It does not block the done criterion, and it does not block `prism-code`. It should be its own change, because it reaches the release evidence chain.

The other three npm packages get tags from this flow but have no publish workflow yet: only `npm-prism-code.yml` publishes.

## Merged before the v0.4.0 tag

This merges before `v0.4.0` and `prism-code-v0.3.0` exist. Four things make that safe.

- **The merge creates no release.** Adding the manifest starts the `tag` job. release-please only tags a merged pull request labelled `autorelease: pending`, and none exists. Its own release step, run against the real `main`, returned zero releases.
- **A package waits until its own version is tagged.** `open-pr` leaves out the root package while `v<version>` is missing, and prism-code while `prism-code-v<version>` is missing, so no release lands on top of a version that never shipped or links to a compare page that does not exist. The others still get their pull requests: the root tag is the factory's cut and can lag for days, and it must not hold prism-code back. The pinned action cannot leave one package out, so `scripts/release-please-dry-run/open-pr.mjs` runs its library with the config narrowed in memory. Mode `dry-run` still works.
- **The manifest holds what the packages declare:** `0.4.0` and `0.3.0`. A test holds it to `Cargo.toml` and each `package.json`.
- **`bootstrap-sha` is the 0.4.0 preparation commit `2e44eed0`.** A package with no tag reads history only back to there, instead of up to 500 commits. Once a tag exists, the tag is used instead.

## Why the changelog needs no hand edit

Four things stood between #398 and the done criterion. The first is a bug, reproduced by the dry run below. #398 recorded the second and third as manual steps, which is what this issue removes.

| In #398 | Effect | Change here |
| --- | --- | --- |
| `bump-patch-for-minor-pre-major: false` | A plain `feat` bumps the minor. `changelog.mjs` then refuses the entry, because a minor with no breaking change breaks the rule in #262. Reproduced: a `feat` commit gave `v0.5.0` and the check failed. | Set it to `true`. A `feat` is now a patch below 1.0, and the option has no effect from 1.0 on. |
| release-please writes `### ⚠ BREAKING CHANGES` first, and nothing when there are no breaks | Every release pull request fails the check until someone edits it. | `normalizeNewestEntry` in `sdk/docs/lib/changelog.mjs`, run by the `open-pr` job. |
| `Cargo.lock` must be updated by hand | `--locked` builds fail on the release branch. | The `open-pr` job runs `cargo update --workspace`. Tested locally: it changes exactly the four workspace package versions. |
| Hand-written notes under `## [Unreleased]` | release-please inserts its entry above that section and leaves it, so shipped notes would stay marked unreleased until someone moved them. | `foldUnreleased` moves them into the new entry. Notes stay optional, and `CONTRIBUTING.md` now leads with the commit title. |

Normalization changes no bullet. It only renames the breaking section, moves it, merges repeated headers, or adds `None.`.

### Where the check still stops a release

A hand-written note under `## [Unreleased]` can list a breaking change that no commit marked with `!`. release-please then proposes a patch, and the check refuses it. This is the check doing its job, and the fix is a config change, not a changelog edit: set `release-as` for that package to the minor, and remove it after the tag.

This is the state of `main` today. #411 and #415 added breaking changes under `## [Unreleased]`, without `!` in their subjects, and the check finds such notes in both the root and `prism-code` changelogs. So the next releases are `v0.5.0` and `prism-code-v0.4.0`, unless those notes ship in the tags still to be cut.

## Enforcing Conventional Commits

`scripts/conventional-commits.mjs` runs on every pull request with a read-only token and no third-party action. The accepted types come from `release-please-config.json`, so a type cannot pass the check and then vanish from the changelog.

A title check alone would leave a hole. The repository sets `squash_merge_commit_title` to `COMMIT_OR_PR_TITLE`, so a squash of a single commit keeps that commit's subject and ignores the title. The check therefore also holds a lone commit to the rule.

Merge commits and rebases are a second hole that no check can close. They land every commit subject on `main`. Of the 100 commits on `main` before 2026-10-30, 44 subjects do not conform, and 42 of those are merge commits. Closing it is a repository setting: see "What the owner must set".

## Cutting release candidates

M5 asks for rc1 to rc3 ([#305](https://github.com/UOR-Foundation/PrismPM/issues/305)). A candidate window is a config change, and no changelog or tag is touched by hand. Each step is an ordinary pull request.

| Step | Change to `release-please-config.json`, for each package in the window | Result |
| --- | --- | --- |
| Open the window | Add `"versioning": "prerelease"`, `"prerelease": true`, `"prerelease-type": "rc"`, `"release-as": "1.0.0-rc.1"`. | Release pull request for `v1.0.0-rc.1`. |
| After rc.1 is tagged | Remove `release-as`. | Any later commit gives `rc.2`, then `rc.3`. |
| Close the window | Remove the three prerelease keys, and add `"release-as": "1.0.0"`. | Release pull request for `v1.0.0`. |
| After 1.0.0 is tagged | Remove `release-as`. | Normal SemVer from here. |

`release-as` has to come out after each tag, because leaving it would ask for the same version again and the tag already exists.
The same steps with `"prerelease-type": "beta"` cut `v1.0.0-beta.1` for M4.

On npm, a version with a prerelease suffix publishes under the `next` dist-tag. npm refuses a prerelease with no `--tag`, and a candidate must not become `latest`.

### Rehearsed through release-please's own code

Each line ran the dry run with that step's config and a rehearsal commit.

| Step | From | Commit | Tag | Prerelease | Changelog check |
| --- | --- | --- | --- | --- | --- |
| Open the window | 0.6.0 | `fix` | `v1.0.0-rc.1` | true | ok |
| Next candidate | 1.0.0-rc.1 | `fix` | `v1.0.0-rc.2` | true | ok |
| Next candidate | 1.0.0-rc.2 | `feat` | `v1.0.0-rc.3` | true | ok |
| Breaking change in the window | 1.0.0-rc.3 | `feat!` | `v1.0.0-rc.4` | true | ok |
| Close the window | 1.0.0-rc.3 | `chore` | `v1.0.0` | false | ok |
| After 1.0 | 1.0.0 | `fix` | `v1.0.1` | false | ok |
| After 1.0 | 1.0.0 | `feat` | `v1.1.0` | false | ok |
| After 1.0 | 1.0.0 | `feat!` | `v2.0.0` | false | ok |

### Two conflicts in the plan

- **A breaking change cannot reset the number.** #305 says the RC counter resets to 1, but `v1.0.0-rc.1` already exists and npm and crates.io never allow a version twice. The number keeps rising, as `rc.4` above shows. RELEASES.md therefore resets the count of candidates that qualify: three more are needed after a breaking change.
- **The roadmap does not fit the spacing.** #305 asks for candidates at least a week apart, so three take at least 14 days. M4 is due 2026-11-06, M5 2026-11-09 and M6 2026-11-10. RELEASES.md follows #305. Either those dates move or the spacing does, and that is the owner's call.

## Dry run: the done criterion as far as it can go without a tag

`scripts/release-please-dry-run/dry-run.mjs` runs release-please at 17.1.3, the version the pinned action bundles, against the real commit history of `main`. It builds each release pull request, hands it to release-please's own tagging code as if merged, and applies the workflow's normalization and check. It only reads. Once merged, it runs in the workflow as mode `dry-run`, in a fork as well.

No `v0.4.0` tag exists yet, so these runs read history back to `bootstrap-sha`. This first run was on 2026-10-30, when `main` had three commits after that one and no `## [Unreleased]` section:

```bash
node scripts/release-please-dry-run/dry-run.mjs
```

The output for the root package, with commit links shortened here:

```text
v0.4.1
  Release pull request: chore(main): release 0.4.1
                        from release-please--branches--main--components--prismpm
  Files it changes:     CHANGELOG.md, Cargo.toml, .release-please-manifest.json
  GitHub Release:       name v0.4.1, prerelease false
  Check as written:     0.4.1 has no ### Breaking Changes
  Check normalized:     passes, no hand edit needed

## [0.4.1](https://github.com/UOR-Foundation/PrismPM/compare/v0.4.0...v0.4.1) (2026-10-30)

### Breaking Changes

None.

### Bugs Fixed

* **test:** make the standalone browser owners pass under LexLean 0.4 (V&V blocker) (#404) (9aa3d92)
* **verify:** keep browser timing out of the digest-bound evidence (follow-up to #392, #397) (#400) (95ec046)
* **verify:** keep per-run browser timing out of oracle comparisons and the manifest (follow-up to #392, #400) (#403) (1010e48)
```

With a rehearsal commit `feat(holo)!: ...` added, the root becomes `v0.5.0`. The breaking section moves after Features Added and the check passes. A `fix(prism-code)` touching `sdk/npm/prism-code` also gives `prism-code-v0.3.1`, with a body naming only that fix.

Run again on 2026-10-31 with the notes now under `## [Unreleased]`, it exits 1, for the reason in "Where the check still stops a release":

```text
v0.4.1                   FAILS: 0.4.1 lists breaking changes, so before 1.0 it must be a minor bump over 0.4.0
prism-code-v0.3.1        FAILS: 0.3.1 lists breaking changes, so before 1.0 it must be a minor bump over 0.3.0
prism-code-spec-v0.1.1, prism-code-verify-v0.1.1, prism-code-conformance-v0.1.1   pass
```

With `release-as` set to `0.5.0` and `0.4.0` for those two, every package passes.

### What the dry run does not prove

- **The write path has not run.** Creating the tag, the GitHub Release and the label change happens only in the real workflow, which GitHub can dispatch only once the file is on `main`. The first real release is the final proof.
- **The normalization step in the workflow has not run** as a workflow. Its pieces ran separately: the normalizer through tests and the dry run, and `cargo update --workspace` by hand.

## What the owner must set

None of these is in this pull request, because each is a repository or organization setting.

| Setting | Why | State today |
| --- | --- | --- |
| Turn on private vulnerability reporting | SECURITY.md sends reporters there, and so does `RELEASE_NOTES.md`. | **Off.** The API reports `enabled: false`, so that link does not work yet. |
| Add `RELEASE_PLEASE_TOKEN`, or allow Actions to create pull requests | `GITHUB_TOKEN` cannot open a release pull request while that setting is off. | Off. With the setting alone, CI does not start on a release pull request; closing and reopening it starts CI. The token avoids that, so it is the better choice. |
| Allow squash merges only, and set `squash_merge_commit_title` to `PR_TITLE` | Closes the merge-commit hole above, and makes the title the only subject. | Merge, rebase and squash are all allowed. |
| Make `conventional commits` a required check | Until then it only reports. | The ruleset on `main` is disabled. |
| Add required reviewers to the `npm` environment | Anyone with write access can now dispatch a publish from a `prism-code-v*` tag. They could already push such a tag. | No protection rules. |

## Options weighed

| Option | Why not |
| --- | --- |
| A personal token on the tag job | Merging a release pull request would publish to npm. This is the option that was rejected on purpose. |
| Opening release pull requests on every push | Five packages would each keep a pull request open and rewritten on every merge, during a period when `main` moves many times a day. #398 chose a manual start, and this keeps it. |
| Teach the check to accept release-please's headings | STABILITY.md section 2 fixes the headers, and readers see them. The tool should fit the policy. |
| Relax the check so a minor may be non-breaking | #262 says minor means breaking and patch means everything else. |
| Changesets | The issue allows it, but #398 already chose release-please, and it needs a hand-written file per change. |
| A third-party title-check action | It would add a dependency with access to pull request data, for a check that fits in a short script and can read the types from the config. |
